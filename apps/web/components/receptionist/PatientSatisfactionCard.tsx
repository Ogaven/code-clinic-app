'use client'

import { Star, Lock } from 'lucide-react'

// Google Business Profile review data (GET /business-profile/reviews/summary)
// is adminOnly at the API — Receptionist gets a 403, so this deliberately
// never calls it. Rather than guess a state or fake a rating, this shows an
// honest "restricted to Admin" card, matching the "no fake AI metrics / no
// fake percentages" requirement. If Receptionist should see real ratings,
// that's a backend RBAC decision for a human to make, not a frontend one.
export default function PatientSatisfactionCard() {
  return (
    <div className="bg-white dark:bg-white/[0.04] rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-white/8">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#f59e0b,#fbbf24)' }}>
          <Star size={13} className="text-white" />
        </div>
        <h3 className="text-sm font-bold text-gray-800 dark:text-white">Patient Satisfaction</h3>
      </div>
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-6 text-center">
        <Lock size={20} className="text-gray-300 dark:text-white/20" />
        <p className="text-xs font-semibold text-gray-500 dark:text-white/50">Google Business reviews are managed by Admin</p>
        <p className="text-[11px] text-gray-400 dark:text-white/30 max-w-[220px]">Review ratings aren{"'"}t exposed to the Receptionist role yet — ask an Admin for the latest score.</p>
      </div>
    </div>
  )
}
