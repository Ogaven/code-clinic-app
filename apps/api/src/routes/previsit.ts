import { Router } from 'express'
import { PrismaClient } from '@prisma/client'

const router = Router()
const prisma = new PrismaClient()

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
    // Find or create patient by phone
    let patient = await prisma.patient.findFirst({ where: { phone } })

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
          firstName, lastName, phone,
          dob: dob ? new Date(dob) : undefined,
          gender, address, district,
          nextOfKinName, nextOfKinPhone, nextOfKinRelation,
          allergies, medicalHistory,
        },
      })
    }

    // Add notes to appointment if chiefComplaint provided
    if (apptId && (chiefComplaint || currentMedications)) {
      const note = [
        chiefComplaint   ? `Chief complaint: ${chiefComplaint}` : '',
        currentMedications ? `Current medications: ${currentMedications}` : '',
      ].filter(Boolean).join('\n')

      await prisma.appointment.update({
        where: { id: apptId },
        data: { notes: note },
      }).catch(() => {})
    }

    res.json({ success: true, patientId: patient.id })
  } catch (e: any) {
    console.error('[PreVisit] Submit error:', e.message)
    res.status(500).json({ error: 'Failed to save pre-visit form' })
  }
})

export default router
