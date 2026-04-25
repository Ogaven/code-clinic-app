'use client'

import { useEffect, useState } from 'react'
import { Bot, Phone, AlertTriangle, Settings, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Agent = { name: string; label: string; description: string; group: string; isActive: boolean }

function AgentCard({ agent, toggling, onToggle }: { agent: Agent; toggling: boolean; onToggle: () => void }) {
  const ICONS: Record<string, string> = {
    booking: '📅', whatsapp: '💬', sms: '📱', facebook: '👥', instagram: '📸',
    website: '🌐', 'reminder-caller': '🔔', 'followup-caller': '💌', 'debt-caller': '💰',
  }
  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 hover:shadow-md transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-900/20 flex items-center justify-center text-xl">
          {ICONS[agent.name] || '🤖'}
        </div>
        <button onClick={onToggle} disabled={toggling}
          className={cn(
            'relative w-11 h-[22px] rounded-full transition-all disabled:opacity-60',
            agent.isActive ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-white/20',
          )}>
          <span className={cn(
            'absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-all',
            agent.isActive ? 'left-[23px]' : 'left-[3px]',
          )} />
        </button>
      </div>
      <h3 className="font-bold text-gray-800 dark:text-white text-sm mb-1">{agent.label}</h3>
      <p className="text-xs text-gray-400 leading-relaxed mb-3">{agent.description}</p>
      <span className={cn(
        'text-[10px] font-bold px-2 py-0.5 rounded-full',
        agent.isActive
          ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
          : 'bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/50',
      )}>
        {agent.isActive ? '● Active' : '○ Paused'}
      </span>
    </div>
  )
}

export default function AgentControlPage() {
  const API   = '/api-proxy'
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const authH = { Authorization: `Bearer ${token}` }

  const [agents, setAgents]         = useState<Agent[]>([])
  const [loading, setLoading]       = useState(true)
  const [toggling, setToggling]     = useState<string | null>(null)
  const [escPhone, setEscPhone]     = useState('')
  const [escTemplate, setEscTpl]    = useState('')
  const [savingEsc, setSavingEsc]   = useState(false)
  const [toast, setToast]           = useState<string | null>(null)

  useEffect(() => { fetchAgents(); fetchEscalation() }, [])

  async function fetchAgents() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/agents`, { headers: authH })
      if (res.ok) setAgents(await res.json())
    } catch {} finally { setLoading(false) }
  }

  async function fetchEscalation() {
    try {
      const res = await fetch(`${API}/ai-suite/agents/escalation`, { headers: authH })
      if (res.ok) {
        const d = await res.json()
        setEscPhone(d.phone || '')
        setEscTpl(d.template || '')
      }
    } catch {}
  }

  async function toggleAgent(name: string) {
    setToggling(name)
    try {
      const res = await fetch(`${API}/ai-suite/agents/${name}/toggle`, {
        method: 'POST', headers: authH,
      })
      if (res.ok) {
        const d = await res.json()
        setAgents(prev => prev.map(a => a.name === name ? { ...a, isActive: d.isActive } : a))
        showToast(`${d.isActive ? 'Activated' : 'Paused'}: ${name}`)
      }
    } catch { showToast('Failed to update agent') } finally { setToggling(null) }
  }

  async function saveEscalation() {
    setSavingEsc(true)
    try {
      await fetch(`${API}/ai-suite/agents/escalation`, {
        method: 'POST', headers: { ...authH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: escPhone, template: escTemplate }),
      })
      showToast('Escalation settings saved')
    } catch {} finally { setSavingEsc(false) }
  }

  async function pauseAll() {
    if (!confirm('Pause ALL AI agents? The clinic will handle conversations manually.')) return
    for (const a of agents.filter(a => a.isActive)) await toggleAgent(a.name)
    showToast('All agents paused')
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const messaging = agents.filter(a => a.group === 'messaging')
  const calling   = agents.filter(a => a.group === 'calling')

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-gray-900 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl animate-fade-in">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black text-gray-800 dark:text-white">Agent Control</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage Sarah's AI agents across all channels</p>
        </div>
        <button onClick={pauseAll}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-bold hover:bg-red-100 transition-colors border border-red-200 dark:border-red-700/40">
          <AlertTriangle size={14} /> Pause All
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-cyan-500" />
        </div>
      ) : (
        <>
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-3 flex items-center gap-2">
              <Bot size={10} /> Messaging Agents
            </p>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              {messaging.map(a => (
                <AgentCard key={a.name} agent={a} toggling={toggling === a.name} onToggle={() => toggleAgent(a.name)} />
              ))}
            </div>
          </div>

          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 mb-3 flex items-center gap-2">
              <Phone size={10} /> Calling Agents
            </p>
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              {calling.map(a => (
                <AgentCard key={a.name} agent={a} toggling={toggling === a.name} onToggle={() => toggleAgent(a.name)} />
              ))}
            </div>
          </div>

          {/* Escalation */}
          <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-4">
            <h2 className="text-sm font-bold text-gray-800 dark:text-white flex items-center gap-2">
              <Settings size={15} className="text-cyan-500" /> Escalation Settings
            </h2>
            <p className="text-xs text-gray-400 dark:text-white/40">
              When the AI can&apos;t resolve a conversation, it will alert this WhatsApp number.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Escalation Phone</label>
                <input value={escPhone} onChange={e => setEscPhone(e.target.value)}
                  placeholder="+256700000000"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Message Template</label>
                <input value={escTemplate} onChange={e => setEscTpl(e.target.value)}
                  placeholder="Hi, patient [name] on [channel] needs your attention"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500" />
              </div>
            </div>
            <button onClick={saveEscalation} disabled={savingEsc}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
              {savingEsc && <Loader2 size={13} className="animate-spin" />}
              Save Settings
            </button>
          </div>
        </>
      )}
    </div>
  )
}
