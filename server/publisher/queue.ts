import { facebookPublisher } from './facebook_publisher.js';
import { db } from '../db/index.js';
import { FacebookPostRecord, FacebookPageConfig } from '../types.js';

/**
 * FacebookPublisherQueue is maintained for backward compatibility with existing callers.
 * All operations are delegated directly to the centralized FacebookPublisher gatekeeper
 * to guarantee that 100% of Facebook publishing passes through the persistent lock and safety checks.
 */
class FacebookPublisherQueue {
  async init(): Promise<void> {
    await facebookPublisher.init();
  }

  startWorker(): void {
    facebookPublisher.startWorker();
  }

  stopWorker(): void {
    facebookPublisher.stopWorker();
  }

  async resetCooldown(): Promise<void> {
    await facebookPublisher.acknowledgeWarnings();
  }

  async forceResetCooldown(): Promise<void> {
    await facebookPublisher.forceResetCooldown();
  }

  applySafeMode(_minSpacingSec = 120): void {
    // Hard minimum 900s is enforced in facebookPublisher
    console.log('[FB Queue] Safe mode acknowledged. Centralized 15-minute floor active.');
  }

  async enqueue(postData: Omit<FacebookPostRecord, 'id' | 'status' | 'retryCount' | 'createdAt'>): Promise<string> {
    // Determine publication type
    let pubType: 'LIVE' | 'FULL_TIME' | 'MANUAL' | 'TEST' = 'LIVE';
    if (postData.matchId === 'test') {
      pubType = 'TEST';
    } else if (postData.matchId?.startsWith('results_roundup_') || postData.eventType === 'FULL_TIME') {
      pubType = 'FULL_TIME';
    } else if (postData.matchId === 'manual') {
      pubType = 'MANUAL';
    }

    const res = await facebookPublisher.requestPublication({
      type: pubType,
      message: postData.message,
      matchId: postData.matchId,
      matchTitle: postData.matchTitle,
      leagueName: postData.leagueName,
      metadata: {
        eventType: postData.eventType,
      },
    });

    return res.postId || res.contentHash || 'queued';
  }

  async getMetrics(): Promise<{
    queueLength: number;
    isProcessing: boolean;
    recentPublishCount: number;
    maxPerMinute: number;
    isCooldown: boolean;
    cooldownSecondsRemaining: number;
    cooldownReason?: string;
    lastPublishedAt?: string;
    minPostSpacingSeconds: number;
  }> {
    const status = await facebookPublisher.getDashboardStatus();
    const fbConfig = await db.getSettings<FacebookPageConfig>('fbConfig', {} as any);
    const configuredSpacing = Math.max(15, fbConfig.minPostSpacingSeconds || 30);
    return {
      queueLength: status.pendingCount,
      isProcessing: status.lock.locked,
      recentPublishCount: status.state.lastPublishAt ? 1 : 0,
      maxPerMinute: 1,
      isCooldown: status.cooldownRemainingSeconds > 0,
      cooldownSecondsRemaining: status.cooldownRemainingSeconds,
      cooldownReason: status.cooldownRemainingSeconds > 0 ? status.state.cooldownReason : undefined,
      lastPublishedAt: status.state.lastPublishAt,
      minPostSpacingSeconds: configuredSpacing,
    };
  }

  async clearQueue(): Promise<number> {
    // Clear pending queue WITHOUT resetting persistent Meta cooldown!
    return await facebookPublisher.clearPendingQueue();
  }
}

export const publisherQueue = new FacebookPublisherQueue();
