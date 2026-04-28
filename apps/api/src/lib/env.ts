/**
 * Validate required environment variables at startup.
 * Exits the process immediately if anything critical is missing.
 */
import { z } from 'zod'

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Auth
  JWT_SECRET:         z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN:     z.string().default('15m'),

  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT:     z.string().default('4000'),
  APP_URL:  z.string().min(1).default('http://localhost:3000'),

  // AI (required for chat features)
  ANTHROPIC_API_KEY: z.string().optional(),

  // Optional services — app degrades gracefully when absent
  REDIS_URL:            z.string().optional(),
  ENCRYPTION_KEY:       z.string().optional(),
  GOOGLE_CLIENT_ID:     z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SENTRY_DSN:           z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const formatted = result.error.issues
      .map(i => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n')
    console.error('\n[Startup] ❌ Invalid environment variables:\n' + formatted + '\n')
    process.exit(1)
  }

  return result.data
}

export const env = validateEnv()
