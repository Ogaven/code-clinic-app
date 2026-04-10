'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import {
  TrendingUp, TrendingDown, Users, Calendar, DollarSign,
  ChevronRight, Activity, Clock, AlertCircle,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, BarChart, Bar,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { cn, formatUGX, getGreeting } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'

// ── Analog Clock ────────────────────────────────────────────────────────────
function AnalogClock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const kla  = new Date(time.toLocaleString('en-US', { timeZone: 'Africa/Kampala' }))
  const h    = kla.getHours() % 12
  const m    = kla.getMinutes()
  const s    = kla.getSeconds()
  const hDeg = h / 12 * 360 + m / 60 * 30
  const mDeg = m / 60 * 360 + s / 60 * 6
  const sDeg = s / 60 * 360
  const cx = 44, cy = 44, r = 40
  const hand = (deg: number, len: number) => ({
    x2: cx + Math.cos((deg - 90) * Math.PI / 180) * len,
    y2: cy + Math.sin((deg - 90) * Math.PI / 180) * len,
  })
  const timeStr = kla.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit', hour12: true })
  const dateStr = kla.toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'long', year: '2-digit' })
    .replace(',', '').replace(/(\d+) (\w+) (\d+)/, '$1 $2 \'$3')
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle cx={cx} cy={cy} r={r} fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5"/>
        <circle cx={cx} cy={cy} r={r-4} fill="rgba(255,255,255,0.04)"/>
        {Array.from({ length: 12 }).map((_, i) => {
          const a  = (i / 12) * 360 - 90
          const x1 = cx + Math.cos(a * Math.PI/180) * (r - 6)
          const y1 = cy + Math.sin(a * Math.PI/180) * (r - 6)
          const x2 = cx + Math.cos(a * Math.PI/180) * (r - 2)
          const y2 = cy + Math.sin(a * Math.PI/180) * (r - 2)
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.45)" strokeWidth={i % 3 === 0 ? 2 : 1} strokeLinecap="round"/>
        })}
        <line x1={cx} y1={cy} x2={hand(hDeg,22).x2} y2={hand(hDeg,22).y2} stroke="white" strokeWidth="3" strokeLinecap="round"/>
        <line x1={cx} y1={cy} x2={hand(mDeg,30).x2} y2={hand(mDeg,30).y2} stroke="#29ABE2" strokeWidth="2" strokeLinecap="round"/>
        <line x1={cx} y1={cy} x2={hand(sDeg,34).x2} y2={hand(sDeg,34).y2} stroke="#EC4899" strokeWidth="1.2" strokeLinecap="round"/>
        <circle cx={cx} cy={cy} r="3.5" fill="white"/>
        <circle cx={cx} cy={cy} r="1.5" fill="#29ABE2"/>
      </svg>
      <p className="text-white/90 text-[11px] font-bold tracking-wide">{timeStr} EAT</p>
      <p className="text-blue-200 text-[9px] font-semibold tracking-wider uppercase">{dateStr}</p>
    </div>
  )
}

// ── Data ────────────────────────────────────────────────────────────────────
const revenueData = [
  { month: 'Nov', revenue: 18500000, expenses: 9200000 },
  { month: 'Dec', revenue: 22000000, expenses: 10800000 },
  { month: 'Jan', revenue: 19800000, expenses: 9500000 },
  { month: 'Feb', revenue: 24500000, expenses: 11200000 },
  { month: 'Mar', revenue: 26800000, expenses: 12100000 },
  { month: 'Apr', revenue: 31232000, expenses: 13400000 },
]

const serviceData = [
  { name: 'Check & Treat',   value: 28, color: '#29ABE2' },
  { name: 'Whitening',       value: 18, color: '#1A237E' },
  { name: 'Root Canal',      value: 15, color: '#9B59B6' },
  { name: 'Orthodontics',    value: 22, color: '#E8A838' },
  { name: 'Extraction',      value: 17, color: '#2ECC71' },
]

const debtors = [
  { name: 'Michael Okello',   amount: 850000,  days: 14, color: '#EF4444' },
  { name: 'Patricia Nabirye', amount: 650000,  days: 8,  color: '#F59E0B' },
  { name: 'John Musisi',      amount: 1200000, days: 21, color: '#EF4444' },
  { name: 'Irene Nakwagala',  amount: 380000,  days: 5,  color: '#10B981' },
  { name: 'George Ssali',     amount: 560000,  days: 11, color: '#F59E0B' },
]

const patientList = [
  { id: '1', firstName: 'Sarah',    lastName: 'Namukasa', service: 'Teeth Whitening',    status: 'CONFIRMED',  doctor: 'Dr. Mugabe',  time: '09:00', colour: '#4A90D9' },
  { id: '2', firstName: 'Robert',   lastName: 'Ssempala', service: 'Root Canal',          status: 'COMPLETED',  doctor: 'Dr. Kissa',   time: '09:30', colour: '#E8A838' },
  { id: '3', firstName: 'Grace',    lastName: 'Apio',     service: 'Check & Treat',       status: 'PENDING',    doctor: 'Dr. Arnold',  time: '10:00', colour: '#2ECC71' },
  { id: '4', firstName: 'Michael',  lastName: 'Okello',   service: 'Dental Crown',        status: 'CONFIRMED',  doctor: 'Dr. Mugabe',  time: '11:00', colour: '#9B59B6' },
  { id: '5', firstName: 'Patience', lastName: 'Nakato',   service: 'Periodontal Therapy', status: 'PENDING',    doctor: 'Dr. Babirye', time: '14:00', colour: '#E74C3C' },
  { id: '6', firstName: 'James',    lastName: 'Otieno',   service: 'Orthodontic Consult', status: 'CONFIRMED',  doctor: 'Dr. Kissa',   time: '14:30', colour: '#1ABC9C' },
]

const upcoming = [
  { time: '15:00', patient: 'Amina Nakigozi',  service: 'Myobrace Treatment', doctor: 'Dr. Arnold',  colour: '#9B59B6' },
  { time: '15:30', patient: 'David Musoke',    service: 'Tooth Extraction',   doctor: 'Dr. Kutesa',  colour: '#1ABC9C' },
  { time: '16:00', patient: 'Lydia Atim',      service: 'Dental Filling',     doctor: 'Dr. Joel',    colour: '#3498DB' },
  { time: '16:30', patient: 'Brian Semakula',  service: 'Review Check Up',    doctor: 'Dr. Faith',   colour: '#F39C12' },
]

const doctorStats = [
  { name: 'Dr. Mugabe',  patients: 8, colour: '#4A90D9' },
  { name: 'Dr. Kissa',   patients: 6, colour: '#E8A838' },
  { name: 'Dr. Arnold',  patients: 5, colour: '#9B59B6' },
  { name: 'Dr. Babirye', patients: 5, colour: '#E74C3C' },
]

const statusCfg: Record<string, { label: string; bg: string; text: string }> = {
  CONFIRMED: { label: 'Confirmed', bg: '#DBEAFE', text: '#2563EB' },
  PENDING:   { label: 'Pending',   bg: '#FEF3C7', text: '#D97706' },
  COMPLETED: { label: 'Completed', bg: '#D1FAE5', text: '#059669' },
  CANCELLED: { label: 'Cancelled', bg: '#FEE2E2', text: '#DC2626' },
}

// ── Weather Widget ──────────────────────────────────────────────────────────
function WeatherWidget() {
  const [time] = useState(new Date())
  const hour = new Date(time.toLocaleString('en-US', { timeZone: 'Africa/Kampala' })).getHours()
  const isNight = hour < 6 || hour >= 20
  const icon = isNight ? '🌙' : hour < 10 ? '🌤️' : '⛅'
  return (
    <div className="rounded-2xl p-3 text-white overflow-hidden relative"
      style={{ background: 'linear-gradient(135deg,#0d47a1 0%,#1976D2 60%,#29ABE2 100%)', boxShadow:'0 8px 24px rgba(13,71,161,0.35)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[9px] font-bold uppercase tracking-widest text-blue-200">Kampala Weather</p>
        <span className="text-[9px] text-blue-300 font-semibold">Live</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-3xl leading-none">{icon}</div>
        <div>
          <p className="text-2xl font-black leading-none">28°C</p>
          <p className="text-[10px] text-blue-200 font-semibold mt-0.5">Partly Cloudy</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-[9px] text-blue-200">High 31° / Low 21°</p>
          <p className="text-[9px] text-blue-300 mt-0.5">Kampala, UG</p>
        </div>
      </div>
      <div className="flex gap-3 mt-2 text-[9px] text-blue-300 font-semibold border-t border-blue-400/30 pt-2">
        <span>💧 72% humidity</span>
        <span>💨 12 km/h NE</span>
        <span>🌅 06:28 rise</span>
      </div>
    </div>
  )
}

// ── Mini Calendar ───────────────────────────────────────────────────────────
function MiniCalendar() {
  const today = new Date()
  const year  = today.getFullYear()
  const month = today.getMonth()
  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days   = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const blanks = Array.from({ length: firstDay }, (_, i) => i)
  const booked = [3, 7, 10, 14, 17, 21, 24, 28]
  const monthName = today.toLocaleDateString('en-UG', { month: 'long', year: 'numeric', timeZone: 'Africa/Kampala' })
  return (
    <div>
      <p className="text-xs font-bold text-clinic-navy dark:text-white mb-3 text-center">{monthName}</p>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {['S','M','T','W','T','F','S'].map((d, i) => (
          <div key={i} className="text-center text-[10px] font-semibold text-gray-400 py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {blanks.map(i => <div key={`b${i}`} />)}
        {days.map(d => {
          const isToday = d === today.getDate()
          const hasAppt = booked.includes(d)
          return (
            <div key={d} className={cn(
              'relative h-7 flex items-center justify-center rounded-lg text-xs font-medium cursor-pointer transition-all',
              isToday ? 'text-white font-bold shadow-md' : hasAppt ? 'text-clinic-blue hover:bg-blue-50 dark:text-cyan-400 dark:hover:bg-white/10' : 'text-gray-400 dark:text-white/30 hover:bg-gray-50 dark:hover:bg-white/5',
            )} style={isToday ? { background: 'linear-gradient(135deg, #1A237E, #29ABE2)' } : {}}>
              {d}
              {hasAppt && !isToday && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-clinic-blue" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Recharts custom tooltips ────────────────────────────────────────────────
function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-3 text-xs animate-fade-in-up">
      <p className="font-bold text-clinic-navy mb-2">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-500">{p.name}:</span>
          <span className="font-bold text-gray-800">{formatUGX(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0]
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-3 text-xs animate-fade-in-up">
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full" style={{ background: p.payload.color }} />
        <span className="font-bold text-clinic-navy">{p.name}</span>
      </div>
      <p className="text-gray-500 mt-1">{p.value}% of appointments</p>
    </div>
  )
}

// ── Main Dashboard ──────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [user, setUser] = useState<any>(null)
  const [now,  setNow]  = useState(new Date())

  useEffect(() => {
    const stored = localStorage.getItem('cc_user')
    if (stored) setUser(JSON.parse(stored))
    const tick = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(tick)
  }, [])

  const greeting     = getGreeting()
  const name         = user ? user.firstName : 'Steven'
  const isDoctor     = user?.role === 'DOCTOR'
  const displayName  = isDoctor ? `Dr. ${name}` : name

  const dateStr = now.toLocaleDateString('en-UG', {
    timeZone: 'Africa/Kampala', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="space-y-3 animate-fade-in">

      {/* ── TOP ROW: greeting + clock centred + dental40 right ── */}
      <div className="relative flex items-end gap-4" style={{ marginBottom: -50 }}>
        <div className="flex-1 pb-3">
          <h2 className="text-clinic-navy dark:text-white text-xl font-bold leading-tight" style={{ fontFamily: 'Plus Jakarta Sans' }}>
            {greeting}, {displayName} 👋
          </h2>
          <p className="text-gray-400 dark:text-blue-300 text-xs mt-0.5">Here&apos;s what&apos;s happening at Code Clinic today.</p>
        </div>
        <div className="flex-shrink-0 rounded-2xl px-5 py-4 shadow-2xl"
          style={{
            background: 'linear-gradient(135deg,#1A237E,#0d47a1)',
            boxShadow: '0 12px 40px rgba(26,35,126,0.4)',
            position: 'absolute', left: '50%', bottom: 0, transform: 'translateX(-50%)', zIndex: 5,
          }}>
          <AnalogClock />
        </div>
        <div className="flex-shrink-0 pointer-events-none select-none" style={{ width: 190 }}>
          <Image src="/dental40.png" alt="Dental" width={190} height={170} priority
            style={{ objectFit:'contain', objectPosition:'bottom', filter:'drop-shadow(0 10px 32px rgba(41,171,226,0.4))', display:'block', width:'100%', height:'auto' }}/>
        </div>
      </div>

      {/* ── KPI CARDS ── */}
      <div className="grid grid-cols-3 gap-3" style={{ paddingTop: 58 }}>
        {[
          { title: "Today's Appointments", value: '24',        sub: '5 pending', trend: { v: 12, up: true },  icon: Calendar,    color: '#29ABE2', bg: 'linear-gradient(135deg,#E0F7FF,#BDEFFF)', cardClass: 'stat-card-cyan' },
          { title: 'Monthly Revenue',       value: 'UGX 31.2M', sub: '+8% vs last month', trend: { v: 8, up: true }, icon: DollarSign, color: '#059669', bg: 'linear-gradient(135deg,#D1FAE5,#A7F3D0)', cardClass: 'stat-card-green' },
          { title: 'Active Patients',       value: '790',       sub: '62 new this month', trend: { v: 5, up: true }, icon: Users,      color: '#7C3AED', bg: 'linear-gradient(135deg,#EDE9FE,#DDD6FE)', cardClass: 'stat-card-purple' },
        ].map((k, i) => (
          <div key={i} className={cn('bg-white rounded-2xl p-4 shadow-sm border border-gray-100 hover:shadow-md transition-all', k.cardClass)}>
            <div className="flex items-start justify-between mb-2">
              <p className="text-[10px] font-semibold text-gray-400 dark:text-white/60 uppercase tracking-wide leading-tight">{k.title}</p>
              <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: k.bg }}>
                <k.icon size={15} style={{ color: k.color }} />
              </div>
            </div>
            <p className="text-xl font-bold text-clinic-navy dark:text-white">{k.value}</p>
            <div className={cn('flex items-center gap-1 text-[10px] font-semibold mt-1', k.trend.up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500')}>
              {k.trend.up ? <TrendingUp size={10}/> : <TrendingDown size={10}/>} {k.sub}
            </div>
          </div>
        ))}
      </div>

      {/* ── MAIN 2-COL ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">

        {/* LEFT 2/3 */}
        <div className="xl:col-span-2 space-y-3">

          {/* Revenue chart + charts row */}
          <div className="grid grid-cols-2 gap-3">

            {/* Revenue area */}
            <div className="bg-white dark:bg-white/5 rounded-2xl shadow-sm border border-gray-100 dark:border-white/10 p-4 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 dark:text-white/50 uppercase tracking-wide">Revenue</p>
                  <p className="text-base font-bold text-clinic-navy dark:text-white">UGX 31.2M <span className="text-xs text-emerald-500">↑ +8%</span></p>
                </div>
                <div className="flex gap-2 text-[9px] text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-clinic-blue inline-block"/>Rev</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-300 inline-block"/>Exp</span>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={100}>
                <AreaChart data={revenueData} margin={{ top:0, right:0, left:0, bottom:0 }}>
                  <defs>
                    <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#29ABE2" stopOpacity={0.25}/>
                      <stop offset="95%" stopColor="#29ABE2" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false}/>
                  <XAxis dataKey="month" tick={{ fontSize:9, fill:'#9CA3AF' }} axisLine={false} tickLine={false}/>
                  <YAxis hide/>
                  <Tooltip content={<RevenueTooltip/>}/>
                  <Area type="monotone" dataKey="revenue" stroke="#29ABE2" strokeWidth={2} fill="url(#rg)" dot={false}/>
                  <Area type="monotone" dataKey="expenses" stroke="#D1D5DB" strokeWidth={1.5} fill="none" dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Service pie + workload */}
            <div className="bg-white dark:bg-white/5 rounded-2xl shadow-sm border border-gray-100 dark:border-white/10 p-4 backdrop-blur-sm">
              <p className="text-[10px] font-semibold text-gray-400 dark:text-white/50 uppercase tracking-wide mb-1">Service Mix & Workload</p>
              <div className="flex gap-2">
                <ResponsiveContainer width="55%" height={100}>
                  <PieChart>
                    <Pie data={serviceData} cx="50%" cy="50%" innerRadius={28} outerRadius={46} dataKey="value" paddingAngle={2}>
                      {serviceData.map((s,i) => <Cell key={i} fill={s.color}/>)}
                    </Pie>
                    <Tooltip content={<PieTooltip/>}/>
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1 pt-1">
                  {doctorStats.map(d => (
                    <div key={d.name} className="flex items-center gap-1.5">
                      <div className="flex-1 bg-gray-100 rounded-full h-1.5 overflow-hidden">
                        <div className="h-1.5 rounded-full" style={{ width:`${d.patients/10*100}%`, background:d.colour }}/>
                      </div>
                      <span className="text-[9px] text-gray-400 w-3 text-right">{d.patients}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
                {serviceData.map(s => (
                  <span key={s.name} className="flex items-center gap-1 text-[9px] text-gray-400">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background:s.color }}/>{s.name}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Patient list — 4 rows only */}
          <div className="bg-white dark:bg-white/5 rounded-2xl shadow-sm border border-gray-100 dark:border-white/10 overflow-hidden backdrop-blur-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50 dark:border-white/8">
              <p className="font-bold text-clinic-navy dark:text-white text-sm" style={{ fontFamily:'Plus Jakarta Sans' }}>Today&apos;s Patients</p>
              <a href="/patients" className="text-[10px] font-semibold text-clinic-blue hover:underline flex items-center gap-1">
                All {patientList.length} <ChevronRight size={11}/>
              </a>
            </div>
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 dark:bg-white/5">
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-white/50 uppercase tracking-wide px-4 py-2">Patient</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-white/50 uppercase tracking-wide px-3 py-2 hidden md:table-cell">Service</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-white/50 uppercase tracking-wide px-3 py-2">Status</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 dark:text-white/50 uppercase tracking-wide px-3 py-2 hidden sm:table-cell">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-white/5">
                {patientList.slice(0, 4).map(p => {
                  const s = statusCfg[p.status]
                  return (
                    <tr key={p.id} className="hover:bg-blue-50/30 dark:hover:bg-white/5 transition-colors cursor-pointer group">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <Avatar firstName={p.firstName} lastName={p.lastName} colour={p.colour} size="sm"/>
                          <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 group-hover:text-clinic-blue dark:group-hover:text-cyan-400 transition-colors">{p.firstName} {p.lastName}</p>
                        </div>
                      </td>
                      <td className="px-3 py-2 hidden md:table-cell"><span className="text-[11px] text-gray-500 dark:text-gray-400">{p.service}</span></td>
                      <td className="px-3 py-2"><span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background:s.bg, color:s.text }}>{s.label}</span></td>
                      <td className="px-3 py-2 hidden sm:table-cell"><span className="text-[11px] text-gray-400 dark:text-gray-500 flex items-center gap-1"><Clock size={10}/>{p.time}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Debt — compact inline list */}
          <div className="bg-white dark:bg-white/5 rounded-2xl shadow-sm border border-red-100 dark:border-red-500/20 overflow-hidden backdrop-blur-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-red-50 dark:border-red-500/20">
              <div className="flex items-center gap-2">
                <AlertCircle size={15} color="#DC2626"/>
                <p className="font-bold text-gray-800 dark:text-white text-sm" style={{ fontFamily:'Plus Jakarta Sans' }}>Outstanding Debt</p>
              </div>
              <p className="text-base font-bold text-red-600">UGX 3.64M</p>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-white/5">
              {debtors.slice(0,3).map((d,i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2 hover:bg-red-50/30 dark:hover:bg-white/5 transition-colors cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Avatar firstName={d.name.split(' ')[0]} lastName={d.name.split(' ')[1]} colour={d.color} size="sm"/>
                    <div>
                      <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{d.name}</p>
                      <p className="text-[9px] text-gray-400 dark:text-gray-500">{d.days}d overdue</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold" style={{ color:d.color }}>UGX {(d.amount/1000).toFixed(0)}K</p>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background:d.days>10?'#FEE2E2':'#FEF3C7', color:d.days>10?'#DC2626':'#D97706' }}>
                      {d.days>10?'CRITICAL':'OVERDUE'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT 1/3 */}
        <div className="space-y-3">

          {/* Weather widget */}
          <WeatherWidget />

          {/* Mini calendar */}
          <div className="bg-white dark:bg-white/5 rounded-2xl shadow-sm border border-gray-100 dark:border-white/10 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="font-bold text-clinic-navy dark:text-white text-sm" style={{ fontFamily:'Plus Jakarta Sans' }}>Schedule</p>
              <a href="/scheduling" className="text-[10px] font-semibold text-clinic-blue hover:underline flex items-center gap-0.5">
                Full view <ChevronRight size={10}/>
              </a>
            </div>
            <MiniCalendar/>
          </div>

          {/* Upcoming — 3 items */}
          <div className="bg-white dark:bg-white/5 rounded-2xl shadow-sm border border-gray-100 dark:border-white/10 overflow-hidden backdrop-blur-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-50 dark:border-white/8">
              <p className="font-bold text-clinic-navy dark:text-white text-sm" style={{ fontFamily:'Plus Jakarta Sans' }}>Upcoming</p>
              <span className="text-[10px] font-semibold text-clinic-blue bg-blue-50 px-2 py-0.5 rounded-full">{upcoming.length} left</span>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-white/5">
              {upcoming.slice(0,3).map((a,i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-blue-50/30 dark:hover:bg-white/5 transition-colors cursor-pointer group">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0" style={{ background:a.colour }}>{a.time}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate group-hover:text-clinic-blue dark:group-hover:text-cyan-400 transition-colors">{a.patient}</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{a.service}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Dentist Notes — 2 notes */}
          <div className="rounded-2xl shadow-sm border border-amber-100 overflow-hidden" style={{ background:'linear-gradient(135deg,#FFFBEB,#FEF3C7)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-amber-100">
              <div className="flex items-center gap-1.5">
                <span>📝</span>
                <p className="font-bold text-amber-800 text-sm" style={{ fontFamily:'Plus Jakarta Sans' }}>Dentist Notes</p>
              </div>
              <span className="text-[10px] text-amber-500 font-semibold">Today</span>
            </div>
            <div className="px-4 py-3 space-y-2">
              {[
                { note:'Robert S. — order crown, Dental Lab (shade A2).', author:'Dr. Kissa', time:'09:35' },
                { note:'Stock low: Composite resin A2, A3. Request order.', author:'Dr. Mugabe', time:'10:10' },
              ].map((n,i) => (
                <div key={i} className="bg-white/60 rounded-xl p-2.5 border border-amber-100">
                  <p className="text-[11px] text-gray-700 leading-relaxed">{n.note}</p>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[9px] font-semibold text-amber-700">{n.author}</span>
                    <span className="text-[9px] text-gray-400">{n.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* dental30 */}
          <div className="flex justify-center">
            <Image src="/dental30.png" alt="Dental" width={220} height={180}
              className="pointer-events-none select-none"
              style={{ objectFit:'contain', filter:'drop-shadow(0 6px 24px rgba(41,171,226,0.3))', width:'100%', height:'auto' }}/>
          </div>

        </div>
      </div>
    </div>
  )
}
