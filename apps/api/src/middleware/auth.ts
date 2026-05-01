import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { isTokenBlacklisted } from '../lib/tokenBlacklist'

export interface AuthUser {
  id: string
  email: string
  role: string
  firstName: string
  lastName: string
  doctorId?: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
      token?: string
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser

    // Reject blacklisted tokens (e.g. post-logout)
    if (await isTokenBlacklisted(token)) {
      res.status(401).json({ error: 'Token has been revoked. Please log in again.' })
      return
    }

    req.user  = payload
    req.token = token
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (token) {
    try {
      req.user  = jwt.verify(token, process.env.JWT_SECRET!) as AuthUser
      req.token = token
    } catch { /* ignore */ }
  }
  next()
}
