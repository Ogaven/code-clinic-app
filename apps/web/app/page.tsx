'use client'

import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useEffect, useState } from 'react'

export default function WelcomePage() {
  const router = useRouter()
  const [show, setShow] = useState(false)
  const [phase, setPhase] = useState<'splash'|'welcome'>('splash')

  useEffect(() => {
    // Brief splash then reveal welcome card
    setTimeout(() => setPhase('welcome'), 1400)
    setTimeout(() => setShow(true), 1500)
  }, [])

  /* ── Splash screen ── */
  if (phase === 'splash') return (
    <div className="h-screen w-screen flex flex-col items-center justify-center"
      style={{ background: 'linear-gradient(145deg,#020818 0%,#0d1b6e 60%,#1251a8 100%)' }}>
      <div className="flex flex-col items-center gap-5" style={{ animation: 'fadeUp 0.6s ease forwards' }}>
        <style>{`@keyframes fadeUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }`}</style>
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center shadow-2xl"
          style={{ background: 'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow:'0 16px 48px rgba(41,171,226,0.5)' }}>
          <span className="text-white font-black text-3xl">CC</span>
        </div>
        <Image src="/logo.png" alt="Code Clinic" width={160} height={56} className="brightness-0 invert"/>
        <p className="text-blue-300/70 text-sm tracking-widest uppercase font-medium">Management System</p>
        <div className="flex gap-1.5 mt-2">
          {[0,1,2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-cyan-400"
              style={{ animation:`bounce 1s ease ${i*0.2}s infinite`, opacity:0.7 }}/>
          ))}
        </div>
        <style>{`@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}`}</style>
      </div>
    </div>
  )

  /* ── Welcome card ── */
  return (
    <div className="h-screen w-screen overflow-hidden relative flex items-center justify-center"
      style={{ background: 'linear-gradient(145deg,#020818 0%,#060e3a 30%,#0d1b6e 65%,#1565C0 100%)' }}>

      {/* Background dots */}
      <div className="absolute inset-0"
        style={{ backgroundImage:'radial-gradient(circle,rgba(255,255,255,0.04) 1px,transparent 1px)', backgroundSize:'36px 36px' }}/>

      {/* Glow blobs */}
      <div className="absolute rounded-full pointer-events-none"
        style={{ width:600,height:600,background:'radial-gradient(circle,rgba(41,171,226,0.2),transparent)',top:'-200px',left:'-150px' }}/>
      <div className="absolute rounded-full pointer-events-none"
        style={{ width:450,height:450,background:'radial-gradient(circle,rgba(124,58,237,0.15),transparent)',bottom:'-100px',right:'-80px' }}/>

      {/* Dental image — right (desktop only) */}
      <div className="absolute right-0 top-0 bottom-0 hidden lg:flex items-center justify-end pointer-events-none" style={{ width:'52%', zIndex:2 }}>
        <div className="relative" style={{ marginRight:'-30px' }}>
          <div className="absolute rounded-full animate-pulse" style={{ width:460,height:460,background:'radial-gradient(circle,rgba(41,171,226,0.28),transparent)',top:'50%',left:'50%',transform:'translate(-50%,-50%)' }}/>
          <Image src="/dental3d.png" alt="Code Clinic" width={580} height={520} priority
            style={{ filter:'drop-shadow(0 24px 72px rgba(41,171,226,0.5))', maxHeight:'85vh', width:'auto', objectFit:'contain', position:'relative', zIndex:10 }}/>
        </div>
      </div>

      {/* Welcome card */}
      <div className="relative z-10 w-full flex items-center justify-center px-6 lg:justify-start lg:pl-16 xl:pl-24">
        <div className="w-full max-w-[380px]"
          style={{ opacity:show?1:0, transform:show?'translateY(0)':'translateY(24px)', transition:'opacity 0.6s ease, transform 0.6s ease' }}>

          {/* Mobile dental image */}
          <div className="flex justify-center mb-5 lg:hidden">
            <Image src="/dental3d.png" alt="Code Clinic" width={180} height={160}
              style={{ filter:'drop-shadow(0 12px 32px rgba(41,171,226,0.5))', objectFit:'contain' }}/>
          </div>

          <div className="rounded-3xl px-7 py-7 shadow-2xl"
            style={{ background:'rgba(255,255,255,0.07)', backdropFilter:'blur(32px)', WebkitBackdropFilter:'blur(32px)', border:'1px solid rgba(255,255,255,0.14)', boxShadow:'0 32px 72px rgba(0,0,0,0.45)' }}>

            <Image src="/logo.png" alt="Code Clinic" width={130} height={46} className="brightness-0 invert mb-5"/>

            <h1 className="text-2xl font-bold text-white leading-snug mb-1.5" style={{ fontFamily:'Plus Jakarta Sans' }}>
              Code Clinic<br/>Management System
            </h1>
            <p className="text-blue-200/70 text-sm mb-7">Painless Dentistry, Lifesaving Smiles.</p>

            {/* Stats row */}
            <div className="flex gap-3 mb-7">
              {[['5,000+','Smiles'],['98%','Satisfaction'],['2012','Est.']].map(([v,l]) => (
                <div key={l} className="flex-1 rounded-2xl py-3 text-center"
                  style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)' }}>
                  <p className="text-white font-bold text-sm">{v}</p>
                  <p className="text-blue-300/60 text-[10px] font-medium">{l}</p>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3">
              <button onClick={() => router.push('/login')}
                className="w-full py-3.5 rounded-2xl font-bold text-white text-sm transition-all hover:-translate-y-0.5 active:scale-[0.98]"
                style={{ background:'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow:'0 8px 28px rgba(41,171,226,0.4)' }}>
                Sign In →
              </button>
              <button onClick={() => router.push('/setup')}
                className="w-full py-3 rounded-2xl font-bold text-white/80 text-sm transition-all hover:bg-white/10 active:scale-[0.98]"
                style={{ background:'rgba(255,255,255,0.08)', border:'1px solid rgba(255,255,255,0.18)' }}>
                Create Account
              </button>
            </div>
          </div>
          <p className="text-center text-[11px] text-white/25 mt-5">©2026 elyrac Ai</p>
        </div>
      </div>
    </div>
  )
}
