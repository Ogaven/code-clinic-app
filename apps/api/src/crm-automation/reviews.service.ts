// ─────────────────────────────────────────────────────────────────────────
// CRM Automation — Reviews list view (Data/Role-Parity milestone).
//
// The Reviews workspace previously only exposed ReviewRequestConfig (a
// settings form) — there was no way to see any real review activity.
// Real data exists in two places, both genuinely populated in production:
//   - PatientFeedback: in-app star ratings/comments collected via the
//     WhatsApp bot after a visit (ai-suite/whatsapp/whatsapp.service.ts).
//     A DIFFERENT concept from outbound Google-review requests, but real,
//     populated patient-satisfaction data worth surfacing here.
//   - ReviewRequestLog: the outbound Google-review request send log (only
//     populated once ReviewRequestConfig.isActive is turned on — genuinely
//     empty until then, not a bug).
// Both are surfaced separately, never conflated.
// ─────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma'

export interface FeedbackEntry {
  id: string
  patientId: string
  patientName: string
  rating: number
  comment: string | null
  channel: string
  submittedAt: Date
}

export interface ReviewsOverview {
  feedback: {
    totalCount: number
    averageRating: number | null
    ratingBreakdown: Record<number, number>
    recent: FeedbackEntry[]
  }
  reviewRequests: {
    totalCount: number
    byStatus: Record<string, number>
  }
}

export async function reviewsOverview(): Promise<ReviewsOverview> {
  const [feedbackRows, requestRows] = await Promise.all([
    prisma.patientFeedback.findMany({
      select: {
        id: true, rating: true, comment: true, channel: true, submittedAt: true,
        patient: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 100,
    }),
    prisma.reviewRequestLog.findMany({ select: { status: true } }),
  ])

  const ratingBreakdown: Record<number, number> = {}
  let ratingSum = 0
  for (const f of feedbackRows) {
    ratingBreakdown[f.rating] = (ratingBreakdown[f.rating] ?? 0) + 1
    ratingSum += f.rating
  }

  const byStatus: Record<string, number> = {}
  for (const r of requestRows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1

  return {
    feedback: {
      totalCount: feedbackRows.length,
      averageRating: feedbackRows.length > 0 ? Math.round((ratingSum / feedbackRows.length) * 10) / 10 : null,
      ratingBreakdown,
      recent: feedbackRows.slice(0, 20).map(f => ({
        id: f.id, patientId: f.patient.id, patientName: `${f.patient.firstName} ${f.patient.lastName}`,
        rating: f.rating, comment: f.comment, channel: f.channel, submittedAt: f.submittedAt,
      })),
    },
    reviewRequests: {
      totalCount: requestRows.length,
      byStatus,
    },
  }
}
