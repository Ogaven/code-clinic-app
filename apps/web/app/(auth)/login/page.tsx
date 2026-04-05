'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Eye, EyeOff, Loader2, Mail, Lock, Sun, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'

function GoogleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.252 17.64 11.927 17.64 9.2z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}
function AppleIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={color}>
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
    </svg>
  )
}

/* Animated SVG background — stars, lines, arcs */
function AnimatedBg({ dark }: { dark: boolean }) {
  const stroke = dark ? 'rgba(41,171,226,0.09)' : 'rgba(26,35,126,0.06)'
  const dot    = dark ? 'rgba(255,255,255,0.06)' : 'rgba(26,35,126,0.05)'
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
      <style>{`
        @keyframes dash { to { stroke-dashoffset: 0; } }
        @keyframes twinkle { 0%,100%{opacity:.08} 50%{opacity:.22} }
        @keyframes drift { 0%{transform:translateY(0)} 100%{transform:translateY(-8px)} }
        .ln  { stroke-dasharray: 200; stroke-dashoffset: 200; animation: dash 8s ease-in-out infinite alternate; }
        .arc { stroke-dasharray: 400; stroke-dashoffset: 400; animation: dash 12s ease-in-out infinite alternate; }
        .star{ animation: twinkle 3s ease-in-out infinite; }
        .dr  { animation: drift 6s ease-in-out infinite alternate; }
      `}</style>
      {/* Lines */}
      <line className="ln" x1="10%" y1="15%" x2="40%" y2="38%"  stroke={stroke} strokeWidth="1"/>
      <line className="ln" x1="60%" y1="5%"  x2="90%" y2="25%"  stroke={stroke} strokeWidth="0.8" style={{animationDelay:'2s'}}/>
      <line className="ln" x1="5%"  y1="70%" x2="30%" y2="90%"  stroke={stroke} strokeWidth="0.7" style={{animationDelay:'1s'}}/>
      <line className="ln" x1="70%" y1="75%" x2="95%" y2="95%"  stroke={stroke} strokeWidth="1"   style={{animationDelay:'3s'}}/>
      <line className="ln" x1="20%" y1="50%" x2="50%" y2="65%"  stroke={stroke} strokeWidth="0.6" style={{animationDelay:'1.5s'}}/>
      {/* Arcs */}
      <path className="arc" d="M 5 200 Q 200 50 400 180"  fill="none" stroke={stroke} strokeWidth="1"/>
      <path className="arc" d="M 600 0 Q 800 300 700 500" fill="none" stroke={stroke} strokeWidth="0.8" style={{animationDelay:'4s'}}/>
      <path className="arc" d="M 100 500 Q 300 400 500 600" fill="none" stroke={stroke} strokeWidth="0.7" style={{animationDelay:'2s'}}/>
      {/* Stars / dots */}
      {[
        [12,8],[88,12],[25,30],[65,18],[80,40],[15,55],[45,75],[92,60],[55,88],[30,92],[70,5],[8,85],
        [50,20],[35,60],[75,80],[22,45],[58,50],[42,35],[85,70],[18,72]
      ].map(([x,y],i)=>(
        <circle key={i} className="star" cx={`${x}%`} cy={`${y}%`} r="1.5" fill={dot}
          style={{ animationDelay: `${(i * 0.37) % 4}s` }} />
      ))}
      {/* Larger accent dots */}
      {[[10,25],[80,15],[50,90],[90,50],[5,60]].map(([x,y],i)=>(
        <circle key={`b${i}`} className="dr star" cx={`${x}%`} cy={`${y}%`} r="2.5" fill={dot}
          style={{ animationDelay: `${i * 0.8}s` }} />
      ))}
    </svg>
  )
}

/* Floating stat chip */
function Chip({ label, value, style, className }: { label: string; value: string; style?: React.CSSProperties; className?: string }) {
  return (
    <div className={cn('absolute rounded-2xl px-3.5 py-2.5 shadow-xl', className)} style={style}>
      <p className="text-[10px] font-semibold text-blue-100 leading-none mb-1">{label}</p>
      <p className="text-base font-bold text-white leading-none">{value}</p>
    </div>
  )
}

const ROLE_REDIRECTS: Record<string, string> = {
  ACCOUNTS:     '/accounts/dashboard',
  RECEPTIONIST: '/receptionist/dashboard',
  DOCTOR:       '/dashboard',
  ADMIN:        '/dashboard',
  DEVELOPER:    '/dashboard',
}

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail]  = useState('')
  const [pwd, setPwd]      = useState('')
  const [showPwd, setShow] = useState(false)
  const [loading, setLoad] = useState(false)
  const [error, setError]  = useState<string | null>(null)
  const [dark, setDark]    = useState(true)
  const [ready, setReady]  = useState(false)

  useEffect(() => {
    const isDark = localStorage.getItem('cc_theme') !== 'light'
    setDark(isDark)
    document.documentElement.classList.toggle('dark', isDark)
    setTimeout(() => setReady(true), 60)
  }, [])

  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('cc_theme', next ? 'dark' : 'light')
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoad(true)
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pwd }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Invalid credentials.'); return }
      if (data.requiresTwoFactor) { sessionStorage.setItem('cc_temp_token', data.tempToken); router.push('/2fa'); return }
      localStorage.setItem('cc_token', data.accessToken)
      localStorage.setItem('cc_user', JSON.stringify(data.user))
      const redirect = ROLE_REDIRECTS[data.user?.role] || '/dashboard'
      router.push(redirect)
    } catch {
      setError('Network error. Make sure the server is running.')
    } finally { setLoad(false) }
  }

  /* Theme tokens */
  const pageBg   = dark ? 'linear-gradient(150deg,#020818 0%,#070f3d 35%,#0d1b6e 70%,#1251a8 100%)' : 'linear-gradient(150deg,#EBF0FF 0%,#D6E4FF 50%,#E8F4FF 100%)'
  const cardBg   = dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.92)'
  const cardBdr  = dark ? 'rgba(255,255,255,0.14)' : 'rgba(186,212,255,0.9)'
  const cardSh   = dark ? '0 25px 70px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,255,255,0.1)' : '0 25px 70px rgba(26,35,126,0.14)'
  const titleClr = dark ? '#fff'     : '#1A237E'
  const subClr   = dark ? '#93C5FD'  : '#5A6A85'
  const lblClr   = dark ? '#C8D8F0'  : '#374151'
  const inputBg  = dark ? 'rgba(255,255,255,0.07)' : '#F3F7FF'
  const inputBdr = dark ? 'rgba(255,255,255,0.16)' : '#BDD0FF'
  const inputClr = dark ? '#fff'     : '#1A237E'
  const divClr   = dark ? 'rgba(255,255,255,0.1)'  : '#E2E8F0'
  const socialBg = dark ? 'rgba(255,255,255,0.09)' : '#fff'
  const socialBdr= dark ? 'rgba(255,255,255,0.18)' : '#DDE8FF'
  const chipBg   = dark ? 'rgba(13,27,110,0.7)'    : 'rgba(255,255,255,0.85)'
  const chipBdr  = dark ? 'rgba(41,171,226,0.3)'   : 'rgba(26,35,126,0.15)'
  const chipTxt  = dark ? '#E0F0FF'  : '#1A237E'

  return (
    <div className="h-screen w-screen overflow-hidden relative flex"
      style={{ background: pageBg, transition: 'background 0.5s' }}>

      {/* Animated background */}
      <AnimatedBg dark={dark} />

      {/* Blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 1 }}>
        <div className="animate-blob-pulse absolute rounded-full"
          style={{ width:650,height:650,background:`radial-gradient(circle,${dark?'rgba(41,171,226,0.18)':'rgba(41,171,226,0.1)'},transparent)`,top:'-180px',left:'-180px' }}/>
        <div className="animate-blob-pulse delay-2s absolute rounded-full"
          style={{ width:500,height:500,background:`radial-gradient(circle,${dark?'rgba(124,58,237,0.15)':'rgba(124,58,237,0.06)'},transparent)`,bottom:'-130px',right:'-100px' }}/>
      </div>

      {/* Theme toggle */}
      <button onClick={toggleTheme}
        className="absolute top-5 right-5 z-50 w-10 h-10 rounded-xl flex items-center justify-center transition-all hover:scale-110"
        style={{ background:dark?'rgba(255,255,255,0.1)':'rgba(26,35,126,0.08)', border:`1px solid ${dark?'rgba(255,255,255,0.2)':'rgba(26,35,126,0.12)'}` }}>
        {dark ? <Sun size={17} color="#FCD34D"/> : <Moon size={17} color="#1A237E"/>}
      </button>

      {/* ── LEFT 50%: glass login card ── */}
      <div className="flex items-center justify-center p-10 relative z-10" style={{ width:'50%' }}>
        <div className="w-full max-w-[420px] rounded-3xl px-8 py-7"
          style={{
            background: cardBg,
            backdropFilter: 'blur(36px)',
            WebkitBackdropFilter: 'blur(36px)',
            border: `1px solid ${cardBdr}`,
            boxShadow: cardSh,
            opacity: ready ? 1 : 0,
            transform: ready ? 'translateY(0)' : 'translateY(24px)',
            transition: 'opacity 0.6s ease, transform 0.6s ease',
          }}>
          {/* Logo */}
          <div className="mb-6">
            <Image src="/logo.png" alt="Code Clinic" width={130} height={46}
              className={dark ? 'brightness-0 invert' : ''} style={{ transition:'filter 0.3s' }}/>
          </div>

          <h2 className="text-2xl font-bold mb-1" style={{ color:titleClr, fontFamily:'Plus Jakarta Sans' }}>
            Welcome back 👋
          </h2>
          <p className="text-sm mb-6" style={{ color:subClr }}>Sign in to continue to Code Clinic</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color:lblClr }}>Email Address</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color:inputClr, opacity:0.4 }}/>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="admin@codeclinic.ug" required
                  className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-all"
                  style={{ background:inputBg, border:`1.5px solid ${inputBdr}`, color:inputClr, caretColor:'#29ABE2' }}
                  onFocus={e => { e.target.style.borderColor='#29ABE2'; e.target.style.boxShadow='0 0 0 3px rgba(41,171,226,0.15)' }}
                  onBlur={e  => { e.target.style.borderColor=inputBdr;  e.target.style.boxShadow='none' }}/>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold" style={{ color:lblClr }}>Password</label>
                <button type="button" className="text-xs font-semibold hover:underline" style={{ color:'#29ABE2' }}>Forgot Password?</button>
              </div>
              <div className="relative">
                <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color:inputClr, opacity:0.4 }}/>
                <input type={showPwd?'text':'password'} value={pwd} onChange={e => setPwd(e.target.value)}
                  placeholder="••••••••••" required
                  className="w-full pl-10 pr-11 py-3 rounded-xl text-sm outline-none transition-all"
                  style={{ background:inputBg, border:`1.5px solid ${inputBdr}`, color:inputClr }}
                  onFocus={e => { e.target.style.borderColor='#29ABE2'; e.target.style.boxShadow='0 0 0 3px rgba(41,171,226,0.15)' }}
                  onBlur={e  => { e.target.style.borderColor=inputBdr;  e.target.style.boxShadow='none' }}/>
                <button type="button" onClick={() => setShow(!showPwd)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color:inputClr, opacity:0.45 }}>
                  {showPwd ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              </div>
            </div>

            {error && (
              <div className="rounded-xl px-4 py-2.5 text-xs flex items-center gap-2"
                style={{ background:'rgba(239,68,68,0.13)', border:'1px solid rgba(239,68,68,0.3)', color:'#FCA5A5' }}>
                ⚠ {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              className={cn('w-full py-3.5 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98]', loading && 'opacity-60 cursor-not-allowed')}
              style={{ background:loading?'#6B7280':'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow:'0 8px 28px rgba(41,171,226,0.38)' }}>
              {loading && <Loader2 size={16} className="animate-spin"/>}
              {loading ? 'Signing in...' : 'Sign In →'}
            </button>
          </form>

          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px" style={{ background:divClr }}/>
            <span className="text-[11px] font-medium" style={{ color:subClr }}>or continue with</span>
            <div className="flex-1 h-px" style={{ background:divClr }}/>
          </div>

          <div className="flex items-center justify-center gap-4">
            <button onClick={() => setError('Google sign-in coming soon.')}
              className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all hover:-translate-y-1 hover:shadow-lg active:scale-95"
              style={{ background:socialBg, border:`1.5px solid ${socialBdr}` }} title="Continue with Google">
              <GoogleIcon/>
            </button>
            <button onClick={() => setError('Apple sign-in coming soon.')}
              className="w-12 h-12 rounded-2xl flex items-center justify-center transition-all hover:-translate-y-1 hover:shadow-lg active:scale-95"
              style={{ background:socialBg, border:`1.5px solid ${socialBdr}` }} title="Continue with Apple">
              <AppleIcon color={dark?'#fff':'#1A237E'}/>
            </button>
          </div>

          <p className="text-center text-[11px] mt-4" style={{ color:subClr }}>©2026 elyrac Ai</p>
        </div>
      </div>

      {/* ── RIGHT 50%: dental image + 4 corner chips (no overlap) ── */}
      <div className="hidden lg:flex items-center justify-center relative z-10" style={{ width:'50%' }}>
        {/* Glow */}
        <div className="absolute rounded-full animate-pulse pointer-events-none"
          style={{ width:460,height:460,background:'radial-gradient(circle,rgba(41,171,226,0.28) 0%,transparent 65%)',zIndex:1 }}/>

        {/* Brand text above image */}
        <div className="absolute top-8 left-0 right-0 text-center pointer-events-none z-20">
          <p className="font-bold text-lg" style={{ color:dark?'rgba(255,255,255,0.85)':'rgba(26,35,126,0.75)', fontFamily:'Plus Jakarta Sans' }}>
            Code Clinic Management System
          </p>
          <p className="text-sm mt-0.5" style={{ color:dark?'rgba(147,197,253,0.7)':'rgba(26,35,126,0.5)' }}>
            Painless Dentistry, Lifesaving Smiles.
          </p>
        </div>

        {/* Dental image — centre */}
        <div className="animate-float-slow relative" style={{ zIndex: 10 }}>
          <Image src="/dental3d.png" alt="Dental 3D" width={480} height={420} priority
            style={{ filter:'drop-shadow(0 24px 64px rgba(41,171,226,0.5)) drop-shadow(0 8px 32px rgba(0,0,30,0.4))', maxHeight:'68vh', width:'auto', objectFit:'contain' }}/>
        </div>

        {/* 4 corner chips — pushed to actual corners, won't overlap image */}
        <div className="animate-float absolute rounded-2xl px-3.5 py-2.5 z-20 shadow-2xl max-w-[148px]"
          style={{ top:'18%', left:'2%', background:chipBg, backdropFilter:'blur(20px)', border:`1px solid ${chipBdr}` }}>
          <p className="text-lg mb-0.5">🦷</p>
          <p className="text-xs font-bold leading-tight" style={{ color:chipTxt }}>Your smile is your best accessory</p>
        </div>

        <div className="animate-float delay-2s absolute rounded-2xl px-3.5 py-2.5 z-20 shadow-2xl max-w-[148px]"
          style={{ bottom:'18%', left:'2%', background:chipBg, backdropFilter:'blur(20px)', border:`1px solid ${chipBdr}` }}>
          <p className="text-lg mb-0.5">✨</p>
          <p className="text-xs font-bold leading-tight" style={{ color:chipTxt }}>5,000+ smiles transformed</p>
        </div>

        <div className="animate-float delay-1s absolute rounded-2xl px-3.5 py-2.5 z-20 shadow-2xl max-w-[148px]"
          style={{ top:'18%', right:'2%', background:chipBg, backdropFilter:'blur(20px)', border:`1px solid ${chipBdr}` }}>
          <p className="text-lg mb-0.5">🏆</p>
          <p className="text-xs font-bold leading-tight" style={{ color:chipTxt }}>98% patient satisfaction</p>
        </div>

        <div className="animate-float delay-3s absolute rounded-2xl px-3.5 py-2.5 z-20 shadow-xl max-w-[148px]"
          style={{ bottom:'18%', right:'2%', background:'rgba(16,185,129,0.18)', backdropFilter:'blur(20px)', border:'1px solid rgba(16,185,129,0.32)' }}>
          <p className="text-lg mb-0.5">💙</p>
          <p className="text-xs font-bold leading-tight text-white">Pain-free dentistry is our promise</p>
        </div>
      </div>
    </div>
  )
}
