import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { config } from '../config.js';
import {
  Match,
  MatchEvent,
  FacebookPostRecord,
  FacebookPublisherState,
  FacebookPendingPublication,
  FacebookPublisherLock,
  FacebookPublicationType,
  ApiKeyRecord,
  DailyLeagueSelection,
  FacebookPageConfig,
  PublishedFtRecord,
  PublishedHtRecord,
  AdminUser,
  AdminSession,
} from '../types.js';

const { Pool } = pg;

export function getTodayDateString(timeZone = 'UTC'): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

interface StoredAdminUser {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  role: 'superadmin' | 'admin' | 'moderator';
  createdAt: string;
  lastLogin?: string;
}

interface LocalDbSchema {
  matches: Record<string, Match>;
  events: Record<string, MatchEvent[]>;
  facebookPosts: FacebookPostRecord[];
  publisherState: FacebookPublisherState;
  pendingPublications: FacebookPendingPublication[];
  publisherLock: FacebookPublisherLock;
  settings: Record<string, any>;
  apiKeys: ApiKeyRecord[];
  adminUsers: StoredAdminUser[];
  adminSessions: AdminSession[];
  claimedFtMatches?: any[];
  claimedHtMatches?: any[];
}

class DatabaseManager {
  private pgPool: pg.Pool | null = null;
  private isPostgres = false;
  private localDataPath = path.join(process.cwd(), 'data', 'sports_db.json');
  private localData: LocalDbSchema = {
    matches: {},
    events: {},
    facebookPosts: [],
    claimedFtMatches: [],
    claimedHtMatches: [],
    publisherState: {
      id: 'default',
      publishingEnabled: config.fbPublishEnabled !== false,
      publishingPaused: false,
      consecutiveMetaBlocks: 0,
      totalMetaBlocks: 0,
      updatedAt: new Date().toISOString(),
    },
    pendingPublications: [],
    publisherLock: {
      lockName: 'fb_publish_master_lock',
      locked: false,
    },
    settings: {
      fbConfig: {
        pageId: config.fbPageId,
        pageName: '',
        category: 'Sports Team / Media',
        link: '',
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
        autoPublishHtRoundup: true,
        publishFullTime: true,
        includeStatsInFullTime: true,
        targetLeagueIds: [],
        postTemplateGoal: "⚽ GOAL! {home_team} {home_score} - {away_score} {away_team}!\n{player} ({minute}')\n#{league_tag} #LiveScores",
        postTemplateYellowCard: "🟨 YELLOW CARD! {player} ({team}) booked in the {minute}' min!\n⏱️ Match Time: {minute}'\n{home_team} {home_score} - {away_score} {away_team}\n🏆 {league_name}\n\n#{league_tag} #GameScores #YellowCard",
        postTemplateRedCard: "🟥 RED CARD! {player} ({team}) sent off in the {minute}' min!\n⏱️ Match Time: {minute}'\n{home_team} {home_score} - {away_score} {away_team}\n🏆 {league_name}\n\n#{league_tag} #GameScores #RedCard",
        postTemplateCorner: "🚩 CORNER KICK! Corner awarded to {team} in the {minute}' min!\n⏱️ Match Time: {minute}'\n{home_team} {home_score} - {away_score} {away_team}\n🏆 {league_name}\n\n#{league_tag} #GameScores #CornerKick",
        postTemplateKickoff: "⚡ MATCH KICK-OFF!\n{home_team} vs {away_team}\n🏆 {league_name}\nStay tuned for live score updates!",
        postTemplateHalfTime: "⏸️ HALF-TIME: {home_team} {home_score} - {away_score} {away_team}\n🏆 {league_name}",
        postTemplateFullTime: "🏁 FULL-TIME: {home_team} {home_score} - {away_score} {away_team}\n🏆 {league_name}\n{stats_summary}\nThanks for following!",
        postTemplateRoundup: "⚽ LIVE MATCHES SCOREBOARD ⏱️\n📊 {count} Active Match(es) in Progress ({time})\n\n{matches_list}\n\n⚡ Follow for live scores and breaking goal updates!\n{hashtags} #LiveScores #GameScores",
        postTemplateHalfTimeRoundup: "⏸️ HALF-TIME SCORES & UPDATES ⚽\n📊 {count} Match(es) at Half-Time\n\n{matches_list}\n\n⚡ Follow for live second-half score and goal updates!\n{hashtags} #HalfTime #LiveScores #GameScores",
      },
      scraperSettings: {
        activeProviderId: 'flashscore',
        pollingIntervalSeconds: 15,
        targetLeagues: ['Premier League', 'LaLiga', 'Champions League', 'Serie A', 'Bundesliga', 'Ligue 1'],
        maxConcurrentScrapes: 4,
      }
    },
    apiKeys: config.apiAdminKey
      ? [
          {
            id: 'key_admin_env',
            key: config.apiAdminKey,
            name: 'Environment Admin Key',
            role: 'admin',
            createdAt: new Date().toISOString(),
          },
        ]
      : [],
    adminUsers: [],
    adminSessions: [],
  };

  async init(): Promise<void> {
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    if (config.databaseUrl) {
      try {
        this.pgPool = new Pool({
          connectionString: config.databaseUrl,
          ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
          connectionTimeoutMillis: 4000,
        });
        await this.pgPool.query('SELECT NOW()');
        this.isPostgres = true;
        console.log('[DB] Connected to PostgreSQL successfully.');
        await this.initPostgresSchema();
        await this.initAdminUserIfNone();
        return;
      } catch (err) {
        console.warn('[DB] Could not connect to PostgreSQL, falling back to local persistent store:', (err as Error).message);
        this.pgPool = null;
        this.isPostgres = false;
      }
    }

    // Initialize local JSON store
    if (fs.existsSync(this.localDataPath)) {
      try {
        const raw = fs.readFileSync(this.localDataPath, 'utf-8');
        const parsed = JSON.parse(raw);
        this.localData = {
          ...this.localData,
          ...parsed,
          publisherState: parsed.publisherState || this.localData.publisherState,
          pendingPublications: parsed.pendingPublications || [],
          publisherLock: parsed.publisherLock || this.localData.publisherLock,
          adminUsers: parsed.adminUsers || [],
          adminSessions: parsed.adminSessions || [],
        };
        console.log('[DB] Loaded persistent local store from disk.');
      } catch (e) {
        console.error('[DB] Error loading local store, initializing fresh:', e);
        this.saveLocalData();
      }
    } else {
      this.saveLocalData();
    }

    await this.initAdminUserIfNone();
  }

  private saveLocalData(): void {
    try {
      fs.writeFileSync(this.localDataPath, JSON.stringify(this.localData, null, 2), 'utf-8');
    } catch (e) {
      console.error('[DB] Error saving local store:', e);
    }
  }

  private async initPostgresSchema(): Promise<void> {
    if (!this.pgPool) return;
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS matches (
        id VARCHAR(64) PRIMARY KEY,
        provider VARCHAR(32) NOT NULL DEFAULT 'flashscore',
        league_id VARCHAR(64) NOT NULL,
        league_name VARCHAR(128) NOT NULL,
        league_country VARCHAR(64) NOT NULL,
        home_team_id VARCHAR(64) NOT NULL,
        home_team_name VARCHAR(128) NOT NULL,
        away_team_id VARCHAR(64) NOT NULL,
        away_team_name VARCHAR(128) NOT NULL,
        home_score INT NOT NULL DEFAULT 0,
        away_score INT NOT NULL DEFAULT 0,
        status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
        status_text VARCHAR(64) NOT NULL DEFAULT '',
        minute INT,
        start_time TIMESTAMP WITH TIME ZONE NOT NULL,
        raw_payload JSONB,
        stats JSONB,
        last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS match_events (
        id VARCHAR(128) PRIMARY KEY,
        match_id VARCHAR(64) NOT NULL,
        event_type VARCHAR(32) NOT NULL,
        minute INT NOT NULL,
        extra_minute INT,
        team_side VARCHAR(8) NOT NULL,
        player_name VARCHAR(128) NOT NULL,
        secondary_player_name VARCHAR(128),
        detail VARCHAR(256),
        home_score INT,
        away_score INT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS facebook_posts (
        id VARCHAR(64) PRIMARY KEY,
        match_id VARCHAR(64) NOT NULL,
        match_title VARCHAR(256) NOT NULL,
        league_name VARCHAR(128) NOT NULL,
        event_type VARCHAR(32) NOT NULL,
        message TEXT NOT NULL,
        fb_post_id VARCHAR(128),
        status VARCHAR(32) NOT NULL DEFAULT 'QUEUED',
        error TEXT,
        retry_count INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        published_at TIMESTAMP WITH TIME ZONE
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(128) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id VARCHAR(64) PRIMARY KEY,
        key VARCHAR(128) UNIQUE NOT NULL,
        name VARCHAR(128) NOT NULL,
        role VARCHAR(32) NOT NULL DEFAULT 'read',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMP WITH TIME ZONE
      );

      CREATE TABLE IF NOT EXISTS admin_users (
        id VARCHAR(64) PRIMARY KEY,
        username VARCHAR(64) UNIQUE NOT NULL,
        password_hash VARCHAR(256) NOT NULL,
        salt VARCHAR(64) NOT NULL,
        role VARCHAR(32) NOT NULL DEFAULT 'superadmin',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        last_login TIMESTAMP WITH TIME ZONE
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        token VARCHAR(128) PRIMARY KEY,
        admin_id VARCHAR(64) NOT NULL,
        username VARCHAR(64) NOT NULL,
        role VARCHAR(32) NOT NULL DEFAULT 'superadmin',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS facebook_publisher_state (
        id VARCHAR(32) PRIMARY KEY DEFAULT 'default',
        publishing_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        publishing_paused BOOLEAN NOT NULL DEFAULT FALSE,
        pause_reason TEXT,
        cooldown_until TIMESTAMP WITH TIME ZONE,
        cooldown_reason TEXT,
        last_attempt_at TIMESTAMP WITH TIME ZONE,
        last_publish_at TIMESTAMP WITH TIME ZONE,
        last_successful_publish_at TIMESTAMP WITH TIME ZONE,
        last_facebook_post_id VARCHAR(128),
        last_published_content_hash VARCHAR(64),
        pending_content_hash VARCHAR(64),
        blocked_content_hash VARCHAR(64),
        consecutive_meta_blocks INT NOT NULL DEFAULT 0,
        total_meta_blocks INT NOT NULL DEFAULT 0,
        last_error_code INT,
        last_error_message TEXT,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );

      INSERT INTO facebook_publisher_state (id, publishing_enabled, publishing_paused, updated_at)
      VALUES ('default', TRUE, FALSE, NOW())
      ON CONFLICT (id) DO NOTHING;

      CREATE TABLE IF NOT EXISTS facebook_pending_publication (
        id VARCHAR(64) PRIMARY KEY,
        publication_type VARCHAR(32) NOT NULL,
        content TEXT NOT NULL,
        content_hash VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        attempt_count INT NOT NULL DEFAULT 0,
        last_error TEXT,
        available_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        metadata JSONB
      );

      CREATE TABLE IF NOT EXISTS facebook_publisher_lock (
        lock_name VARCHAR(64) PRIMARY KEY,
        locked BOOLEAN NOT NULL DEFAULT FALSE,
        lock_owner VARCHAR(128),
        locked_at TIMESTAMP WITH TIME ZONE,
        lease_until TIMESTAMP WITH TIME ZONE
      );

      INSERT INTO facebook_publisher_lock (lock_name, locked)
      VALUES ('fb_publish_master_lock', FALSE)
      ON CONFLICT (lock_name) DO NOTHING;

      CREATE TABLE IF NOT EXISTS facebook_claimed_ft_matches (
        match_id VARCHAR(64) PRIMARY KEY,
        team_key VARCHAR(128) NOT NULL,
        home_team VARCHAR(128),
        away_team VARCHAR(128),
        league_name VARCHAR(128),
        score VARCHAR(32),
        publication_key VARCHAR(128) NOT NULL,
        claimed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_claimed_ft_team_key ON facebook_claimed_ft_matches(team_key);

      CREATE TABLE IF NOT EXISTS facebook_claimed_ht_matches (
        match_id VARCHAR(64) PRIMARY KEY,
        team_key VARCHAR(128) NOT NULL,
        home_team VARCHAR(128),
        away_team VARCHAR(128),
        league_name VARCHAR(128),
        score VARCHAR(32),
        publication_key VARCHAR(128) NOT NULL,
        claimed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_claimed_ht_team_key ON facebook_claimed_ht_matches(team_key);

      CREATE INDEX IF NOT EXISTS idx_fb_pending_status ON facebook_pending_publication(status);
      CREATE INDEX IF NOT EXISTS idx_fb_pending_type ON facebook_pending_publication(publication_type);
    `;
    await this.pgPool.query(schemaSql);
    await this.pgPool.query('ALTER TABLE facebook_publisher_state ADD COLUMN IF NOT EXISTS blocked_content_hash VARCHAR(64)');
  }

  async saveMatches(matches: Match[]): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        for (const m of matches) {
          await client.query(
            `INSERT INTO matches (
              id, provider, league_id, league_name, league_country,
              home_team_id, home_team_name, away_team_id, away_team_name,
              home_score, away_score, status, status_text, minute,
              start_time, raw_payload, stats, last_updated
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
            ON CONFLICT (id) DO UPDATE SET
              home_score = EXCLUDED.home_score,
              away_score = EXCLUDED.away_score,
              status = EXCLUDED.status,
              status_text = EXCLUDED.status_text,
              minute = EXCLUDED.minute,
              stats = EXCLUDED.stats,
              last_updated = NOW()`,
            [
              m.id, m.provider, m.league.id, m.league.name, m.league.country,
              m.homeTeam.id, m.homeTeam.name, m.awayTeam.id, m.awayTeam.name,
              m.homeScore, m.awayScore, m.status, m.statusText, m.minute || null,
              m.startTime, JSON.stringify(m), JSON.stringify(m.stats || {})
            ]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } else {
      for (const m of matches) {
        this.localData.matches[m.id] = { ...m, lastUpdated: new Date().toISOString() };
      }
      this.saveLocalData();
    }
  }

  async saveMatch(match: Match): Promise<void> {
    return this.saveMatches([match]);
  }

  async saveEvents(events: MatchEvent[]): Promise<void> {
    return this.saveMatchEvents(events);
  }

  async getMatchById(id: string): Promise<Match | null> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query('SELECT raw_payload FROM matches WHERE id = $1', [id]);
      if (res.rows.length === 0) return null;
      return res.rows[0].raw_payload as Match;
    }
    return this.localData.matches[id] || null;
  }

  async getAllMatches(filter?: { status?: string; leagueId?: string; limit?: number }): Promise<Match[]> {
    if (this.isPostgres && this.pgPool) {
      let q = 'SELECT raw_payload FROM matches WHERE 1=1';
      const params: any[] = [];
      if (filter?.status) {
        params.push(filter.status);
        q += ` AND status = $${params.length}`;
      }
      if (filter?.leagueId) {
        params.push(filter.leagueId);
        q += ` AND league_id = $${params.length}`;
      }
      q += ' ORDER BY start_time DESC';
      if (filter?.limit) {
        params.push(filter.limit);
        q += ` LIMIT $${params.length}`;
      }
      const res = await this.pgPool.query(q, params);
      return res.rows.map(r => r.raw_payload as Match);
    }

    let list = Object.values(this.localData.matches);
    if (filter?.status) {
      list = list.filter(m => m.status === filter.status);
    }
    if (filter?.leagueId) {
      list = list.filter(m => m.league.id === filter.leagueId);
    }
    list.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    if (filter?.limit) {
      list = list.slice(0, filter.limit);
    }
    return list;
  }

  async saveMatchEvents(events: MatchEvent[]): Promise<void> {
    if (events.length === 0) return;
    if (this.isPostgres && this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        for (const ev of events) {
          await client.query(
            `INSERT INTO match_events (
              id, match_id, event_type, minute, extra_minute,
              team_side, player_name, secondary_player_name, detail,
              home_score, away_score, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (id) DO NOTHING`,
            [
              ev.id, ev.matchId, ev.type, ev.minute, ev.extraMinute || null,
              ev.teamSide, ev.playerName, ev.secondaryPlayerName || null, ev.detail || null,
              ev.homeScore ?? null, ev.awayScore ?? null, ev.createdAt
            ]
          );
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } else {
      for (const ev of events) {
        if (!this.localData.events[ev.matchId]) {
          this.localData.events[ev.matchId] = [];
        }
        const existingIdx = this.localData.events[ev.matchId].findIndex(e => e.id === ev.id);
        if (existingIdx === -1) {
          this.localData.events[ev.matchId].push(ev);
        }
      }
      this.saveLocalData();
    }
  }

  async getEventsByMatchId(matchId: string): Promise<MatchEvent[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        'SELECT * FROM match_events WHERE match_id = $1 ORDER BY minute ASC',
        [matchId]
      );
      return res.rows.map(r => ({
        id: r.id,
        matchId: r.match_id,
        type: r.event_type,
        minute: r.minute,
        extraMinute: r.extra_minute,
        teamSide: r.team_side,
        playerName: r.player_name,
        secondaryPlayerName: r.secondary_player_name,
        detail: r.detail,
        homeScore: r.home_score,
        awayScore: r.away_score,
        createdAt: r.created_at.toISOString(),
      }));
    }
    return this.localData.events[matchId] || [];
  }

  async saveFacebookPost(post: FacebookPostRecord): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO facebook_posts (
          id, match_id, match_title, league_name, event_type,
          message, fb_post_id, status, error, retry_count,
          created_at, published_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          fb_post_id = EXCLUDED.fb_post_id,
          error = EXCLUDED.error,
          retry_count = EXCLUDED.retry_count,
          published_at = EXCLUDED.published_at`,
        [
          post.id, post.matchId, post.matchTitle, post.leagueName, post.eventType,
          post.message, post.fbPostId || null, post.status, post.error || null,
          post.retryCount, post.createdAt, post.publishedAt || null
        ]
      );
    } else {
      const idx = this.localData.facebookPosts.findIndex(p => p.id === post.id);
      if (idx >= 0) {
        this.localData.facebookPosts[idx] = post;
      } else {
        this.localData.facebookPosts.unshift(post);
      }
      this.saveLocalData();
    }
  }

  async updateFacebookPost(id: string, updates: Partial<FacebookPostRecord>): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      const setClauses: string[] = [];
      const values: any[] = [];
      let i = 1;
      for (const [key, val] of Object.entries(updates)) {
        const col = key === 'fbPostId' ? 'fb_post_id'
          : key === 'publishedAt' ? 'published_at'
          : key === 'retryCount' ? 'retry_count'
          : key;
        setClauses.push(`${col} = $${i++}`);
        values.push(val);
      }
      values.push(id);
      await this.pgPool.query(`UPDATE facebook_posts SET ${setClauses.join(', ')} WHERE id = $${i}`, values);
    } else {
      const idx = this.localData.facebookPosts.findIndex(p => p.id === id);
      if (idx >= 0) {
        this.localData.facebookPosts[idx] = { ...this.localData.facebookPosts[idx], ...updates };
        this.saveLocalData();
      }
    }
  }

  async getFacebookPosts(limit = 50, offset = 0): Promise<FacebookPostRecord[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        'SELECT * FROM facebook_posts ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      );
      return res.rows.map(r => ({
        id: r.id,
        matchId: r.match_id,
        matchTitle: r.match_title,
        leagueName: r.league_name,
        eventType: r.event_type,
        message: r.message,
        fbPostId: r.fb_post_id,
        status: r.status,
        error: r.error,
        retryCount: r.retry_count,
        createdAt: r.created_at.toISOString(),
        publishedAt: r.published_at ? r.published_at.toISOString() : undefined,
      }));
    }
    return this.localData.facebookPosts.slice(offset, offset + limit);
  }

  async clearFacebookPosts(): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query('DELETE FROM facebook_posts');
    } else {
      this.localData.facebookPosts = [];
      this.saveLocalData();
    }
  }

  async deleteFacebookPost(id: string): Promise<boolean> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query('DELETE FROM facebook_posts WHERE id = $1', [id]);
      return (res.rowCount ?? 0) > 0;
    } else {
      const initial = this.localData.facebookPosts.length;
      this.localData.facebookPosts = this.localData.facebookPosts.filter(p => p.id !== id);
      const changed = this.localData.facebookPosts.length !== initial;
      if (changed) this.saveLocalData();
      return changed;
    }
  }

  async dismissAntiSpamWarnings(): Promise<number> {
    let count = 0;
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        "UPDATE facebook_posts SET error = NULL WHERE error LIKE '%1390008%' OR error LIKE '%velocity%' OR error LIKE '%spam%'"
      );
      count = res.rowCount ?? 0;
    } else {
      for (const p of this.localData.facebookPosts) {
        if (p.error && (p.error.includes('1390008') || p.error.includes('velocity') || p.error.includes('spam'))) {
          p.error = undefined;
          count++;
        }
      }
      if (count > 0) this.saveLocalData();
    }
    return count;
  }

  // ==========================================
  // Centralized Persistent Facebook Publisher State
  // ==========================================

  async getPublisherState(): Promise<FacebookPublisherState> {
    const defaultState: FacebookPublisherState = {
      id: 'default',
      publishingEnabled: config.fbPublishEnabled !== false,
      publishingPaused: false,
      consecutiveMetaBlocks: 0,
      totalMetaBlocks: 0,
      updatedAt: new Date().toISOString(),
    };

    if (this.isPostgres && this.pgPool) {
      try {
        const res = await this.pgPool.query('SELECT * FROM facebook_publisher_state WHERE id = $1', ['default']);
        if (res.rows.length === 0) {
          await this.pgPool.query(
            `INSERT INTO facebook_publisher_state (id, publishing_enabled, publishing_paused, consecutive_meta_blocks, total_meta_blocks, updated_at)
             VALUES ('default', $1, FALSE, 0, 0, NOW())
             ON CONFLICT (id) DO NOTHING`,
            [config.fbPublishEnabled !== false]
          );
          return defaultState;
        }
        const r = res.rows[0];
        return {
          id: r.id,
          publishingEnabled: Boolean(r.publishing_enabled),
          publishingPaused: Boolean(r.publishing_paused),
          pauseReason: r.pause_reason || undefined,
          cooldownUntil: r.cooldown_until ? new Date(r.cooldown_until).toISOString() : undefined,
          cooldownReason: r.cooldown_reason || undefined,
          lastAttemptAt: r.last_attempt_at ? new Date(r.last_attempt_at).toISOString() : undefined,
          lastPublishAt: r.last_publish_at ? new Date(r.last_publish_at).toISOString() : undefined,
          lastSuccessfulPublishAt: r.last_successful_publish_at ? new Date(r.last_successful_publish_at).toISOString() : undefined,
          lastFacebookPostId: r.last_facebook_post_id || undefined,
          lastPublishedContentHash: r.last_published_content_hash || undefined,
          pendingContentHash: r.pending_content_hash || undefined,
          blockedContentHash: r.blocked_content_hash || undefined,
          consecutiveMetaBlocks: Number(r.consecutive_meta_blocks) || 0,
          totalMetaBlocks: Number(r.total_meta_blocks) || 0,
          lastErrorCode: r.last_error_code ? Number(r.last_error_code) : undefined,
          lastErrorMessage: r.last_error_message || undefined,
          updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        };
      } catch (err) {
        console.warn('[DB] Error querying facebook_publisher_state in Postgres, fallback to memory:', (err as Error).message);
      }
    }

    if (!this.localData.publisherState) {
      this.localData.publisherState = defaultState;
      this.saveLocalData();
    }
    return { ...this.localData.publisherState };
  }

  async updatePublisherState(updates: Partial<FacebookPublisherState>): Promise<FacebookPublisherState> {
    const current = await this.getPublisherState();
    const updated: FacebookPublisherState = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (this.isPostgres && this.pgPool) {
      try {
        await this.pgPool.query(
          `INSERT INTO facebook_publisher_state (
            id, publishing_enabled, publishing_paused, pause_reason,
            cooldown_until, cooldown_reason, last_attempt_at, last_publish_at,
            last_successful_publish_at, last_facebook_post_id, last_published_content_hash,
            pending_content_hash, blocked_content_hash, consecutive_meta_blocks, total_meta_blocks,
            last_error_code, last_error_message, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
          ON CONFLICT (id) DO UPDATE SET
            publishing_enabled = EXCLUDED.publishing_enabled,
            publishing_paused = EXCLUDED.publishing_paused,
            pause_reason = EXCLUDED.pause_reason,
            cooldown_until = EXCLUDED.cooldown_until,
            cooldown_reason = EXCLUDED.cooldown_reason,
            last_attempt_at = EXCLUDED.last_attempt_at,
            last_publish_at = EXCLUDED.last_publish_at,
            last_successful_publish_at = EXCLUDED.last_successful_publish_at,
            last_facebook_post_id = EXCLUDED.last_facebook_post_id,
            last_published_content_hash = EXCLUDED.last_published_content_hash,
            pending_content_hash = EXCLUDED.pending_content_hash,
            blocked_content_hash = EXCLUDED.blocked_content_hash,
            consecutive_meta_blocks = EXCLUDED.consecutive_meta_blocks,
            total_meta_blocks = EXCLUDED.total_meta_blocks,
            last_error_code = EXCLUDED.last_error_code,
            last_error_message = EXCLUDED.last_error_message,
            updated_at = NOW()`,
          [
            'default',
            updated.publishingEnabled,
            updated.publishingPaused,
            updated.pauseReason || null,
            updated.cooldownUntil ? new Date(updated.cooldownUntil) : null,
            updated.cooldownReason || null,
            updated.lastAttemptAt ? new Date(updated.lastAttemptAt) : null,
            updated.lastPublishAt ? new Date(updated.lastPublishAt) : null,
            updated.lastSuccessfulPublishAt ? new Date(updated.lastSuccessfulPublishAt) : null,
            updated.lastFacebookPostId || null,
            updated.lastPublishedContentHash || null,
            updated.pendingContentHash || null,
            updated.blockedContentHash || null,
            updated.consecutiveMetaBlocks,
            updated.totalMetaBlocks,
            updated.lastErrorCode || null,
            updated.lastErrorMessage || null,
          ]
        );
      } catch (err) {
        console.warn('[DB] Error updating facebook_publisher_state in Postgres:', (err as Error).message);
      }
    }

    this.localData.publisherState = updated;
    this.saveLocalData();
    return updated;
  }

  // ==========================================
  // Persistent Pending Publications
  // ==========================================

  async getPendingPublication(type?: FacebookPublicationType): Promise<FacebookPendingPublication | null> {
    if (this.isPostgres && this.pgPool) {
      try {
        let query = "SELECT * FROM facebook_pending_publication WHERE status = 'PENDING'";
        const params: any[] = [];
        if (type) {
          query += " AND publication_type = $1";
          params.push(type);
        }
        query += " ORDER BY created_at ASC LIMIT 1";
        const res = await this.pgPool.query(query, params);
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
          id: r.id,
          publicationType: r.publication_type as FacebookPublicationType,
          content: r.content,
          contentHash: r.content_hash,
          status: r.status,
          createdAt: new Date(r.created_at).toISOString(),
          updatedAt: new Date(r.updated_at).toISOString(),
          attemptCount: Number(r.attempt_count) || 0,
          lastError: r.last_error || undefined,
          availableAt: new Date(r.available_at).toISOString(),
          metadata: r.metadata || undefined,
        };
      } catch (err) {
        console.warn('[DB] Error querying pending publication in Postgres:', (err as Error).message);
      }
    }

    const items = (this.localData.pendingPublications || []).filter(p => p.status === 'PENDING');
    if (type) {
      return items.find(p => p.publicationType === type) || null;
    }
    return items[0] || null;
  }

  async getAllPendingPublications(): Promise<FacebookPendingPublication[]> {
    if (this.isPostgres && this.pgPool) {
      try {
        const res = await this.pgPool.query(
          "SELECT * FROM facebook_pending_publication WHERE status = 'PENDING' ORDER BY created_at ASC"
        );
        return res.rows.map(r => ({
          id: r.id,
          publicationType: r.publication_type as FacebookPublicationType,
          content: r.content,
          contentHash: r.content_hash,
          status: r.status,
          createdAt: new Date(r.created_at).toISOString(),
          updatedAt: new Date(r.updated_at).toISOString(),
          attemptCount: Number(r.attempt_count) || 0,
          lastError: r.last_error || undefined,
          availableAt: new Date(r.available_at).toISOString(),
          metadata: r.metadata || undefined,
        }));
      } catch (err) {
        console.warn('[DB] Error querying all pending publications in Postgres:', (err as Error).message);
      }
    }
    return (this.localData.pendingPublications || []).filter(p => p.status === 'PENDING');
  }

  async savePendingPublication(pub: FacebookPendingPublication): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      try {
        await this.pgPool.query(
          `INSERT INTO facebook_pending_publication (
            id, publication_type, content, content_hash, status,
            created_at, updated_at, attempt_count, last_error, available_at, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10)
          ON CONFLICT (id) DO UPDATE SET
            publication_type = EXCLUDED.publication_type,
            content = EXCLUDED.content,
            content_hash = EXCLUDED.content_hash,
            status = EXCLUDED.status,
            updated_at = NOW(),
            attempt_count = EXCLUDED.attempt_count,
            last_error = EXCLUDED.last_error,
            available_at = EXCLUDED.available_at,
            metadata = EXCLUDED.metadata`,
          [
            pub.id,
            pub.publicationType,
            pub.content,
            pub.contentHash,
            pub.status,
            new Date(pub.createdAt),
            pub.attemptCount,
            pub.lastError || null,
            new Date(pub.availableAt),
            JSON.stringify(pub.metadata || {}),
          ]
        );
      } catch (err) {
        console.warn('[DB] Error saving pending publication to Postgres:', (err as Error).message);
      }
    }

    if (!this.localData.pendingPublications) {
      this.localData.pendingPublications = [];
    }
    const idx = this.localData.pendingPublications.findIndex(p => p.id === pub.id);
    if (idx >= 0) {
      this.localData.pendingPublications[idx] = { ...pub, updatedAt: new Date().toISOString() };
    } else {
      this.localData.pendingPublications.push({ ...pub, updatedAt: new Date().toISOString() });
    }
    this.saveLocalData();
  }

  async deletePendingPublication(id: string): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      try {
        await this.pgPool.query('DELETE FROM facebook_pending_publication WHERE id = $1', [id]);
      } catch (err) {
        console.warn('[DB] Error deleting pending publication in Postgres:', (err as Error).message);
      }
    }

    if (this.localData.pendingPublications) {
      this.localData.pendingPublications = this.localData.pendingPublications.filter(p => p.id !== id);
      this.saveLocalData();
    }
  }

  async clearPendingPublications(): Promise<number> {
    let count = 0;
    if (this.isPostgres && this.pgPool) {
      try {
        const res = await this.pgPool.query("DELETE FROM facebook_pending_publication WHERE status = 'PENDING'");
        count = res.rowCount ?? 0;
      } catch (err) {
        console.warn('[DB] Error clearing pending publications in Postgres:', (err as Error).message);
      }
    }

    if (this.localData.pendingPublications) {
      const initial = this.localData.pendingPublications.length;
      this.localData.pendingPublications = this.localData.pendingPublications.filter(p => p.status !== 'PENDING');
      count = Math.max(count, initial - this.localData.pendingPublications.length);
      this.saveLocalData();
    }
    return count;
  }

  async getPendingPublicationById(id: string): Promise<FacebookPendingPublication | null> {
    if (this.isPostgres && this.pgPool) {
      try {
        const res = await this.pgPool.query('SELECT * FROM facebook_pending_publication WHERE id = $1', [id]);
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
          id: r.id,
          publicationType: r.publication_type as FacebookPublicationType,
          content: r.content,
          contentHash: r.content_hash,
          status: r.status,
          createdAt: new Date(r.created_at).toISOString(),
          updatedAt: new Date(r.updated_at).toISOString(),
          attemptCount: Number(r.attempt_count) || 0,
          lastError: r.last_error || undefined,
          availableAt: new Date(r.available_at).toISOString(),
          metadata: r.metadata || undefined,
        };
      } catch (err) {
        console.warn('[DB] Error querying pending publication by ID in Postgres:', (err as Error).message);
      }
    }
    return (this.localData.pendingPublications || []).find(p => p.id === id) || null;
  }

  async getBlockedPublications(): Promise<FacebookPendingPublication[]> {
    if (this.isPostgres && this.pgPool) {
      try {
        const res = await this.pgPool.query(
          "SELECT * FROM facebook_pending_publication WHERE status = 'BLOCKED' ORDER BY updated_at DESC"
        );
        return res.rows.map(r => ({
          id: r.id,
          publicationType: r.publication_type as FacebookPublicationType,
          content: r.content,
          contentHash: r.content_hash,
          status: r.status,
          createdAt: new Date(r.created_at).toISOString(),
          updatedAt: new Date(r.updated_at).toISOString(),
          attemptCount: Number(r.attempt_count) || 0,
          lastError: r.last_error || undefined,
          availableAt: new Date(r.available_at).toISOString(),
          metadata: r.metadata || undefined,
        }));
      } catch (err) {
        console.warn('[DB] Error querying blocked publications in Postgres:', (err as Error).message);
      }
    }
    return (this.localData.pendingPublications || []).filter(p => p.status === 'BLOCKED');
  }

  async findPendingOrBlockedPublication(keyOrId: string, contentHash?: string): Promise<FacebookPendingPublication | null> {
    if (this.isPostgres && this.pgPool) {
      try {
        let query = "SELECT * FROM facebook_pending_publication WHERE (id = $1";
        const params: any[] = [keyOrId];
        if (contentHash) {
          query += " OR content_hash = $2";
          params.push(contentHash);
        }
        query += ") AND status IN ('PENDING', 'BLOCKED', 'PUBLISHING') LIMIT 1";
        const res = await this.pgPool.query(query, params);
        if (res.rows.length === 0) return null;
        const r = res.rows[0];
        return {
          id: r.id,
          publicationType: r.publication_type as FacebookPublicationType,
          content: r.content,
          contentHash: r.content_hash,
          status: r.status,
          createdAt: new Date(r.created_at).toISOString(),
          updatedAt: new Date(r.updated_at).toISOString(),
          attemptCount: Number(r.attempt_count) || 0,
          lastError: r.last_error || undefined,
          availableAt: new Date(r.available_at).toISOString(),
          metadata: r.metadata || undefined,
        };
      } catch (err) {
        console.warn('[DB] Error finding pending or blocked publication in Postgres:', (err as Error).message);
      }
    }
    return (
      (this.localData.pendingPublications || []).find(
        p =>
          (p.id === keyOrId || (contentHash && p.contentHash === contentHash)) &&
          (p.status === 'PENDING' || p.status === 'BLOCKED' || (p.status as any) === 'PUBLISHING')
      ) || null
    );
  }

  // ==========================================
  // Distributed Cross-Process Master Lock
  // ==========================================

  async acquirePublisherLock(owner: string, leaseSeconds = config.fbLockLeaseSeconds): Promise<boolean> {
    if (this.isPostgres && this.pgPool) {
      try {
        // Atomic conditional update: lock if currently unlocked, lease expired, or already owned by same worker
        const res = await this.pgPool.query(
          `UPDATE facebook_publisher_lock
           SET locked = TRUE,
               lock_owner = $1,
               locked_at = NOW(),
               lease_until = NOW() + ($2 || ' seconds')::INTERVAL
           WHERE lock_name = 'fb_publish_master_lock'
             AND (locked = FALSE OR lease_until < NOW() OR lock_owner = $1)`,
          [owner, leaseSeconds]
        );
        if ((res.rowCount ?? 0) > 0) {
          return true;
        }
        return false;
      } catch (err) {
        console.warn('[DB] Error acquiring publisher lock in Postgres:', (err as Error).message);
      }
    }

    const currentLock = this.localData.publisherLock || { lockName: 'fb_publish_master_lock', locked: false };
    const now = Date.now();
    const isExpired = currentLock.leaseUntil ? new Date(currentLock.leaseUntil).getTime() < now : true;
    const canAcquire = !currentLock.locked || isExpired || currentLock.lockOwner === owner;

    if (canAcquire) {
      this.localData.publisherLock = {
        lockName: 'fb_publish_master_lock',
        locked: true,
        lockOwner: owner,
        lockedAt: new Date(now).toISOString(),
        leaseUntil: new Date(now + leaseSeconds * 1000).toISOString(),
      };
      this.saveLocalData();
      return true;
    }
    return false;
  }

  async releasePublisherLock(owner: string): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      try {
        await this.pgPool.query(
          `UPDATE facebook_publisher_lock
           SET locked = FALSE,
               lock_owner = NULL,
               lease_until = NULL
           WHERE lock_name = 'fb_publish_master_lock'
             AND (lock_owner = $1 OR lease_until < NOW())`,
          [owner]
        );
        return;
      } catch (err) {
        console.warn('[DB] Error releasing publisher lock in Postgres:', (err as Error).message);
      }
    }

    if (this.localData.publisherLock) {
      if (
        this.localData.publisherLock.lockOwner === owner ||
        (this.localData.publisherLock.leaseUntil &&
          new Date(this.localData.publisherLock.leaseUntil).getTime() < Date.now())
      ) {
        this.localData.publisherLock = {
          lockName: 'fb_publish_master_lock',
          locked: false,
          lockOwner: undefined,
          lockedAt: undefined,
          leaseUntil: undefined,
        };
        this.saveLocalData();
      }
    }
  }

  async getPublisherLockStatus(): Promise<{ locked: boolean; owner?: string; remainingSeconds?: number }> {
    if (this.isPostgres && this.pgPool) {
      try {
        const res = await this.pgPool.query(
          "SELECT * FROM facebook_publisher_lock WHERE lock_name = 'fb_publish_master_lock'"
        );
        if (res.rows.length > 0) {
          const r = res.rows[0];
          const now = Date.now();
          const leaseMs = r.lease_until ? new Date(r.lease_until).getTime() : 0;
          const isLocked = Boolean(r.locked) && leaseMs > now;
          return {
            locked: isLocked,
            owner: isLocked ? r.lock_owner || undefined : undefined,
            remainingSeconds: isLocked ? Math.max(0, Math.ceil((leaseMs - now) / 1000)) : 0,
          };
        }
      } catch (err) {
        console.warn('[DB] Error checking publisher lock in Postgres:', (err as Error).message);
      }
    }

    const currentLock = this.localData.publisherLock;
    if (!currentLock || !currentLock.locked) {
      return { locked: false, remainingSeconds: 0 };
    }
    const now = Date.now();
    const leaseMs = currentLock.leaseUntil ? new Date(currentLock.leaseUntil).getTime() : 0;
    const isLocked = currentLock.locked && leaseMs > now;
    return {
      locked: isLocked,
      owner: isLocked ? currentLock.lockOwner : undefined,
      remainingSeconds: isLocked ? Math.max(0, Math.ceil((leaseMs - now) / 1000)) : 0,
    };
  }

  async getSettings<T>(key: string, defaultValue: T): Promise<T> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query('SELECT value FROM system_settings WHERE key = $1', [key]);
      if (res.rows.length === 0) return defaultValue;
      return res.rows[0].value as T;
    }
    return (this.localData.settings[key] as T) ?? defaultValue;
  }

  async saveSettings(key: string, value: any): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        'INSERT INTO system_settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()',
        [key, JSON.stringify(value)]
      );
    } else {
      this.localData.settings[key] = value;
      this.saveLocalData();
    }
  }

  async getPublishedFtMatches(): Promise<PublishedFtRecord[]> {
    return this.getSettings<PublishedFtRecord[]>('publishedFtMatches', []);
  }

  async isFtMatchPublished(matchId: string, homeTeamName?: string, awayTeamName?: string): Promise<boolean> {
    const list = await this.getPublishedFtMatches();
    if (!list || list.length === 0) return false;

    // Check by match ID
    if (matchId && list.some(r => r.matchId === matchId)) {
      return true;
    }

    // Check by normalized team pair key to prevent duplicate posts even if ID changes
    if (homeTeamName && awayTeamName) {
      const cleanHome = homeTeamName.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      const cleanAway = awayTeamName.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      const teamKey = `${cleanHome}_vs_${cleanAway}`;
      if (teamKey && list.some(r => r.teamKey === teamKey)) {
        return true;
      }
    }

    return false;
  }

  async markFtMatchesPublished(matches: Match[]): Promise<void> {
    if (!matches || matches.length === 0) return;
    const current = await this.getPublishedFtMatches();
    const newRecords: PublishedFtRecord[] = [];
    const now = new Date().toISOString();

    for (const m of matches) {
      const matchId = m.id;
      const home = m.homeTeam?.name || '';
      const away = m.awayTeam?.name || '';
      const cleanHome = home.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      const cleanAway = away.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      const teamKey = `${cleanHome}_vs_${cleanAway}`;

      const alreadyExists = current.some(
        r => r.matchId === matchId || (teamKey && r.teamKey === teamKey)
      );

      if (!alreadyExists) {
        newRecords.push({
          matchId,
          teamKey,
          homeTeam: home,
          awayTeam: away,
          leagueName: m.league?.name || '',
          score: `${m.homeScore ?? 0} - ${m.awayScore ?? 0}`,
          publishedAt: now,
        });
      }
    }

    if (newRecords.length > 0) {
      // Keep up to 2000 most recent records
      const combined = [...newRecords, ...current].slice(0, 2000);
      await this.saveSettings('publishedFtMatches', combined);
    }
  }

  async clearPublishedFtMatches(): Promise<void> {
    await this.saveSettings('publishedFtMatches', []);
  }

  async getPublishedHtMatches(): Promise<PublishedHtRecord[]> {
    return this.getSettings<PublishedHtRecord[]>('publishedHtMatches', []);
  }

  async isHtMatchPublished(matchId: string, homeTeamName?: string, awayTeamName?: string): Promise<boolean> {
    const list = await this.getPublishedHtMatches();
    if (!list || list.length === 0) return false;

    // Check by match ID
    if (matchId && list.some(r => r.matchId === matchId)) {
      return true;
    }

    // Check by normalized team pair key to prevent duplicate posts even if ID changes
    if (homeTeamName && awayTeamName) {
      const cleanHome = homeTeamName.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      const cleanAway = awayTeamName.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      const teamKey = `${cleanHome}_vs_${cleanAway}`;
      if (teamKey && list.some(r => r.teamKey === teamKey)) {
        return true;
      }
    }

    return false;
  }

  async markHtMatchesPublished(matches: Match[]): Promise<void> {
    if (!matches || matches.length === 0) return;
    const current = await this.getPublishedHtMatches();
    const newRecords: PublishedHtRecord[] = [];
    const now = new Date().toISOString();

    for (const m of matches) {
      const matchId = m.id;
      const home = m.homeTeam?.name || '';
      const away = m.awayTeam?.name || '';
      const cleanHome = home.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      const cleanAway = away.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
      const teamKey = `${cleanHome}_vs_${cleanAway}`;

      const alreadyExists = current.some(
        r => r.matchId === matchId || (teamKey && r.teamKey === teamKey)
      );

      if (!alreadyExists) {
        newRecords.push({
          matchId,
          teamKey,
          homeTeam: home,
          awayTeam: away,
          leagueName: m.league?.name || '',
          score: `${m.homeScore ?? 0} - ${m.awayScore ?? 0}`,
          publishedAt: now,
        });
      }
    }

    if (newRecords.length > 0) {
      // Keep up to 2000 most recent records
      const combined = [...newRecords, ...current].slice(0, 2000);
      await this.saveSettings('publishedHtMatches', combined);
    }
  }

  async clearPublishedHtMatches(): Promise<void> {
    await this.saveSettings('publishedHtMatches', []);
  }

  // ==========================================
  // Atomic Match Claiming for Roundups
  // ==========================================

  async claimFtMatchesForPublication(matches: Match[], publicationKey: string): Promise<Match[]> {
    if (!matches || matches.length === 0) return [];

    const successfullyClaimed: Match[] = [];
    const publishedList = await this.getPublishedFtMatches();
    const publishedMatchIds = new Set(publishedList.map(r => r.matchId));
    const publishedTeamKeys = new Set(publishedList.map(r => r.teamKey).filter(Boolean));

    if (this.isPostgres && this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        for (const m of matches) {
          const home = m.homeTeam?.name || '';
          const away = m.awayTeam?.name || '';
          const cleanHome = home.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
          const cleanAway = away.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
          const teamKey = `${cleanHome}_vs_${cleanAway}`;

          if (publishedMatchIds.has(m.id) || (teamKey && publishedTeamKeys.has(teamKey))) {
            continue;
          }

          const res = await client.query(
            `INSERT INTO facebook_claimed_ft_matches (
               match_id, team_key, home_team, away_team, league_name, score, publication_key, claimed_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (match_id) DO NOTHING
             RETURNING match_id`,
            [m.id, teamKey, home, away, m.league?.name || '', `${m.homeScore ?? 0} - ${m.awayScore ?? 0}`, publicationKey]
          );

          if (res.rows.length > 0) {
            successfullyClaimed.push(m);
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.warn('[DB] Error claiming FT matches in Postgres:', (err as Error).message);
      } finally {
        client.release();
      }
    } else {
      if (!this.localData.claimedFtMatches) {
        this.localData.claimedFtMatches = [];
      }
      const claimedIds = new Set(this.localData.claimedFtMatches.map((c: any) => c.matchId));
      const claimedKeys = new Set(this.localData.claimedFtMatches.map((c: any) => c.teamKey));

      for (const m of matches) {
        const home = m.homeTeam?.name || '';
        const away = m.awayTeam?.name || '';
        const cleanHome = home.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const cleanAway = away.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const teamKey = `${cleanHome}_vs_${cleanAway}`;

        if (publishedMatchIds.has(m.id) || (teamKey && publishedTeamKeys.has(teamKey))) {
          continue;
        }
        if (claimedIds.has(m.id) || (teamKey && claimedKeys.has(teamKey))) {
          continue;
        }

        this.localData.claimedFtMatches.push({
          matchId: m.id,
          teamKey,
          homeTeam: home,
          awayTeam: away,
          leagueName: m.league?.name || '',
          score: `${m.homeScore ?? 0} - ${m.awayScore ?? 0}`,
          publicationKey,
          claimedAt: new Date().toISOString(),
        });
        successfullyClaimed.push(m);
      }
      this.saveLocalData();
    }

    return successfullyClaimed;
  }

  async claimHtMatchesForPublication(matches: Match[], publicationKey: string): Promise<Match[]> {
    if (!matches || matches.length === 0) return [];

    const successfullyClaimed: Match[] = [];
    const publishedList = await this.getPublishedHtMatches();
    const publishedMatchIds = new Set(publishedList.map(r => r.matchId));
    const publishedTeamKeys = new Set(publishedList.map(r => r.teamKey).filter(Boolean));

    if (this.isPostgres && this.pgPool) {
      const client = await this.pgPool.connect();
      try {
        await client.query('BEGIN');
        for (const m of matches) {
          const home = m.homeTeam?.name || '';
          const away = m.awayTeam?.name || '';
          const cleanHome = home.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
          const cleanAway = away.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
          const teamKey = `${cleanHome}_vs_${cleanAway}`;

          if (publishedMatchIds.has(m.id) || (teamKey && publishedTeamKeys.has(teamKey))) {
            continue;
          }

          const res = await client.query(
            `INSERT INTO facebook_claimed_ht_matches (
               match_id, team_key, home_team, away_team, league_name, score, publication_key, claimed_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
             ON CONFLICT (match_id) DO NOTHING
             RETURNING match_id`,
            [m.id, teamKey, home, away, m.league?.name || '', `${m.homeScore ?? 0} - ${m.awayScore ?? 0}`, publicationKey]
          );

          if (res.rows.length > 0) {
            successfullyClaimed.push(m);
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        console.warn('[DB] Error claiming HT matches in Postgres:', (err as Error).message);
      } finally {
        client.release();
      }
    } else {
      if (!this.localData.claimedHtMatches) {
        this.localData.claimedHtMatches = [];
      }
      const claimedIds = new Set(this.localData.claimedHtMatches.map((c: any) => c.matchId));
      const claimedKeys = new Set(this.localData.claimedHtMatches.map((c: any) => c.teamKey));

      for (const m of matches) {
        const home = m.homeTeam?.name || '';
        const away = m.awayTeam?.name || '';
        const cleanHome = home.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const cleanAway = away.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        const teamKey = `${cleanHome}_vs_${cleanAway}`;

        if (publishedMatchIds.has(m.id) || (teamKey && publishedTeamKeys.has(teamKey))) {
          continue;
        }
        if (claimedIds.has(m.id) || (teamKey && claimedKeys.has(teamKey))) {
          continue;
        }

        this.localData.claimedHtMatches.push({
          matchId: m.id,
          teamKey,
          homeTeam: home,
          awayTeam: away,
          leagueName: m.league?.name || '',
          score: `${m.homeScore ?? 0} - ${m.awayScore ?? 0}`,
          publicationKey,
          claimedAt: new Date().toISOString(),
        });
        successfullyClaimed.push(m);
      }
      this.saveLocalData();
    }

    return successfullyClaimed;
  }

  async markClaimedFtMatchesPublished(publicationKey: string): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      try {
        const res = await this.pgPool.query(
          'SELECT * FROM facebook_claimed_ft_matches WHERE publication_key = $1',
          [publicationKey]
        );
        if (res.rows.length > 0) {
          const matchesToMark: Match[] = res.rows.map(r => ({
            id: r.match_id,
            homeTeam: { id: '', name: r.home_team },
            awayTeam: { id: '', name: r.away_team },
            league: { id: '', name: r.league_name, country: '' },
            homeScore: 0,
            awayScore: 0,
            status: 'FINISHED',
            statusText: 'FT',
            provider: 'flashscore',
            startTime: '',
            lastUpdated: '',
          }));
          await this.markFtMatchesPublished(matchesToMark);
        }
      } catch (err) {
        console.warn('[DB] Error transferring claimed FT matches to published:', (err as Error).message);
      }
    } else {
      if (this.localData.claimedFtMatches) {
        const claimed = this.localData.claimedFtMatches.filter((c: any) => c.publicationKey === publicationKey);
        if (claimed.length > 0) {
          const matchesToMark: Match[] = claimed.map((r: any) => ({
            id: r.matchId,
            homeTeam: { id: '', name: r.homeTeam },
            awayTeam: { id: '', name: r.awayTeam },
            league: { id: '', name: r.leagueName, country: '' },
            homeScore: 0,
            awayScore: 0,
            status: 'FINISHED',
            statusText: 'FT',
            provider: 'flashscore',
            startTime: '',
            lastUpdated: '',
          }));
          await this.markFtMatchesPublished(matchesToMark);
        }
      }
    }
  }

  async markClaimedHtMatchesPublished(publicationKey: string): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      try {
        const res = await this.pgPool.query(
          'SELECT * FROM facebook_claimed_ht_matches WHERE publication_key = $1',
          [publicationKey]
        );
        if (res.rows.length > 0) {
          const matchesToMark: Match[] = res.rows.map(r => ({
            id: r.match_id,
            homeTeam: { id: '', name: r.home_team },
            awayTeam: { id: '', name: r.away_team },
            league: { id: '', name: r.league_name, country: '' },
            homeScore: 0,
            awayScore: 0,
            status: 'PAUSED',
            statusText: 'HT',
            provider: 'flashscore',
            startTime: '',
            lastUpdated: '',
          }));
          await this.markHtMatchesPublished(matchesToMark);
        }
      } catch (err) {
        console.warn('[DB] Error transferring claimed HT matches to published:', (err as Error).message);
      }
    } else {
      if (this.localData.claimedHtMatches) {
        const claimed = this.localData.claimedHtMatches.filter((c: any) => c.publicationKey === publicationKey);
        if (claimed.length > 0) {
          const matchesToMark: Match[] = claimed.map((r: any) => ({
            id: r.matchId,
            homeTeam: { id: '', name: r.homeTeam },
            awayTeam: { id: '', name: r.awayTeam },
            league: { id: '', name: r.leagueName, country: '' },
            homeScore: 0,
            awayScore: 0,
            status: 'PAUSED',
            statusText: 'HT',
            provider: 'flashscore',
            startTime: '',
            lastUpdated: '',
          }));
          await this.markHtMatchesPublished(matchesToMark);
        }
      }
    }
  }

  async clearClaimedMatches(): Promise<void> {
    if (this.isPostgres && this.pgPool) {
      try {
        await this.pgPool.query('DELETE FROM facebook_claimed_ft_matches');
        await this.pgPool.query('DELETE FROM facebook_claimed_ht_matches');
      } catch (err) {
        console.warn('[DB] Error clearing claimed matches in Postgres:', (err as Error).message);
      }
    }
    if (this.localData) {
      this.localData.claimedFtMatches = [];
      this.localData.claimedHtMatches = [];
      this.saveLocalData();
    }
  }

  async getApiKeys(): Promise<ApiKeyRecord[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query('SELECT * FROM api_keys ORDER BY created_at DESC');
      return res.rows.map(r => ({
        id: r.id,
        key: r.key,
        name: r.name,
        role: r.role,
        createdAt: r.created_at.toISOString(),
        lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : undefined,
      }));
    }
    return this.localData.apiKeys;
  }

  async validateApiKey(key: string): Promise<ApiKeyRecord | null> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query('SELECT * FROM api_keys WHERE key = $1', [key]);
      if (res.rows.length === 0) return null;
      await this.pgPool.query('UPDATE api_keys SET last_used_at = NOW() WHERE key = $1', [key]);
      const r = res.rows[0];
      return {
        id: r.id,
        key: r.key,
        name: r.name,
        role: r.role,
        createdAt: r.created_at.toISOString(),
        lastUsedAt: new Date().toISOString(),
      };
    }
    const match = this.localData.apiKeys.find(k => k.key === key);
    if (match) {
      match.lastUsedAt = new Date().toISOString();
      this.saveLocalData();
      return match;
    }
    return null;
  }

  async getDailyLeagueSelection(timeZone = 'UTC'): Promise<DailyLeagueSelection> {
    const today = getTodayDateString(timeZone);
    const stored = await this.getSettings<DailyLeagueSelection | null>('dailyLeagueSelection', null);

    // If no selection stored, or if the date has changed (new day began!):
    if (!stored || stored.date !== today) {
      const resetSelection: DailyLeagueSelection = {
        date: today,
        selectedLeagueIds: [],
        selectedLeagueNames: [],
        allLeaguesSelected: false,
        lastUpdated: new Date().toISOString(),
      };
      await this.saveSettings('dailyLeagueSelection', resetSelection);

      // Also reset fbConfig targetLeagueIds so they remain strictly in sync
      const fbConfig = await this.getSettings<FacebookPageConfig | null>('fbConfig', null);
      if (fbConfig) {
        fbConfig.targetLeagueIds = [];
        await this.saveSettings('fbConfig', fbConfig);
      }
      return resetSelection;
    }

    return stored;
  }

  async saveDailyLeagueSelection(
    selection: { selectedLeagueIds: string[]; selectedLeagueNames?: string[]; allLeaguesSelected?: boolean },
    timeZone = 'UTC'
  ): Promise<DailyLeagueSelection> {
    const today = getTodayDateString(timeZone);
    const updated: DailyLeagueSelection = {
      date: today,
      selectedLeagueIds: Array.isArray(selection.selectedLeagueIds) ? selection.selectedLeagueIds : [],
      selectedLeagueNames: Array.isArray(selection.selectedLeagueNames) ? selection.selectedLeagueNames : [],
      allLeaguesSelected: Boolean(selection.allLeaguesSelected),
      lastUpdated: new Date().toISOString(),
    };
    await this.saveSettings('dailyLeagueSelection', updated);

    // Synchronize fbConfig.targetLeagueIds
    const fbConfig = await this.getSettings<FacebookPageConfig | null>('fbConfig', null);
    if (fbConfig) {
      fbConfig.targetLeagueIds = updated.selectedLeagueIds;
      await this.saveSettings('fbConfig', fbConfig);
    }

    return updated;
  }

  async resetDailyLeagueSelection(timeZone = 'UTC'): Promise<DailyLeagueSelection> {
    const today = getTodayDateString(timeZone);
    const resetSelection: DailyLeagueSelection = {
      date: today,
      selectedLeagueIds: [],
      selectedLeagueNames: [],
      allLeaguesSelected: false,
      lastUpdated: new Date().toISOString(),
    };
    await this.saveSettings('dailyLeagueSelection', resetSelection);
    const fbConfig = await this.getSettings<FacebookPageConfig | null>('fbConfig', null);
    if (fbConfig) {
      fbConfig.targetLeagueIds = [];
      await this.saveSettings('fbConfig', fbConfig);
    }
    return resetSelection;
  }

  async getStats(): Promise<{ matchCount: number; eventCount: number; fbPostCount: number; dbType: string }> {
    if (this.isPostgres && this.pgPool) {
      const m = await this.pgPool.query('SELECT COUNT(*) FROM matches');
      const e = await this.pgPool.query('SELECT COUNT(*) FROM match_events');
      const p = await this.pgPool.query('SELECT COUNT(*) FROM facebook_posts');
      return {
        matchCount: parseInt(m.rows[0].count, 10),
        eventCount: parseInt(e.rows[0].count, 10),
        fbPostCount: parseInt(p.rows[0].count, 10),
        dbType: 'PostgreSQL'
      };
    }
    const matchCount = Object.keys(this.localData.matches).length;
    const eventCount = Object.values(this.localData.events).reduce((sum, evList) => sum + evList.length, 0);
    const fbPostCount = this.localData.facebookPosts.length;
    return {
      matchCount,
      eventCount,
      fbPostCount,
      dbType: 'Persistent SQL/JSON Store'
    };
  }

  // -------------------------------------------------------------
  // Admin User & Session Authentication
  // -------------------------------------------------------------

  hashPassword(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  }

  generateSalt(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  async initAdminUserIfNone(): Promise<void> {
    try {
      const count = await this.getAdminCount();
      if (count === 0) {
        const salt = this.generateSalt();
        const defaultUsername = 'admin';
        const defaultPassword = 'admin12345';
        const passwordHash = this.hashPassword(defaultPassword, salt);
        const adminId = 'admin_' + crypto.randomBytes(8).toString('hex');

        if (this.isPostgres && this.pgPool) {
          await this.pgPool.query(
            `INSERT INTO admin_users (id, username, password_hash, salt, role, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
             ON CONFLICT (username) DO NOTHING`,
            [adminId, defaultUsername, passwordHash, salt, 'superadmin']
          );
        } else {
          this.localData.adminUsers.push({
            id: adminId,
            username: defaultUsername,
            passwordHash,
            salt,
            role: 'superadmin',
            createdAt: new Date().toISOString(),
          });
          this.saveLocalData();
        }
        console.log(`[Auth] Initialized default superadmin user ('${defaultUsername}'). Password: '${defaultPassword}'`);
      }
    } catch (e) {
      console.error('[Auth] Error initializing default admin:', e);
    }
  }

  async getAdminCount(): Promise<number> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query('SELECT COUNT(*) FROM admin_users');
      return parseInt(res.rows[0].count, 10);
    }
    return (this.localData.adminUsers || []).length;
  }

  async getAdminByUsername(username: string): Promise<(AdminUser & { passwordHash: string; salt: string }) | null> {
    const cleanUsername = username.trim().toLowerCase();
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        'SELECT id, username, password_hash, salt, role, created_at, last_login FROM admin_users WHERE LOWER(username) = $1 LIMIT 1',
        [cleanUsername]
      );
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        username: r.username,
        passwordHash: r.password_hash,
        salt: r.salt,
        role: r.role,
        createdAt: r.created_at,
        lastLogin: r.last_login,
      };
    }

    const found = (this.localData.adminUsers || []).find(u => u.username.toLowerCase() === cleanUsername);
    if (!found) return null;
    return {
      id: found.id,
      username: found.username,
      passwordHash: found.passwordHash,
      salt: found.salt,
      role: found.role,
      createdAt: found.createdAt,
      lastLogin: found.lastLogin,
    };
  }

  async getAdminById(id: string): Promise<AdminUser | null> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        'SELECT id, username, role, created_at, last_login FROM admin_users WHERE id = $1 LIMIT 1',
        [id]
      );
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      return {
        id: r.id,
        username: r.username,
        role: r.role,
        createdAt: r.created_at,
        lastLogin: r.last_login,
      };
    }

    const found = (this.localData.adminUsers || []).find(u => u.id === id);
    if (!found) return null;
    return {
      id: found.id,
      username: found.username,
      role: found.role,
      createdAt: found.createdAt,
      lastLogin: found.lastLogin,
    };
  }

  async createAdminUser(data: { username: string; password: string; role?: 'superadmin' | 'admin' | 'moderator' }): Promise<AdminUser> {
    const cleanUsername = data.username.trim().toLowerCase();
    const existing = await this.getAdminByUsername(cleanUsername);
    if (existing) {
      throw new Error(`Username "${data.username}" already exists.`);
    }

    const salt = this.generateSalt();
    const passwordHash = this.hashPassword(data.password, salt);
    const id = 'admin_' + crypto.randomBytes(8).toString('hex');
    const role = data.role || 'admin';
    const now = new Date().toISOString();

    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO admin_users (id, username, password_hash, salt, role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, cleanUsername, passwordHash, salt, role, now]
      );
    } else {
      this.localData.adminUsers.push({
        id,
        username: cleanUsername,
        passwordHash,
        salt,
        role,
        createdAt: now,
      });
      this.saveLocalData();
    }

    return {
      id,
      username: cleanUsername,
      role,
      createdAt: now,
    };
  }

  async updateAdminPassword(adminId: string, newPassword: string): Promise<boolean> {
    const salt = this.generateSalt();
    const passwordHash = this.hashPassword(newPassword, salt);

    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        'UPDATE admin_users SET password_hash = $1, salt = $2 WHERE id = $3',
        [passwordHash, salt, adminId]
      );
      return (res.rowCount ?? 0) > 0;
    }

    const idx = (this.localData.adminUsers || []).findIndex(u => u.id === adminId);
    if (idx >= 0) {
      this.localData.adminUsers[idx].passwordHash = passwordHash;
      this.localData.adminUsers[idx].salt = salt;
      this.saveLocalData();
      return true;
    }
    return false;
  }

  async updateAdminLastLogin(adminId: string): Promise<void> {
    const now = new Date().toISOString();
    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query('UPDATE admin_users SET last_login = NOW() WHERE id = $1', [adminId]);
      return;
    }

    const idx = (this.localData.adminUsers || []).findIndex(u => u.id === adminId);
    if (idx >= 0) {
      this.localData.adminUsers[idx].lastLogin = now;
      this.saveLocalData();
    }
  }

  async getAdminUsers(): Promise<AdminUser[]> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query('SELECT id, username, role, created_at, last_login FROM admin_users ORDER BY created_at ASC');
      return res.rows.map(r => ({
        id: r.id,
        username: r.username,
        role: r.role,
        createdAt: r.created_at,
        lastLogin: r.last_login,
      }));
    }

    return (this.localData.adminUsers || []).map(u => ({
      id: u.id,
      username: u.username,
      role: u.role,
      createdAt: u.createdAt,
      lastLogin: u.lastLogin,
    }));
  }

  async getAllAdmins(): Promise<AdminUser[]> {
    return this.getAdminUsers();
  }

  async createSession(adminId: string, username: string, role = 'superadmin', expiresInDays = 7): Promise<AdminSession> {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    const session: AdminSession = {
      token,
      adminId,
      username,
      role,
      createdAt: now.toISOString(),
      expiresAt,
    };

    if (this.isPostgres && this.pgPool) {
      await this.pgPool.query(
        `INSERT INTO admin_sessions (token, admin_id, username, role, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [token, adminId, username, role, session.createdAt, expiresAt]
      );
    } else {
      if (!this.localData.adminSessions) this.localData.adminSessions = [];
      this.localData.adminSessions.push(session);
      this.saveLocalData();
    }

    return session;
  }

  async validateSession(token: string): Promise<AdminSession | null> {
    if (!token) return null;

    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query(
        'SELECT token, admin_id, username, role, created_at, expires_at FROM admin_sessions WHERE token = $1 LIMIT 1',
        [token]
      );
      if (res.rows.length === 0) return null;
      const r = res.rows[0];
      if (new Date(r.expires_at).getTime() < Date.now()) {
        await this.deleteSession(token);
        return null;
      }
      return {
        token: r.token,
        adminId: r.admin_id,
        username: r.username,
        role: r.role,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      };
    }

    const sessions = this.localData.adminSessions || [];
    const found = sessions.find(s => s.token === token);
    if (!found) return null;

    if (new Date(found.expiresAt).getTime() < Date.now()) {
      await this.deleteSession(token);
      return null;
    }

    return found;
  }

  async deleteSession(token: string): Promise<boolean> {
    if (this.isPostgres && this.pgPool) {
      const res = await this.pgPool.query('DELETE FROM admin_sessions WHERE token = $1', [token]);
      return (res.rowCount ?? 0) > 0;
    }

    const initialLen = (this.localData.adminSessions || []).length;
    this.localData.adminSessions = (this.localData.adminSessions || []).filter(s => s.token !== token);
    if (this.localData.adminSessions.length !== initialLen) {
      this.saveLocalData();
      return true;
    }
    return false;
  }

  getConnectionInfo() {
    const rawUrl = config.databaseUrl;
    let masked = 'None';
    let isRenderHost = false;
    if (rawUrl) {
      try {
        const u = new URL(rawUrl);
        masked = `${u.protocol}//${u.username}:****@${u.host}${u.pathname}`;
        isRenderHost = u.host.includes('dpg-') || u.host.includes('render.com');
      } catch {
        masked = 'Configured (PostgreSQL)';
      }
    }
    return {
      isPostgres: this.isPostgres,
      dbType: this.isPostgres ? 'PostgreSQL (Connected)' : (config.databaseUrl ? 'PostgreSQL (Fallback to Local Disk)' : 'Local JSON Disk Store'),
      databaseUrlMasked: masked,
      isRenderHost,
    };
  }
}

export const db = new DatabaseManager();
