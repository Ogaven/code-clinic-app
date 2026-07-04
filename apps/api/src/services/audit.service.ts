import crypto from 'crypto'
import { Request } from 'express'
import { prisma } from '../lib/prisma'

export type EntityType =
  | 'PATIENT' | 'APPOINTMENT' | 'INVOICE' | 'SERVICE'
  | 'STAFF' | 'TREATMENT_PLAN' | 'NOTE' | 'PAYMENT'

export type AuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE'
  | 'LOGIN' | 'LOGOUT' | 'LOGIN_FAILED'
  | 'VIEW_SENSITIVE' | 'EXPORT'
  | 'RESCHEDULE' | 'CANCEL' | 'CONFIRM'
  | 'PAYMENT_RECEIVED' | 'STATUS_CHANGE'

export type AuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL'

export interface AuditParams {
  userId:        string
  actionType:    AuditAction
  entityType:    EntityType
  entityId:      string
  entityName:    string
  fieldChanges?: { before: Record<string, unknown>; after: Record<string, unknown> }
  severity?:     AuditSeverity
  notes?:        string
  req?:          Request
}

export async function logAudit(params: AuditParams): Promise<void> {
  try {
    const prev = await prisma.auditLog.findFirst({
      orderBy: { createdAt: 'desc' },
      select:  { hashChain: true },
    })
    const prevHash = prev?.hashChain ?? '0'.repeat(64)

    const entryData = JSON.stringify({
      userId:     params.userId,
      actionType: params.actionType,
      entityType: params.entityType,
      entityId:   params.entityId,
      entityName: params.entityName,
      timestamp:  new Date().toISOString(),
    })
    const hashChain = crypto
      .createHash('sha256')
      .update(prevHash + entryData)
      .digest('hex')

    const ip        = params.req?.ip ?? params.req?.headers['x-forwarded-for'] as string ?? undefined
    const userAgent = params.req?.headers['user-agent'] ?? undefined

    await prisma.auditLog.create({
      data: {
        userId:      params.userId,
        action:      params.actionType,          // keep legacy field populated
        resource:    params.entityType,
        resourceId:  params.entityId,
        ip,
        userAgent,
        entityType:  params.entityType,
        entityId:    params.entityId,
        entityName:  params.entityName,
        actionType:  params.actionType,
        fieldChanges: params.fieldChanges
          ? JSON.stringify(params.fieldChanges)
          : undefined,
        hashChain,
        severity:    params.severity ?? 'INFO',
        notes:       params.notes,
      },
    })
  } catch (err) {
    // Never throw — audit failures must never break the main operation
    console.error('[AuditLog] Write failed:', (err as Error).message)
  }
}

/** Quick helper: produce a human-readable EAT timestamp */
export function eatTimestamp(date: Date = new Date()): string {
  return date.toLocaleString('en-GB', {
    timeZone: 'Africa/Nairobi',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
