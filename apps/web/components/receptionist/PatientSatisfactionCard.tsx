'use client'

// Matches the Admin dashboard's "Patient Satisfaction" card exactly (see
// apps/web/app/(admin)/dashboard/page.tsx) — same gauge, same copy, same
// pending state. A real, authorized GBP connection already exists
// server-side (apps/api/src/routes/business-profile.ts), but Google's Basic
// API Access approval is still pending, so no live rating can be shown
// honestly yet, for ANY role. This card never calls that endpoint — it's a
// static, truthful "pending" placeholder, not a fetch that would 403.
import { CompactCard, SatisfactionGauge } from './DashboardPrimitives'

export default function PatientSatisfactionCard() {
  return (
    <CompactCard title="Patient Satisfaction" action={<span className="rounded-full bg-gray-50 px-2 py-0.5 text-[9px] font-bold text-gray-500 dark:bg-white/5 dark:text-white/40">Google Reviews</span>}>
      <div className="flex items-center justify-between px-1 text-[10px] font-semibold text-gray-400 dark:text-white/25">
        <span>No reviews yet</span>
        <span>&nbsp;</span>
      </div>
      <SatisfactionGauge pct={null} ratingLabel="—" />
      <div className="-mt-2 text-center">
        <p className="mx-auto max-w-[190px] text-[10px] font-semibold leading-snug text-gray-500 dark:text-slate-400">Google Reviews pending API approval</p>
        <p className="mt-2 text-[10px] font-bold text-gray-300 dark:text-white/25">View all reviews</p>
      </div>
    </CompactCard>
  )
}
