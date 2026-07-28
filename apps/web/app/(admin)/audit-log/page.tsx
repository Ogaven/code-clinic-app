'use client'

import { useEffect, useState, useCallback } from 'react'
import { Search, ChevronLeft, ChevronRight, Download, ShieldCheck, ShieldAlert, ChevronDown, ChevronUp, MessageSquare, ClipboardList } from 'lucide-react'

const API = '/api-proxy'

// ── Bot message log types ─────────────────────────────────────────────────────

interface BotMessageLog {
  id: string
  recipientPhone: string
  channel: string
  templateType: string
  messageBody: string
  sentAt: string
  deliveryStatus: string | null
  patient: { firstName: string; lastName: string; patientNumber: number } | null
}

interface BotPageData {
  logs: BotMessageLog[]
  total: number
  page: number
  limit: number
  pages: number
}

// ── Delivery status badge ─────────────────────────────────────────────────────

function DeliveryBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-gray-400">pending</span>
  const styles: Record<string, string> = {
    read:      'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    delivered: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    sent:      'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
    failed:    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  }
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${styles[status] || styles['sent']}`}>
      {status}
    </span>
  )
}

// ── Template type badge ───────────────────────────────────────────────────────

const TEMPLATE_COLORS: Record<string, string> = {
  appointment_reminder:   'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  booking_confirmation:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  followup_feedback:      'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  reactivation:           'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  staff_alert:            'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  general_reply:          'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  consent_update:         'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  cancellation_notice:    'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
}

function TemplateBadge({ type }: { type: string }) {
  const style = TEMPLATE_COLORS[type] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${style}`}>
      {type.replace(/_/g, ' ')}
    </span>
  )
}

// ── Bot message row ───────────────────────────────────────────────────────────

function BotRow({ log }: { log: BotMessageLog }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <tr
        className="hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {eatTime(log.sentAt)}
        </td>
        <td className="px-4 py-3">
          {log.patient ? (
            <div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100">
                {log.patient.firstName} {log.patient.lastName}
              </div>
              <div className="text-[10px] text-gray-400">#{log.patient.patientNumber} · {log.recipientPhone}</div>
            </div>
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400">{log.recipientPhone}</div>
          )}
        </td>
        <td className="px-4 py-3">
          <TemplateBadge type={log.templateType} />
        </td>
        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-200 max-w-xs truncate">
          {log.messageBody}
        </td>
        <td className="px-4 py-3">
          <DeliveryBadge status={log.deliveryStatus} />
        </td>
        <td className="px-4 py-3 w-6">
          {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 dark:bg-gray-800/60">
          <td colSpan={6} className="px-6 pb-4 pt-2">
            <p className="text-xs font-mono text-gray-700 dark:text-gray-200 whitespace-pre-wrap bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-3">
              {log.messageBody}
            </p>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Human-readable sentence builder ─────────────────────────────────────────

function actorName(user: AuditLog['user']): string {
  if (!user) return 'System'
  return `${user.firstName} ${user.lastName}`
}

function buildSentence(log: AuditLog): string {
  const who = actorName(log.user)
  const entity = log.entityName || log.resourceId || ''

  switch (log.actionType) {
    case 'LOGIN':        return `${who} logged in`
    case 'LOGOUT':       return `${who} logged out`
    case 'LOGIN_FAILED': return `Failed login attempt for ${who}`
    case 'CREATE':
      switch (log.entityType) {
        case 'PATIENT':        return `${who} registered a new patient — ${entity}`
        case 'APPOINTMENT':    return `${who} booked an appointment — ${entity}`
        case 'TREATMENT_PLAN': return `${who} added a treatment plan item — ${entity}`
        case 'NOTE':           return `${who} added a treatment note — ${entity}`
        case 'INVOICE':        return `${who} created an invoice — ${entity}`
        case 'STAFF':          return `${who} added a staff member — ${entity}`
        default:               return `${who} created ${entity || log.entityType || log.resource}`
      }
    case 'UPDATE':
      switch (log.entityType) {
        case 'PATIENT':        return `${who} updated patient — ${entity}`
        case 'TREATMENT_PLAN': return `${who} updated treatment plan — ${entity}${log.notes ? ' → ' + log.notes : ''}`
        case 'STAFF':          return `${who} updated staff — ${entity}${log.notes ? ' (' + log.notes + ')' : ''}`
        default:               return `${who} updated ${entity || log.entityType || log.resource}`
      }
    case 'DELETE':
      switch (log.entityType) {
        case 'PATIENT':        return `${who} deleted patient — ${entity}`
        case 'TREATMENT_PLAN': return `${who} deleted treatment plan — ${entity}`
        case 'STAFF':          return `${who} deleted staff member — ${entity}`
        default:               return `${who} deleted ${entity || log.entityType || log.resource}`
      }
    case 'RESCHEDULE':   return `${who} rescheduled appointment — ${entity}`
    case 'CANCEL':       return `${who} cancelled appointment — ${entity}`
    case 'CONFIRM':      return `${who} confirmed appointment — ${entity}`
    case 'STATUS_CHANGE':return `${who} moved appointment to "${log.notes}" — ${entity}`
    case 'PAYMENT_RECEIVED': return `${who} recorded payment — ${entity}`
    case 'VIEW_SENSITIVE':   return `${who} viewed sensitive data — ${entity}`
    case 'EXPORT':           return `${who} exported data — ${entity}`
    default:
      // Fall back to old-style HTTP method logs gracefully
      if (!log.actionType) {
        const methodMap: Record<string, string> = { POST: 'created', PUT: 'updated', PATCH: 'updated', DELETE: 'deleted' }
        const verb = methodMap[log.action] || log.action.toLowerCase()
        return `${who} ${verb} ${log.resource}${log.resourceId ? ' (' + log.resourceId.slice(0, 8) + '…)' : ''}`
      }
      return `${who} — ${log.actionType} on ${entity || log.resource}`
  }
}

// ── Severity badge ────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string | null }) {
  if (!severity || severity === 'INFO') return null
  const styles = severity === 'CRITICAL'
    ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
    : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300'
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${styles}`}>
      {severity}
    </span>
  )
}

// ── Entity type badge ─────────────────────────────────────────────────────────

const ENTITY_COLORS: Record<string, string> = {
  PATIENT:        'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  APPOINTMENT:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  INVOICE:        'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  PAYMENT:        'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  TREATMENT_PLAN: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  NOTE:           'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  STAFF:          'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-300',
  SERVICE:        'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
}

function EntityBadge({ type }: { type: string | null }) {
  if (!type) return null
  const style = ENTITY_COLORS[type] || 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
  const label = type.replace(/_/g, ' ')
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${style}`}>{label}</span>
  )
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ user }: { user: AuditLog['user'] }) {
  if (!user) return (
    <div className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-[10px] text-gray-500 font-bold shrink-0">
      SYS
    </div>
  )
  const initials = `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
  return (
    <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-[10px] text-blue-700 dark:text-blue-300 font-bold shrink-0 uppercase">
      {initials}
    </div>
  )
}

// ── EAT timestamp ─────────────────────────────────────────────────────────────

function eatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Africa/Nairobi',
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuditLog {
  id: string
  action: string
  actionType: string | null
  entityType: string | null
  entityId: string | null
  entityName: string | null
  resource: string
  resourceId: string | null
  fieldChanges: string | null
  hashChain: string | null
  severity: string | null
  notes: string | null
  ip: string | null
  createdAt: string
  user: { firstName: string; lastName: string; email: string; role: string; avatarR2Key: string | null } | null
}

interface PageData {
  logs: AuditLog[]
  total: number
  page: number
  limit: number
  pages: number
}

// ── Row component with expandable field changes ───────────────────────────────

function LogRow({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false)
  const hasChanges = !!log.fieldChanges

  let changes: { before: Record<string, unknown>; after: Record<string, unknown> } | null = null
  if (hasChanges) {
    try { changes = JSON.parse(log.fieldChanges!) } catch {}
  }

  return (
    <>
      <tr
        className={`hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors ${hasChanges ? 'cursor-pointer' : ''}`}
        onClick={() => hasChanges && setExpanded(e => !e)}
      >
        <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {eatTime(log.createdAt)}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <Avatar user={log.user} />
            <div>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-100 leading-tight">
                {log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System'}
              </div>
              {log.user && (
                <div className="text-[10px] text-gray-400 uppercase tracking-wide">{log.user.role}</div>
              )}
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <EntityBadge type={log.entityType} />
            <SeverityBadge severity={log.severity} />
          </div>
        </td>
        <td className="px-4 py-3">
          <p className="text-sm text-gray-700 dark:text-gray-200">{buildSentence(log)}</p>
          {log.ip && <p className="text-[10px] text-gray-400 mt-0.5">IP: {log.ip}</p>}
        </td>
        <td className="px-4 py-3 text-right">
          {hasChanges && (
            expanded
              ? <ChevronUp size={14} className="text-gray-400 ml-auto" />
              : <ChevronDown size={14} className="text-gray-400 ml-auto" />
          )}
        </td>
      </tr>
      {expanded && changes && (
        <tr className="bg-gray-50 dark:bg-gray-800/60">
          <td colSpan={5} className="px-6 pb-4 pt-2">
            <div className="grid grid-cols-2 gap-4 text-xs font-mono">
              <div>
                <p className="text-gray-400 uppercase text-[10px] tracking-wide mb-1">Before</p>
                <pre className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                  {JSON.stringify(changes.before, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-gray-400 uppercase text-[10px] tracking-wide mb-1">After</p>
                <pre className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap">
                  {JSON.stringify(changes.after, null, 2)}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const [activeTab, setActiveTab] = useState<'human' | 'bot'>('human')

  // ── Human audit log state ─────────────────────────────────────────────────
  const [data, setData]         = useState<PageData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [page, setPage]         = useState(1)
  const [search, setSearch]     = useState('')
  const [actionType, setActionType] = useState('')
  const [entityType, setEntityType] = useState('')
  const [severity, setSeverity] = useState('')
  const [from, setFrom]         = useState('')
  const [to, setTo]             = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<{ intact: boolean; total: number; tampered: number } | null>(null)
  const [exporting, setExporting] = useState(false)

  // ── Bot message log state ─────────────────────────────────────────────────
  const [botData, setBotData]       = useState<BotPageData | null>(null)
  const [botLoading, setBotLoading] = useState(false)
  const [botPage, setBotPage]       = useState(1)
  const [botSearch, setBotSearch]   = useState('')
  const [botStatus, setBotStatus]   = useState('')
  const [botFrom, setBotFrom]       = useState('')
  const [botTo, setBotTo]           = useState('')

  const loadBot = useCallback(async () => {
    setBotLoading(true)
    try {
      const token = localStorage.getItem('cc_token') || ''
      const params = new URLSearchParams({ page: String(botPage), limit: '50' })
      if (botSearch) params.set('q',      botSearch)
      if (botStatus) params.set('status', botStatus)
      if (botFrom)   params.set('from',   botFrom)
      if (botTo)     params.set('to',     botTo)
      const res = await fetch(`${API}/audit-logs/bot-messages?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setBotData(await res.json())
    } finally {
      setBotLoading(false)
    }
  }, [botPage, botSearch, botStatus, botFrom, botTo])

  useEffect(() => { if (activeTab === 'bot') loadBot() }, [activeTab, loadBot])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = localStorage.getItem('cc_token') || ''
      const params = new URLSearchParams({ page: String(page), limit: '50' })
      if (search)     params.set('q',          search)
      if (actionType) params.set('actionType', actionType)
      if (entityType) params.set('entityType', entityType)
      if (severity)   params.set('severity',   severity)
      if (from)       params.set('from',       from)
      if (to)         params.set('to',         to)
      const res = await fetch(`${API}/audit-logs?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) setData(await res.json())
    } finally {
      setLoading(false)
    }
  }, [page, search, actionType, entityType, severity, from, to])

  useEffect(() => { load() }, [load])

  const applyFilter = (fn: () => void) => { fn(); setPage(1) }

  const handleExport = async () => {
    setExporting(true)
    try {
      const token = localStorage.getItem('cc_token') || ''
      const params = new URLSearchParams({ limit: '10000' })
      if (search)     params.set('q',          search)
      if (actionType) params.set('actionType', actionType)
      if (entityType) params.set('entityType', entityType)
      if (severity)   params.set('severity',   severity)
      if (from)       params.set('from',       from)
      if (to)         params.set('to',         to)
      const res = await fetch(`${API}/audit-logs?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const result: PageData = await res.json()
      const rows = result.logs.map(l => [
        eatTime(l.createdAt),
        l.user ? `${l.user.firstName} ${l.user.lastName}` : 'System',
        l.user?.role || '',
        l.actionType || l.action,
        l.entityType || l.resource,
        buildSentence(l),
        l.severity || 'INFO',
        l.ip || '',
      ])
      const header = ['Timestamp', 'User', 'Role', 'Action', 'Entity', 'Description', 'Severity', 'IP']
      const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
      URL.revokeObjectURL(url)
    } finally { setExporting(false) }
  }

  const handleVerify = async () => {
    setVerifying(true)
    setVerifyResult(null)
    try {
      const token = localStorage.getItem('cc_token') || ''
      const res = await fetch(`${API}/audit-logs/verify`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setVerifyResult(await res.json())
    } finally { setVerifying(false) }
  }

  const hasFilter = search || actionType || entityType || severity || from || to

  return (
    <div className="p-4 md:p-6 space-y-4">

      {/* Header with action buttons */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Audit Log</h1>
          <p className="text-xs text-gray-400 mt-0.5">Tamper-evident record of all clinical and bot actions</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
          >
            {verifying
              ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
              : verifyResult
                ? verifyResult.intact ? <ShieldCheck size={14} className="text-green-600" /> : <ShieldAlert size={14} className="text-red-600" />
                : <ShieldCheck size={14} />
            }
            {verifyResult
              ? verifyResult.intact ? 'Integrity OK' : `${verifyResult.tampered} tampered!`
              : 'Verify Integrity'
            }
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-60"
          >
            <Download size={14} />
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('human')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'human'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <ClipboardList size={14} /> Human Actions
        </button>
        <button
          onClick={() => setActiveTab('bot')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'bot'
              ? 'border-blue-500 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <MessageSquare size={14} /> Bot Messages
          {botData && <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-1.5 py-0.5 rounded-full">{botData.total.toLocaleString()}</span>}
        </button>
      </div>

      {/* ── BOT MESSAGES TAB ── */}
      {activeTab === 'bot' && (
        <div className="space-y-4">
          {/* Bot filters */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search patient, phone, message…"
                  value={botSearch}
                  onChange={e => { setBotSearch(e.target.value); setBotPage(1) }}
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <select
                value={botStatus}
                onChange={e => { setBotStatus(e.target.value); setBotPage(1) }}
                className="py-2 px-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Statuses</option>
                <option value="sent">Sent</option>
                <option value="delivered">Delivered</option>
                <option value="read">Read</option>
                <option value="failed">Failed</option>
              </select>
              <input
                type="date"
                value={botFrom}
                onChange={e => { setBotFrom(e.target.value); setBotPage(1) }}
                className="py-2 px-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-gray-400 text-sm self-center">to</span>
              <input
                type="date"
                value={botTo}
                onChange={e => { setBotTo(e.target.value); setBotPage(1) }}
                className="py-2 px-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {(botSearch || botStatus || botFrom || botTo) && (
                <button
                  onClick={() => { setBotSearch(''); setBotStatus(''); setBotFrom(''); setBotTo(''); setBotPage(1) }}
                  className="py-2 px-3 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Bot messages table */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {botLoading ? (
              <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
            ) : !botData || botData.logs.length === 0 ? (
              <div className="py-16 text-center text-gray-400 text-sm">No bot messages found</div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
                        <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">Time (EAT)</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Recipient</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Type</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Message</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Delivery</th>
                        <th className="px-4 py-3 w-6" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {botData.logs.map(log => <BotRow key={log.id} log={log} />)}
                    </tbody>
                  </table>
                </div>
                {botData.pages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                    <span className="text-xs text-gray-400">
                      {((botData.page - 1) * botData.limit) + 1}–{Math.min(botData.page * botData.limit, botData.total)} of {botData.total.toLocaleString()}
                    </span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setBotPage(p => Math.max(1, p - 1))} disabled={botData.page <= 1}
                        className="p-1.5 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700">
                        <ChevronLeft size={14} />
                      </button>
                      <span className="text-xs text-gray-600 dark:text-gray-300">Page {botData.page} / {botData.pages}</span>
                      <button onClick={() => setBotPage(p => Math.min(botData.pages, p + 1))} disabled={botData.page >= botData.pages}
                        className="p-1.5 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700">
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── HUMAN ACTIONS TAB ── */}
      {activeTab === 'human' && (<>

      {/* Verify result banner */}
      {verifyResult && (
        <div className={`rounded-lg px-4 py-3 text-sm flex items-center gap-2 ${verifyResult.intact ? 'bg-green-50 text-green-800 dark:bg-green-900/20 dark:text-green-300' : 'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-300'}`}>
          {verifyResult.intact
            ? <><ShieldCheck size={16} /> All {verifyResult.total} entries verified — chain intact. No tampering detected.</>
            : <><ShieldAlert size={16} /> {verifyResult.tampered} of {verifyResult.total} entries have broken hash chains — possible tampering detected!</>
          }
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, patient, notes…"
              value={search}
              onChange={e => applyFilter(() => setSearch(e.target.value))}
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select
            value={actionType}
            onChange={e => applyFilter(() => setActionType(e.target.value))}
            className="py-2 px-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Actions</option>
            <option value="LOGIN">Login</option>
            <option value="LOGOUT">Logout</option>
            <option value="LOGIN_FAILED">Failed Login</option>
            <option value="CREATE">Created</option>
            <option value="UPDATE">Updated</option>
            <option value="DELETE">Deleted</option>
            <option value="RESCHEDULE">Rescheduled</option>
            <option value="CANCEL">Cancelled</option>
            <option value="STATUS_CHANGE">Status Change</option>
            <option value="PAYMENT_RECEIVED">Payment</option>
            <option value="VIEW_SENSITIVE">Viewed Sensitive</option>
            <option value="EXPORT">Export</option>
          </select>

          <select
            value={entityType}
            onChange={e => applyFilter(() => setEntityType(e.target.value))}
            className="py-2 px-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Types</option>
            <option value="PATIENT">Patient</option>
            <option value="APPOINTMENT">Appointment</option>
            <option value="INVOICE">Invoice</option>
            <option value="PAYMENT">Payment</option>
            <option value="TREATMENT_PLAN">Treatment Plan</option>
            <option value="NOTE">Note</option>
            <option value="STAFF">Staff</option>
            <option value="SERVICE">Service</option>
          </select>

          <select
            value={severity}
            onChange={e => applyFilter(() => setSeverity(e.target.value))}
            className="py-2 px-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Severity</option>
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="CRITICAL">Critical</option>
          </select>

          <input
            type="date"
            value={from}
            onChange={e => applyFilter(() => setFrom(e.target.value))}
            className="py-2 px-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-gray-400 text-sm self-center">to</span>
          <input
            type="date"
            value={to}
            onChange={e => applyFilter(() => setTo(e.target.value))}
            className="py-2 px-3 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {hasFilter && (
            <button
              onClick={() => { setSearch(''); setActionType(''); setEntityType(''); setSeverity(''); setFrom(''); setTo(''); setPage(1) }}
              className="py-2 px-3 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Log table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
        ) : !data || data.logs.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No audit logs found</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-750">
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">Time (EAT)</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Staff</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Type</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">Action</th>
                    <th className="px-4 py-3 w-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {data.logs.map(log => <LogRow key={log.id} log={log} />)}
                </tbody>
              </table>
            </div>

            {data.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                <span className="text-xs text-gray-400">
                  {((data.page - 1) * data.limit) + 1}–{Math.min(data.page * data.limit, data.total)} of {data.total.toLocaleString()} entries
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={data.page <= 1}
                    className="p-1.5 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="text-xs text-gray-600 dark:text-gray-300">
                    Page {data.page} / {data.pages}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(data.pages, p + 1))}
                    disabled={data.page >= data.pages}
                    className="p-1.5 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      </>)}
    </div>
  )
}
