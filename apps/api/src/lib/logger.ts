/**
 * Structured logger using pino.
 * Falls back gracefully if pino is not installed yet.
 */

let logger: {
  info:  (obj: object | string, msg?: string) => void
  warn:  (obj: object | string, msg?: string) => void
  error: (obj: object | string, msg?: string) => void
  debug: (obj: object | string, msg?: string) => void
}

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pino = require('pino') as typeof import('pino')
  logger = pino.default({
    level: process.env.LOG_LEVEL || 'info',
    base:  { service: 'codeclinic-api' },
    transport:
      process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
        : undefined,
  })
} catch {
  // Fallback to console if pino is not installed
  const fmt = (obj: object | string, msg?: string) =>
    typeof obj === 'string' ? obj : (msg ? `${msg} ${JSON.stringify(obj)}` : JSON.stringify(obj))

  logger = {
    info:  (o, m) => console.log('[INFO]',  fmt(o, m)),
    warn:  (o, m) => console.warn('[WARN]',  fmt(o, m)),
    error: (o, m) => console.error('[ERROR]', fmt(o, m)),
    debug: (o, m) => console.debug('[DEBUG]', fmt(o, m)),
  }
}

export { logger }
