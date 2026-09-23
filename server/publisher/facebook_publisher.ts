import crypto from 'crypto';
import { db } from '../db/index.js';
import { fbClient } from './facebook_client.js';
import { config } from '../config.js';
import {
  FacebookPublisherState,
  FacebookPendingPublication,
  FacebookPublicationType,
  FacebookPageConfig,
  FacebookPostRecord,
} from '../types.js';

export interface PublishRequest {
  type: FacebookPublicationType;
  message: string;
  matchId?: string;
  matchTitle?: string;
  leagueName?: string;
  metadata?: Record<string, any>;
  forceImmediate?: boolean; // For manual or test publish requests that should attempt processing synchronously
}

export interface PublishRequestResult {
  success: boolean;
  blocked?: boolean;
  duplicate?: boolean;
  queued?: boolean;
  postId?: string;
  error?: string;
  reason?: string;
  cooldownUntil?: string;
  retryAfterSeconds?: number;
  contentHash?: string;
}

export class FacebookPublisher {
  private workerId: string;
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() {
    this.workerId = `worker_${process.pid}_${Math.random().toString(36).substring(2, 8)}`;
  }

  /**
   * Initialize publisher on system startup.
   * Loads persistent state, checks existing cooldowns, and starts background loop.
   */
  async init(): Promise<void> {
    try {
      const state = await db.getPublisherState();
      const now = Date.now();

      if (state.cooldownUntil) {
        const cooldownRemainingMs = new Date(state.cooldownUntil).getTime() - now;
        if (cooldownRemainingMs > 0) {
          console.log(
            `[FB] Persistent cooldown active on startup: ${Math.ceil(cooldownRemainingMs / 1000)}s remaining (${state.cooldownReason || 'Meta anti-spam rate limit'}). Publishing remains PAUSED.`
          );
        } else {
          // Cooldown has elapsed while server was restarting
          await db.updatePublisherState({
            publishingPaused: false,
            cooldownUntil: undefined,
            cooldownReason: undefined,
          });
          console.log('[FB] Persistent cooldown has elapsed. Publisher resumed.');
        }
      }

      // Check if any old lock was held by a crashed process and lease has expired
      const lockStatus = await db.getPublisherLockStatus();
      if (lockStatus.locked && lockStatus.remainingSeconds === 0) {
        await db.releasePublisherLock(lockStatus.owner || 'expired');
        console.log('[FB] Cleaned up expired publisher lock from previous run.');
      }

      console.log(`[FB] FacebookPublisher initialized successfully. Worker ID: ${this.workerId}`);
    } catch (err) {
      console.warn('[FB] Error during FacebookPublisher init:', (err as Error).message);
    }

    this.startWorker();
  }

  /**
   * Background tick loop checking pending publications against interval and cooldown
   */
  startWorker(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.processNextPending().catch(err => {
        console.warn('[FB] Unexpected error in publisher background tick:', (err as Error).message);
      });
    }, 5000);
  }

  stopWorker(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Deterministic content hashing using SHA-256
   */
  computeContentHash(message: string): string {
    // Normalize lines and whitespace
    const normalized = message
      .trim()
      .split('\n')
      .map(line => line.trim())
      .filter(line => Boolean(line))
      .join('\n');

    return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex');
  }

  /**
   * Calculate exponential backoff duration for Meta Error 1390008:
   * Block 1: 10 minutes (600s)
   * Block 2: 20 minutes (1200s)
   * Block 3: 40 minutes (2400s)
   * Block 4+: 60 minutes max (3600s)
   */
  calculateMetaBackoffSeconds(consecutiveBlocks: number): number {
    const initial = config.fbInitialCooldownSeconds || 600; // 10 min
    const max = config.fbMaxCooldownSeconds || 3600; // 60 min

    if (consecutiveBlocks <= 1) return initial;
    if (consecutiveBlocks === 2) return Math.min(max, initial * 2); // 20 min
    if (consecutiveBlocks === 3) return Math.min(max, initial * 4); // 40 min
    return max; // 60 min ceiling
  }

  /**
   * Check if Facebook publishing is currently on cooldown
   */
  async isCooldownActive(): Promise<{ active: boolean; cooldownUntil?: string; remainingSeconds?: number; reason?: string }> {
    const state = await db.getPublisherState();
    if (!state.cooldownUntil) {
      return { active: false };
    }
    const now = Date.now();
    const untilMs = new Date(state.cooldownUntil).getTime();
    if (untilMs > now) {
      const remainingSeconds = Math.ceil((untilMs - now) / 1000);
      return {
        active: true,
        cooldownUntil: state.cooldownUntil,
        remainingSeconds,
        reason: state.cooldownReason || 'Meta anti-spam rate limit active',
      };
    }
    return { active: false };
  }

  /**
   * Central Gateway: ALL Facebook publication requests must call this method.
   */
  async requestPublication(req: PublishRequest): Promise<PublishRequestResult> {
    console.log(`[FB] Publication requested: ${req.type}`);

    const state = await db.getPublisherState();

    // 1. Safety Check: Global Facebook Publishing Enabled
    if (!state.publishingEnabled) {
      console.log('[FB] Publication skipped - publishing is globally disabled.');
      return {
        success: false,
        blocked: true,
        reason: 'Facebook publishing is currently disabled in system configuration.',
      };
    }

    // 2. Safety Check: Active Meta Cooldown
    const cooldown = await this.isCooldownActive();
    if (cooldown.active) {
      const reasonMsg = `Facebook publishing is paused because Meta returned error 1390008 (Anti-Spam Velocity Filter). Cooldown active for ${cooldown.remainingSeconds}s.`;
      console.log(`[FB] Publication skipped - cooldown active (${cooldown.remainingSeconds}s remaining)`);

      if (req.type === 'TEST') {
        console.log('[FB] Test publication rejected because publisher is paused');
      }

      return {
        success: false,
        blocked: true,
        reason: reasonMsg,
        cooldownUntil: cooldown.cooldownUntil,
        retryAfterSeconds: cooldown.remainingSeconds,
      };
    }

    // 3. Safety Check: Content Hashing & Deduplication
    const contentHash = this.computeContentHash(req.message);
    if (state.lastPublishedContentHash && state.lastPublishedContentHash === contentHash) {
      console.log('[FB] Duplicate scoreboard detected. Publication skipped.');
      return {
        success: false,
        duplicate: true,
        reason: 'Duplicate scoreboard detected. Publication skipped.',
        contentHash,
      };
    }

    // 4. Never automatically requeue the exact payload that Meta blocked.
    // A different successful publication clears this quarantine; manual reset also clears it.
    if (state.blockedContentHash && state.blockedContentHash === contentHash) {
      return {
        success: false,
        blocked: true,
        reason: 'This exact publication payload was quarantined after Meta Error 368/1390008. It will not be retried automatically.',
        contentHash,
      };
    }

    // 4. For LIVE Scoreboard or HALF_TIME: Coalesce into ONE pending publication
    if (req.type === 'LIVE' || req.type === 'HALF_TIME') {
      const existingPending = await db.getPendingPublication(req.type);
      if (existingPending) {
        // Coalesce: update the existing pending publication with the latest scoreboard
        existingPending.content = req.message;
        existingPending.contentHash = contentHash;
        existingPending.updatedAt = new Date().toISOString();
        existingPending.metadata = { ...existingPending.metadata, ...req.metadata };
        await db.savePendingPublication(existingPending);
        await db.updatePublisherState({ pendingContentHash: contentHash });
        console.log(`[FB] Pending ${req.type} scoreboard updated`);
        return {
          success: true,
          queued: true,
          contentHash,
          reason: `${req.type === 'HALF_TIME' ? 'Half-Time' : 'Live'} scoreboard updated in pending queue.`,
        };
      }
    }

    // 5. Store pending publication in PostgreSQL/database
    const pendingId = `pub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const pending: FacebookPendingPublication = {
      id: pendingId,
      publicationType: req.type,
      content: req.message,
      contentHash,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attemptCount: 0,
      availableAt: new Date().toISOString(),
      metadata: req.metadata,
    };
    await db.savePendingPublication(pending);
    await db.updatePublisherState({ pendingContentHash: contentHash });

    // 6. If immediate processing requested (e.g. manual/test publish when safe)
    if (req.forceImmediate) {
      return await this.executePublication(pending);
    }

    // Trigger immediate background evaluation if not already running
    if (!this.isProcessing) {
      setImmediate(() => this.processNextPending());
    }

    return {
      success: true,
      queued: true,
      contentHash,
      reason: 'Publication accepted and queued for safe dispatch.',
    };
  }

  /**
   * Process the next eligible pending publication through the distributed lock and safety checks.
   */
  async processNextPending(): Promise<void> {
    if (this.isProcessing) return;

    try {
      // 1. Check if any pending publication exists
      const pending = await db.getPendingPublication();
      if (!pending) return;

      // 2. Check Cooldown
      const cooldown = await this.isCooldownActive();
      if (cooldown.active) {
        return; // Wait for cooldown to expire
      }

      // 3. Check Inter-Post Safety Delay (prevents concurrent Meta API requests)
      const state = await db.getPublisherState();
      const fbConfig = await db.getSettings<FacebookPageConfig>('fbConfig', {} as any);
      const minSpacingSec = Math.max(15, fbConfig.minPostSpacingSeconds || config.fbMinPublishIntervalSeconds || 30);
      const now = Date.now();

      if (state.lastSuccessfulPublishAt) {
        const elapsedSeconds = (now - new Date(state.lastSuccessfulPublishAt).getTime()) / 1000;
        if (elapsedSeconds < minSpacingSec) {
          const remainingSeconds = Math.ceil(minSpacingSec - elapsedSeconds);
          // Only log periodically to avoid spamming the logs
          if (remainingSeconds % 10 === 0) {
            console.log(`[FB] Publication skipped - inter-post delay active (${remainingSeconds}s remaining)`);
          }
          return;
        }
      }

      this.isProcessing = true;
      await this.executePublication(pending);
    } catch (err) {
      console.warn('[FB] Error in processNextPending:', (err as Error).message);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Atomic execution: Acquire Lock -> Reload State -> Recheck -> Publish -> Update State -> Release Lock
   */
  private async executePublication(pending: FacebookPendingPublication): Promise<PublishRequestResult> {
    // 1. ACQUIRE DISTRIBUTED LOCK
    const acquired = await db.acquirePublisherLock(this.workerId, config.fbLockLeaseSeconds);
    if (!acquired) {
      console.log(`[FB] Could not acquire publisher lock. Another worker is currently publishing.`);
      return {
        success: false,
        blocked: true,
        reason: 'Another publisher process currently holds the lock.',
      };
    }

    console.log(`[FB] Publisher lock acquired by ${this.workerId}`);

    try {
      // 2. RELOAD STATE from PostgreSQL
      const state = await db.getPublisherState();

      // 3. RECHECK COOLDOWN
      if (state.cooldownUntil && new Date(state.cooldownUntil).getTime() > Date.now()) {
        const remaining = Math.ceil((new Date(state.cooldownUntil).getTime() - Date.now()) / 1000);
        console.log(`[FB] Publication skipped - cooldown active (${remaining}s remaining)`);
        return {
          success: false,
          blocked: true,
          reason: `Meta anti-spam cooldown active for ${remaining}s.`,
          cooldownUntil: state.cooldownUntil,
          retryAfterSeconds: remaining,
        };
      }

      // 4. RECHECK INTER-POST SAFETY DELAY (except for explicit manual test)
      const fbConfig = await db.getSettings<FacebookPageConfig>('fbConfig', {
        pageId: config.fbPageId,
        pageAccessToken: config.fbPageAccessToken,
      } as any);
      const minSpacingSec = Math.max(15, fbConfig.minPostSpacingSeconds || config.fbMinPublishIntervalSeconds || 30);
      if (state.lastSuccessfulPublishAt && pending.publicationType !== 'TEST') {
        const elapsed = (Date.now() - new Date(state.lastSuccessfulPublishAt).getTime()) / 1000;
        if (elapsed < minSpacingSec) {
          const remaining = Math.ceil(minSpacingSec - elapsed);
          console.log(`[FB] Publication skipped - inter-post delay active (${remaining}s remaining)`);
          return {
            success: false,
            blocked: true,
            reason: `Inter-post safety spacing active (${remaining}s remaining).`,
            retryAfterSeconds: remaining,
          };
        }
      }

      // 5. RECHECK CONTENT HASH
      const currentHash = this.computeContentHash(pending.content);
      if (state.lastPublishedContentHash && state.lastPublishedContentHash === currentHash) {
        console.log('[FB] Duplicate scoreboard detected. Publication skipped.');
        // Clean up pending duplicate
        await db.deletePendingPublication(pending.id);
        return {
          success: false,
          duplicate: true,
          reason: 'Duplicate scoreboard detected. Publication skipped.',
        };
      }

      // 6. RESOLVE CREDENTIALS
      const pageId = fbConfig.pageId || config.fbPageId;
      const accessToken = fbConfig.pageAccessToken || config.fbPageAccessToken;

      if (!pageId || !accessToken) {
        console.warn('[FB] Cannot publish: Missing Facebook Page ID or Access Token.');
        return {
          success: false,
          error: 'Facebook Page ID or Access Token is not configured.',
        };
      }

      // 7. PUBLISH TO FACEBOOK GRAPH API
      console.log(`[FB] Publishing to Facebook (${pending.publicationType})`);
      await db.updatePublisherState({ lastAttemptAt: new Date().toISOString() });

      const result = await fbClient.publishPost(pageId, accessToken, pending.content);

      if (result.success && result.postId) {
        // SUCCESS PATH
        console.log(`[FB] Publication successful. Post ID: ${result.postId}`);
        const nowIso = new Date().toISOString();

        await db.updatePublisherState({
          publishingPaused: false,
          cooldownUntil: undefined,
          cooldownReason: undefined,
          consecutiveMetaBlocks: 0, // Reset consecutive blocks on success
          lastPublishAt: nowIso,
          lastSuccessfulPublishAt: nowIso,
          lastFacebookPostId: result.postId,
          lastPublishedContentHash: currentHash,
          pendingContentHash: undefined,
          blockedContentHash: undefined,
          lastErrorCode: undefined,
          lastErrorMessage: undefined,
        });

        // Record in facebook_posts history table
        const postRecord: FacebookPostRecord = {
          id: pending.id,
          matchId: pending.publicationType === 'LIVE' ? 'roundup_live' : pending.publicationType,
          matchTitle: (pending.metadata?.customTitle as string) || `Combined Scoreboard (${pending.publicationType})`,
          leagueName: (pending.metadata?.leagueNames as string[])?.join(', ') || 'Various',
          eventType: 'ROUNDUP' as any,
          message: pending.content,
          fbPostId: result.postId,
          status: 'PUBLISHED',
          retryCount: pending.attemptCount,
          createdAt: pending.createdAt,
          publishedAt: nowIso,
        };
        await db.saveFacebookPost(postRecord);

        // Delete from pending table
        await db.deletePendingPublication(pending.id);

        return {
          success: true,
          postId: result.postId,
          contentHash: currentHash,
        };
      } else {
        // ERROR PATH
        const errorCode = result.errorCode || (result.isSpamBlocked ? 368 : 0);
        const errorSubcode = result.errorSubcode;
        const errorMsg = result.error || 'Unknown Facebook API error';

        console.warn(`[FB] Publication failed: ${errorMsg} (code ${errorCode}, subcode ${errorSubcode})`);

        // Check for Meta Error 1390008 (Anti-Spam Velocity Block)
        const isMetaVelocityBlock = errorCode === 368 && errorSubcode === 1390008;
        if (isMetaVelocityBlock) {
          console.log('[FB] Meta 1390008 detected');

          const newConsecutive = (state.consecutiveMetaBlocks || 0) + 1;
          const totalBlocks = (state.totalMetaBlocks || 0) + 1;
          const backoffSeconds = this.calculateMetaBackoffSeconds(newConsecutive);
          const cooldownUntilIso = new Date(Date.now() + backoffSeconds * 1000).toISOString();
          const reason = `Facebook Anti-Spam Velocity Filter (Error 1390008): Meta temporarily blocked publishing. Cooldown paused for ${Math.round(backoffSeconds / 60)} minutes.`;

          if (newConsecutive === 1) {
            console.log(`[FB] Persistent cooldown created: ${backoffSeconds}s (block #1)`);
          } else {
            console.log(`[FB] Persistent cooldown extended: ${backoffSeconds}s (block #${newConsecutive})`);
          }

          // Persist backoff in PostgreSQL
          await db.updatePublisherState({
            publishingPaused: true,
            pauseReason: reason,
            cooldownUntil: cooldownUntilIso,
            cooldownReason: reason,
            consecutiveMetaBlocks: newConsecutive,
            totalMetaBlocks: totalBlocks,
            lastErrorCode: 1390008,
            lastErrorMessage: errorMsg,
          });

          // Quarantine this exact publication. Do NOT leave it PENDING, or the worker
          // would retry the same payload automatically when cooldown expires.
          pending.status = 'BLOCKED';
          pending.lastError = 'Meta Error 368 / Subcode 1390008: ' + errorMsg;
          await db.savePendingPublication(pending);
          await db.updatePublisherState({ blockedContentHash: currentHash, pendingContentHash: undefined });

          // Record failure in facebook_posts
          await db.saveFacebookPost({
            id: pending.id,
            matchId: pending.publicationType,
            matchTitle: `Scoreboard (${pending.publicationType})`,
            leagueName: 'Various',
            eventType: 'ROUNDUP' as any,
            message: pending.content,
            status: 'FAILED',
            error: errorMsg,
            retryCount: pending.attemptCount + 1,
            createdAt: pending.createdAt,
          });

          return {
            success: false,
            blocked: true,
            error: errorMsg,
            reason,
            cooldownUntil: cooldownUntilIso,
            retryAfterSeconds: backoffSeconds,
          };
        } else {
          // Other API error (e.g. invalid token, permission, network)
          pending.attemptCount += 1;
          pending.lastError = errorMsg;

          if (pending.attemptCount >= config.fbPublishMaxRetries) {
            pending.status = 'FAILED';
            await db.deletePendingPublication(pending.id);
          } else {
            // Requeue with backoff delay
            pending.availableAt = new Date(Date.now() + 60000 * pending.attemptCount).toISOString();
            await db.savePendingPublication(pending);
          }

          await db.updatePublisherState({
            lastErrorCode: errorCode,
            lastErrorMessage: errorMsg,
          });

          return {
            success: false,
            error: errorMsg,
          };
        }
      }
    } finally {
      // RELEASE LOCK
      await db.releasePublisherLock(this.workerId);
      console.log(`[FB] Publisher lock released by ${this.workerId}`);
    }
  }

  /**
   * Reset or dismiss warnings without bypassing active Meta cooldowns
   */
  async acknowledgeWarnings(): Promise<void> {
    await db.dismissAntiSpamWarnings();
    const state = await db.getPublisherState();
    // Do not bypass cooldown if still active!
    if (state.cooldownUntil && new Date(state.cooldownUntil).getTime() > Date.now()) {
      console.log('[FB] Warnings acknowledged. Active Meta cooldown remains in effect.');
    } else {
      await db.updatePublisherState({
        publishingPaused: false,
        cooldownUntil: undefined,
        cooldownReason: undefined,
      });
      console.log('[FB] Warnings acknowledged. Publisher resumed.');
    }
  }

  /**
   * Clear pending queue without bypassing active Meta cooldowns
   */
  async clearPendingQueue(): Promise<number> {
    const cleared = await db.clearPendingPublications();
    await db.updatePublisherState({ pendingContentHash: undefined });
    console.log(`[FB] Cleared ${cleared} pending publications from queue.`);
    return cleared;
  }

  /**
   * Force manual reset of cooldown (SuperAdmin action)
   */
  async forceResetCooldown(): Promise<void> {
    await db.updatePublisherState({
      publishingPaused: false,
      cooldownUntil: undefined,
      cooldownReason: undefined,
      blockedContentHash: undefined,
      consecutiveMetaBlocks: 0,
    });
    console.log('[FB] Publisher cooldown manually reset. Publisher resumed.');
  }

  /**
   * Comprehensive publisher status for UI dashboard and diagnostics
   */
  async getDashboardStatus(): Promise<{
    state: FacebookPublisherState;
    lock: { locked: boolean; owner?: string; remainingSeconds?: number };
    cooldownRemainingSeconds: number;
    pendingCount: number;
    pendingType?: string;
  }> {
    const state = await db.getPublisherState();
    const lock = await db.getPublisherLockStatus();
    const pendingList = await db.getAllPendingPublications();

    const now = Date.now();
    let cooldownRemainingSeconds = 0;
    if (state.cooldownUntil) {
      const untilMs = new Date(state.cooldownUntil).getTime();
      if (untilMs > now) {
        cooldownRemainingSeconds = Math.ceil((untilMs - now) / 1000);
      }
    }

    return {
      state,
      lock,
      cooldownRemainingSeconds,
      pendingCount: pendingList.length,
      pendingType: pendingList[0]?.publicationType,
    };
  }
}

export const facebookPublisher = new FacebookPublisher();
