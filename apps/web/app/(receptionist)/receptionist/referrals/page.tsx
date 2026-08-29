'use client'

// Reuses the exact Admin Referrals implementation
// (apps/web/app/(admin)/referrals/page.tsx) — a genuinely read-only source
// breakdown (GET /patients/referral-stats, requireAuth only, no role
// restriction). No navigation or mutating actions exist in that component,
// so it's safe to render unmodified with no role-aware props needed.

import ReferralsPage from '@/app/(admin)/referrals/page'

export default function ReceptionistReferralsPage() {
  return <ReferralsPage />
}
