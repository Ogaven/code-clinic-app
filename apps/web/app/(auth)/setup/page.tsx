'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Eye, EyeOff, Loader2, Mail, Lock, User } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function SetupPage() {
  const router = useRouter()
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', confirm: '' })
  const [showPwd, setShow] = useState(false)
  const [loading, setLoad] = useState(false)
  const [error, setError]  = useState<string | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    setChecking(false)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return }
    setError(null); setLoad(true)
    try {
      const res = await fetch('/api-proxy/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: form.firstName, lastName: form.lastName, email: form.email, password: form.password }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Setup failed.'); return }
      localStorage.setItem('cc_token', data.accessToken)
      localStorage.setItem('cc_user', JSON.stringify(data.user))
      router.push('/dashboard')
    } catch {
      setError('Network error. Please try again.')
    } finally { setLoad(false) }
  }

  if (checking) return (
    <div className="h-screen flex items-center justify-center" style={{ background: 'linear-gradient(150deg,#020818,#0d1b6e)' }}>
      <Loader2 size={32} className="animate-spin text-cyan-400" />
    </div>
  )

  const inp = 'w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none bg-white/8 border border-white/16 text-white placeholder-white/30 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 transition-all'
  const lbl = 'block text-xs font-semibold mb-1.5 text-blue-100'

  return (
    <div className="min-h-screen w-screen flex items-start lg:items-center justify-center px-5 pt-10 pb-8 relative overflow-auto"
      style={{ background: 'linear-gradient(150deg,#020818 0%,#070f3d 35%,#0d1b6e 70%,#1251a8 100%)' }}>

      {/* Blobs */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute rounded-full" style={{ width:600,height:600,background:'radial-gradient(circle,rgba(41,171,226,0.15),transparent)',top:'-200px',left:'-150px' }}/>
        <div className="absolute rounded-full" style={{ width:400,height:400,background:'radial-gradient(circle,rgba(124,58,237,0.12),transparent)',bottom:'-100px',right:'-100px' }}/>
      </div>

      <div className="w-full max-w-[440px] relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <Image src="/logo.png" alt="Code Clinic" width={130} height={46} className="brightness-0 invert mx-auto mb-4"/>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold text-cyan-300 mb-4"
            style={{ background:'rgba(41,171,226,0.15)', border:'1px solid rgba(41,171,226,0.3)' }}>
            First-time setup
          </div>
          <h1 className="text-2xl font-bold text-white mb-1" style={{ fontFamily:'Plus Jakarta Sans' }}>
            Create Admin Account
          </h1>
          <p className="text-sm text-blue-200/70">Set up your Code Clinic management system</p>
        </div>

        <div className="rounded-3xl px-6 py-7"
          style={{ background:'rgba(255,255,255,0.07)', backdropFilter:'blur(32px)', border:'1px solid rgba(255,255,255,0.14)', boxShadow:'0 24px 64px rgba(0,0,0,0.5)' }}>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>First Name</label>
                <div className="relative">
                  <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40"/>
                  <input className={inp} placeholder="Steven" required
                    value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}/>
                </div>
              </div>
              <div>
                <label className={lbl}>Last Name</label>
                <div className="relative">
                  <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40"/>
                  <input className={inp} placeholder="Mugabe" required
                    value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}/>
                </div>
              </div>
            </div>

            <div>
              <label className={lbl}>Email Address</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40"/>
                <input type="email" className={inp} placeholder="admin@codeclinic.ug" required
                  value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}/>
              </div>
            </div>

            <div>
              <label className={lbl}>Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40"/>
                <input type={showPwd ? 'text' : 'password'} className={cn(inp, 'pr-11')} placeholder="Min 6 characters" required minLength={6}
                  value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}/>
                <button type="button" onClick={() => setShow(!showPwd)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70">
                  {showPwd ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              </div>
            </div>

            <div>
              <label className={lbl}>Confirm Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40"/>
                <input type={showPwd ? 'text' : 'password'} className={inp} placeholder="Repeat password" required
                  value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}/>
              </div>
            </div>

            {error && (
              <div className="rounded-xl px-4 py-2.5 text-xs flex items-center gap-2"
                style={{ background:'rgba(239,68,68,0.13)', border:'1px solid rgba(239,68,68,0.3)', color:'#FCA5A5' }}>
                ⚠ {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className={cn('w-full py-3.5 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-all hover:-translate-y-0.5 mt-2', loading && 'opacity-60 cursor-not-allowed')}
              style={{ background: loading ? '#6B7280' : 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow:'0 8px 28px rgba(41,171,226,0.38)' }}>
              {loading && <Loader2 size={16} className="animate-spin"/>}
              {loading ? 'Creating account...' : 'Create Admin Account →'}
            </button>
          </form>

          <p className="text-center text-xs mt-5 text-blue-200/50">
            Already have an account?{' '}
            <Link href="/login" className="text-cyan-400 font-semibold hover:underline">Sign in</Link>
          </p>
        </div>

        <p className="text-center text-[11px] text-white/25 mt-6">©2026 elyrac Ai — Code Clinic Management System</p>
      </div>
    </div>
  )
}
