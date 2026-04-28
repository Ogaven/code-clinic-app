/**
 * Redis client — wraps ioredis with graceful no-op fallback when REDIS_URL is absent.
 * All features that use Redis will still work in degraded mode (booking state stays
 * in-memory, token blacklist is process-local) until Redis is configured.
 */
import { logger } from './logger'

interface RedisLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<unknown>
  setex(key: string, seconds: number, value: string): Promise<unknown>
  del(key: string): Promise<unknown>
  exists(key: string): Promise<number>
  quit(): Promise<unknown>
}

class NoOpRedis implements RedisLike {
  private store: Map<string, { value: string; expiresAt: number | null }> = new Map()

  private isExpired(key: string): boolean {
    const entry = this.store.get(key)
    if (!entry) return true
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return true
    }
    return false
  }

  async get(key: string) {
    if (this.isExpired(key)) return null
    return this.store.get(key)?.value ?? null
  }

  async set(key: string, value: string) {
    this.store.set(key, { value, expiresAt: null })
  }

  async setex(key: string, seconds: number, value: string) {
    this.store.set(key, { value, expiresAt: Date.now() + seconds * 1000 })
  }

  async del(key: string) {
    this.store.delete(key)
  }

  async exists(key: string) {
    return this.isExpired(key) ? 0 : 1
  }

  async quit() {}
}

function createRedis(): RedisLike {
  const url = process.env.REDIS_URL
  if (!url) {
    logger.warn('REDIS_URL not set — using in-memory fallback (not suitable for multi-instance)')
    return new NoOpRedis()
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require('ioredis') as typeof import('ioredis')
    const client = new Redis.default(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })
    client.on('error', (err: Error) => logger.error({ err }, 'Redis error'))
    client.on('connect', () => logger.info('Redis connected'))
    return client as unknown as RedisLike
  } catch {
    logger.warn('ioredis not available — using in-memory fallback')
    return new NoOpRedis()
  }
}

export const redis = createRedis()
