import { Request, Response, NextFunction } from 'express'

type Role = 'ADMIN' | 'DOCTOR' | 'RECEPTIONIST' | 'ACCOUNTS' | 'DEVELOPER'

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }
    if (!roles.includes(req.user.role as Role)) {
      res.status(403).json({
        error: 'Access denied',
        required: roles,
        current: req.user.role,
      })
      return
    }
    next()
  }
}

// Convenience exports
export const adminOnly = requireRole('ADMIN')
export const doctorOrAdmin = requireRole('ADMIN', 'DOCTOR')
export const clinicalStaff = requireRole('ADMIN', 'DOCTOR', 'RECEPTIONIST')
export const accountsOrAdmin = requireRole('ADMIN', 'ACCOUNTS')
export const developerOnly = requireRole('DEVELOPER')
