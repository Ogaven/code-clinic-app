'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  MessageSquare, Facebook, Instagram, Phone, Mic2,
  CheckCircle2, XCircle, Loader2, Plus, Trash2, Edit3, Save, X,
  ChevronDown, ChevronUp, ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── types ──────────────────────────────────────────────────────────────────────

type SipTrunk = {
  id: string; name: string; host: string; port: number; netmask: number
  protocol: string; allowInbound: boolean; allowOutbound: boolean
  optionsPing: boolean; username?: string | null; password?: string | null
  useSipRegistration: boolean; leadingPlus: boolean
  techPrefix?: string | null; sipDiversionHeader?: string | null
}

// ── small helpers ──────────────────────────────────────────────────────────────

function StatusBadge({ connected }: { connected: boolean }) {
  return connected ? (
    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
      <CheckCircle2 size={9} /> Connected
    </span>
  ) : (
    <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50">
      <XCircle size={9} /> Not connected
    </span>
  )
}

function SectionCard({ icon, label, badge, children, expandedDefault = false }: {
  icon: React.ReactNode; label: string; badge?: React.ReactNode; children: React.ReactNode; expandedDefault?: boolean
}) {
  const [open, setOpen] = useState(expandedDefault)
  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
        <div className="flex items-center gap-3">
          {icon}
          <span className="text-sm font-bold text-gray-800 dark:text-white">{label}</span>
          {badge}
        </div>
        {open ? <ChevronUp size={15} className="text-gray-400" /> : <ChevronDown size={15} className="text-gray-400" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-gray-50 dark:border-white/5 pt-4">{children}</div>}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all" />
  )
}

function SaveBtn({ saving, onClick }: { saving: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} disabled={saving}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60"
      style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
      {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
      Save
    </button>
  )
}

// ── WhatsApp section ───────────────────────────────────────────────────────────

function WhatsAppSection({ toast }: { toast: (m: string) => void }) {
  const API = '/api-proxy'
  function authH() {
    const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
  }

  const [status,    setStatus]  = useState<{ connected: boolean; pending?: boolean; phone?: string | null } | null>(null)
  const [phone,     setPhone]   = useState('')
  const [saving,    setSaving]  = useState(false)
  const [submitted, setSubmitted] = useState(false)

  useEffect(() => {
    fetch(`${API}/ai-suite/connections/whatsapp`, { headers: authH() })
      .then(r => r.json()).then(setStatus).catch(() => {})
  }, [])

  async function submit() {
    if (!phone) return toast('Please enter your WhatsApp phone number')
    setSaving(true)
    try {
      await fetch(`${API}/ai-suite/connections/whatsapp/simple`, {
        method: 'PATCH', headers: authH(), body: JSON.stringify({ phone }),
      })
      setSubmitted(true)
      setPhone('')
    } catch { toast('Failed to submit') } finally { setSaving(false) }
  }

  const isPending  = submitted || status?.pending
  const isConnected = status?.connected

  return (
    <SectionCard expandedDefault
      icon={<div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#25D36618' }}><MessageSquare size={16} style={{ color: '#25D366' }} /></div>}
      label="WhatsApp"
      badge={status && <StatusBadge connected={!!isConnected} />}>
      <div className="space-y-4">
        {isConnected ? (
          <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 size={14} />
            <span>WhatsApp is connected and active.</span>
          </div>
        ) : isPending ? (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-700/40">
            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Request received!</p>
            <p className="text-sm text-amber-600 dark:text-amber-300/80 mt-1">Our team will set this up for you. You'll receive a confirmation within 24 hours.</p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 dark:text-white/50">Enter your clinic's WhatsApp number and our team will connect it for you.</p>
            <Field label="WhatsApp Phone Number">
              <Input value={phone} onChange={setPhone} placeholder="+256741087667" />
            </Field>
            <button onClick={submit} disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <MessageSquare size={13} />}
              Request Setup
            </button>
          </>
        )}
      </div>
    </SectionCard>
  )
}

// ── Facebook section ───────────────────────────────────────────────────────────

function FacebookSection({ toast }: { toast: (m: string) => void }) {
  const API = '/api-proxy'
  function authH() {
    const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    return { Authorization: `Bearer ${t}` }
  }

  const [status,       setStatus]       = useState<{ connected: boolean; pageName: string | null } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    fetch(`${API}/ai-suite/connections/facebook/status`, { headers: authH() })
      .then(r => r.json()).then(setStatus).catch(() => {})
  }, [])

  function connectFacebook() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : ''
    const w = window.open(`${API}/ai-suite/connections/facebook/oauth?token=${token}`, '_blank', 'width=600,height=700')
    const t = setInterval(() => {
      if (w?.closed) {
        clearInterval(t)
        fetch(`${API}/ai-suite/connections/facebook/status`, { headers: authH() })
          .then(r => r.json()).then(d => { setStatus(d); if (d.connected) toast('Facebook connected') }).catch(() => {})
      }
    }, 1000)
  }

  async function disconnect() {
    setDisconnecting(true)
    try {
      await fetch(`${API}/ai-suite/connections/facebook`, { method: 'DELETE', headers: authH() })
      setStatus({ connected: false, pageName: null })
      toast('Facebook disconnected')
    } catch { toast('Failed') } finally { setDisconnecting(false) }
  }

  return (
    <SectionCard
      icon={<div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#1877F218' }}><Facebook size={16} style={{ color: '#1877F2' }} /></div>}
      label="Facebook Messenger"
      badge={status && <StatusBadge connected={status.connected} />}>
      <div className="space-y-4">
        {status?.connected ? (
          <>
            <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 size={14} />
              <span>Connected to page: <span className="font-semibold">{status.pageName}</span></span>
            </div>
            <button onClick={disconnect} disabled={disconnecting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 hover:bg-red-100 transition-colors disabled:opacity-60">
              {disconnecting ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
              Disconnect
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-400 dark:text-white/40">Connect your Facebook Page to receive and send Messenger messages through Sarah.</p>
            <button onClick={connectFacebook}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
              style={{ background: '#1877F2' }}>
              <Facebook size={14} /> Connect with Facebook
              <ExternalLink size={12} className="opacity-70" />
            </button>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

// ── Instagram section ──────────────────────────────────────────────────────────

function InstagramSection({ toast }: { toast: (m: string) => void }) {
  const API = '/api-proxy'
  function authH() {
    const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    return { Authorization: `Bearer ${t}` }
  }

  const [status,        setStatus]        = useState<{ connected: boolean; accountName: string | null } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    fetch(`${API}/ai-suite/connections/instagram/status`, { headers: authH() })
      .then(r => r.json()).then(setStatus).catch(() => {})
  }, [])

  function connectInstagram() {
    const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : ''
    const w = window.open(`${API}/ai-suite/connections/instagram/oauth?token=${token}`, '_blank', 'width=600,height=700')
    const t = setInterval(() => {
      if (w?.closed) {
        clearInterval(t)
        fetch(`${API}/ai-suite/connections/instagram/status`, { headers: authH() })
          .then(r => r.json()).then(d => { setStatus(d); if (d.connected) toast('Instagram connected') }).catch(() => {})
      }
    }, 1000)
  }

  async function disconnect() {
    setDisconnecting(true)
    try {
      await fetch(`${API}/ai-suite/connections/instagram`, { method: 'DELETE', headers: authH() })
      setStatus({ connected: false, accountName: null })
      toast('Instagram disconnected')
    } catch { toast('Failed') } finally { setDisconnecting(false) }
  }

  return (
    <SectionCard
      icon={<div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: '#E4405F18' }}><Instagram size={16} style={{ color: '#E4405F' }} /></div>}
      label="Instagram DMs"
      badge={status && <StatusBadge connected={status.connected} />}>
      <div className="space-y-4">
        {status?.connected ? (
          <>
            <div className="flex items-center gap-2 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 size={14} />
              <span>Connected: <span className="font-semibold">{status.accountName}</span></span>
            </div>
            <button onClick={disconnect} disabled={disconnecting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/40 hover:bg-red-100 transition-colors disabled:opacity-60">
              {disconnecting ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
              Disconnect
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-400 dark:text-white/40">Connect your Instagram Business account to manage DMs through Sarah.</p>
            <button onClick={connectInstagram}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg,#E4405F,#833AB4,#F77737)' }}>
              <Instagram size={14} /> Connect with Instagram
              <ExternalLink size={12} className="opacity-70" />
            </button>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

// ── SMS section ────────────────────────────────────────────────────────────────

function SmsSection({ toast }: { toast: (m: string) => void }) {
  const API = '/api-proxy'
  function authH() {
    const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }
  }

  const [connected, setConnected] = useState(false)
  const [apiKey,    setApiKey]    = useState('')
  const [username,  setUsername]  = useState('')
  const [saving,    setSaving]    = useState(false)

  useEffect(() => {
    fetch(`${API}/ai-suite/connections/sms`, { headers: authH() })
      .then(r => r.json())
      .then(d => { setConnected(d.connected); setUsername(d.username || '') })
      .catch(() => {})
  }, [])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`${API}/ai-suite/connections/sms`, {
        method: 'PATCH', headers: authH(),
        body: JSON.stringify({ ...(apiKey && { apiKey }), username }),
      })
      const d = await res.json()
      setConnected(d.connected)
      setApiKey('')
      toast("SMS settings saved")
    } catch { toast('Failed to save') } finally { setSaving(false) }
  }

  return (
    <SectionCard
      icon={<div className="w-8 h-8 rounded-xl flex items-center justify-center bg-cyan-50 dark:bg-cyan-900/20"><Phone size={16} className="text-cyan-500" /></div>}
      label="SMS (Africa's Talking)"
      badge={<StatusBadge connected={connected} />}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="API Key">
            <Input value={apiKey} onChange={setApiKey} placeholder="Leave blank to keep existing" type="password" />
          </Field>
          <Field label="Username">
            <Input value={username} onChange={setUsername} placeholder="Your AT username" />
          </Field>
        </div>
        <SaveBtn saving={saving} onClick={save} />
      </div>
    </SectionCard>
  )
}

// ── SIP Trunks section ─────────────────────────────────────────────────────────

const BLANK_TRUNK: Omit<SipTrunk, 'id'> = {
  name: '', host: '', port: 5060, netmask: 32, protocol: 'UDP',
  allowInbound: true, allowOutbound: true, optionsPing: false,
  username: '', password: '', useSipRegistration: false,
  leadingPlus: false, techPrefix: '', sipDiversionHeader: '',
}

function SipTrunksSection({ toast }: { toast: (m: string) => void }) {
  const API = '/api-proxy'
  function authH(json = false) {
    const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    const h: Record<string, string> = { Authorization: `Bearer ${t}` }
    if (json) h['Content-Type'] = 'application/json'
    return h
  }

  const [trunks,  setTrunks]  = useState<SipTrunk[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<SipTrunk | null>(null)
  const [adding,  setAdding]  = useState(false)
  const [form,    setForm]    = useState<typeof BLANK_TRUNK>({ ...BLANK_TRUNK })
  const [saving,  setSaving]  = useState(false)

  useEffect(() => {
    fetch(`${API}/ai-suite/connections/sip-trunks`, { headers: authH() })
      .then(r => r.json()).then(setTrunks).catch(() => {}).finally(() => setLoading(false))
  }, [])

  function startEdit(t: SipTrunk) {
    setEditing(t)
    setForm({ name: t.name, host: t.host, port: t.port, netmask: t.netmask, protocol: t.protocol,
      allowInbound: t.allowInbound, allowOutbound: t.allowOutbound, optionsPing: t.optionsPing,
      username: t.username || '', password: t.password || '', useSipRegistration: t.useSipRegistration,
      leadingPlus: t.leadingPlus, techPrefix: t.techPrefix || '', sipDiversionHeader: t.sipDiversionHeader || '',
    })
    setAdding(true)
  }

  function startAdd() {
    setEditing(null)
    setForm({ ...BLANK_TRUNK })
    setAdding(true)
  }

  async function save() {
    if (!form.name || !form.host) return toast('Name and host are required')
    setSaving(true)
    try {
      if (editing) {
        const res = await fetch(`${API}/ai-suite/connections/sip-trunks/${editing.id}`, {
          method: 'PATCH', headers: authH(true), body: JSON.stringify(form),
        })
        const updated = await res.json()
        setTrunks(ts => ts.map(t => t.id === editing.id ? updated : t))
        toast('Trunk updated')
      } else {
        const res = await fetch(`${API}/ai-suite/connections/sip-trunks`, {
          method: 'POST', headers: authH(true), body: JSON.stringify(form),
        })
        const created = await res.json()
        setTrunks(ts => [...ts, created])
        toast('Trunk added')
      }
      setAdding(false); setEditing(null)
    } catch { toast('Failed to save') } finally { setSaving(false) }
  }

  async function remove(id: string) {
    if (!confirm('Delete this SIP trunk?')) return
    await fetch(`${API}/ai-suite/connections/sip-trunks/${id}`, { method: 'DELETE', headers: authH() })
    setTrunks(ts => ts.filter(t => t.id !== id))
    toast('Trunk deleted')
  }

  function setF(k: keyof typeof BLANK_TRUNK, v: any) {
    setForm(f => ({ ...f, [k]: v }))
  }

  return (
    <SectionCard
      icon={<div className="w-8 h-8 rounded-xl flex items-center justify-center bg-purple-50 dark:bg-purple-900/20"><Mic2 size={16} className="text-purple-500" /></div>}
      label="SIP Trunks (Voice)">
      <div className="space-y-4">
        {loading ? (
          <Loader2 size={16} className="animate-spin text-gray-400" />
        ) : trunks.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-white/40">No SIP trunks configured yet.</p>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-white/5">
            {trunks.map(t => (
              <div key={t.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white">{t.name}</p>
                  <p className="text-xs text-gray-400 dark:text-white/40 font-mono">{t.host}:{t.port} · {t.protocol}</p>
                  <div className="flex gap-2 mt-1">
                    {t.allowInbound  && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">Inbound</span>}
                    {t.allowOutbound && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">Outbound</span>}
                    {t.useSipRegistration && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">Registered</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => startEdit(t)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/10 transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-white/70">
                    <Edit3 size={13} />
                  </button>
                  <button onClick={() => remove(t.id)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-gray-400 hover:text-red-500">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!adding ? (
          <button onClick={startAdd}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold text-gray-600 dark:text-white/70 border border-dashed border-gray-300 dark:border-white/20 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
            <Plus size={13} /> Add SIP Trunk
          </button>
        ) : (
          <div className="bg-gray-50 dark:bg-white/5 rounded-2xl border border-gray-200 dark:border-white/10 p-4 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-gray-800 dark:text-white">{editing ? 'Edit' : 'New'} SIP Trunk</p>
              <button onClick={() => { setAdding(false); setEditing(null) }} className="text-gray-400 hover:text-gray-600 dark:hover:text-white transition-colors"><X size={16} /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name"><Input value={form.name} onChange={v => setF('name', v)} placeholder="Roke Telecom" /></Field>
              <Field label="Host"><Input value={form.host} onChange={v => setF('host', v)} placeholder="41.191.76.76" /></Field>
              <Field label="Port"><Input value={String(form.port)} onChange={v => setF('port', parseInt(v) || 5060)} placeholder="5060" /></Field>
              <Field label="Protocol">
                <select value={form.protocol} onChange={e => setF('protocol', e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500">
                  {['UDP', 'TCP', 'TLS'].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Username (optional)"><Input value={form.username || ''} onChange={v => setF('username', v)} placeholder="trunk_user" /></Field>
              <Field label="Password (optional)"><Input value={form.password || ''} onChange={v => setF('password', v)} placeholder="••••••••" type="password" /></Field>
            </div>
            <div className="flex flex-wrap gap-4 py-1">
              {([
                ['allowInbound',       'Allow Inbound'],
                ['allowOutbound',      'Allow Outbound'],
                ['useSipRegistration', 'SIP Registration'],
                ['leadingPlus',        'Leading +'],
                ['optionsPing',        'OPTIONS Ping'],
              ] as [keyof typeof BLANK_TRUNK, string][]).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-xs text-gray-600 dark:text-white/60 cursor-pointer">
                  <input type="checkbox" checked={!!form[k]} onChange={e => setF(k, e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-cyan-500" />
                  {label}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tech Prefix"><Input value={form.techPrefix || ''} onChange={v => setF('techPrefix', v)} placeholder="Optional" /></Field>
              <Field label="SIP Diversion Header"><Input value={form.sipDiversionHeader || ''} onChange={v => setF('sipDiversionHeader', v)} placeholder="Optional" /></Field>
            </div>
            <SaveBtn saving={saving} onClick={save} />
          </div>
        )}
      </div>
    </SectionCard>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ConnectionsPage() {
  const [toast, setToast] = useState<string | null>(null)
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-gray-900 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl">
          {toast}
        </div>
      )}

      <div>
        <h1 className="text-xl font-black text-gray-800 dark:text-white">Connections</h1>
        <p className="text-sm text-gray-400 mt-0.5">Connect Sarah to your messaging channels</p>
      </div>

      <WhatsAppSection  toast={showToast} />
      <FacebookSection  toast={showToast} />
      <InstagramSection toast={showToast} />
      <SmsSection       toast={showToast} />
      <SipTrunksSection toast={showToast} />
    </div>
  )
}
