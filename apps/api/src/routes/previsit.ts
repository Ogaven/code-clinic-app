import { Router } from 'express'
import QRCode from 'qrcode'
import { prisma } from '../lib/prisma'
import { normalizePhone, phoneVariants } from '../utils/phone'
import { requireAuth } from '../middleware/auth'
import { env } from '../lib/env'

const router = Router()

// GET /pre-visit/qr — staff-only. QR code for the public walk-in intake form
// (no ?appt=/?phone= params -- scanning it opens a blank form that creates a
// new patient directly, no CSV/Sheet import step involved).
router.get('/qr', requireAuth, async (_req, res) => {
  try {
    const webUrl = env.APP_URL.split(',')[0].trim()
    const intakeUrl = `${webUrl}/pre-visit`
    const qrDataUrl = await QRCode.toDataURL(intakeUrl, { width: 480, margin: 2 })
    res.json({ url: intakeUrl, qrDataUrl })
  } catch (e: any) {
    res.status(500).json({ error: 'Failed to generate QR code' })
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
    const normalizedPhone = normalizePhone(phone)

    // Find or create patient by phone (checks every historical stored format)
    let patient = await prisma.patient.findFirst({ where: { phone: { in: phoneVariants(normalizedPhone) } } })

    if (patient) {
      patient = await prisma.patient.update({
        where: { id: patient.id },
        data: {
          firstName, lastName,
          dob: dob ? new Date(dob) : undefined,
          gender, address, district,
          nextOfKinName, nextOfKinPhone, nextOfKinRelation,
          allergies, medicalHistory,
        },
      })
    } else {
      patient = await prisma.patient.create({
        data: {
          firstName, lastName, phone: normalizedPhone,
          dob: dob ? new Date(dob) : undefined,
          gender, address, district,
          nextOfKinName, nextOfKinPhone, nextOfKinRelation,
          allergies, medicalHistory,
        },
      })
    }

    if (chiefComplaint || currentMedications) {
      const note = [
        chiefComplaint     ? `Chief complaint: ${chiefComplaint}`         : '',
        currentMedications ? `Current medications: ${currentMedications}` : '',
      ].filter(Boolean).join('\n')

      if (apptId) {
        // Booked visit — attach to the appointment the doctor will see pre-visit
        await prisma.appointment.update({
          where: { id: apptId },
          data: { notes: note },
        }).catch(() => {})
      } else {
        // Walk-in QR intake — no appointment yet, log on the patient's timeline
        // instead of silently discarding it
        await prisma.patientActivity.create({
          data: {
            patientId: patient.id,
            userId:    'pre-visit-form',
            userName:  'Pre-Visit Form (Self-Service)',
            action:    'Submitted intake form',
            metadata:  note,
          },
        }).catch(() => {})
      }
    }

    res.json({ success: true, patientId: patient.id })
  } catch (e: any) {
    console.error('[PreVisit] Submit error:', e.message)
    res.status(500).json({ error: 'Failed to save pre-visit form' })
  }
})

export default router
