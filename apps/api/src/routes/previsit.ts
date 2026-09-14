import { Router } from 'express'
import QRCode from 'qrcode'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { env } from '../lib/env'
import { submitWalkInIntake, type IntakeOutcome } from '../services/previsit-intake.service'
import { sendPushToUser } from '../services/push.service'

const router = Router()

// GET /pre-visit/qr — staff-only. QR code for the public walk-in intake form
// (no ?appt=/?phone= params -- scanning it opens a blank form that creates a
// new patient directly, no CSV/Sheet import step involved).
// ?size= lets callers ask for a higher-resolution render (the Walk-In Intake
// page requests 1024px+ for the branded print flyer) without changing the
// default used by the small on-screen preview.
router.get('/qr', requireAuth, async (req, res) => {
  try {
    const requested = parseInt(String(req.query.size || '480'), 10)
    const width = Number.isFinite(requested) ? Math.min(Math.max(requested, 128), 2048) : 480
    const webUrl = env.APP_URL.split(',')[0].trim()
    const intakeUrl = `${webUrl}/pre-visit`
    const qrDataUrl = await QRCode.toDataURL(intakeUrl, { width, margin: 2 })
    res.json({ url: intakeUrl, qrDataUrl })
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to generate QR code' })
  }
})

// GET /pre-visit/recent — staff-only. Feed for the Walk-In Intake page: a
// short list + count of walk-in (no appointment) submissions in the last
// 24h, sourced from the PatientActivity rows submitWalkInIntake's caller
// below writes for every no-apptId submission.
router.get('/recent', requireAuth, async (_req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const activities = await prisma.patientActivity.findMany({
      where: { userId: 'pre-visit-form', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { patient: { select: { id: true, firstName: true, lastName: true, phone: true } } },
    })
    const submissions = activities.map(a => {
      let outcome: IntakeOutcome | null = null
      try { outcome = JSON.parse(a.metadata || '{}').outcome ?? null } catch { /* legacy free-text metadata */ }
      return {
        id:        a.id,
        patientId: a.patientId,
        name:      `${a.patient.firstName} ${a.patient.lastName}`.trim(),
        phone:     a.patient.phone,
        outcome,
        createdAt: a.createdAt,
      }
    })
    res.json({ count: submissions.length, submissions })
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to fetch recent walk-ins' })
  }
})

// GET /pre-visit/:apptId — public, no auth
router.get('/:apptId', async (req, res) => {
  try {
    const appt = await prisma.appointment.findUnique({
      where: { id: req.params.apptId },
      include: {
        patient: {
          select: {
            id: true, firstName: true, lastName: true, phone: true,
            dob: true, gender: true, address: true, district: true,
            nextOfKinName: true, nextOfKinPhone: true, nextOfKinRelation: true,
            allergies: true, medicalHistory: true,
          },
        },
        doctor:  { include: { user: { select: { firstName: true, lastName: true } } } },
        service: { select: { name: true } },
      },
    })
    if (!appt) { res.status(404).json({ error: 'Appointment not found' }); return }
    res.json(appt)
  } catch { res.status(500).json({ error: 'Failed to fetch appointment' }) }
})

// Recipients for the "New Walk-In Intake" staff notification: every active
// receptionist/admin (never the walk-in patient themselves — this flow must
// never send the submitter anything, see notifyWalkInStaff below).
async function notifyWalkInStaff(patientName: string, outcome: IntakeOutcome) {
  try {
    const staff = await prisma.user.findMany({ where: { role: { in: ['RECEPTIONIST', 'ADMIN'] }, isActive: true } })
    const title = outcome === 'REQUIRES_REVIEW' ? 'Walk-In Needs Review' : 'New Walk-In Intake'
    const body =
      outcome === 'REQUIRES_REVIEW'
        ? `${patientName} submitted a walk-in form with conflicting details — please review before their visit.`
        : outcome === 'CREATED'
          ? `${patientName} registered as a new patient via the walk-in QR intake form.`
          : `${patientName} (existing patient) checked in via the walk-in QR intake form.`

    await Promise.all(staff.map(async u => {
      const href = u.role === 'RECEPTIONIST' ? '/receptionist/patients/walk-in' : '/patients/walk-in'
      await prisma.notification.create({ data: { userId: u.id, type: 'SYSTEM', title, body, href, isRead: false } })
      sendPushToUser(u.id, { title, body, url: href }).catch(() => {})
    }))
  } catch (e: any) {
    console.warn('[PreVisit] Walk-in staff notification failed:', e.message)
  }
}

// POST /pre-visit/submit — public, no auth
router.post('/submit', async (req, res) => {
  const {
    apptId, phone,
    firstName, lastName, dob, gender,
    address, district,
    nextOfKinName, nextOfKinPhone, nextOfKinRelation,
    allergies, medicalHistory,
    chiefComplaint, currentMedications,
  } = req.body

  if (!phone || !firstName || !lastName) {
    res.status(400).json({ error: 'Name and phone are required' }); return
  }

  try {
    // Find-or-create is wrapped in a Postgres advisory-lock transaction
    // (see services/previsit-intake.service.ts) so two near-simultaneous
    // submits for the same phone (double-tap, two QR scans) can never race
    // past the lookup and create two Patient rows. Existing-patient matches
    // only fill in currently-empty fields; a real conflict on name/DOB is
    // flagged REQUIRES_REVIEW rather than silently overwritten.
    const { patient, outcome, conflicts } = await submitWalkInIntake(prisma, {
      phone, firstName, lastName, dob, gender, address, district,
      nextOfKinName, nextOfKinPhone, nextOfKinRelation, allergies, medicalHistory,
    })

    const patientName = `${patient.firstName} ${patient.lastName}`.trim()
    console.log(`[PreVisit] Submit outcome=${outcome} patientId=${patient.id}${conflicts ? ` conflicts=${conflicts.join(',')}` : ''}`)

    const note = [
      chiefComplaint     ? `Chief complaint: ${chiefComplaint}`         : '',
      currentMedications ? `Current medications: ${currentMedications}` : '',
    ].filter(Boolean).join('\n')

    if (apptId) {
      // Booked visit — attach to the appointment the doctor will see pre-visit
      if (note) {
        await prisma.appointment.update({
          where: { id: apptId },
          data: { notes: note },
        }).catch(() => {})
      }
    } else {
      // Walk-in QR intake — no appointment yet. Always log on the patient's
      // timeline (not just when a chief complaint was given) so the Walk-In
      // Intake page has a reliable feed of recent submissions + outcomes.
      await prisma.patientActivity.create({
        data: {
          patientId: patient.id,
          userId:    'pre-visit-form',
          userName:  'Pre-Visit Form (Self-Service)',
          action:    'Submitted walk-in intake form',
          metadata:  JSON.stringify({ outcome, conflicts, note: note || undefined }),
        },
      }).catch(() => {})

      // Fire-and-forget — never blocks the visitor's response, and never
      // contacts the walk-in patient themselves (staff only).
      notifyWalkInStaff(patientName, outcome).catch(() => {})
    }

    res.json({ success: true, patientId: patient.id, outcome, conflicts })
  } catch (e: any) {
    console.error('[PreVisit] Submit error:', e.message)
    res.status(500).json({ error: 'Failed to save pre-visit form' })
  }
})

export default router
