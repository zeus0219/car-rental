import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import Redis from 'ioredis';

/**
 * A6: shared rate-limit state for multi-instance API (when `REDIS_URL` is set).
 * `timeToExpire` is seconds (same as Nest default in-memory storage) for `Retry-After` / `X-RateLimit-*`.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly redis: Redis;
  private readonly keyPrefix = 'throttler:';

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
  }

  async increment(key: string, ttlMs: number): Promise<ThrottlerStorageRecord> {
    const k = this.keyPrefix + key;
    const hits = await this.redis.incr(k);
    if (hits === 1) {
      await this.redis.pexpire(k, ttlMs);
    }
    let pttl = await this.redis.pttl(k);
    if (pttl < 0) {
      await this.redis.pexpire(k, ttlMs);
      pttl = ttlMs;
    }
    const timeToExpire = Math.max(1, Math.ceil(pttl / 1000));
    return { totalHits: hits, timeToExpire };
  }
}
