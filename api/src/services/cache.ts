/**
 * Cache Service for AI Compliance
 *
 * Provides caching for regulatory rules and AI conflict resolutions
 * with fallback support when the AI service is unavailable.
 */

import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';
import {
  CACHE_TTL_RULES,
  CACHE_TTL_CONFLICTS,
  FALLBACK_CACHE_TTL,
} from '../types/conflicts';

// ============= Redis Client =============

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
  if (!config.cache?.enabled) {
    return null;
  }

  if (!redisClient) {
    try {
      redisClient = new Redis(config.redis.url, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        retryStrategy: (times: number) => {
          if (times > 3) {
            return null; // Stop retrying
          }
          return Math.min(times * 100, 3000);
        },
      });

      redisClient.on('error', (err) => {
        logger.error('Redis connection error', { error: err.message });
      });

      redisClient.on('connect', () => {
        logger.info('Redis connected');
      });
    } catch (error) {
      logger.error('Failed to create Redis client', { error });
      return null;
    }
  }

  return redisClient;
}

// ============= In-Memory Fallback =============

const inMemoryCache = new Map<string, { data: string; expiresAt: number }>();

function cleanExpiredInMemory(): void {
  const now = Date.now();
  for (const [key, value] of inMemoryCache.entries()) {
    if (value.expiresAt < now) {
      inMemoryCache.delete(key);
    }
  }
}

// Clean up every 5 minutes
setInterval(cleanExpiredInMemory, 5 * 60 * 1000);

// ============= Generic Cache Operations =============

/**
 * Set a value in cache with TTL
 */
async function setCacheValue(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  const serialized = JSON.stringify(value);

  const redis = getRedis();
  if (redis) {
    try {
      await redis.setex(key, ttlSeconds, serialized);
      return;
    } catch (error) {
      logger.warn('Redis set failed, using in-memory', { key, error });
    }
  }

  // Fallback to in-memory
  inMemoryCache.set(key, {
    data: serialized,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Get a value from cache
 */
async function getCacheValue<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const value = await redis.get(key);
      if (value) {
        return JSON.parse(value) as T;
      }
      return null;
    } catch (error) {
      logger.warn('Redis get failed, trying in-memory', { key, error });
    }
  }

  // Fallback to in-memory
  const cached = inMemoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return JSON.parse(cached.data) as T;
  }

  return null;
}

/**
 * Delete a value from cache
 */
async function deleteCacheValue(key: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(key);
    } catch (error) {
      logger.warn('Redis delete failed', { key, error });
    }
  }

  inMemoryCache.delete(key);
}

/**
 * Delete all keys matching a pattern
 */
async function deleteByPattern(pattern: string): Promise<number> {
  let deletedCount = 0;

  const redis = getRedis();
  if (redis) {
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        deletedCount = await redis.del(...keys);
      }
    } catch (error) {
      logger.warn('Redis pattern delete failed', { pattern, error });
    }
  }

  // Also clean in-memory
  const patternRegex = new RegExp(pattern.replace('*', '.*'));
  for (const key of inMemoryCache.keys()) {
    if (patternRegex.test(key)) {
      inMemoryCache.delete(key);
      deletedCount++;
    }
  }

  return deletedCount;
}

// ============= Compliance-Specific Cache Functions =============

/**
 * Cache compliance resolution results
 */
export async function setComplianceCache<T>(key: string, value: T): Promise<void> {
  await setCacheValue(`compliance:${key}`, value, CACHE_TTL_CONFLICTS);
}

/**
 * Get cached compliance resolution
 */
export async function getComplianceCache<T>(key: string): Promise<T | null> {
  return getCacheValue<T>(`compliance:${key}`);
}

/**
 * Set fallback cache (longer TTL for when AI is down)
 */
export async function setFallbackCache<T>(key: string, value: T): Promise<void> {
  await setCacheValue(`fallback:${key}`, value, FALLBACK_CACHE_TTL);
}

/**
 * Get fallback cache (used when AI service fails)
 */
export async function getFallbackCache<T>(key: string): Promise<T | null> {
  return getCacheValue<T>(`fallback:${key}`);
}

/**
 * Cache jurisdiction rules
 */
export async function setRulesCache(jurisdiction: string, rules: unknown): Promise<void> {
  await setCacheValue(`rules:${jurisdiction}`, rules, CACHE_TTL_RULES);
}

/**
 * Get cached jurisdiction rules
 */
export async function getRulesCache<T>(jurisdiction: string): Promise<T | null> {
  return getCacheValue<T>(`rules:${jurisdiction}`);
}

/**
 * Invalidate all cached rules for a jurisdiction
 * Called when regulatory updates are detected
 */
export async function invalidateJurisdictionCache(jurisdiction: string): Promise<void> {
  logger.info('Invalidating cache for jurisdiction', { jurisdiction });

  // Delete rules cache
  await deleteCacheValue(`rules:${jurisdiction}`);

  // Delete all conflict caches that include this jurisdiction
  const deleted = await deleteByPattern(`compliance:*${jurisdiction}*`);

  logger.info('Jurisdiction cache invalidated', { jurisdiction, deletedKeys: deleted });
}

/**
 * Invalidate all compliance caches (nuclear option)
 * Called on major regulatory changes
 */
export async function invalidateAllComplianceCache(): Promise<void> {
  logger.warn('Invalidating ALL compliance caches');

  await deleteByPattern('compliance:*');
  await deleteByPattern('rules:*');
  // Note: We keep fallback caches as they're the safety net
}

// ============= Health Check =============

/**
 * Check if Redis is connected and working
 */
export async function isCacheHealthy(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return true; // In-memory fallback is always "healthy"
  }

  try {
    await redis.ping();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  type: 'redis' | 'memory';
  connected: boolean;
  keys?: number;
  memoryUsage?: string;
}> {
  const redis = getRedis();

  if (redis) {
    try {
      const info = await redis.info('memory');
      const dbSize = await redis.dbsize();
      const memoryMatch = info.match(/used_memory_human:(\S+)/);

      return {
        type: 'redis',
        connected: true,
        keys: dbSize,
        memoryUsage: memoryMatch ? memoryMatch[1] : 'unknown',
      };
    } catch (error) {
      return {
        type: 'redis',
        connected: false,
      };
    }
  }

  return {
    type: 'memory',
    connected: true,
    keys: inMemoryCache.size,
  };
}

// ============= Cleanup =============

/**
 * Close Redis connection gracefully
 */
export async function closeCache(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
  inMemoryCache.clear();
}
