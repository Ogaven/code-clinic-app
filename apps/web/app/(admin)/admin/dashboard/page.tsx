'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// /admin/dashboard is the role-based entry point for ADMIN/DEVELOPER.
// The full dashboard lives at /dashboard inside the (admin) layout group.
export default function AdminDashboardEntry() {
  const router = useRouter()
  useEffect(() => { router.replace('/dashboard') }, [router])
  return null
}
