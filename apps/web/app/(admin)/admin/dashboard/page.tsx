import { redirect } from 'next/navigation'

// Legacy quick-links page — superseded by the main Overview dashboard.
// Kept as a redirect (not deleted) so old bookmarks/links still resolve.
export default function AdminDashboardPage() {
  redirect('/dashboard')
}
