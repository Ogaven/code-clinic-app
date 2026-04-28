import { Request, Response, NextFunction } from 'express'
import { PrismaClient } from '@prisma/client'
import { logger } from '../lib/logger'

const prisma = new PrismaClient()

const AUDIT_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

export function auditLog(resource: string) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    const req = _req
    const res = _res

    if (!AUDIT_METHODS.includes(req.method)) {
      next()
      return
    }

    const originalJson = res.json.bind(res)
    res.json = function (body: unknown) {
      // Fire async audit after response is delivered — non-blocking but properly awaited
      if (req.user && res.statusCode < 400) {
        const resourceId =
          req.params['id'] ??
          (body && typeof body === 'object' && body !== null && 'id' in body
            ? String((body as Record<string, unknown>)['id'])
            : undefined)

        prisma.auditLog
          .create({
            data: {
              userId: req.user.id,
              action: req.method,
              resource,
              resourceId,
              metadata: JSON.stringify({
                path: req.path,
                query: req.query,
                statusCode: res.statusCode,
              }),
              ip: req.ip,
              userAgent: req.headers['user-agent'],
            },
          })
          .catch(err => logger.error({ err, resource, action: req.method }, 'Audit log write failed'))
      }
      return originalJson(body)
    }

    next()
  }
}
