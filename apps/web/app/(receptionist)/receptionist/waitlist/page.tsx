// Reuses the exact same Waitlist implementation as Admin — the page has no
// admin-only imports/links (it's a self-contained patient-search + add-to-
// waitlist workspace over /crm-automation/waitlist, already
// adminAndReceptionist-guarded server-side). Previously, both nav configs
// linked Receptionist to the admin-only `/waitlist` URL, which the (admin)
// layout's role redirect bounced Receptionist straight back out of before
// the page ever rendered — this route fixes that by giving Receptionist a
// real destination under their own layout, matching the campaigns pattern.
export { default } from '@/app/(admin)/waitlist/page'
