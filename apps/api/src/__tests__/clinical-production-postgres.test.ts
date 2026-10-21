import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomUUID } from 'node:crypto'

const isolatedUrl = process.env.CRM_INTEGRATION_DATABASE_URL
vi.mock('../lib/tokenBlacklist', () => ({ isTokenBlacklisted: async () => false }))
vi.mock('../lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasources: { db: { url: process.env.CRM_INTEGRATION_DATABASE_URL! } } }) }
})

import { prisma } from '../lib/prisma'
import router from '../routes/clinical-production'

describe.skipIf(!isolatedUrl)('clinical production authenticated PostgreSQL integration (disposable CI DB only)', () => {
  let server: Server
  let base: string
  const prefix = `clinical-ledger-ci-${randomUUID()}`
  const ids = { recorder: randomUUID(), reviewer: randomUUID(), doctor: randomUUID(), patient: randomUUID() }
  const key = (suffix: string) => `${prefix}-${suffix}`
  const token = (id: string, role: 'ADMIN' | 'DOCTOR' = 'ADMIN') => jwt.sign(
    { id, role, email: `${id}@example.invalid`, firstName: 'Synthetic', lastName: 'Test' },
    process.env.JWT_SECRET!, { expiresIn: '5m' },
  )
  const request = async (path: string, id: string, method = 'GET', body?: unknown, role: 'ADMIN' | 'DOCTOR' = 'ADMIN') =>
    fetch(base + path, { method, headers: { authorization: `Bearer ${token(id, role)}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const record = (suffix: string, amountUGX = 100000, kind = 'DELIVERY', originalEntryId?: string) => ({
    patientId: ids.patient, deliveredAt: '2026-10-20T12:00:00+03:00', amountUGX, kind, originalEntryId,
    sourceKey: key(suffix), note: 'Synthetic verified clinical delivery for isolated CI only',
  })
  const decide = (entryId: string, id: string, decision = 'APPROVED') =>
    request(`/entries/${entryId}/decision`, id, 'POST', { decision, note: 'Synthetic independent verification' })

  beforeAll(async () => {
    if (!isolatedUrl || !/codeclinic_ci_integration(?:\?|$)/.test(new URL(isolatedUrl).pathname.slice(1))) {
      throw new Error('Refusing to run clinical ledger integration tests outside codeclinic_ci_integration')
    }
    await prisma.user.createMany({ data: [
      { id: ids.recorder, email: `${key('recorder')}@example.invalid`, passwordHash: 'synthetic-unused', firstName: 'Recorder', lastName: 'CI', role: 'ADMIN' },
      { id: ids.reviewer, email: `${key('reviewer')}@example.invalid`, passwordHash: 'synthetic-unused', firstName: 'Reviewer', lastName: 'CI', role: 'ADMIN' },
      { id: ids.doctor, email: `${key('doctor')}@example.invalid`, passwordHash: 'synthetic-unused', firstName: 'Doctor', lastName: 'CI', role: 'DOCTOR' },
    ] })
    await prisma.patient.create({ data: { id: ids.patient, firstName: 'Synthetic', lastName: 'Ledger CI', phone: '+256700000000' } })
    const app = express()
    app.use(express.json())
    app.use(router)
    server = await new Promise<Server>(resolve => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
    })
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()))
    if (isolatedUrl) {
      const entries = await prisma.clinicalProductionEntry.findMany({ where: { sourceKey: { startsWith: prefix } }, select: { id: true } })
      await prisma.auditLog.deleteMany({ where: { resource: 'CLINICAL_PRODUCTION', resourceId: { in: entries.map(e => e.id) } } })
      await prisma.clinicalProductionEntry.deleteMany({ where: { sourceKey: { startsWith: prefix }, originalEntryId: { not: null } } })
      await prisma.clinicalProductionEntry.deleteMany({ where: { sourceKey: { startsWith: prefix } } })
      await prisma.patient.delete({ where: { id: ids.patient } })
      await prisma.user.deleteMany({ where: { id: { in: [ids.recorder, ids.reviewer, ids.doctor] } } })
    }
    await prisma.$disconnect()
  })

  it('enforces real JWT, RBAC, independent approval, idempotency and approved-only summary', async () => {
    expect((await fetch(base + '/entries/pending')).status).toBe(401)
    expect((await request('/entries/pending', ids.doctor, 'GET', undefined, 'DOCTOR')).status).toBe(403)
    const payload = record('first')
    const created = await request('/entries', ids.recorder, 'POST', payload)
    expect(created.status).toBe(201)
    const entry = (await created.json() as { entry: { id: string } }).entry
    expect((await request('/entries', ids.recorder, 'POST', payload)).status).toBe(200)
    expect((await request('/entries', ids.recorder, 'POST', { ...payload, amountUGX: 999 })).status).toBe(409)
    expect((await decide(entry.id, ids.recorder)).status).toBe(403)
    const pendingSummary = await request('/summary?startDate=2026-10-20&endDate=2026-10-20', ids.reviewer)
    expect((await pendingSummary.json() as { netClinicalProductionUGX: number }).netClinicalProductionUGX).toBe(0)
    expect((await decide(entry.id, ids.reviewer)).status).toBe(200)
    expect((await decide(entry.id, ids.reviewer)).status).toBe(409)
    const summary = await request('/summary?startDate=2026-10-20&endDate=2026-10-20', ids.reviewer)
    expect((await summary.json() as { netClinicalProductionUGX: number }).netClinicalProductionUGX).toBe(100000)
    expect(await prisma.auditLog.count({ where: { resource: 'CLINICAL_PRODUCTION', resourceId: entry.id } })).toBe(2)
  })

  it('rejects excessive corrections and rolls back approval when audit persistence fails', async () => {
    const deliveryResponse = await request('/entries', ids.recorder, 'POST', record('correction-base'))
    expect(deliveryResponse.status).toBe(201)
    const delivery = (await deliveryResponse.json() as { entry: { id: string } }).entry
    expect((await decide(delivery.id, ids.reviewer)).status).toBe(200)
    expect((await request('/entries', ids.recorder, 'POST', record('overdraw', -100001, 'ADJUSTMENT', delivery.id))).status).toBe(400)
    const correctionResponse = await request('/entries', ids.recorder, 'POST', record('correction', -20000, 'ADJUSTMENT', delivery.id))
    expect(correctionResponse.status).toBe(201)
    const correction = (await correctionResponse.json() as { entry: { id: string } }).entry
    expect((await decide(correction.id, ids.reviewer)).status).toBe(200)
    const summary = await request('/summary?startDate=2026-10-20&endDate=2026-10-20', ids.reviewer)
    expect((await summary.json() as { netClinicalProductionUGX: number }).netClinicalProductionUGX).toBe(180000)
    const pendingResponse = await request('/entries', ids.recorder, 'POST', record('audit-rollback', 5000))
    expect(pendingResponse.status).toBe(201)
    const pending = (await pendingResponse.json() as { entry: { id: string } }).entry
    // A dedicated database trigger forces the audit INSERT to fail after the
    // approval UPDATE. The request must roll back the UPDATE atomically.
    // This trigger exists only in the disposable CI database and is removed
    // in finally even if an assertion fails.
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION clinical_ledger_ci_reject_audit()
      RETURNS trigger LANGUAGE plpgsql AS $
      BEGIN
        IF NEW.resource = 'CLINICAL_PRODUCTION'
           AND NEW.resourceId = '${pending.id}' THEN
          RAISE EXCEPTION 'synthetic audit insert failure';
        END IF;
        RETURN NEW;
      END;
      $`)
    await prisma.$executeRawUnsafe(`CREATE TRIGGER clinical_ledger_ci_audit_failure
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION clinical_ledger_ci_reject_audit()`)
    try {
      expect((await decide(pending.id, ids.reviewer)).status).toBe(500)
      expect((await prisma.clinicalProductionEntry.findUnique({ where: { id: pending.id } }))?.approvalStatus).toBe('PENDING')
      expect(await prisma.auditLog.count({ where: { resourceId: pending.id } })).toBe(1)
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS clinical_ledger_ci_audit_failure ON audit_logs')
      await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS clinical_ledger_ci_reject_audit()')
    }
    expect((await decide(pending.id, ids.reviewer)).status).toBe(200)
    expect(await prisma.auditLog.count({ where: { resourceId: pending.id } })).toBe(2)
  })
})
