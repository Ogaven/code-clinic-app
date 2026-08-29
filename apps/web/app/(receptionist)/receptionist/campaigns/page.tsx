// Reuses the exact same Campaigns implementation as Admin — no hardcoded
// Admin-only navigation exists in that component (it only calls the real
// campaigns/templates APIs), and campaigns.ts is requireAuth-only on every
// route, so Receptionist is already fully authorized for the same actions
// Admin has. Re-exported directly rather than copied, so the two entry
// points can never drift apart.
export { default } from '@/app/(admin)/campaigns/page'
