import { Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { redisUrl } from '@aven/config/env';
import { sha256 } from './tokens.js';

export type RateLimitResult = { allowed: boolean; retryAfter: number };

@Injectable()
export class AuthRateLimiter {
  private redis: Redis | undefined;

  private getRedis(): Redis {
    if (!this.redis) {
      this.redis = new Redis(redisUrl(), {
        lazyConnect: true,
        connectTimeout: 1500,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        retryStrategy: () => null,
      });
      this.redis.on('error', () => undefined);
    }
    return this.redis;
  }

  async consume(
    action: string,
    identifier: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult> {
    const client = this.getRedis();
    if (client.status === 'wait') await client.connect();
    const key = `auth:rl:${action}:${sha256(identifier).slice(0, 32)}`;
    const result = await client.multi().incr(key).expire(key, windowSeconds, 'NX').exec();
    const count = Number(result?.[0]?.[1] ?? 0);
    if (count <= limit) return { allowed: true, retryAfter: 0 };
    const ttl = await client.ttl(key);
    return { allowed: false, retryAfter: Math.max(ttl, 1) };
  }

  close(): void {
    this.redis?.disconnect();
    this.redis = undefined;
  }
}
