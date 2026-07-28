'use client'

import { useEffect, useState } from 'react'
import { Bot, Phone, AlertTriangle, Loader2, Save, ChevronDown, RefreshCw, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'

// ── Meta WhatsApp Usage Card ──────────────────────────────────────────────────

interface DataPoint { start: number; end: number; volume: number; cost?: number }
interface WabaUsage {
  wabaName: string; phone: string
  daily: DataPoint[]
  thisMonth: { volume: number; cost: number }
  lastMonth: { volume: number; cost: number }
}
interface MetaUsage { uganda: WabaUsage; kenya: WabaUsage; cachedAt: string }

function MiniBarChart({ points }: { points: DataPoint[] }) {
  if (!points.length) return <p className="text-xs text-gray-300 dark:text-white/20 italic">No data</p>
  const max = Math.max(...points.map(p => p.volume), 1)
  return (
    <div className="flex items-end gap-[2px] h-8 w-full">
      {points.map((p, i) => {
        const h = Math.max(2, Math.round((p.volume / max) * 32))
        const d = new Date(p.start * 1000)
        const label = `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}: ${p.volume}`
        return (
          <div key={i} title={label}
            style={{ height: `${h}px`, flex: 1 }}
            className="rounded-sm bg-cyan-400/70 dark:bg-cyan-400/50 hover:bg-cyan-500 transition-colors cursor-default" />
        )
      })}
    </div>
  )
}

function WabaCard({ data, label }: { data: WabaUsage; label: string }) {
  const changeAmt = data.thisMonth.volume - data.lastMonth.volume
  const changePct = data.lastMonth.volume
    ? Math.round((changeAmt / data.lastMonth.volume) * 100)
    : null

  return (
    <div className="bg-gray-50 dark:bg-white/5 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40">{label}</p>
          <p className="text-xs font-bold text-gray-700 dark:text-white mt-0.5">{data.wabaName}</p>
          <p className="text-[10px] text-gray-400 dark:text-white/30">{data.phone}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-black text-gray-800 dark:text-white leading-none">{data.thisMonth.volume.toLocaleString()}</p>
          <p className="text-[10px] text-gray-400 dark:text-white/40 mt-0.5">this month</p>
          {changePct !== null && (
            <p className={cn('text-[10px] font-bold mt-0.5', changeAmt >= 0 ? 'text-emerald-500' : 'text-red-400')}>
              {changeAmt >= 0 ? '+' : ''}{changePct}% vs last mo
            </p>
          )}
        </div>
      </div>

      <MiniBarChart points={data.daily} />

      <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-white/30">
        <span>Last month: <span className="font-bold text-gray-500 dark:text-white/40">{data.lastMonth.volume.toLocaleString()}</span></span>
        {data.thisMonth.cost > 0
          ? <span>Est. cost: <span className="font-bold text-amber-500">${data.thisMonth.cost.toFixed(4)}</span></span>
          : <span className="italic">Cost: $0.00 (free tier)</span>
        }
      </div>
    </div>
  )
}

function WhatsAppUsageCard() {
  const API = '/api-proxy'
  const [usage, setUsage]       = useState<MetaUsage | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  function authH() {
    const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    return { Authorization: `Bearer ${t}` }
  }

  async function load(force = false) {
    force ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const endpoint = force ? `${API}/ai-suite/meta-usage/refresh` : `${API}/ai-suite/meta-usage`
      const res = await fetch(endpoint, {
        method: force ? 'POST' : 'GET',
        headers: authH(),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setUsage(await res.json())
    } catch (e: any) {
      setError('Could not load Meta usage data')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [])

  const cachedAt = usage ? new Date(usage.cachedAt).toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' }) : null

  return (
    <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
            <MessageSquare size={15} className="text-emerald-500" />
          </div>
          <div>
            <span className="text-sm font-bold text-gray-800 dark:text-white">WhatsApp Usage</span>
            {cachedAt && <span className="text-[10px] text-gray-400 dark:text-white/30 ml-2">cached {cachedAt}</span>}
          </div>
        </div>
        <button onClick={() => load(true)} disabled={refreshing || loading}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors disabled:opacity-40">
          <RefreshCw size={13} className={cn('text-gray-400', refreshing && 'animate-spin')} />
        </button>
      </div>

      <div className="border-t border-gray-50 dark:border-white/5 px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={18} className="animate-spin text-cyan-500" />
          </div>
        ) : error ? (
          <p className="text-xs text-red-400 text-center py-4">{error}</p>
        ) : usage ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <WabaCard data={usage.uganda} label="Main Clinic" />
            <WabaCard data={usage.kenya}  label="Kenya (test)" />
          </div>
        ) : null}

        <p className="text-[9px] text-gray-300 dark:text-white/20 mt-3 leading-relaxed">
          Data via Meta Graph API · refreshes every 6 h · Uganda routes through Africa&apos;s Talking (AT) so cost data is not exposed directly · Kenya uses Meta Cloud API, cost $0 = utility messages within service window
        </p>
      </div>
    </div>
  )
}

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
  const API = '/api-proxy'
  function authH(json = false) {
    const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
    const h: Record<string, string> = { Authorization: `Bearer ${t}` }
    if (json) h['Content-Type'] = 'application/json'
    return h
  }

  const [agents, setAgents]             = useState<Agent[]>([])
  const [loading, setLoading]           = useState(true)
  const [toggling, setToggling]         = useState<string | null>(null)
  const [escPhone, setEscPhone]         = useState('')
  const [escTemplate, setEscTpl]        = useState('')
  const [savingEsc, setSavingEsc]       = useState(false)
  const [toast, setToast]               = useState<string | null>(null)
  const [callingEnabled, setCallingEnabled]         = useState(false)
  const [togglingCalling, setTogglingCalling]       = useState(false)

  // Sarah's config
  const [configTab,     setConfigTab]     = useState<'prompt' | 'escalation'>('prompt')
  const [systemPrompt,  setSystemPrompt]  = useState('')
  const [savingPrompt,  setSavingPrompt]  = useState(false)
  const [configOpen,    setConfigOpen]    = useState(true)

  useEffect(() => { fetchAgents(); fetchEscalation(); fetchConfig(); fetchCallingEnabled() }, [])

  async function fetchCallingEnabled() {
    try {
      const res = await fetch(`${API}/ai-suite/agents/calling-enabled`, { headers: authH() })
      if (res.ok) { const d = await res.json(); setCallingEnabled(d.enabled) }
    } catch {}
  }

  async function toggleCallingEnabled() {
    setTogglingCalling(true)
    try {
      const next = !callingEnabled
      const res = await fetch(`${API}/ai-suite/agents/calling-enabled`, {
        method: 'POST', headers: authH(true),
        body: JSON.stringify({ enabled: next }),
      })
      if (res.ok) { setCallingEnabled(next); showToast(next ? 'Calling agents enabled' : 'Calling agents disabled') }
    } catch { showToast('Failed to update') } finally { setTogglingCalling(false) }
  }

  async function fetchAgents() {
    setLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/agents`, { headers: authH() })
      if (res.ok) setAgents(await res.json())
    } catch {} finally { setLoading(false) }
  }

  async function fetchEscalation() {
    try {
      const res = await fetch(`${API}/ai-suite/agents/escalation`, { headers: authH() })
      if (res.ok) {
        const d = await res.json()
        setEscPhone(d.phone || '')
        setEscTpl(d.template || '')
      }
    } catch {}
  }

  async function fetchConfig() {
    try {
      const res = await fetch(`${API}/ai-suite/config`, { headers: authH() })
      if (res.ok) {
        const d = await res.json()
        setSystemPrompt(d.systemPrompt || '')
        if (!escPhone) setEscPhone(d.escalationPhone || '')
      }
    } catch {}
  }

  async function toggleAgent(name: string) {
    setToggling(name)
    try {
      const res = await fetch(`${API}/ai-suite/agents/${name}/toggle`, {
        method: 'POST', headers: authH(),
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
        method: 'POST', headers: authH(true),
        body: JSON.stringify({ phone: escPhone, template: escTemplate }),
      })
      // Also persist escalation phone to AiAgentConfig
      await fetch(`${API}/ai-suite/config`, {
        method: 'PATCH', headers: authH(true),
        body: JSON.stringify({ escalationPhone: escPhone }),
      })
      showToast('Escalation settings saved')
    } catch {} finally { setSavingEsc(false) }
  }

  async function savePrompt() {
    setSavingPrompt(true)
    try {
      await fetch(`${API}/ai-suite/config`, {
        method: 'PATCH', headers: authH(true),
        body: JSON.stringify({ systemPrompt }),
      })
      showToast('Prompt saved — takes effect on next conversation')
    } catch { showToast('Failed to save prompt') } finally { setSavingPrompt(false) }
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

      {/* ── Sarah's Configuration ─────────────────────── */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <button onClick={() => setConfigOpen(o => !o)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-cyan-50 dark:bg-cyan-900/20 flex items-center justify-center text-lg">🤖</div>
            <span className="text-sm font-bold text-gray-800 dark:text-white">Sarah&apos;s Configuration</span>
          </div>
          {configOpen ? <ChevronDown size={15} className="text-gray-400 rotate-180 transition-transform" /> : <ChevronDown size={15} className="text-gray-400 transition-transform" />}
        </button>

        {configOpen && (
          <div className="border-t border-gray-50 dark:border-white/5">
            {/* Tab bar */}
            <div className="flex border-b border-gray-50 dark:border-white/5">
              {(['prompt', 'escalation'] as const).map(tab => (
                <button key={tab} onClick={() => setConfigTab(tab)}
                  className={cn(
                    'px-5 py-3 text-xs font-bold transition-all border-b-2 -mb-px',
                    configTab === tab
                      ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
                      : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-white/60',
                  )}>
                  {tab === 'prompt' ? 'Personality & Prompt' : 'Escalation Settings'}
                </button>
              ))}
            </div>

            <div className="p-5">
              {configTab === 'prompt' ? (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 dark:text-white/40">
                    This is Sarah&apos;s system prompt — the personality, tone, and behaviour instructions she follows in every conversation. Leave blank to use the built-in default.
                  </p>
                  <textarea
                    value={systemPrompt}
                    onChange={e => setSystemPrompt(e.target.value)}
                    rows={10}
                    placeholder="You are Sarah, the patient care assistant for Code Clinic…"
                    className="w-full px-4 py-3 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white resize-y focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all font-mono leading-relaxed"
                  />
                  <button onClick={savePrompt} disabled={savingPrompt}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60"
                    style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
                    {savingPrompt ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    Save Prompt
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-gray-400 dark:text-white/40">
                    When Sarah can&apos;t resolve a conversation, she will alert this WhatsApp number.
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
                    {savingEsc ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    Save Settings
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── WhatsApp Usage ───────────────────────────────── */}
      <WhatsAppUsageCard />

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
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-white/40 flex items-center gap-2">
                <Phone size={10} /> Calling Agents
              </p>
              <div className="flex items-center gap-3">
                <span className={cn(
                  'text-xs font-bold',
                  callingEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400',
                )}>
                  {callingEnabled ? 'Calls ON' : 'Calls OFF'}
                </span>
                <button onClick={toggleCallingEnabled} disabled={togglingCalling}
                  className={cn(
                    'relative w-11 h-[22px] rounded-full transition-all disabled:opacity-60',
                    callingEnabled ? 'bg-emerald-500' : 'bg-red-400',
                  )}>
                  <span className={cn(
                    'absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-all',
                    callingEnabled ? 'left-[23px]' : 'left-[3px]',
                  )} />
                </button>
              </div>
            </div>
            {!callingEnabled && (
              <div className="mb-3 px-4 py-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/30 text-xs text-red-600 dark:text-red-400 font-medium flex items-center gap-2">
                <AlertTriangle size={12} /> All outbound voice calls are currently disabled. Toggle above to re-enable.
              </div>
            )}
            <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
              {calling.map(a => (
                <AgentCard key={a.name} agent={a} toggling={toggling === a.name} onToggle={() => toggleAgent(a.name)} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
