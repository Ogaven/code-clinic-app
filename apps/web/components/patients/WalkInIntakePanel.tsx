'use client'

// Walk-In Intake — shared between /patients/walk-in (Admin) and
// /receptionist/patients/walk-in (Receptionist). Moved out of Receptionist
// Settings (Integrations tab) into its own place under Patients, visible to
// Admin + Receptionist only (never Doctor — enforced via `requiredRoles`
// below, since the shared (receptionist) layout otherwise also admits
// DOCTOR).
//
// Three things live here:
//  1. The staff-only QR code (GET /pre-visit/qr) for the public, no-login
//     /pre-visit intake form, plus a plain PNG download and a branded
//     print-quality flyer (PNG + PDF, composed client-side with
//     html2canvas/jsPDF — same dynamic-import pattern already used for the
//     Treatment Plan PDF export on the patient detail page).
//  2. A live feed of recent walk-in submissions (GET /pre-visit/recent),
//     polled every 30s — the same interval TopBar/ReceptionistTopBar/
//     DoctorTopBar already use for notification polling.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { QrCode, Download, RefreshCw, Users, ChevronRight, AlertTriangle, CheckCircle2, FileText, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RecentSubmission {
  id: string
  patientId: string
  name: string
  phone: string
  outcome: 'CREATED' | 'MATCHED_EXISTING' | 'REQUIRES_REVIEW' | null
  createdAt: string
}

const OUTCOME_BADGE: Record<string, { label: string; pill: string }> = {
  CREATED:          { label: 'New patient',      pill: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' },
  MATCHED_EXISTING: { label: 'Existing patient',  pill: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' },
  REQUIRES_REVIEW:  { label: 'Needs review',      pill: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
}

function timeAgo(value: string) {
  const mins = Math.floor((Date.now() - new Date(value).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

function waitForImage(src: string): Promise<void> {
  return new Promise(resolve => {
    const img = new window.Image()
    img.onload = () => resolve()
    img.onerror = () => resolve()
    img.src = src
  })
}

export interface WalkInIntakePanelProps {
  /** '/patients' for Admin, '/receptionist/patients' for Receptionist — used to link back to the patient list and into individual patient profiles. */
  basePath: string
  /** Roles allowed to view this page (Admin + Receptionist per spec — never Doctor). */
  requiredRoles: string[]
  /** Where to send anyone whose role isn't in requiredRoles. */
  fallbackHref: string
}

export default function WalkInIntakePanel({ basePath, requiredRoles, fallbackHref }: WalkInIntakePanelProps) {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  const [qr, setQr]               = useState<{ url: string; qrDataUrl: string } | null>(null)
  const [qrLoading, setQrLoading] = useState(true)

  const [recent, setRecent]               = useState<RecentSubmission[]>([])
  const [recentLoading, setRecentLoading] = useState(true)

  const [flyerBusy, setFlyerBusy]     = useState<'png' | 'pdf' | null>(null)
  const [flyerMenuOpen, setFlyerMenuOpen] = useState(false)
  const [toast, setToast]             = useState<{ msg: string; type: 'ok' | 'err' } | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function authHeaders() {
    const token = localStorage.getItem('cc_token')
    return { Authorization: `Bearer ${token}` }
  }

  function showToast(msg: string, type: 'ok' | 'err') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Access gate ──────────────────────────────────────────────
  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (!stored) { router.push('/login'); return }
    const u = JSON.parse(stored)
    if (!requiredRoles.includes(u.role)) { router.replace(fallbackHref); return }
    setReady(true)
  }, []) // eslint-disable-line

  // ── QR fetch ─────────────────────────────────────────────────
  async function fetchQr() {
    setQrLoading(true)
    try {
      const res = await fetch('/api-proxy/pre-visit/qr', { headers: authHeaders() })
      if (res.ok) setQr(await res.json())
    } catch { /* fetchQr can be retried via the Generate button */ }
    finally { setQrLoading(false) }
  }

  // ── Recent submissions ──────────────────────────────────────
  async function fetchRecent() {
    try {
      const res = await fetch('/api-proxy/pre-visit/recent', { headers: authHeaders() })
      if (res.ok) {
        const data = await res.json()
        setRecent(data.submissions || [])
      }
    } catch { /* keep the last known list on a transient failure */ }
    finally { setRecentLoading(false) }
  }

  useEffect(() => {
    if (!ready) return
    fetchQr()
    fetchRecent()
    pollRef.current = setInterval(fetchRecent, 30000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [ready]) // eslint-disable-line

  // ── Branded flyer composition ───────────────────────────────
  async function composeFlyer(): Promise<HTMLCanvasElement> {
    const res = await fetch('/api-proxy/pre-visit/qr?size=1024', { headers: authHeaders() })
    if (!res.ok) throw new Error('Failed to generate high-resolution QR')
    const { qrDataUrl, url } = await res.json()

    await waitForImage('/logo.png')

    const { default: html2canvas } = await import('html2canvas')

    const container = document.createElement('div')
    container.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;background:#ffffff;padding:56px 48px;display:flex;flex-direction:column;align-items:center;gap:22px;font-family:Arial,Helvetica,sans-serif;'
    container.innerHTML = `
      <img src="/logo.png" style="height:52px;object-fit:contain" />
      <h1 style="font-size:26px;font-weight:900;color:#1A237E;margin:6px 0 0;text-align:center;letter-spacing:-0.01em">Walk-In Patient Registration</h1>
      <img src="${qrDataUrl}" style="width:440px;height:440px;border:10px solid #1A237E;border-radius:28px;padding:10px;background:#fff" />
      <p style="font-size:19px;font-weight:700;color:#0f172a;text-align:center;margin:4px 0 0">Scan to register before your appointment</p>
      <p style="font-size:13px;color:#64748b;text-align:center;max-width:520px;margin:0;word-break:break-all">${url}</p>
      <div style="width:100%;height:6px;background:linear-gradient(90deg,#1A237E,#29ABE2);border-radius:3px;margin-top:10px"></div>
      <p style="font-size:13px;font-weight:800;color:#1A237E;text-align:center;margin:0;letter-spacing:0.04em">CODE CLINIC</p>
    `
    document.body.appendChild(container)
    // Give the inline <img> tags (logo + QR data URL) a beat to paint before snapshotting.
    await new Promise(r => setTimeout(r, 150))
    try {
      return await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
    } finally {
      document.body.removeChild(container)
    }
  }

  async function downloadFlyerPng() {
    setFlyerBusy('png'); setFlyerMenuOpen(false)
    try {
      const canvas = await composeFlyer()
      const a = document.createElement('a')
      a.href = canvas.toDataURL('image/png')
      a.download = 'code-clinic-walk-in-qr-flyer.png'
      a.click()
    } catch { showToast('Failed to generate flyer', 'err') }
    finally { setFlyerBusy(null) }
  }

  async function downloadFlyerPdf() {
    setFlyerBusy('pdf'); setFlyerMenuOpen(false)
    try {
      const canvas = await composeFlyer()
      const { jsPDF } = await import('jspdf')
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' })
      const pageW = pdf.internal.pageSize.getWidth()
      const pageH = pdf.internal.pageSize.getHeight()
      const imgW  = pageW - 24
      const imgH  = (canvas.height * imgW) / canvas.width
      const y     = Math.max(12, (pageH - imgH) / 2)
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 12, y, imgW, imgH)
      pdf.save('code-clinic-walk-in-qr-flyer.pdf')
    } catch { showToast('Failed to generate flyer', 'err') }
    finally { setFlyerBusy(null) }
  }

  if (!ready) return null

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
      {toast && (
        <div className={cn('fixed top-4 right-4 z-50 px-4 py-3 rounded-xl text-sm font-bold text-white shadow-lg',
          toast.type === 'ok' ? 'bg-emerald-500' : 'bg-red-500')}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-white/40 mb-1">
            <Link href={basePath} className="hover:underline">Patients</Link>
            <ChevronRight size={12} />
            <span>Walk-In Intake</span>
          </div>
          <h1 className="text-lg font-black text-gray-800 dark:text-white">Walk-In Intake</h1>
          <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">
            Print and display the QR code at reception — new patients scan it, fill in their details, and a patient profile is created automatically. No import step.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── QR card ──────────────────────────────────────────── */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100 dark:border-white/8 flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
              <QrCode size={20} className="text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-black text-gray-800 dark:text-white">Walk-In Intake QR Code</h2>
              <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Scanning opens a blank intake form — no appointment or patient link required.</p>
            </div>
          </div>
          <div className="px-6 py-5 flex flex-col sm:flex-row items-center gap-6">
            {qrLoading ? (
              <div className="w-40 h-40 flex items-center justify-center flex-shrink-0">
                <RefreshCw size={20} className="animate-spin text-gray-300" />
              </div>
            ) : qr ? (
              <img src={qr.qrDataUrl} alt="Walk-in intake QR code" className="w-40 h-40 rounded-xl border border-gray-100 dark:border-white/10 flex-shrink-0" />
            ) : (
              <button onClick={fetchQr}
                className="w-40 h-40 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 dark:border-white/10 text-gray-400 text-xs font-bold flex-shrink-0">
                <QrCode size={22} /> Generate
              </button>
            )}
            <div className="flex-1 space-y-3 text-center sm:text-left w-full">
              <p className="text-xs text-gray-500 dark:text-white/50 break-all">{qr?.url || 'Loading intake URL...'}</p>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                {qr && (
                  <a href={qr.qrDataUrl} download="code-clinic-walk-in-qr.png"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black text-white transition-all hover:-translate-y-0.5"
                    style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}>
                    <Download size={14} /> Download QR
                  </a>
                )}
                <div className="relative">
                  <button onClick={() => setFlyerMenuOpen(o => !o)} disabled={!!flyerBusy}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-all disabled:opacity-50">
                    {flyerBusy ? <RefreshCw size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                    {flyerBusy ? 'Preparing...' : 'Branded Flyer'}
                    <span className="text-gray-400">▾</span>
                  </button>
                  {flyerMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setFlyerMenuOpen(false)} />
                      <div className="absolute left-0 sm:right-0 sm:left-auto top-full mt-1 w-52 bg-white dark:bg-[#152040] rounded-xl shadow-xl border border-gray-100 dark:border-white/10 py-1.5 z-20">
                        <button onClick={downloadFlyerPng} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5">
                          <ImageIcon size={13} className="text-blue-500" /> High-res PNG (print)
                        </button>
                        <button onClick={downloadFlyerPdf} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5">
                          <FileText size={13} className="text-red-500" /> A4 PDF (print)
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-gray-400 dark:text-white/30">Branded flyer includes the Code Clinic logo, heading, a high-resolution QR code, and instructions — ready to print and post at reception.</p>
            </div>
          </div>
        </div>

        {/* ── Recent submissions ───────────────────────────────── */}
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/8 shadow-sm overflow-hidden flex flex-col">
          <div className="px-6 py-5 border-b border-gray-100 dark:border-white/8 flex items-center gap-4">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 bg-cyan-50 dark:bg-cyan-900/20">
              <Users size={20} className="text-cyan-600 dark:text-cyan-400" />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-black text-gray-800 dark:text-white">Recent Walk-Ins</h2>
              <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Last 24 hours — refreshes automatically</p>
            </div>
            <div className="text-2xl font-black text-cyan-600 dark:text-cyan-400 tabular-nums">{recent.length}</div>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[420px]">
            {recentLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw size={18} className="animate-spin text-gray-300" />
              </div>
            ) : recent.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-400 dark:text-white/30">
                <QrCode size={28} className="mb-2 opacity-30" />
                <p className="text-xs font-semibold">No walk-in submissions yet today</p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-white/8">
                {recent.map(s => {
                  const badge = s.outcome ? OUTCOME_BADGE[s.outcome] : null
                  return (
                    <li key={s.id}>
                      <Link href={`${basePath}/${s.patientId}`}
                        className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50">
                          {s.outcome === 'REQUIRES_REVIEW'
                            ? <AlertTriangle size={14} className="text-amber-500" />
                            : <CheckCircle2 size={14} className="text-emerald-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-800 dark:text-white truncate">{s.name || 'Unnamed patient'}</p>
                          <p className="text-xs text-gray-400 dark:text-white/40">{s.phone} · {timeAgo(s.createdAt)}</p>
                        </div>
                        {badge && (
                          <span className={cn('text-[10px] font-black px-2 py-1 rounded-full flex-shrink-0', badge.pill)}>{badge.label}</span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
