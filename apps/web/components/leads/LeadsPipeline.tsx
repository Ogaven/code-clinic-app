'use client'

import { useCallback, useEffect, useMemo, useRef, useState, Fragment } from 'react'
import {
  Plus, Search, RefreshCw, UserCheck, Trash2, X, CheckCircle2, AlertCircle,
  Phone, Mail, MessageSquare, ExternalLink, Clock, Tag,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { slaBadge, LeadAutomationPanel } from '@/components/leads/LeadAutomationStatus'
import { LEAD_SOURCES, resolveInitialSourceFilter } from '@/lib/leadsSourceFilter'

// ── Types ────────────────────────────────────────────────────────
interface Lead {
  id: string
  name:        string | null
  phone:       string | null
  email:       string | null
  source:      string
  status:      string
  notes:       string | null
  lastMessage: string | null
  assignedTo:  string | null
  convertedToPatientId: string | null
  createdAt:   string
  updatedAt:   string
  // CRM Automation (Parts M/N/T) — already returned by GET /crm/leads today
  // since Prisma includes every column by default; declared here so the
  // frontend can read them without an `any` cast.
  firstReplyAt?:      string | null
  firstHumanReplyAt?: string | null
  slaState?:          string | null
  lossReason?:        string | null
}

interface HistoricalReconciliationSummary {
  readOnly: true
  autoConversionEnabled: false
  scanned: number
  eligible: number
  manualReview: number
  unmatched: number
  skipped: number
  reasons: Record<string, number>
  provenanceStatus: string
}

interface ReconciliationCandidate {
  leadId: string
  currentStage: string
  patientId: string
  appointmentId: string
}

interface UnlinkedBookingCandidate {
  leadId: string
  leadName: string | null
  currentStage: string
  source: string
  ambiguous: boolean
  matchingPatients: { patientId: string; patientName: string; appointmentId: string; appointmentStartAt?: string; appointmentStatus?: string; evidence?: string; requiresStaffIdentityVerification?: boolean }[]
}

interface ConversationSummary {
  id: string
  channel: string
  phoneNumber: string
  lastMessage: { id: string; role: string; content: string; createdAt: string } | null
  updatedAt: string
}

interface StaffMember {
  id: string
  firstName: string
  lastName: string
  role: string
  isActive: boolean
}

// ── Constants ────────────────────────────────────────────────────
// LEAD_SOURCES itself now lives in lib/leadsSourceFilter.ts (single source
// of truth shared with the Sources -> Pipeline drill-down seeding logic).
const SOURCES = LEAD_SOURCES
const STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST'] as const

const SOURCE_STYLE: Record<string, string> = {
  WHATSAPP:  'bg-green-100 text-green-700 dark:bg-green-400/15 dark:text-green-300',
  FACEBOOK:  'bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300',
  INSTAGRAM: 'bg-pink-100 text-pink-700 dark:bg-pink-400/15 dark:text-pink-300',
  WEBSITE:   'bg-purple-100 text-purple-700 dark:bg-purple-400/15 dark:text-purple-300',
  QUIZ:      'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-400/15 dark:text-fuchsia-300',
  SCOREAPP:  'bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300',
  FACEBOOK_LEAD_AD: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300',
  WALKIN:    'bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
  OTHER:     'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60',
}
const SOURCE_LABEL: Record<string, string> = {
  WHATSAPP: 'WhatsApp', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', WEBSITE: 'Website',
  QUIZ: 'Quiz', SCOREAPP: 'ScoreApp', FACEBOOK_LEAD_AD: 'FB Lead Ad', WALKIN: 'Walk-in', OTHER: 'Other',
}
const STATUS_STYLE: Record<string, string> = {
  NEW:       'bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60',
  CONTACTED: 'bg-blue-100 text-blue-600 dark:bg-blue-400/15 dark:text-blue-300',
  QUALIFIED: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300',
  CONVERTED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
  LOST:      'bg-red-100 text-red-500 dark:bg-red-400/15 dark:text-red-300',
}
const STATUS_DOT: Record<string, string> = {
  NEW: '#94A3B8', CONTACTED: '#3B82F6', QUALIFIED: '#06B6D4', CONVERTED: '#10B981', LOST: '#EF4444',
}
const STAGE_LABEL: Record<string, string> = {
  NEW: 'New', CONTACTED: 'Contacted', QUALIFIED: 'Qualified', CONVERTED: 'Converted', LOST: 'Lost',
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Kampala' })
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Kampala' })
}
// ── Africa/Kampala period boundaries (client-side; leads are fetched in full,
// unpaginated, so filtering the already-fetched list is accurate — see load()
// below) — same fixed-UTC+3 math as apps/api/src/routes/pipeline.ts, no
// shared frontend timezone utility exists yet to import instead. ──────────
type LeadPeriod = 'today' | 'week' | 'month' | 'all'
const KAMPALA_OFFSET_MS = 3 * 60 * 60 * 1000
function kampalaMidnightUTC(y: number, m: number, day: number): Date {
  return new Date(Date.UTC(y, m, day, 0, 0, 0, 0) - KAMPALA_OFFSET_MS)
}
function kampalaPeriodRange(key: LeadPeriod): { start: Date | null; end: Date | null; label: string } {
  if (key === 'all') return { start: null, end: null, label: 'All time' }
  const shifted = new Date(Date.now() + KAMPALA_OFFSET_MS)
  const y = shifted.getUTCFullYear(), m = shifted.getUTCMonth(), day = shifted.getUTCDate()
  if (key === 'today') return { start: kampalaMidnightUTC(y, m, day), end: kampalaMidnightUTC(y, m, day + 1), label: 'today' }
  if (key === 'week') {
    const dow = new Date(Date.UTC(y, m, day)).getUTCDay()
    const monday = day - (dow === 0 ? 6 : dow - 1)
    return { start: kampalaMidnightUTC(y, m, monday), end: kampalaMidnightUTC(y, m, monday + 7), label: 'this week' }
  }
  return { start: kampalaMidnightUTC(y, m, 1), end: kampalaMidnightUTC(y, m + 1, 1), label: 'this month' }
}

function waLink(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const normalized = digits.startsWith('0') && digits.length === 10 ? '256' + digits.slice(1) : digits
  return `https://wa.me/${normalized}`
}

// ── Lead ↔ Conversation matching ──────────────────────────────────
// There is no foreign key between Lead and AiConversation — every match below
// is a runtime join against genuinely persisted identifiers, never a guess.
// Rules differ by source because each channel's lead-creation code
// (apps/api/src/ai-suite/{whatsapp,facebook,website}/..., routes/quiz-funnels.ts)
// stores a different kind of identifier in `phone`:
//
//   WHATSAPP / QUIZ — `phone` is a real phone number (quiz leads pass
//     through normalizePhone() before storage). Matched against WHATSAPP-
//     channel conversations by normalized digits (0-prefix -> 256-prefix),
//     same convention already used for the inbox's Lead badge.
//   FACEBOOK / INSTAGRAM — `phone` is actually the Meta PSID (both the DM
//     path in facebook.routes.ts and the comment path store `senderId`/
//     `fromId` into the `phone` column). Matched by EXACT string equality
//     against FACEBOOK/INSTAGRAM/FACEBOOK_COMMENT/INSTAGRAM_COMMENT-channel
//     conversations — no phone-style normalization applies to a PSID.
//   WEBSITE — genuinely ambiguous at the data level: website.routes.ts's
//     message handler stores the chat session UUID in `phone` (matchable),
//     but website.agent.ts's save_booking_request/escalate_to_human tools
//     instead store a human-typed callback phone number in the SAME column
//     (not matchable — there is no session id captured on those leads at
//     all). Both look like arbitrary strings in the Lead record, so this
//     only attempts a match when the value matches UUID format — the one
//     case where it is guaranteed to be the session id, not a phone number.
//   WALKIN / OTHER — no messaging channel exists for these; never attempted.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normalizePhoneDigits(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('0') && digits.length >= 9) digits = '256' + digits.slice(1)
  return digits
}

function findMatchedConversation(lead: Lead, conversations: ConversationSummary[]): ConversationSummary | null {
  if (!lead.phone) return null
  if (lead.source === 'WHATSAPP' || lead.source === 'QUIZ') {
    const target = normalizePhoneDigits(lead.phone)
    if (!target) return null
    return conversations.find(c => c.channel === 'WHATSAPP' && normalizePhoneDigits(c.phoneNumber) === target) ?? null
  }
  if (lead.source === 'FACEBOOK' || lead.source === 'INSTAGRAM') {
    const channels = lead.source === 'FACEBOOK' ? ['FACEBOOK', 'FACEBOOK_COMMENT'] : ['INSTAGRAM', 'INSTAGRAM_COMMENT']
    return conversations.find(c => channels.includes(c.channel) && c.phoneNumber === lead.phone) ?? null
  }
  if (lead.source === 'WEBSITE' && UUID_RE.test(lead.phone)) {
    return conversations.find(c => c.channel === 'WEBSITE' && c.phoneNumber === lead.phone) ?? null
  }
  return null
}

// ── Page ─────────────────────────────────────────────────────────
// Shared Leads Pipeline used by both Admin (/leads) and Receptionist
// (/receptionist/leads). `inboxPath` differs because each role has its own
// AI Suite Inbox route; delete is gated on role read from the same cc_user
// record already used for currentUserId — DELETE /crm/leads/:id is
// ADMIN-only server-side (apps/api/src/routes/crm.ts), so hiding the button
// for non-admins is purely supplementary, not the real enforcement.
export default function LeadsPipeline({ inboxPath, initialLeadId, initialSource }: { inboxPath: string; initialLeadId?: string | null; initialSource?: string | null }) {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const [leads,      setLeads]      = useState<Lead[]>([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  // Sources -> Pipeline drill-down: seeds the SAME srcFilter state the
  // existing source-pill buttons already set, from ?source=X on the
  // Pipeline URL (see SourcesWorkspace.tsx's Link). Lazy initializer: this
  // only needs to seed the very first fetch, exactly like any other filter
  // a staff member could have clicked before the page loaded.
  const [srcFilter,  setSrcFilter]  = useState(() => resolveInitialSourceFilter(initialSource))
  const [ownerFilter, setOwnerFilter] = useState('all') // all | unassigned | mine | <userId>
  const [sortBy,     setSortBy]     = useState<'updated' | 'oldest' | 'created'>('updated')
  const [periodKey,  setPeriodKey]  = useState<LeadPeriod>('all')
  const [toast,      setToast]      = useState<{ msg: string; ok: boolean } | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [staff,      setStaff]      = useState<StaffMember[]>([])

  const currentUser = useMemo(() => {
    if (typeof window === 'undefined') return { id: null as string | null, role: null as string | null }
    try {
      const u = JSON.parse(localStorage.getItem('cc_user') || '{}')
      return { id: u.id ?? null, role: u.role ?? null }
    } catch { return { id: null, role: null } }
  }, [])
  const currentUserId = currentUser.id
  const canDelete = currentUser.role === 'ADMIN'

  // Modals
  const [showAdd,    setShowAdd]    = useState(false)
  const [converting, setConverting] = useState<Lead | null>(null)
  const [deleting,   setDeleting]   = useState<Lead | null>(null)
  const [viewLead,   setViewLead]   = useState<Lead | null>(null)
  const [busy,       setBusy]       = useState(false)
  const [qualifying, setQualifying] = useState<Lead | null>(null)
  const [qualifyIntent, setQualifyIntent] = useState('')
  const [losing,     setLosing]     = useState<Lead | null>(null)
  const [lostReason, setLostReason] = useState('')

  const [unlinkedOpen, setUnlinkedOpen] = useState(false)
  const [unlinkedLoading, setUnlinkedLoading] = useState(false)
  const [unlinkedError, setUnlinkedError] = useState('')
  const [unlinkedCandidates, setUnlinkedCandidates] = useState<UnlinkedBookingCandidate[]>([])
  const [unlinkedPage, setUnlinkedPage] = useState(1)
  const [unlinkedTotal, setUnlinkedTotal] = useState(0)
  const [unlinkedHasMore, setUnlinkedHasMore] = useState(false)
  const [expandedUnlinkedLeadId, setExpandedUnlinkedLeadId] = useState<string | null>(null)

  const [verificationTarget, setVerificationTarget] = useState<{ leadId: string; patientId: string; appointmentId: string; patientName: string } | null>(null)
  const [verificationName, setVerificationName] = useState('')
  const [verificationConfirmed, setVerificationConfirmed] = useState(false)
  const [verificationBusy, setVerificationBusy] = useState(false)
  const [verificationError, setVerificationError] = useState('')
  const [verificationSuccess, setVerificationSuccess] = useState('')

  async function submitVerifiedLink() {
    if (!verificationTarget || !verificationConfirmed || verificationBusy) return
    setVerificationBusy(true)
    setVerificationError('')
    setVerificationSuccess('')
    try {
      const response = await fetch(`${API}/crm/leads/${encodeURIComponent(verificationTarget.leadId)}/verify-patient-booking`, {
        method: 'POST',
        headers: { ...authH, 'Content-Type': 'application/json' } as HeadersInit,
        body: JSON.stringify({
          patientId: verificationTarget.patientId,
          appointmentId: verificationTarget.appointmentId,
          confirmedPatientName: verificationName,
        }),
      })
      const data = await response.json()
      if (!response.ok || data.success !== true) throw new Error(data.error || 'Verification failed')
      setVerificationSuccess(`Lead verified and moved to ${data.stage}. Refreshing review.`)
      setVerificationTarget(null)
      setVerificationName('')
      setVerificationConfirmed(false)
      await Promise.all([loadUnlinkedReview(unlinkedPage), load()])
    } catch (error) {
      setVerificationError(error instanceof Error ? error.message : 'Verification failed. Review the lead before retrying.')
    } finally { setVerificationBusy(false) }
  }

  async function loadUnlinkedReview(_page: number) {
    setUnlinkedLoading(true)
    setUnlinkedError('')
    try {
      // Automatically scan all pages so staff review only actual candidates.
      // This is discovery only: phone matches never trigger conversion.
      const all: UnlinkedBookingCandidate[] = []
      let page = 1
      let total = 0
      let hasMore = true
      while (hasMore) {
        const response = await fetch(`${API}/crm/leads/unlinked-booking-review?page=${page}`, { headers: authH as any })
        if (!response.ok) throw new Error(`Could not load unlinked review (HTTP ${response.status})`)
        const data = await response.json()
        if (data.readOnly !== true || !Array.isArray(data.candidates)) throw new Error('Unexpected review response')
        all.push(...data.candidates)
        total = data.total
        hasMore = Boolean(data.hasMore)
        page += 1
        if (page > 10000) throw new Error('Review pagination exceeded safety limit')
      }
      setUnlinkedCandidates(all)
      setUnlinkedPage(1)
      setUnlinkedTotal(total)
      setUnlinkedHasMore(false)
    } catch (error) {
      setUnlinkedError(error instanceof Error ? error.message : 'Could not load unlinked review')
    } finally { setUnlinkedLoading(false) }
  }

  const [historicalSummary, setHistoricalSummary] = useState<HistoricalReconciliationSummary | null>(null)
  const [historicalSummaryLoading, setHistoricalSummaryLoading] = useState(false)
  const [historicalSummaryError, setHistoricalSummaryError] = useState('')
  async function loadHistoricalSummary() {
    setHistoricalSummaryLoading(true)
    setHistoricalSummaryError('')
    try {
      const response = await fetch(`${API}/crm/leads/automatic-reconciliation-summary`, { headers: authH as any })
      if (!response.ok) throw new Error(`Summary unavailable (HTTP ${response.status})`)
      const data = await response.json()
      if (data.readOnly !== true || data.autoConversionEnabled !== false) throw new Error('Unexpected reconciliation safety state')
      setHistoricalSummary(data as HistoricalReconciliationSummary)
    } catch (error) {
      setHistoricalSummaryError(error instanceof Error ? error.message : 'Could not load summary')
    } finally { setHistoricalSummaryLoading(false) }
  }

  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [reviewCandidates, setReviewCandidates] = useState<ReconciliationCandidate[]>([])
  const [reviewTotal, setReviewTotal] = useState(0)
  const [reviewPage, setReviewPage] = useState(1)
  const [reviewHasMore, setReviewHasMore] = useState(false)

  async function loadReconciliationPage(page: number) {
    setReviewLoading(true)
    setReviewError('')
    try {
      const response = await fetch(`${API}/crm/leads/reconciliation-preview?page=${page}`, { headers: authH as any })
      if (!response.ok) throw new Error(`Could not load review (HTTP ${response.status})`)
      const data = await response.json()
      if (data.readOnly !== true || !Array.isArray(data.candidates)) throw new Error('Unexpected review response')
      setReviewCandidates(data.candidates)
      setReviewTotal(data.total ?? 0)
      setReviewPage(data.page ?? page)
      setReviewHasMore(Boolean(data.hasMore))
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'Could not load review')
    } finally {
      setReviewLoading(false)
    }
  }

  // Add form
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'WALKIN', notes: '' })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (srcFilter !== 'all') params.set('source', srcFilter)
      if (search.trim())       params.set('q', search.trim())
      const r = await fetch(`${API}/crm/leads?${params}`, { headers: authH as any })
      const d = await r.json()
      setLeads(Array.isArray(d) ? d : [])
    } catch { setLeads([]) }
    setLoading(false)
  }, [srcFilter, search, token]) // eslint-disable-line

  useEffect(() => { load() }, [load])

  // Deep-link support: CRM Dashboard / Needs Attention / Follow-ups pages
  // link here with ?open=<leadId> so staff land straight in the drawer
  // instead of having to search the board manually. Opens once per id (not
  // on every `leads` refetch) so a manual close isn't immediately reopened
  // by the next poll/refresh.
  const openedInitialLeadRef = useRef<string | null>(null)
  useEffect(() => {
    if (!initialLeadId || openedInitialLeadRef.current === initialLeadId) return
    const match = leads.find(l => l.id === initialLeadId)
    if (match) { setViewLead(match); openedInitialLeadRef.current = initialLeadId }
  }, [initialLeadId, leads])

  // Real conversations, for the deterministic Lead -> Conversation matching
  // above. Same endpoint already used by the AI Suite inbox — no new backend
  // route, read-only, no messages sent.
  useEffect(() => {
    fetch(`${API}/ai-suite/conversations`, { headers: authH as any })
      .then(r => r.ok ? r.json() : [])
      .then(d => setConversations(Array.isArray(d) ? d : []))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Real staff for lead assignment — narrow summary endpoint (id/name/role/
  // isActive only), never hard-coded. Leads assignment doesn't need the
  // email/phone/lastLogin/doctor-scheduling fields GET /employees returns
  // (see WORKSTREAM A final closure pass, employee data minimization).
  useEffect(() => {
    fetch(`${API}/employees/summary`, { headers: authH as any })
      .then(r => r.ok ? r.json() : [])
      .then(d => setStaff(Array.isArray(d) ? d.filter((s: StaffMember) => s.isActive) : []))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function addLead() {
    if (!form.source) return
    setBusy(true)
    try {
      const r = await fetch(`${API}/crm/leads`, {
        method: 'POST', headers: authH as any,
        body: JSON.stringify({ ...form, name: form.name || null, phone: form.phone || null, email: form.email || null }),
      })
      if (r.ok) { showToast('Lead added'); setShowAdd(false); setForm({ name: '', phone: '', email: '', source: 'WALKIN', notes: '' }); load() }
      else { const d = await r.json(); showToast(d.error || 'Failed to add lead', false) }
    } catch { showToast('Network error', false) }
    setBusy(false)
  }

  // Pipeline stage actions — each calls the dedicated crm-automation endpoint
  // (never a raw PATCH {status}) so LeadStageHistory, SLA cancellation, and
  // the LOST-reason requirement are always enforced server-side.
  async function logReply(lead: Lead) {
    setBusy(true)
    try {
      const r = await fetch(`${API}/crm-automation/leads/${lead.id}/log-human-reply`, { method: 'POST', headers: authH as any })
      const d = await r.json()
      if (!r.ok) { showToast(d.error || 'Failed to log reply', false); return }
      setLeads(ls => ls.map(l => l.id === lead.id ? { ...l, ...d } : l))
      setViewLead(v => v ? { ...v, ...d } : v)
      showToast(d.status === 'CONTACTED' ? 'Reply logged — lead moved to Contacted' : `Reply logged — lead remains ${d.status || lead.status}`)
    } catch { showToast('Network error', false) }
    setBusy(false)
  }

  async function submitQualify() {
    if (!qualifying || !qualifyIntent) return
    setBusy(true)
    try {
      const r = await fetch(`${API}/crm-automation/leads/${qualifying.id}/qualify`, {
        method: 'POST', headers: authH as any, body: JSON.stringify({ intent: qualifyIntent }),
      })
      const d = await r.json()
      if (!r.ok) { showToast(d.error || 'Failed to qualify lead', false); return }
      setLeads(ls => ls.map(l => l.id === qualifying.id ? { ...l, ...d } : l))
      setViewLead(v => v ? { ...v, ...d } : v)
      showToast('Lead marked Qualified')
      setQualifying(null); setQualifyIntent('')
    } catch { showToast('Network error', false) }
    setBusy(false)
  }

  async function submitLost() {
    if (!losing || !lostReason.trim()) return
    setBusy(true)
    try {
      const r = await fetch(`${API}/crm-automation/leads/${losing.id}/lost`, {
        method: 'POST', headers: authH as any, body: JSON.stringify({ reason: lostReason.trim() }),
      })
      const d = await r.json()
      if (!r.ok) { showToast(d.error || 'Failed to mark lead lost', false); return }
      setLeads(ls => ls.map(l => l.id === losing.id ? { ...l, ...d } : l))
      setViewLead(v => v ? { ...v, ...d } : v)
      showToast('Lead marked Lost')
      setLosing(null); setLostReason('')
    } catch { showToast('Network error', false) }
    setBusy(false)
  }

  async function assignLead(lead: Lead, assignedTo: string | null) {
    try {
      const r = await fetch(`${API}/crm/leads/${lead.id}`, {
        method: 'PATCH', headers: authH as any,
        body: JSON.stringify({ assignedTo }),
      })
      if (!r.ok) { showToast('Assignment failed', false); return }
      setLeads(ls => ls.map(l => l.id === lead.id ? { ...l, assignedTo } : l))
      if (viewLead?.id === lead.id) setViewLead(v => v ? { ...v, assignedTo } : v)
    } catch { showToast('Network error', false) }
  }

  async function convertLead() {
    if (!converting) return
    setBusy(true)
    try {
      const r = await fetch(`${API}/crm/leads/${converting.id}/convert`, { method: 'POST', headers: authH as any })
      if (r.ok) {
        showToast(`${converting.name || 'Lead'} converted to patient`)
        setConverting(null)
        load()
      } else {
        const d = await r.json()
        showToast(d.error || 'Conversion failed', false)
      }
    } catch { showToast('Network error', false) }
    setBusy(false)
  }

  async function deleteLead() {
    if (!deleting) return
    setBusy(true)
    try {
      const r = await fetch(`${API}/crm/leads/${deleting.id}`, { method: 'DELETE', headers: authH as any })
      if (r.ok) { showToast('Lead deleted'); setDeleting(null); load() }
      else { const d = await r.json(); showToast(d.error || 'Delete failed', false) }
    } catch { showToast('Network error', false) }
    setBusy(false)
  }

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'

  // Period range recomputed only when periodKey changes (not on every render) —
  // "now" is fine to freeze for the component's lifetime here.
  const periodRange = useMemo(() => kampalaPeriodRange(periodKey), [periodKey])

  // Period + owner filter + sort, all applied client-side on top of the
  // server-filtered (source/search) list — all real fields, no fabricated
  // state. Filtering client-side is accurate (not a paginated subset) because
  // load() below always fetches the FULL matching set, unpaginated.
  // Period is by createdAt (lead ACQUISITION date) — never updatedAt, which
  // changes on status/notes/assignment edits unrelated to when the lead
  // actually came in.
  const filteredLeads = useMemo(() => {
    let out = leads
    if (periodRange.start) {
      const s = periodRange.start.getTime(), e = periodRange.end!.getTime()
      out = out.filter(l => { const t = new Date(l.createdAt).getTime(); return t >= s && t < e })
    }
    if (ownerFilter === 'unassigned') out = out.filter(l => !l.assignedTo)
    else if (ownerFilter === 'mine' && currentUserId) out = out.filter(l => l.assignedTo === currentUserId)
    else if (ownerFilter !== 'all') out = out.filter(l => l.assignedTo === ownerFilter)

    out = [...out]
    if (sortBy === 'oldest') out.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    else if (sortBy === 'created') out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    else out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    return out
  }, [leads, periodRange, ownerFilter, sortBy, currentUserId])

  // Real, client-computed counts from the filtered leads list — never fabricated.
  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = { NEW: 0, CONTACTED: 0, QUALIFIED: 0, CONVERTED: 0, LOST: 0 }
    for (const l of filteredLeads) counts[l.status] = (counts[l.status] ?? 0) + 1
    return counts
  }, [filteredLeads])

  const byStage = useMemo(() => {
    const map: Record<string, Lead[]> = { NEW: [], CONTACTED: [], QUALIFIED: [], CONVERTED: [], LOST: [] }
    for (const l of filteredLeads) (map[l.status] ?? (map[l.status] = [])).push(l)
    return map
  }, [filteredLeads])

  function staffName(id: string | null): string {
    if (!id) return 'Unassigned'
    const s = staff.find(s => s.id === id)
    return s ? `${s.firstName} ${s.lastName}` : 'Unassigned'
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">

      {toast && (
        <div className={cn(
          'fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl text-sm font-bold',
          toast.ok ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white',
        )}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Header — subtitle states the reporting window explicitly so staff
          never have to guess whether the counts below are today's, this
          week's, or the full all-time dataset. */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-800 dark:text-white">Leads Pipeline</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {loading
              ? 'Loading…'
              : periodKey === 'all'
                ? `${filteredLeads.length} lead${filteredLeads.length !== 1 ? 's' : ''} · All time`
                : `${filteredLeads.length} lead${filteredLeads.length !== 1 ? 's' : ''} ${periodRange.label}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 p-1">
            {(['today', 'week', 'month', 'all'] as LeadPeriod[]).map(p => (
              <button key={p} onClick={() => setPeriodKey(p)}
                className={cn('px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors',
                  periodKey === p ? 'bg-cyan-500 text-white' : 'text-gray-500 dark:text-white/50 hover:bg-gray-100 dark:hover:bg-white/10')}>
                {p === 'today' ? 'Today' : p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'All time'}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg"
            style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
            <Plus size={14} /> Add Lead
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-sky-100 dark:border-sky-500/20 bg-white dark:bg-white/5 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-gray-800 dark:text-white">Historical reconciliation overview</h2>
            <p className="text-xs text-gray-500 dark:text-white/50 mt-1">Full-dataset assessment. Patient identity must be independently verified before conversion.</p>
          </div>
          <button type="button" disabled={historicalSummaryLoading} onClick={() => void loadHistoricalSummary()}
            className="rounded-xl border border-sky-200 dark:border-sky-500/30 px-4 py-2 text-sm font-semibold text-sky-700 dark:text-sky-300 disabled:opacity-50">
            {historicalSummaryLoading ? 'Scanning historical leads…' : historicalSummary ? 'Refresh summary' : 'Scan all leads'}
          </button>
        </div>
        {historicalSummaryError && <p role="alert" className="text-sm text-red-600">{historicalSummaryError}</p>}
        {historicalSummary && <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">{([
            ['Scanned', historicalSummary.scanned], ['Manual review', historicalSummary.manualReview],
            ['Unmatched', historicalSummary.unmatched], ['Skipped', historicalSummary.skipped],
            ['Verified eligible', historicalSummary.eligible],
          ] as const).map(([label, count]) => <div key={label} className="rounded-lg bg-gray-50 dark:bg-white/5 p-3"><p className="text-xs text-gray-500">{label}</p><p className="text-lg font-bold dark:text-white">{count}</p></div>)}</div>
          <p className="text-xs text-amber-700 dark:text-amber-300">Automatic conversion disabled: existing patient links lack independent verification provenance. Phone matches require staff review.</p>
          <details className="text-xs text-gray-600 dark:text-white/60"><summary className="cursor-pointer font-semibold">Classification reasons</summary><ul className="mt-2 space-y-1">{Object.entries(historicalSummary.reasons).map(([reason, count]) => <li key={reason}>{reason.replaceAll('_', ' ')}: {count}</li>)}</ul></details>
        </>}
      </section>

      {/* Historical booking review is intentionally read-only. A matched appointment
          is not permission to change patient or lead data automatically. */}
      <section className="rounded-2xl border border-sky-100 dark:border-sky-500/20 bg-white dark:bg-white/5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-gray-800 dark:text-white">Historical booked leads review</h2>
            <p className="text-xs text-gray-500 dark:text-white/50 mt-1">Check leads with an explicit patient link and a qualifying appointment. Review only — no stages are changed.</p>
          </div>
          <button type="button" onClick={() => { if (!reviewOpen) void loadReconciliationPage(1); setReviewOpen(!reviewOpen) }}
            className="rounded-xl border border-sky-200 dark:border-sky-500/30 px-4 py-2 text-sm font-semibold text-sky-700 dark:text-sky-300">
            {reviewOpen ? 'Close review' : 'Review booked leads'}
          </button>
        </div>
        {reviewOpen && <div className="mt-4 space-y-3">
          {reviewLoading ? <p className="text-sm text-gray-500">Checking appointments…</p> : reviewError ? <p role="alert" className="text-sm text-red-600">{reviewError}</p> : <>
            <p className="text-xs text-gray-500">Page {reviewPage} · {reviewTotal} explicitly linked leads to scan across all pages · {reviewCandidates.length} qualifying appointments on this page. This is not the total number of conversions needed.</p>
            {reviewCandidates.length === 0 ? <p className="text-sm text-gray-500">No qualifying booked leads found on this page.</p> :
              <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-gray-100 dark:border-white/10"><th className="py-2">Lead</th><th>Current stage</th><th>Patient link</th><th>Appointment</th></tr></thead><tbody>{reviewCandidates.map(candidate => {
                const lead = leads.find(item => item.id === candidate.leadId)
                return <tr key={candidate.leadId} className="border-b border-gray-100 dark:border-white/10"><td className="py-2">{lead?.name || lead?.phone || candidate.leadId}</td><td>{candidate.currentStage}</td><td className="font-mono">{candidate.patientId.slice(0, 8)}…</td><td className="font-mono">{candidate.appointmentId.slice(0, 8)}…</td></tr>
              })}</tbody></table></div>}
          </>}
          <div className="flex items-center gap-2"><button type="button" disabled={reviewLoading || reviewPage <= 1} onClick={() => void loadReconciliationPage(reviewPage - 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">Previous</button><button type="button" disabled={reviewLoading || !reviewHasMore} onClick={() => void loadReconciliationPage(reviewPage + 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">Next</button><button type="button" disabled={reviewLoading} onClick={() => void loadReconciliationPage(reviewPage)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">Refresh</button></div>
        </div>}
      </section>

      <section className="rounded-2xl border border-amber-100 dark:border-amber-500/20 bg-white dark:bg-white/5 p-4">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div><h2 className="text-sm font-bold text-gray-800 dark:text-white">Review unlinked booked leads</h2>
            <p className="text-xs text-gray-500 mt-1">Possible phone-number matches only. Shared family numbers require identity checks. No leads are changed.</p></div>
          <button type="button" onClick={() => { if (!unlinkedOpen) void loadUnlinkedReview(1); setUnlinkedOpen(!unlinkedOpen) }} className="rounded-xl border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-700 dark:text-amber-300">{unlinkedOpen ? 'Close unlinked review' : 'Find possible bookings'}</button>
        </div>
        {unlinkedOpen && <div className="mt-4 space-y-3">
          {unlinkedLoading ? <p className="text-sm text-gray-500">Checking possible matches…</p> : unlinkedError ? <p role="alert" className="text-sm text-red-600">{unlinkedError}</p> : <>
            <p className="text-xs text-gray-500">Automatically scanned {unlinkedTotal} unlinked leads · {unlinkedCandidates.length} possible booked leads requiring identity verification.</p>
            {unlinkedCandidates.length > 0 && <button type="button" onClick={() => window.print()} className="rounded-lg border border-amber-300 px-3 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300">Print / Save mapping PDF</button>}
            <div id="clinic-mapping-print" className="hidden">
              <h1>Code Clinic — Historical Lead / Patient Mapping</h1>
              <p>CONFIDENTIAL — For authorized clinic staff only. Generated {new Date().toLocaleString('en-UG', { timeZone: 'Africa/Kampala' })}. Possible matches: {unlinkedCandidates.length}. Unlinked leads scanned: {unlinkedTotal}.</p>
              <p>Phone and name similarities are NOT proof of identity. Verify against the clinic's patient and appointment records. Do not convert without independent confirmation.</p>
              <table><thead><tr><th>Lead / Stage</th><th>Suggested patient</th><th>Booking date / status</th><th>Staff decision and verification</th></tr></thead>
                <tbody>{unlinkedCandidates.flatMap(candidate => candidate.matchingPatients.map(patient =>
                  <tr key={candidate.leadId + patient.patientId}>
                    <td>{candidate.leadName || 'Unnamed lead'} ({candidate.currentStage})<div className="print-id">{candidate.leadId}</div></td>
                    <td>{patient.patientName}<div className="print-id">{patient.patientId}</div>{candidate.ambiguous ? 'SHARED PHONE — MULTIPLE PATIENTS' : 'Phone candidate — verify'}</td>
                    <td>{patient.appointmentStartAt ? new Date(patient.appointmentStartAt).toLocaleString('en-UG', { timeZone: 'Africa/Kampala' }) : 'Date unavailable'} · {patient.appointmentStatus || 'Unknown'}<div className="print-id">{patient.appointmentId}</div></td>
                    <td>☐ Confirmed ☐ Rejected ☐ Investigate<br />Evidence checked: __________________<br />Staff: ______________ Date: __________</td>
                  </tr>
                ))}</tbody>
              </table>
              <p>Supervisor name: ____________________ Signature: ____________________ Date: __________</p>
              <p>Only authorized administrators may perform final CRM linkage after independently verifying identity and appointment evidence.</p>
            </div>
            <style jsx global>{`@media print {
              body * { visibility: hidden !important; }
              #clinic-mapping-print, #clinic-mapping-print * { visibility: visible !important; }
              #clinic-mapping-print { display: block !important; position: absolute; top: 0; left: 0; width: 100%; color: #111; background: white; font: 11px Arial, sans-serif; }
              #clinic-mapping-print h1 { font-size: 20px; margin-bottom: 10px; }
              #clinic-mapping-print p { margin: 8px 0; }
              #clinic-mapping-print table { width: 100%; border-collapse: collapse; }
              #clinic-mapping-print th, #clinic-mapping-print td { border: 1px solid #777; padding: 8px; vertical-align: top; text-align: left; }
              #clinic-mapping-print tr { break-inside: avoid; }
              #clinic-mapping-print .print-id { font-size: 8px; overflow-wrap: anywhere; margin: 4px 0; }
              @page { size: A4 landscape; margin: 12mm; }
            }`}</style>
            {unlinkedCandidates.length === 0 ? <p className="text-sm text-gray-500">No possible bookings found across the scanned leads.</p> :
              <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b"><th className="py-2">Lead</th><th>Stage</th><th>Possible patient / appointment</th><th>Review status</th></tr></thead><tbody>{unlinkedCandidates.map(candidate => <Fragment key={candidate.leadId}>
                <tr className="border-b border-gray-100 dark:border-white/10">
                  <td className="py-2">{candidate.leadName || leads.find(l => l.id === candidate.leadId)?.phone || candidate.leadId}</td>
                  <td>{candidate.currentStage}</td>
                  <td>{candidate.matchingPatients.map(p => <div key={p.patientId}>{p.patientName} · {p.appointmentStartAt ? new Date(p.appointmentStartAt).toLocaleDateString('en-UG', { timeZone: 'Africa/Kampala', year: 'numeric', month: 'short', day: 'numeric' }) : 'Date unavailable'} · {p.appointmentStatus || 'Status unavailable'}</div>)}</td>
                  <td className="py-2">
                    <div className="text-amber-700 dark:text-amber-300">{candidate.ambiguous ? 'Multiple patients share phone — verify identity' : 'Phone match — verify identity'}</div>
                    <button type="button" aria-expanded={expandedUnlinkedLeadId === candidate.leadId} onClick={() => setExpandedUnlinkedLeadId(expandedUnlinkedLeadId === candidate.leadId ? null : candidate.leadId)} className="mt-1 rounded-lg border border-amber-200 px-2 py-1 font-medium text-amber-800 dark:text-amber-300">{expandedUnlinkedLeadId === candidate.leadId ? 'Hide details' : 'Inspect matches'}</button>
                  </td>
                </tr>
                {expandedUnlinkedLeadId === candidate.leadId && <tr className="border-b border-amber-200 bg-amber-50/50 dark:bg-amber-950/20"><td colSpan={4} className="p-3">
                  <p className="font-semibold">Identity verification required before linking or converting</p>
                  <p className="mt-1 text-gray-600 dark:text-gray-300">Confirm the patient's full name and appointment against the clinic record. A shared phone number alone is not sufficient evidence. This inspection does not modify any records.</p>
                  <p className="mt-2 font-mono break-all">Lead ID: {candidate.leadId}</p>
                  {candidate.matchingPatients.map(p => <div key={p.patientId} className="mt-2 rounded-lg border border-amber-200 p-2">
                    <p className="font-semibold">{p.patientName}</p>
                    <p>Appointment: {p.appointmentStartAt ? new Date(p.appointmentStartAt).toLocaleString('en-UG', { timeZone: 'Africa/Kampala', dateStyle: 'medium', timeStyle: 'short' }) : 'Date unavailable'} · {p.appointmentStatus || 'Status unavailable'}</p>
                    <details className="mt-1 text-xs"><summary className="cursor-pointer">Technical record IDs</summary><p className="font-mono break-all">Patient ID: {p.patientId}</p><p className="font-mono break-all">Appointment ID: {p.appointmentId}</p></details>
                    {currentUser.role === 'ADMIN' && <button type="button" className="mt-2 rounded-lg border border-amber-300 px-3 py-1.5 font-semibold" onClick={() => { setVerificationTarget({ leadId: candidate.leadId, patientId: p.patientId, appointmentId: p.appointmentId, patientName: p.patientName }); setVerificationName(''); setVerificationConfirmed(false); setVerificationError(''); setVerificationSuccess('') }}>Verify &amp; Link Patient</button>}
                  </div>)}
                </td></tr>}
              </Fragment>)}</tbody></table></div>}
          </>}
          {verificationSuccess && <p role="status" className="text-sm text-green-700">{verificationSuccess}</p>}
          {verificationTarget && <div className="rounded-xl border-2 border-amber-400 p-4 space-y-3">
            <h3 className="font-bold text-sm">Confirm patient identity before conversion</h3>
            <p className="text-xs">Check the actual patient record and appointment with the clinic. A phone match or name match alone does not establish identity. This action links the lead and moves it to Converted.</p>
            <p className="text-xs">Patient: <strong>{verificationTarget.patientName}</strong> · Appointment: {verificationTarget.appointmentId}</p>
            <label className="block text-xs font-semibold">Type the patient's full name exactly as shown in the record
              <input className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-gray-900" value={verificationName} onChange={e => setVerificationName(e.target.value)} autoComplete="off" />
            </label>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={verificationConfirmed} onChange={e => setVerificationConfirmed(e.target.checked)} /> I personally checked the patient identity and appointment against the clinic record and confirm this is the correct person.</label>
            {verificationError && <p role="alert" className="text-xs text-red-600">{verificationError}</p>}
            <div className="flex gap-2"><button type="button" disabled={verificationBusy || !verificationConfirmed || verificationName.trim().toLowerCase().replace(/\\s+/g, ' ') !== verificationTarget.patientName.trim().toLowerCase().replace(/\\s+/g, ' ')} onClick={() => void submitVerifiedLink()} className="rounded-lg bg-amber-700 text-white px-3 py-2 text-xs disabled:opacity-40">{verificationBusy ? 'Verifying…' : 'Confirm identity, link & convert'}</button>
              <button type="button" disabled={verificationBusy} onClick={() => { setVerificationTarget(null); setVerificationError('') }} className="rounded-lg border px-3 py-2 text-xs">Cancel</button></div>
          </div>}
          <div className="flex gap-2"><button type="button" disabled={unlinkedLoading || unlinkedPage <= 1} onClick={() => void loadUnlinkedReview(unlinkedPage - 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">Previous</button><button type="button" disabled={unlinkedLoading || !unlinkedHasMore} onClick={() => void loadUnlinkedReview(unlinkedPage + 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">Next</button><button type="button" disabled={unlinkedLoading} onClick={() => void loadUnlinkedReview(unlinkedPage)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">Refresh</button></div>
        </div>}
      </section>

      {/* Pipeline summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-3.5">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40">All</p>
          <p className="text-xl font-black text-gray-800 dark:text-white mt-0.5">{loading ? '…' : filteredLeads.length}</p>
        </div>
        {STATUSES.map(s => (
          <div key={s} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-3.5">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: STATUS_DOT[s] }} />
              {STAGE_LABEL[s]}
            </p>
            <p className="text-xl font-black text-gray-800 dark:text-white mt-0.5">{loading ? '…' : stageCounts[s]}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 p-4 space-y-3">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, phone, or email..."
            className="w-full pl-8 pr-4 py-2 text-sm bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 dark:text-white dark:placeholder-white/30 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] font-black uppercase text-gray-400 self-center mr-1">Source</span>
          {(['all', ...SOURCES] as string[]).map(s => (
            <button key={s} onClick={() => setSrcFilter(s)}
              className={cn('px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all',
                srcFilter === s ? 'bg-cyan-500 text-white' : 'bg-gray-100 dark:bg-white/8 text-gray-500 dark:text-white/50 hover:bg-gray-200 dark:hover:bg-white/12')}>
              {s === 'all' ? 'All' : SOURCE_LABEL[s] ?? s}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-black uppercase text-gray-400 self-center mr-1">Owner</span>
          {[
            { id: 'all', label: 'All owners' },
            { id: 'unassigned', label: 'Unassigned' },
            ...(currentUserId ? [{ id: 'mine', label: 'My leads' }] : []),
            ...staff.map(s => ({ id: s.id, label: `${s.firstName} ${s.lastName}` })),
          ].map(o => (
            <button key={o.id} onClick={() => setOwnerFilter(o.id)}
              className={cn('px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all',
                ownerFilter === o.id ? 'bg-cyan-500 text-white' : 'bg-gray-100 dark:bg-white/8 text-gray-500 dark:text-white/50 hover:bg-gray-200 dark:hover:bg-white/12')}>
              {o.label}
            </button>
          ))}
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value as typeof sortBy)}
            className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-white/8 text-gray-500 dark:text-white/50 border-0 outline-none cursor-pointer">
            <option value="updated" className="dark:bg-[#152040]">Recently updated</option>
            <option value="oldest" className="dark:bg-[#152040]">Oldest untouched</option>
            <option value="created" className="dark:bg-[#152040]">Latest enquiry</option>
          </select>
        </div>
      </div>

      {/* Pipeline columns */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 p-16 text-gray-300 dark:text-white/20">
          <RefreshCw size={18} className="animate-spin" /> Loading…
        </div>
      ) : filteredLeads.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-16 text-gray-300 dark:text-white/20 bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10">
          <UserCheck size={36} className="mb-3 opacity-30" />
          <p className="text-sm font-medium">No leads found</p>
          <p className="text-xs mt-1">
            {leads.length > 0 ? 'No leads match the current owner filter' : 'New enquiries via WhatsApp, Facebook, or Instagram appear here automatically'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-start">
          {STATUSES.map(stage => (
            <div key={stage} className="bg-gray-50 dark:bg-white/[0.03] rounded-2xl border border-gray-100 dark:border-white/10 flex flex-col min-h-[120px]">
              <div className="px-3.5 py-3 border-b border-gray-100 dark:border-white/10 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-black text-gray-600 dark:text-white/70">
                  <span className="w-2 h-2 rounded-full" style={{ background: STATUS_DOT[stage] }} />
                  {STAGE_LABEL[stage]}
                </span>
                <span className="text-[10px] font-bold text-gray-400 dark:text-white/40 bg-white dark:bg-white/10 px-1.5 py-0.5 rounded-full">
                  {byStage[stage].length}
                </span>
              </div>
              <div className="p-2 space-y-2 flex-1">
                {byStage[stage].length === 0 ? (
                  <p className="text-[11px] text-gray-300 dark:text-white/20 text-center py-6">No leads</p>
                ) : byStage[stage].map(lead => {
                  const matched = findMatchedConversation(lead, conversations)
                  return (
                    <button
                      key={lead.id}
                      onClick={() => setViewLead(lead)}
                      className="w-full text-left bg-white dark:bg-[#111a35] rounded-xl border border-gray-100 dark:border-white/10 p-3 hover:shadow-md hover:-translate-y-0.5 transition-all">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="text-sm font-bold text-gray-800 dark:text-white truncate">
                          {lead.name || <span className="italic text-gray-400 dark:text-white/30 font-normal">Unknown</span>}
                        </p>
                        <span className={cn('flex-shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold', SOURCE_STYLE[lead.source] ?? 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60')}>
                          {SOURCE_LABEL[lead.source] ?? lead.source}
                        </span>
                      </div>
                      {lead.phone && <p className="text-[11px] text-gray-400 dark:text-white/40 mb-1">{lead.phone}</p>}
                      {lead.lastMessage && (
                        <p className="text-[11px] text-gray-500 dark:text-white/50 line-clamp-2 leading-relaxed">{lead.lastMessage}</p>
                      )}
                      {lead.status === 'LOST' && lead.lossReason && (
                        <p className="text-[10px] text-red-500 dark:text-red-400 mt-1 truncate">Lost: {lead.lossReason}</p>
                      )}
                      {(() => {
                        const badge = slaBadge(lead)
                        return badge ? (
                          <span className={cn('inline-block mt-1.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold', badge.className)}>
                            {badge.text}
                          </span>
                        ) : null
                      })()}
                      <div className="flex items-center justify-between mt-2 gap-1.5">
                        <span className="text-[10px] text-gray-300 dark:text-white/25 flex-shrink-0">{fmtDate(lead.updatedAt)}</span>
                        <div className="flex items-center gap-2 min-w-0">
                          {lead.assignedTo && (
                            <span className="flex items-center gap-1 text-[10px] font-semibold text-gray-400 dark:text-white/40 truncate">
                              <UserCheck size={9} className="flex-shrink-0" /> {staffName(lead.assignedTo)}
                            </span>
                          )}
                          {matched && (
                            <span className={cn('flex items-center gap-1 text-[10px] font-bold flex-shrink-0',
                              matched.lastMessage?.role === 'USER' ? 'text-amber-600 dark:text-amber-400' : 'text-cyan-600 dark:text-cyan-400')}>
                              <MessageSquare size={9} />
                              {matched.lastMessage ? (matched.lastMessage.role === 'USER' ? 'Customer replied' : 'Clinic replied') : 'Linked'}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Add Lead modal ────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowAdd(false)}>
          <div className="bg-white dark:bg-[#152040] rounded-3xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">Add Lead</h2>
              <button onClick={() => setShowAdd(false)}
                className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                <X size={16} className="text-gray-400" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">Full Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="e.g. Jane Doe" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">Phone</label>
                <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className={inputCls} placeholder="+256 700 000 000" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">Email</label>
                <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} placeholder="email@example.com" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">Source *</label>
                <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} className={inputCls}>
                  {SOURCES.map(s => <option key={s} value={s} className="dark:bg-[#152040]">{SOURCE_LABEL[s]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3}
                  className={inputCls} placeholder="What did they enquire about?" />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowAdd(false)}
                  className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-bold text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                  Cancel
                </button>
                <button onClick={addLead} disabled={busy}
                  className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
                  {busy ? 'Adding…' : 'Add Lead'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Convert confirmation ──────────────────────────────── */}
      {converting && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setConverting(null)}>
          <div className="bg-white dark:bg-[#152040] rounded-3xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-400/15 flex items-center justify-center flex-shrink-0">
                <UserCheck size={18} className="text-emerald-600 dark:text-emerald-300" />
              </div>
              <h2 className="text-base font-bold text-gray-800 dark:text-white">Convert to Patient</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-white/60 mb-6 leading-relaxed">
              Create a patient record for <strong>{converting.name || converting.phone || 'this lead'}</strong>?
              The lead will be marked as Converted and they'll appear in the Patients list.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConverting(null)} disabled={busy}
                className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-bold text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={convertLead} disabled={busy}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-60">
                {busy ? 'Converting…' : 'Convert'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mark Qualified modal ──────────────────────────────── */}
      {qualifying && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setQualifying(null)}>
          <div className="bg-white dark:bg-[#152040] rounded-3xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-cyan-100 dark:bg-cyan-400/15 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 size={18} className="text-cyan-600 dark:text-cyan-300" />
              </div>
              <h2 className="text-base font-bold text-gray-800 dark:text-white">Mark Qualified</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-white/60 mb-4 leading-relaxed">
              What signal did <strong>{qualifying.name || qualifying.phone || 'this lead'}</strong> give? This is only allowed while the lead has replied within the last 48 hours.
            </p>
            <select value={qualifyIntent} onChange={e => setQualifyIntent(e.target.value)} className={inputCls + ' mb-6'}>
              <option value="" className="dark:bg-[#152040]">Select a reason…</option>
              <option value="asked_pricing" className="dark:bg-[#152040]">Asked about pricing</option>
              <option value="wants_appointment" className="dark:bg-[#152040]">Wants an appointment</option>
              <option value="asked_availability" className="dark:bg-[#152040]">Asked about availability</option>
              <option value="other" className="dark:bg-[#152040]">Other qualifying signal</option>
            </select>
            <div className="flex gap-3">
              <button onClick={() => setQualifying(null)} disabled={busy}
                className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-bold text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submitQualify} disabled={busy || !qualifyIntent}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-cyan-600 hover:bg-cyan-700 transition-colors disabled:opacity-60">
                {busy ? 'Saving…' : 'Mark Qualified'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mark Lost modal ───────────────────────────────────── */}
      {losing && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setLosing(null)}>
          <div className="bg-white dark:bg-[#152040] rounded-3xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-400/15 flex items-center justify-center flex-shrink-0">
                <X size={18} className="text-red-600 dark:text-red-300" />
              </div>
              <h2 className="text-base font-bold text-gray-800 dark:text-white">Mark Lost</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-white/60 mb-4 leading-relaxed">
              A reason is required for <strong>{losing.name || losing.phone || 'this lead'}</strong>.
            </p>
            <textarea value={lostReason} onChange={e => setLostReason(e.target.value)} rows={3}
              className={inputCls + ' mb-6'} placeholder="e.g. Went with another clinic, unreachable, not interested…" />
            <div className="flex gap-3">
              <button onClick={() => setLosing(null)} disabled={busy}
                className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-bold text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submitLost} disabled={busy || !lostReason.trim()}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-60">
                {busy ? 'Saving…' : 'Mark Lost'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lead detail drawer ────────────────────────────────── */}
      {viewLead && (() => {
        const matched = findMatchedConversation(viewLead, conversations)
        return (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-end z-50" onClick={() => setViewLead(null)}>
            <div className="bg-white dark:bg-[#0e1730] h-full w-full max-w-md shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="sticky top-0 bg-white dark:bg-[#0e1730] border-b border-gray-100 dark:border-white/10 px-5 py-4 flex items-center justify-between z-10">
                <h2 className="text-base font-bold text-gray-800 dark:text-white">Lead Details</h2>
                <button onClick={() => setViewLead(null)} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                  <X size={16} className="text-gray-400" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                {/* Identity */}
                <div className="space-y-2">
                  <p className="text-lg font-bold text-gray-800 dark:text-white">{viewLead.name || <span className="italic text-gray-400 dark:text-white/30">Unknown name</span>}</p>
                  {viewLead.phone && !viewLead.phone.startsWith('ws_') && (
                    <a href={waLink(viewLead.phone)} target="_blank" rel="noreferrer"
                      className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 font-semibold hover:underline w-fit">
                      <Phone size={13} /> {viewLead.phone}
                    </a>
                  )}
                  {viewLead.email && (
                    <a href={`mailto:${viewLead.email}`} className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 font-semibold hover:underline w-fit">
                      <Mail size={13} /> {viewLead.email}
                    </a>
                  )}
                </div>

                {/* Badges */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn('px-2.5 py-1 rounded-full text-[11px] font-bold', SOURCE_STYLE[viewLead.source] ?? 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60')}>
                    {SOURCE_LABEL[viewLead.source] ?? viewLead.source}
                  </span>
                  {/* Read-only — stage only ever changes through the dedicated
                      Pipeline Actions below, each backed by its own audited
                      transition (never a free-form status write, which used
                      to silently skip LeadStageHistory). */}
                  <span className={cn('text-[11px] font-bold px-2.5 py-1 rounded-full', STATUS_STYLE[viewLead.status] ?? 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60')}>
                    {STAGE_LABEL[viewLead.status] ?? viewLead.status}
                  </span>
                </div>

                {/* Assignment */}
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-1">Assigned to</label>
                  <select
                    value={viewLead.assignedTo ?? ''}
                    onChange={e => assignLead(viewLead, e.target.value || null)}
                    className="w-full text-sm font-semibold px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 dark:text-white cursor-pointer outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500">
                    <option value="" className="dark:bg-[#152040]">Unassigned</option>
                    {staff.map(s => (
                      <option key={s.id} value={s.id} className="dark:bg-[#152040]">{s.firstName} {s.lastName}</option>
                    ))}
                  </select>
                </div>

                {/* Timeline — updatedAt is deliberately NOT called "last activity":
                    it changes on status/notes/contact edits too, not just a real
                    customer interaction, so labelling it that way would overstate
                    what's actually known. Genuine conversation activity (when a
                    deterministic match exists) is shown separately below. */}
                <div className="flex items-center gap-4 text-xs text-gray-400 dark:text-white/40">
                  <span className="flex items-center gap-1"><Tag size={11} /> Created {fmtDate(viewLead.createdAt)}</span>
                  <span className="flex items-center gap-1"><Clock size={11} /> Updated {fmtDate(viewLead.updatedAt)}</span>
                </div>

                {/* CRM Automation (Part T) — response timer / SLA state / stale
                    indicator / stage history, kept in the drawer rather than the
                    card itself so cards stay uncluttered. */}
                <LeadAutomationPanel lead={viewLead} token={token} />

                {/* Original enquiry / last message from the Lead record itself */}
                {viewLead.lastMessage && (
                  <div className="bg-gray-50 dark:bg-white/5 rounded-2xl p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <MessageSquare size={12} className="text-gray-400" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40">Last recorded lead message</span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-white/70 whitespace-pre-wrap leading-relaxed">{viewLead.lastMessage}</p>
                  </div>
                )}

                {viewLead.notes && (
                  <div className="bg-amber-50 dark:bg-amber-400/10 rounded-2xl p-4">
                    <span className="text-[10px] font-black uppercase tracking-widest text-amber-500 dark:text-amber-300 block mb-2">Notes</span>
                    <p className="text-sm text-gray-700 dark:text-white/70 whitespace-pre-wrap leading-relaxed">{viewLead.notes}</p>
                  </div>
                )}

                {/* Matched conversation — only shown when a real, deterministic
                    match was found (see findMatchedConversation above). No
                    fabricated relationship is ever displayed.
                    DEEP-LINK LIMITATION: the inbox route only reliably opens the
                    right conversation for WhatsApp. The auto-select effect on
                    that page only searches the conversation list of whichever
                    channel tab is active, and the tab always starts on WhatsApp
                    with no channel URL param to redirect it — so a Facebook/
                    Instagram/Website match would land on the inbox but never
                    auto-select, silently doing nothing. The button is
                    therefore only offered for WhatsApp; other channels show
                    the matched context with no (misleading) link. */}
                <div className="bg-cyan-50 dark:bg-cyan-400/10 rounded-2xl p-4">
                  <span className="text-[10px] font-black uppercase tracking-widest text-cyan-600 dark:text-cyan-300 block mb-2">Conversation</span>
                  {matched ? (
                    <>
                      {matched.lastMessage && (
                        <p className="text-sm text-gray-700 dark:text-white/70 line-clamp-3 leading-relaxed mb-2">
                          {matched.lastMessage.role === 'AGENT' ? '🤖 ' : ''}{matched.lastMessage.content}
                        </p>
                      )}
                      {matched.lastMessage && (
                        <p className="text-[11px] text-gray-400 dark:text-white/40 mb-2">Last conversation activity {fmtDateTime(matched.lastMessage.createdAt)}</p>
                      )}
                      {matched.channel === 'WHATSAPP' ? (
                        <a href={`${inboxPath}?phone=${encodeURIComponent(matched.phoneNumber)}`}
                          className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-700 dark:text-cyan-300 hover:underline">
                          <ExternalLink size={12} /> View conversation
                        </a>
                      ) : (
                        <p className="text-[11px] text-gray-500 dark:text-white/40 leading-relaxed">
                          Matched on {SOURCE_LABEL[viewLead.source] ?? viewLead.source}, but the inbox can't be deep-linked to this exact conversation yet — open the {SOURCE_LABEL[viewLead.source] ?? viewLead.source} tab in AI Suite Inbox manually to find it.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-white/40 leading-relaxed">
                      No conversation could be reliably matched to this lead.
                      {viewLead.source === 'WEBSITE' && ' Website booking-request/escalation leads only capture a callback phone number, not the chat session — matching would need that session id to be persisted on the lead.'}
                      {(viewLead.source === 'WALKIN' || viewLead.source === 'OTHER') && ' This source has no associated messaging channel.'}
                    </p>
                  )}
                </div>

                {/* Conversion state */}
                {viewLead.convertedToPatientId && (
                  <div className="bg-emerald-50 dark:bg-emerald-400/10 rounded-2xl p-4 flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-300 flex-shrink-0" />
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 font-semibold">Converted to a patient record</p>
                  </div>
                )}

                {/* Pipeline actions — one button per real transition, each
                    calling its own dedicated crm-automation endpoint. This is
                    the only way a lead's stage should move; there is no
                    free-form "set status to anything" control left in this
                    UI (see the read-only badge above). */}
                {(viewLead.status === 'NEW' || viewLead.status === 'CONTACTED') && (
                  <div className="flex gap-2">
                    {viewLead.status === 'NEW' && (
                      <button onClick={() => logReply(viewLead)} disabled={busy}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-400/15 dark:text-blue-300 dark:hover:bg-blue-400/25 transition-colors disabled:opacity-60">
                        <MessageSquare size={14} /> Log Reply
                      </button>
                    )}
                    {viewLead.status === 'CONTACTED' && (
                      <button onClick={() => { setQualifying(viewLead); setQualifyIntent('') }} disabled={busy}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold bg-cyan-50 text-cyan-700 hover:bg-cyan-100 dark:bg-cyan-400/15 dark:text-cyan-300 dark:hover:bg-cyan-400/25 transition-colors disabled:opacity-60">
                        <CheckCircle2 size={14} /> Mark Qualified
                      </button>
                    )}
                    <button onClick={() => { setLosing(viewLead); setLostReason('') }} disabled={busy}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-400/15 dark:text-red-300 dark:hover:bg-red-400/25 transition-colors disabled:opacity-60">
                      <X size={14} /> Mark Lost
                    </button>
                  </div>
                )}
                {viewLead.status === 'QUALIFIED' && (
                  <button onClick={() => { setLosing(viewLead); setLostReason('') }} disabled={busy}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-400/15 dark:text-red-300 dark:hover:bg-red-400/25 transition-colors disabled:opacity-60">
                    <X size={14} /> Mark Lost
                  </button>
                )}

                {/* Quick actions — delete is ADMIN-only: DELETE /crm/leads/:id
                    enforces this server-side, so hiding the button for other
                    roles here is supplementary only, not the real gate. */}
                <div className="flex gap-2 pt-1">
                  {viewLead.status !== 'CONVERTED' && viewLead.status !== 'LOST' && (
                    <button
                      onClick={() => { setViewLead(null); setConverting(viewLead) }}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-400/15 dark:text-emerald-300 dark:hover:bg-emerald-400/25 transition-colors">
                      <UserCheck size={14} /> Convert to Patient
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => { setViewLead(null); setDeleting(viewLead) }}
                      className="p-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-red-500 hover:bg-red-50 dark:hover:bg-red-400/10 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Delete confirmation ───────────────────────────────── */}
      {deleting && canDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setDeleting(null)}>
          <div className="bg-white dark:bg-[#152040] rounded-3xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-400/15 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-600 dark:text-red-300" />
              </div>
              <h2 className="text-base font-bold text-gray-800 dark:text-white">Delete Lead</h2>
            </div>
            <p className="text-sm text-gray-600 dark:text-white/60 mb-6 leading-relaxed">
              Delete <strong>{deleting.name || deleting.phone || 'this lead'}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDeleting(null)} disabled={busy}
                className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-bold text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={deleteLead} disabled={busy}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-60">
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}