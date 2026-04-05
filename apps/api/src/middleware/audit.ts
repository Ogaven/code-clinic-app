import { Request, Response, NextFunction } from 'express'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const AUDIT_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

export function auditLog(resource: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!AUDIT_METHODS.includes(req.method)) {
      next()
      return
    }

    const originalJson = res.json.bind(res)
    res.json = function (body) {
      // Log after response is sent
      if (req.user && res.statusCode < 400) {
        const resourceId =
          req.params.id ||
          (body && typeof body === 'object' && 'id' in body ? (body as any).id : undefined)

        prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action: req.method,
            resource,
            resourceId,
            metadata: {
              path: req.path,
              query: req.query,
              statusCode: res.statusCode,
            },
            ip: req.ip,
            userAgent: req.headers['user-agent'],
          },
        }).catch(console.error)
      }
      return originalJson(body)
    }

    next()
  }
}
