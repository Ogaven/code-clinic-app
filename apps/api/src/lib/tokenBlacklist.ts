/**
 * Token blacklist — used to invalidate JWT access tokens on logout.
 * Backed by Redis when available; falls back to in-memory Map (single-process only).
 */
import { redis } from './redis'

const KEY_PREFIX = 'blacklist:'

export async function blacklistToken(token: string, expiresInSeconds: number): Promise<void> {
  await redis.setex(`${KEY_PREFIX}${token}`, expiresInSeconds, '1')
}

export async function isTokenBlacklisted(token: string): Promise<boolean> {
  const result = await redis.exists(`${KEY_PREFIX}${token}`)
  return result === 1
}
