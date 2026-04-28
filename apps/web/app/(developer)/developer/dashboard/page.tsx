'use client'

import { useEffect, useState } from 'react'
import {
  Activity, Database, Users, Shield, Clock, Server,
  GitBranch, Zap, Terminal, AlertCircle, CheckCircle2,
  ArrowUpRight, RefreshCw,
} from 'lucide-react'

interface HealthData {
  status: string; uptime?: number; timestamp?: string
  db?: { status: string }; redis?: { status: string }
  services?: { email: boolean; push: boolean; storage: boolean }
}

function StatCard({ label, value, sub, icon: Icon, colour, trend }: {
  label: string; value: string | number; sub?: string
  icon: any; colour: string; trend?: 'up' | 'ok' | 'warn'
}) {
  return (
    <div className="rounded-xl border p-5 flex flex-col gap-3"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
      <div className="flex items-center justify-between">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: `${colour}18`, border: `1px solid ${colour}30` }}>
          <Icon size={16} style={{ color: colour }} />
        </div>
        {trend && (
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
            trend === 'ok' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
            : trend === 'warn' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20'
            : 'text-sky-400 bg-sky-500/10 border-sky-500/20'
          }`}>
            {trend === 'ok' ? '● ok' : trend === 'warn' ? '⚠ warn' : '↑ up'}
          </span>
        )}
      </div>
      <div>
        <p className="font-mono text-2xl font-bold text-white">{value}</p>
        <p className="font-mono text-xs text-slate-500 mt-0.5">{label}</p>
        {sub && <p className="font-mono text-[10px] text-slate-600 mt-1">{sub}</p>}
      </div>
    </div>
  )
}

function ServiceRow({ name, ok, detail }: { name: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.04] last:border-0">
      <div className="flex items-center gap-2.5">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
        <span className="font-mono text-sm text-slate-300">{name}</span>
      </div>
      <div className="flex items-center gap-2">
        {detail && <span className="font-mono text-[10px] text-slate-600">{detail}</span>}
        <span className={`font-mono text-[10px] font-semibold px-2 py-0.5 rounded-full ${
          ok ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'
        }`}>{ok ? 'up' : 'down'}</span>
      </div>
    </div>
  )
}

export default function DevDashboard() {
  const [health, setHealth]     = useState<HealthData | null>(null)
  const [users, setUsers]       = useState<any[]>([])
  const [refreshing, setRef]    = useState(false)
  const [lastRefresh, setLast]  = useState(new Date())
  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null

  async function load() {
    setRef(true)
    try {
      const [hRes, uRes] = await Promise.allSettled([
        fetch('/api-proxy/health').then(r => r.json()),
        fetch('/api-proxy/employees', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      ])
      if (hRes.status === 'fulfilled') setHealth(hRes.value)
      if (uRes.status === 'fulfilled' && Array.isArray(uRes.value)) setUsers(uRes.value)
    } finally { setRef(false); setLast(new Date()) }
  }

  useEffect(() => { load() }, [])

  const dbOk      = health?.db?.status === 'ok'
  const redisOk   = health?.redis?.status === 'ok' || health?.redis?.status === 'noop'
  const apiOk     = health?.status === 'ok'
  const emailOk   = health?.services?.email ?? false
  const pushOk    = health?.services?.push  ?? false
  const storageOk = health?.services?.storage ?? false

  const uptimeMins = health?.uptime ? Math.floor(health.uptime / 60) : null
  const uptimeStr  = uptimeMins !== null
    ? uptimeMins > 1440
      ? `${Math.floor(uptimeMins / 1440)}d ${Math.floor((uptimeMins % 1440) / 60)}h`
      : uptimeMins > 60
        ? `${Math.floor(uptimeMins / 60)}h ${uptimeMins % 60}m`
        : `${uptimeMins}m`
    : '—'

  const roleCounts = users.reduce((acc: Record<string, number>, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1; return acc
  }, {})

  return (
    <div className="space-y-6 max-w-5xl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-mono text-xl font-bold text-white">Developer Dashboard</h1>
          <p className="font-mono text-xs text-slate-500 mt-1">
            last refreshed: {lastRefresh.toLocaleTimeString()}
          </p>
        </div>
        <button onClick={load} disabled={refreshing}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono text-slate-300 border border-white/10 hover:bg-white/5 transition-all disabled:opacity-50">
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          refresh
        </button>
      </div>

      {/* Stat grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="api_status" value={apiOk ? 'healthy' : 'degraded'} icon={Server}
          colour={apiOk ? '#10b981' : '#ef4444'} trend={apiOk ? 'ok' : 'warn'} />
        <StatCard label="uptime" value={uptimeStr} sub="current session" icon={Clock}
          colour="#29ABE2" trend="up" />
        <StatCard label="total_users" value={users.length} icon={Users}
          colour="#8b5cf6" trend="ok" />
        <StatCard label="database" value={dbOk ? 'connected' : 'error'} icon={Database}
          colour={dbOk ? '#10b981' : '#ef4444'} trend={dbOk ? 'ok' : 'warn'} />
      </div>

      {/* Services + Users */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Services */}
        <div className="rounded-xl border p-5" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Activity size={14} className="text-emerald-400" />
            <h3 className="font-mono text-sm font-semibold text-slate-200">service_health()</h3>
          </div>
          <ServiceRow name="REST API"         ok={apiOk}      detail="Express" />
          <ServiceRow name="PostgreSQL"        ok={dbOk}       detail="Prisma ORM" />
          <ServiceRow name="Redis / Cache"     ok={redisOk}    detail={health?.redis?.status === 'noop' ? 'in-memory fallback' : undefined} />
          <ServiceRow name="Email (SMTP)"      ok={emailOk} />
          <ServiceRow name="Push Notifications" ok={pushOk} />
          <ServiceRow name="File Storage (R2)" ok={storageOk} />
        </div>

        {/* User breakdown */}
        <div className="rounded-xl border p-5" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-2 mb-4">
            <Users size={14} className="text-sky-400" />
            <h3 className="font-mono text-sm font-semibold text-slate-200">user_distribution()</h3>
          </div>
          {(['ADMIN','DOCTOR','RECEPTIONIST','ACCOUNTS','DEVELOPER'] as const).map(role => {
            const count = roleCounts[role] || 0
            const colours: Record<string, string> = {
              ADMIN: '#1A237E', DOCTOR: '#29ABE2', RECEPTIONIST: '#2ECC71',
              ACCOUNTS: '#F39C12', DEVELOPER: '#9B59B6',
            }
            return (
              <div key={role} className="flex items-center gap-3 py-2 border-b border-white/[0.04] last:border-0">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: colours[role] }} />
                <span className="font-mono text-xs text-slate-400 flex-1">{role.toLowerCase()}</span>
                <div className="w-20 h-1.5 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: users.length ? `${(count / users.length) * 100}%` : '0%', background: colours[role] }} />
                </div>
                <span className="font-mono text-xs text-slate-300 w-4 text-right">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Quick actions */}
      <div className="rounded-xl border p-5" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2 mb-4">
          <Terminal size={14} className="text-amber-400" />
          <h3 className="font-mono text-sm font-semibold text-slate-200">quick_actions()</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[
            { label: 'seed_database()',  href: null,                    icon: Database, colour: '#10b981', action: 'seed' },
            { label: 'view_logs()',      href: '/developer/logs',        icon: Activity, colour: '#29ABE2', action: null },
            { label: 'api_explorer()',   href: '/developer/api',         icon: Terminal, colour: '#f59e0b', action: null },
            { label: 'manage_users()',   href: '/developer/users',       icon: Users,    colour: '#8b5cf6', action: null },
          ].map(item => (
            item.action === 'seed' ? (
              <SeedButton key="seed" token={token} />
            ) : (
              <a key={item.label} href={item.href!}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-mono text-slate-300 hover:text-white hover:bg-white/5 transition-all group"
                style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
                <item.icon size={13} style={{ color: item.colour }} />
                <span className="truncate">{item.label}</span>
                <ArrowUpRight size={10} className="ml-auto opacity-0 group-hover:opacity-100 text-slate-500" />
              </a>
            )
          ))}
        </div>
      </div>

      {/* Environment */}
      <div className="rounded-xl border p-5" style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.06)' }}>
        <div className="flex items-center gap-2 mb-4">
          <GitBranch size={14} className="text-purple-400" />
          <h3 className="font-mono text-sm font-semibold text-slate-200">environment()</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { k: 'NODE_ENV',      v: 'production' },
            { k: 'PLATFORM',      v: 'Railway' },
            { k: 'STACK',         v: 'Next.js + Express + Prisma' },
            { k: 'DATABASE',      v: 'PostgreSQL 15' },
            { k: 'CACHE',         v: health?.redis?.status === 'ok' ? 'Redis' : 'In-memory (NoOp)' },
            { k: 'STORAGE',       v: 'Cloudflare R2' },
            { k: 'AI_PROVIDER',   v: 'Anthropic Claude' },
            { k: 'AUTH',          v: 'JWT + Google OAuth' },
          ].map(({ k, v }) => (
            <div key={k} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <span className="font-mono text-[10px] text-emerald-400 flex-shrink-0 w-28">{k}</span>
              <span className="font-mono text-[10px] text-slate-400 truncate">{v}</span>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

function SeedButton({ token }: { token: string | null }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')

  async function run() {
    setState('loading')
    try {
      const res = await fetch('/api-proxy/developer/seed', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      setState(res.ok ? 'ok' : 'err')
      setTimeout(() => setState('idle'), 3000)
    } catch { setState('err'); setTimeout(() => setState('idle'), 3000) }
  }

  const map = {
    idle:    { label: 'seed_database()', colour: '#10b981', icon: Database },
    loading: { label: 'seeding...',      colour: '#f59e0b', icon: RefreshCw },
    ok:      { label: '✓ seeded!',       colour: '#10b981', icon: CheckCircle2 },
    err:     { label: '✗ failed',        colour: '#ef4444', icon: AlertCircle },
  }
  const { label, colour, icon: Icon } = map[state]

  return (
    <button onClick={run} disabled={state === 'loading'}
      className="flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-mono text-slate-300 hover:text-white hover:bg-white/5 transition-all disabled:opacity-60"
      style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
      <Icon size={13} style={{ color: colour }} className={state === 'loading' ? 'animate-spin' : ''} />
      <span className="truncate">{label}</span>
    </button>
  )
}
