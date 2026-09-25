import crypto from 'crypto';
import { Match, MatchEvent, FacebookPageConfig } from '../types.js';
import { db, getTodayDateString } from '../db/index.js';
import { cache } from '../cache/redis.js';
import { config } from '../config.js';
import { publisherQueue } from '../publisher/queue.js';
import { facebookPublisher } from '../publisher/facebook_publisher.js';
import { flashscoreClient } from '../scraper/flashscore_client.js';
import {
  formatGoalPost,
  formatYellowCardPost,
  formatRedCardPost,
  formatCornerPost,
  formatKickoffPost,
  formatHalfTimePost,
  formatFullTimePost,
  formatLiveRoundupPost,
  formatResultsRoundupPost,
  formatHalfTimeRoundupPost,
} from '../publisher/templates.js';

type BroadcastCallback = (type: string, payload: any) => void;

class SportsSyncEngine {
  private isRunning = false;
  private isSyncing = false;
  private timer: NodeJS.Timeout | null = null;
  private previousMatches: Map<string, Match> = new Map();
  private broadcastFn: BroadcastCallback | null = null;
  private lastScrapeTime: string | null = null;
  private scrapeCount = 0;
  private lastError: string | null = null;
  private lastRoundupFingerprint = '';
  private lastActiveDay = '';

  setBroadcast(fn: BroadcastCallback): void {
    this.broadcastFn = fn;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[SyncEngine] Starting sports sync engine...');

    if (this.broadcastFn) {
      this.broadcastFn('sync_status_updated', this.getStatus());
    }

    // Load initial matches from database / cache
    try {
      const cached = await cache.getLiveMatches();
      if (cached && cached.length > 0) {
        for (const m of cached) {
          this.previousMatches.set(m.id, m);
        }
      }
    } catch (e) {
      console.warn('[SyncEngine] Could not load initial cached matches:', e);
    }

    // Run first sync immediately
    await this.syncLiveMatches().catch(err => {
      console.warn('[SyncEngine] Initial sync error:', (err as Error)?.message || err);
    });

    // Schedule regular polling
    const intervalMs = Math.max(5000, config.scrapeIntervalSeconds * 1000);
    this.timer = setInterval(() => {
      this.syncLiveMatches().catch(err => {
        console.warn('[SyncEngine] Polling error:', (err as Error)?.message || err);
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    console.log('[SyncEngine] Stopped sports sync engine.');
    if (this.broadcastFn) {
      this.broadcastFn('sync_status_updated', this.getStatus());
    }
  }

  /**
   * Syncs live matches from Scrapling / Flashscore engine
   */
  async syncLiveMatches(): Promise<Match[]> {
    // Explicit synchronization guard (mutex) to prevent overlapping executions
    if (this.isSyncing) {
      console.log('[SyncEngine] Skipping sync cycle - previous syncLiveMatches is still in progress');
      return Array.from(this.previousMatches.values());
    }

    this.isSyncing = true;
    try {
      const incomingMatches: Match[] = await flashscoreClient.getLiveMatches();
      this.lastScrapeTime = new Date().toISOString();
      this.scrapeCount++;
      this.lastError = null;

      // Day rollover check for automatic league selection reset
      const fbConfig = await db.getSettings<FacebookPageConfig>('fbConfig', { timezone: 'UTC' } as any);
      const today = getTodayDateString(fbConfig.timezone || 'UTC');
      if (this.lastActiveDay && this.lastActiveDay !== today) {
        console.log(`[SyncEngine] Day rollover detected: ${this.lastActiveDay} -> ${today}. Auto-resetting daily league selection.`);
        const resetSelection = await db.getDailyLeagueSelection(fbConfig.timezone || 'UTC');
        if (this.broadcastFn) {
          this.broadcastFn('daily_leagues_updated', {
            date: resetSelection.date,
            selectedLeagueIds: resetSelection.selectedLeagueIds,
            reset: true,
            message: `A new day (${resetSelection.date}) has begun. League selection has been automatically reset.`
          });
        }
      }
      this.lastActiveDay = today;

      // Update cache
      await cache.setLiveMatches(incomingMatches, 30);

      // Diff against previous matches for real-time live events & Facebook publishing
      await this.processMatchDiffs(incomingMatches);

      // Broadcast live matches list to all connected clients (strictly filtered by today's selected leagues)
      if (this.broadcastFn) {
        const dailySelection = await db.getDailyLeagueSelection(fbConfig.timezone || 'UTC');
        const filteredMatches = dailySelection.selectedLeagueIds.length > 0
          ? incomingMatches.filter(m => m.league?.id && dailySelection.selectedLeagueIds.includes(m.league.id))
          : [];

        this.broadcastFn('live_matches_updated', {
          count: filteredMatches.length,
          totalUnfiltered: incomingMatches.length,
          timestamp: this.lastScrapeTime,
          matches: filteredMatches,
          dailySelectionDate: dailySelection.date,
          selectedLeagueCount: dailySelection.selectedLeagueIds.length,
        });
      }

      return incomingMatches;
    } catch (err: any) {
      this.lastError = err.message || 'Unknown scrape error';
      console.warn(`[SyncEngine] Live sync warning: ${this.lastError}`);
      throw err;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Compare previous match state to incoming match state to identify
   * Goals, Kickoffs, Half-Times, Red Cards, and Full-Times
   */
  private async processMatchDiffs(currentMatches: Match[]): Promise<void> {
    const fbConfig = await db.getSettings<FacebookPageConfig>('fbConfig', {
      pageId: config.fbPageId,
      isConnected: false,
      autoPublishEnabled: false,
      publishingMode: 'roundup',
      roundupIntervalMinutes: 15,
      minPostSpacingSeconds: 30,
      publishGoals: true,
      publishYellowCards: true,
      publishRedCards: true,
      publishCorners: true,
      publishKickoff: true,
      publishHalfTime: true,
      publishFullTime: true,
      includeStatsInFullTime: true,
      targetLeagueIds: [],
      postTemplateGoal: '',
      postTemplateYellowCard: '',
      postTemplateRedCard: '',
      postTemplateCorner: '',
      postTemplateKickoff: '',
      postTemplateHalfTime: '',
      postTemplateFullTime: '',
    });

    for (const match of currentMatches) {
      const prev = this.previousMatches.get(match.id);
      await db.saveMatch(match);

      if (prev) {
        // 1. Kickoff detection (SCHEDULED -> IN_PLAY)
        if (prev.status === 'SCHEDULED' && match.status === 'IN_PLAY') {
          await this.handleEvent({
            match,
            type: 'KICKOFF',
            teamSide: 'home',
            playerName: '',
            minute: 1,
            fbConfig,
          });
        }

        // 2. Goal detection (Score change)
        let eventMinute = match.minute || prev.minute;
        if (!eventMinute && match.startTime) {
          const elapsed = Math.floor((Date.now() - new Date(match.startTime).getTime()) / 60000);
          if (elapsed >= 1 && elapsed <= 130) eventMinute = elapsed;
        }
        if (!eventMinute && match.statusText) {
          const m = match.statusText.match(/(\d+)/);
          if (m) eventMinute = parseInt(m[1], 10);
        }
        const finalMinute = eventMinute || 1;

        if (match.homeScore > prev.homeScore) {
          const diff = match.homeScore - prev.homeScore;
          for (let i = 0; i < diff; i++) {
            await this.handleEvent({
              match,
              type: 'GOAL',
              teamSide: 'home',
              playerName: match.homeTeam.name,
              minute: finalMinute,
              homeScore: match.homeScore,
              awayScore: match.awayScore,
              fbConfig,
            });
          }
        }

        if (match.awayScore > prev.awayScore) {
          const diff = match.awayScore - prev.awayScore;
          for (let i = 0; i < diff; i++) {
            await this.handleEvent({
              match,
              type: 'GOAL',
              teamSide: 'away',
              playerName: match.awayTeam.name,
              minute: finalMinute,
              homeScore: match.homeScore,
              awayScore: match.awayScore,
              fbConfig,
            });
          }
        }

        // 3. Half-time detection
        if (prev.status === 'IN_PLAY' && match.status === 'PAUSED') {
          await this.handleEvent({
            match,
            type: 'HALF_TIME',
            teamSide: 'home',
            playerName: '',
            minute: 45,
            homeScore: match.homeScore,
            awayScore: match.awayScore,
            fbConfig,
          });
        }

        // 4. Full-time detection
        if ((prev.status === 'IN_PLAY' || prev.status === 'PAUSED') && match.status === 'FINISHED') {
          let stats = undefined;
          if (fbConfig.includeStatsInFullTime) {
            try {
              stats = await this.getMatchStatistics(match.id);
            } catch (e) {
              // Ignore stats fetch failure on finished
            }
          }

          await this.handleEvent({
            match,
            type: 'FULL_TIME',
            teamSide: 'home',
            playerName: '',
            minute: 90,
            homeScore: match.homeScore,
            awayScore: match.awayScore,
            fbConfig,
            stats,
          });
        }

        // 5. Cards & Corner events detection from stats diff
        if (match.stats && prev.stats) {
          // Yellow cards
          if ((match.stats.yellowCardsHome ?? 0) > (prev.stats.yellowCardsHome ?? 0)) {
            await this.handleEvent({
              match,
              type: 'YELLOW_CARD',
              teamSide: 'home',
              playerName: `${match.homeTeam.name} Player`,
              minute: finalMinute,
              fbConfig,
            });
          }
          if ((match.stats.yellowCardsAway ?? 0) > (prev.stats.yellowCardsAway ?? 0)) {
            await this.handleEvent({
              match,
              type: 'YELLOW_CARD',
              teamSide: 'away',
              playerName: `${match.awayTeam.name} Player`,
              minute: finalMinute,
              fbConfig,
            });
          }

          // Red cards
          if ((match.stats.redCardsHome ?? 0) > (prev.stats.redCardsHome ?? 0)) {
            await this.handleEvent({
              match,
              type: 'RED_CARD',
              teamSide: 'home',
              playerName: `${match.homeTeam.name} Player`,
              minute: finalMinute,
              fbConfig,
            });
          }
          if ((match.stats.redCardsAway ?? 0) > (prev.stats.redCardsAway ?? 0)) {
            await this.handleEvent({
              match,
              type: 'RED_CARD',
              teamSide: 'away',
              playerName: `${match.awayTeam.name} Player`,
              minute: finalMinute,
              fbConfig,
            });
          }

          // Corners
          if ((match.stats.cornersHome ?? 0) > (prev.stats.cornersHome ?? 0)) {
            await this.handleEvent({
              match,
              type: 'CORNER',
              teamSide: 'home',
              playerName: `${match.homeTeam.name}`,
              minute: finalMinute,
              fbConfig,
            });
          }
          if ((match.stats.cornersAway ?? 0) > (prev.stats.cornersAway ?? 0)) {
            await this.handleEvent({
              match,
              type: 'CORNER',
              teamSide: 'away',
              playerName: `${match.awayTeam.name}`,
              minute: finalMinute,
              fbConfig,
            });
          }
        }
      }

      // Update in memory map
      this.previousMatches.set(match.id, match);
    }

    // Auto-Roundup Publishing check (All live games, half-time, and full-time in single posts without conflict)
    if (fbConfig.autoPublishEnabled) {
      await this.coordinateAndPublishRoundups(currentMatches, fbConfig);
    }
  }

  async enrichMatchesWithStats(matches: Match[]): Promise<Match[]> {
    if (!matches || matches.length === 0) return matches;
    await Promise.all(
      matches.map(async (m) => {
        try {
          if (!m.stats) {
            const stats = await this.getMatchStatistics(m.id);
            if (stats) m.stats = stats;
          }
          if (!m.events || m.events.length === 0) {
            const events = await this.getMatchEvents(m.id);
            if (events && events.length > 0) m.events = events;
          }
        } catch {
          // Ignore error on individual match
        }
      })
    );
    return matches;
  }

  /**
   * Unified Conflict-Free Roundup Coordinator:
   * Guarantees ZERO CONFLICT between:
   * 1. Live Scoreboard (posting strictly according to user-selected minutes, e.g. 5m, 10m, 15m)
   * 2. Grouped Half-Time Scores (intermission updates, published once per match)
   * 3. Grouped Full-Time Results (completed matches, published once per match)
   *
   * Architectural Guarantees:
   * - Strict inter-post safety delay (fbConfig.minPostSpacingSeconds || 30) between ALL posts to prevent Meta Graph API collisions.
   * - Priority 1: Full-Time Results. Completed matches have highest priority.
   * - Priority 2: Half-Time Scores. Matches at intermission are captured and posted once.
   * - Priority 3: Live Scoreboard. Scheduled updates for in-play matches strictly respecting roundupIntervalMinutes.
   * - Exactly ONE post is dispatched per sync tick, completely eliminating race conditions.
   */
  private async coordinateAndPublishRoundups(currentMatches: Match[], fbConfig: FacebookPageConfig): Promise<void> {
    if (!fbConfig.autoPublishEnabled) return;

    const hasToken = Boolean(fbConfig.pageAccessToken || config.fbPageAccessToken);
    const hasPageId = Boolean(fbConfig.pageId || config.fbPageId);
    if (!hasToken || !hasPageId) return;

    // Check if Meta anti-spam cooldown is active
    const cooldownStatus = await facebookPublisher.isCooldownActive();
    if (cooldownStatus.active) return;

    // Inter-post safety delay (safe buffer between consecutive posts)
    const minSpacingSec = Math.max(15, fbConfig.minPostSpacingSeconds || config.fbMinPublishIntervalSeconds || 30);
    const minSpacingMs = minSpacingSec * 1000;

    // Determine the timestamp of the last post of ANY type
    const publisherState = await db.getPublisherState();
    const lastPublishTimes = [
      fbConfig.lastRoundupPublishedAt ? new Date(fbConfig.lastRoundupPublishedAt).getTime() : 0,
      fbConfig.lastHtRoundupPublishedAt ? new Date(fbConfig.lastHtRoundupPublishedAt).getTime() : 0,
      fbConfig.lastFtRoundupPublishedAt ? new Date(fbConfig.lastFtRoundupPublishedAt).getTime() : 0,
      publisherState.lastPublishAt ? new Date(publisherState.lastPublishAt).getTime() : 0,
      publisherState.lastSuccessfulPublishAt ? new Date(publisherState.lastSuccessfulPublishAt).getTime() : 0,
    ];
    const lastAnyPostTime = Math.max(...lastPublishTimes);
    const elapsedSinceAnyPost = Date.now() - lastAnyPostTime;

    // If ANY post was made less than minSpacingMs ago, wait for safe buffer to avoid Meta API collision
    if (lastAnyPostTime > 0 && elapsedSinceAnyPost < minSpacingMs) {
      return;
    }

    // Must have target leagues selected for today
    if (!fbConfig.targetLeagueIds || fbConfig.targetLeagueIds.length === 0) {
      return;
    }

    // =========================================================================
    // PRIORITY 1: FULL-TIME RESULTS (MATCHES FINISHED)
    // =========================================================================
    if (fbConfig.publishFullTime && (fbConfig.autoPublishFtRoundup ?? true)) {
      const dispatched = await this.tryPublishFinishedRoundup(fbConfig);
      if (dispatched) {
        return; // Yield this tick: next post will safely wait for minSpacingMs
      }
    }

    // =========================================================================
    // PRIORITY 2: HALF-TIME SCORES (MATCHES REACHED INTERMISSION)
    // =========================================================================
    if (fbConfig.publishHalfTime && (fbConfig.autoPublishHtRoundup ?? true)) {
      const dispatched = await this.tryPublishHalfTimeRoundup(currentMatches, fbConfig);
      if (dispatched) {
        return; // Yield this tick: next post will safely wait for minSpacingMs
      }
    }

    // =========================================================================
    // PRIORITY 3: LIVE SCOREBOARD (ACCORDING TO SELECTED MINUTES)
    // =========================================================================
    await this.tryPublishLiveRoundup(currentMatches, fbConfig, minSpacingMs);
  }

  /**
   * Group newly finished matches and publish a single Full-Time Results post.
   * Strictly filters out matches that have already been published so teams are never repeated.
   */
  private async tryPublishFinishedRoundup(fbConfig: FacebookPageConfig): Promise<boolean> {
    try {
      // 1. Get finished matches from results cache/feed
      const resultsToday = await this.getResults(0);
      // 2. Also check any finished matches in previousMatches map
      const finishedFromMap = Array.from(this.previousMatches.values()).filter(m => m.status === 'FINISHED');

      // Combine and de-duplicate by ID
      const allFinishedMap = new Map<string, Match>();
      for (const m of resultsToday) allFinishedMap.set(m.id, m);
      for (const m of finishedFromMap) allFinishedMap.set(m.id, m);
      const allFinished = Array.from(allFinishedMap.values());

      if (allFinished.length === 0) return false;

      // Filter strictly by target leagues selected for today
      if (!fbConfig.targetLeagueIds || fbConfig.targetLeagueIds.length === 0) {
        return false;
      }
      const eligible = allFinished.filter(m => fbConfig.targetLeagueIds.includes(m.league?.id));

      // STRICT DE-DUPLICATION: Filter out any matches whose FT result was ALREADY published
      const unpublished: Match[] = [];
      for (const m of eligible) {
        const isPublished = await db.isFtMatchPublished(m.id, m.homeTeam?.name, m.awayTeam?.name);
        if (!isPublished) {
          unpublished.push(m);
        }
      }

      // DO NOT REPEAT POSTING: If there are NO new unpublished completed matches, do nothing!
      if (unpublished.length === 0) {
        return false;
      }

      // Build deterministic logical identity based on the sorted match IDs
      const sortedMatchIds = unpublished.map(m => m.id).sort();
      const matchBatchHash = crypto.createHash('sha256').update(sortedMatchIds.join(',')).digest('hex').substring(0, 16);
      const deterministicId = `roundup_ft_${matchBatchHash}`;

      // ATOMIC CLAIM: Atomically claim matches in DB to prevent duplicate job generation from overlapping sync cycles
      const claimedMatches = await db.claimFtMatchesForPublication(unpublished, deterministicId);
      if (claimedMatches.length === 0) {
        console.log(`[SyncCoordinator] All ${unpublished.length} newly finished match(es) already claimed by active publication.`);
        return false;
      }

      console.log(`[SyncCoordinator] Found ${claimedMatches.length} newly finished match(es). Grouping into Full-Time Results post [${deterministicId}]...`);

      // Optionally enrich with stats if enabled
      if (fbConfig.includeStatsInFullTime) {
        await this.enrichMatchesWithStats(claimedMatches.slice(0, 15));
      }

      const message = formatResultsRoundupPost(claimedMatches, fbConfig);

      const pubRes = await facebookPublisher.requestPublication({
        type: 'FULL_TIME',
        message,
        matchId: deterministicId,
        idempotencyKey: deterministicId,
        matchTitle: `Full-Time Results (${claimedMatches.length} Matches)`,
        leagueName: 'Multiple Leagues',
        metadata: {
          matchCount: claimedMatches.length,
          matchIds: claimedMatches.map(m => m.id),
          leagueNames: Array.from(new Set(claimedMatches.map(m => m.league?.name).filter(Boolean))),
        },
      });

      if (!pubRes.blocked) {
        // Mark these matches and teams as published immediately so they are NEVER repeated!
        await db.markFtMatchesPublished(claimedMatches);

        fbConfig.lastFtRoundupPublishedAt = new Date().toISOString();
        await db.saveSettings('fbConfig', fbConfig);
        console.log(`[SyncCoordinator] Successfully enqueued grouped FT post [${deterministicId}] and marked ${claimedMatches.length} match(es) as published.`);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[SyncCoordinator] Error in tryPublishFinishedRoundup:', (err as Error)?.message || err);
      return false;
    }
  }

  /**
   * Group active Half-Time matches and publish a single consolidated Half-Time Scores & Updates post.
   * Strictly filters out matches that have already been published for their half-time score to prevent repetition.
   */
  private async tryPublishHalfTimeRoundup(currentMatches: Match[], fbConfig: FacebookPageConfig): Promise<boolean> {
    try {
      // Find matches currently at Half-Time
      const isHalfTime = (m: Match) => {
        const st = (m.statusText || '').toLowerCase();
        return m.status === 'PAUSED' || st === 'ht' || st.includes('half time') || st.includes('halftime') || (m.minute === 45 && m.status !== 'FINISHED');
      };

      const htMatches = (currentMatches || []).filter(isHalfTime);
      if (htMatches.length === 0) return false;

      // Filter strictly by target leagues selected for today
      if (!fbConfig.targetLeagueIds || fbConfig.targetLeagueIds.length === 0) {
        return false;
      }
      const eligible = htMatches.filter(m => fbConfig.targetLeagueIds.includes(m.league?.id));

      // STRICT DE-DUPLICATION: Filter out any matches whose HT result was ALREADY published
      const unpublished: Match[] = [];
      for (const m of eligible) {
        const isPublished = await db.isHtMatchPublished(m.id, m.homeTeam?.name, m.awayTeam?.name);
        if (!isPublished) {
          unpublished.push(m);
        }
      }

      // DO NOT REPEAT POSTING: If there are NO new unpublished half-time matches, do nothing!
      if (unpublished.length === 0) {
        return false;
      }

      // Build deterministic logical identity based on the sorted match IDs
      const sortedMatchIds = unpublished.map(m => m.id).sort();
      const matchBatchHash = crypto.createHash('sha256').update(sortedMatchIds.join(',')).digest('hex').substring(0, 16);
      const deterministicId = `roundup_ht_${matchBatchHash}`;

      // ATOMIC CLAIM: Atomically claim matches in DB to prevent duplicate job generation from overlapping sync cycles
      const claimedMatches = await db.claimHtMatchesForPublication(unpublished, deterministicId);
      if (claimedMatches.length === 0) {
        console.log(`[SyncCoordinator] All ${unpublished.length} half-time match(es) already claimed by active publication.`);
        return false;
      }

      console.log(`[SyncCoordinator] Found ${claimedMatches.length} newly reached Half-Time match(es). Grouping into Half-Time Scores post [${deterministicId}]...`);

      // Enrich with stats if available
      await this.enrichMatchesWithStats(claimedMatches.slice(0, 15));

      const message = formatHalfTimeRoundupPost(claimedMatches, fbConfig);

      const pubRes = await facebookPublisher.requestPublication({
        type: 'HALF_TIME',
        message,
        matchId: deterministicId,
        idempotencyKey: deterministicId,
        matchTitle: `Half-Time Scores (${claimedMatches.length} Matches)`,
        leagueName: 'Multiple Leagues',
        metadata: {
          matchCount: claimedMatches.length,
          matchIds: claimedMatches.map(m => m.id),
          leagueNames: Array.from(new Set(claimedMatches.map(m => m.league?.name).filter(Boolean))),
        },
      });

      if (!pubRes.blocked) {
        // Mark these matches and teams as published immediately so they are NEVER repeated!
        await db.markHtMatchesPublished(claimedMatches);

        fbConfig.lastHtRoundupPublishedAt = new Date().toISOString();
        await db.saveSettings('fbConfig', fbConfig);
        console.log(`[SyncCoordinator] Successfully enqueued grouped Half-Time post [${deterministicId}] and marked ${claimedMatches.length} match(es) as published.`);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[SyncCoordinator] Error in tryPublishHalfTimeRoundup:', (err as Error)?.message || err);
      return false;
    }
  }

  /**
   * Publish scheduled Live Scoreboard Roundup strictly according to the minutes selected by the user.
   * Completely avoids conflict with Half-Time and Full-Time posts.
   */
  private async tryPublishLiveRoundup(currentMatches: Match[], fbConfig: FacebookPageConfig, minSpacingMs: number): Promise<boolean> {
    try {
      if (!currentMatches || currentMatches.length === 0) return false;

      // Filter to active in-play matches only (never finished)
      let activeMatches = currentMatches.filter(m => m.status === 'IN_PLAY' || m.status === 'PAUSED');

      // Filter strictly by target leagues selected for today
      if (!fbConfig.targetLeagueIds || fbConfig.targetLeagueIds.length === 0) {
        return false;
      }
      activeMatches = activeMatches.filter(m => fbConfig.targetLeagueIds.includes(m.league?.id));

      if (activeMatches.length === 0) return false;

      // If all matches in the active set are at Half-Time and half-time posting is enabled,
      // the dedicated Half-Time post covers them: avoid redundant duplicate live scoreboard post
      const inPlayCount = activeMatches.filter(m => m.status === 'IN_PLAY').length;
      if (inPlayCount === 0 && fbConfig.publishHalfTime) {
        return false;
      }

      // Check selected minutes interval (e.g. 5, 10, 15, 30, 45, 60 minutes)
      const intervalMinutes = Math.max(1, fbConfig.roundupIntervalMinutes || 5);
      const intervalMs = intervalMinutes * 60 * 1000;
      const lastTime = fbConfig.lastRoundupPublishedAt ? new Date(fbConfig.lastRoundupPublishedAt).getTime() : 0;
      const elapsed = Date.now() - lastTime;

      // Has the user's selected minute interval elapsed?
      if (lastTime > 0 && elapsed < intervalMs) {
        return false;
      }

      // Score fingerprint: Check if match scores or match statuses have actually changed
      const currentFingerprint = activeMatches
        .map(m => `${m.id}:${m.homeScore}-${m.awayScore}:${m.status}`)
        .sort()
        .join('|');

      // If scores haven't changed since last post and less than 30 minutes elapsed, skip duplicate post
      if (this.lastRoundupFingerprint === currentFingerprint && elapsed < 30 * 60 * 1000) {
        return false;
      }

      console.log(`[SyncCoordinator] Posting scheduled live scoreboard (${intervalMinutes}m interval, ${activeMatches.length} active matches)...`);
      await this.enrichMatchesWithStats(activeMatches);
      const message = formatLiveRoundupPost(activeMatches, fbConfig);

      const pubRes = await facebookPublisher.requestPublication({
        type: 'LIVE',
        message,
        matchId: 'roundup_live',
        idempotencyKey: 'roundup_live',
        matchTitle: `Live Scoreboard Roundup (${activeMatches.length} Matches)`,
        leagueName: 'Multiple Leagues',
        metadata: {
          matchCount: activeMatches.length,
          leagueNames: Array.from(new Set(activeMatches.map(m => m.league?.name).filter(Boolean))),
        },
      });

      if (!pubRes.blocked) {
        this.lastRoundupFingerprint = currentFingerprint;
        fbConfig.lastRoundupPublishedAt = new Date().toISOString();
        await db.saveSettings('fbConfig', fbConfig);
        console.log(`[SyncCoordinator] Scheduled Live Scoreboard post successfully enqueued (${activeMatches.length} matches).`);
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[SyncCoordinator] Error in tryPublishLiveRoundup:', (err as Error)?.message || err);
      return false;
    }
  }

  private async handleEvent(params: {
    match: Match;
    type: 'GOAL' | 'YELLOW_CARD' | 'RED_CARD' | 'CORNER' | 'KICKOFF' | 'HALF_TIME' | 'FULL_TIME';
    teamSide: 'home' | 'away';
    playerName: string;
    minute: number;
    homeScore?: number;
    awayScore?: number;
    fbConfig: FacebookPageConfig;
    stats?: any;
  }): Promise<void> {
    const { match, type, teamSide, playerName, minute, homeScore, awayScore, fbConfig, stats } = params;

    const eventRecord: MatchEvent = {
      id: `ev_${match.id}_${Date.now()}_${type}`,
      matchId: match.id,
      type: type === 'RED_CARD' ? 'RED_CARD' : type === 'YELLOW_CARD' ? 'YELLOW_CARD' : type === 'CORNER' ? 'CORNER' : type === 'GOAL' ? 'GOAL' : 'STATUS_CHANGE',
      minute,
      teamSide,
      playerName: playerName || (teamSide === 'home' ? match.homeTeam.name : match.awayTeam.name),
      homeScore: homeScore ?? match.homeScore,
      awayScore: awayScore ?? match.awayScore,
      createdAt: new Date().toISOString(),
    };

    // Save event
    await db.saveEvents([eventRecord]);

    // Broadcast event over WebSocket
    if (this.broadcastFn) {
      this.broadcastFn('match_event', {
        matchId: match.id,
        event: eventRecord,
        match,
      });
    }

    // Check auto publishing configuration
    if (!fbConfig.autoPublishEnabled) return;
    const hasToken = Boolean(fbConfig.pageAccessToken || config.fbPageAccessToken);
    const hasPageId = Boolean(fbConfig.pageId || config.fbPageId);
    if (!hasToken || !hasPageId) return;

    // In roundup mode, all automated Facebook publishing is consolidated into scheduled multi-game scoreboard roundups
    // to protect the connected Facebook Page from Meta velocity anti-spam blocks (error 1390008).
    if (fbConfig.publishingMode === 'roundup') {
      return;
    }

    // Strict daily league filter: only post games from leagues selected by the admin for today
    if (!fbConfig.targetLeagueIds || fbConfig.targetLeagueIds.length === 0 || !fbConfig.targetLeagueIds.includes(match.league.id)) {
      return; // Skip this unselected league
    }

    let shouldPublish = false;
    let postMessage = '';

    if (type === 'GOAL' && fbConfig.publishGoals) {
      shouldPublish = true;
      postMessage = formatGoalPost(match, eventRecord, fbConfig);
    } else if (type === 'YELLOW_CARD' && (fbConfig.publishYellowCards ?? true)) {
      shouldPublish = true;
      postMessage = formatYellowCardPost(match, eventRecord, fbConfig);
    } else if (type === 'RED_CARD' && fbConfig.publishRedCards) {
      shouldPublish = true;
      postMessage = formatRedCardPost(match, eventRecord, fbConfig);
    } else if (type === 'CORNER' && (fbConfig.publishCorners ?? true)) {
      shouldPublish = true;
      postMessage = formatCornerPost(match, eventRecord, fbConfig);
    } else if (type === 'KICKOFF' && fbConfig.publishKickoff) {
      shouldPublish = true;
      postMessage = formatKickoffPost(match, fbConfig);
    } else if (type === 'HALF_TIME' && fbConfig.publishHalfTime) {
      shouldPublish = true;
      postMessage = formatHalfTimePost(match, fbConfig);
    } else if (type === 'FULL_TIME' && fbConfig.publishFullTime) {
      shouldPublish = true;
      postMessage = formatFullTimePost(match, fbConfig);
    }

    if (shouldPublish && postMessage) {
      await facebookPublisher.requestPublication({
        type: type === 'FULL_TIME' ? 'FULL_TIME' : type === 'HALF_TIME' ? 'HALF_TIME' : 'LIVE',
        message: postMessage,
        matchId: match.id,
        matchTitle: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
        leagueName: match.league.name,
        metadata: { eventType: type },
      });
    }
  }

  async getLiveMatches(): Promise<Match[]> {
    try {
      const cached = await cache.getLiveMatches();
      if (cached && cached.length > 0) return cached;
    } catch {
      // ignore
    }
    if (this.previousMatches.size > 0) {
      return Array.from(this.previousMatches.values());
    }
    try {
      return await this.syncLiveMatches();
    } catch {
      return Array.from(this.previousMatches.values());
    }
  }

  async getTodayMatches(): Promise<Match[]> {
    const cached = await cache.get<Match[]>('matches:today');
    if (cached) return cached;

    try {
      const matches = await flashscoreClient.getTodayMatches();
      if (matches && matches.length > 0) {
        await cache.set('matches:today', matches, 60);
        return matches;
      }
    } catch (e) {
      console.warn('[SyncEngine] Error getting today matches:', e);
    }
    return [];
  }

  async getFixtures(offset = 1): Promise<Match[]> {
    const cacheKey = `matches:fixtures:${offset}`;
    const cached = await cache.get<Match[]>(cacheKey);
    if (cached) return cached;

    try {
      const matches = await flashscoreClient.getFixtures(offset);
      if (matches && matches.length > 0) {
        await cache.set(cacheKey, matches, 120);
        return matches;
      }
    } catch (e) {
      console.warn('[SyncEngine] Error getting fixtures:', e);
    }
    return [];
  }

  async getResults(offset = -1): Promise<Match[]> {
    const cacheKey = `matches:results:${offset}`;
    const cached = await cache.get<Match[]>(cacheKey);
    if (cached) return cached;

    try {
      const matches = await flashscoreClient.getResults(offset);
      if (matches && matches.length > 0) {
        await cache.set(cacheKey, matches, 120);
        return matches;
      }
    } catch (e) {
      console.warn('[SyncEngine] Error getting results:', e);
    }
    return [];
  }

  async getMatchEvents(matchId: string): Promise<MatchEvent[]> {
    const cacheKey = `match:${matchId}:events`;
    const cached = await cache.get<MatchEvent[]>(cacheKey);
    if (cached) return cached;

    try {
      const events = await flashscoreClient.getMatchEvents(matchId);
      if (events && events.length > 0) {
        await cache.set(cacheKey, events, 20);
        return events;
      }
    } catch (e) {
      console.warn('[SyncEngine] Error getting match events:', e);
    }
    return [];
  }

  async getMatchStatistics(matchId: string): Promise<any> {
    const cacheKey = `match:${matchId}:stats`;
    const cached = await cache.get<any>(cacheKey);
    if (cached) return cached;

    try {
      const stats = await flashscoreClient.getMatchStatistics(matchId);
      if (stats) {
        await cache.set(cacheKey, stats, 30);
        return stats;
      }
    } catch (e) {
      console.warn('[SyncEngine] Error getting match stats:', e);
    }
    return null;
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      trackedLiveMatches: this.previousMatches.size,
      lastScrapeTime: this.lastScrapeTime,
      scrapeCount: this.scrapeCount,
      lastError: this.lastError,
      intervalSeconds: config.scrapeIntervalSeconds,
    };
  }
}

export const sportsSync = new SportsSyncEngine();
