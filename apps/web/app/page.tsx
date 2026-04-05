'use client'

import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { useEffect, useState } from 'react'

function AnimatedBg() {
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
      <style>{`
        @keyframes dash2 { to { stroke-dashoffset: 0; } }
        @keyframes twinkle2 { 0%,100%{opacity:.06} 50%{opacity:.2} }
        @keyframes drift2 { 0%{transform:translateY(0px)} 100%{transform:translateY(-10px)} }
        .wln  { stroke-dasharray: 300; stroke-dashoffset: 300; animation: dash2 10s ease-in-out infinite alternate; }
        .warc { stroke-dasharray: 500; stroke-dashoffset: 500; animation: dash2 14s ease-in-out infinite alternate; }
        .wst  { animation: twinkle2 3s ease-in-out infinite; }
        .wdr  { animation: drift2 7s ease-in-out infinite alternate; }
      `}</style>
      <line className="wln" x1="5%"  y1="10%" x2="35%" y2="35%"  stroke="rgba(41,171,226,0.1)"  strokeWidth="1"/>
      <line className="wln" x1="65%" y1="8%"  x2="95%" y2="28%"  stroke="rgba(41,171,226,0.08)" strokeWidth="0.8" style={{animationDelay:'2s'}}/>
      <line className="wln" x1="8%"  y1="65%" x2="32%" y2="88%"  stroke="rgba(41,171,226,0.08)" strokeWidth="0.7" style={{animationDelay:'1s'}}/>
      <line className="wln" x1="68%" y1="72%" x2="94%" y2="94%"  stroke="rgba(41,171,226,0.1)"  strokeWidth="1"   style={{animationDelay:'3s'}}/>
      <path className="warc" d="M 0 300 Q 250 80 500 250"   fill="none" stroke="rgba(41,171,226,0.07)" strokeWidth="1"/>
      <path className="warc" d="M 700 0 Q 950 350 850 600"  fill="none" stroke="rgba(41,171,226,0.06)" strokeWidth="0.8" style={{animationDelay:'5s'}}/>
      <path className="warc" d="M 200 700 Q 400 550 650 750" fill="none" stroke="rgba(41,171,226,0.07)" strokeWidth="0.7" style={{animationDelay:'2s'}}/>
      {[
        [10,8],[88,14],[22,32],[68,20],[82,42],[13,57],[47,76],[94,62],[56,89],[28,93],
        [72,6],[9,84],[52,22],[37,62],[76,82],[21,47],[60,52],[43,37],[86,72],[16,74],
        [35,15],[55,40],[90,30],[18,90],[63,10]
      ].map(([x,y],i)=>(
        <circle key={i} className="wst" cx={`${x}%`} cy={`${y}%`} r="1.5"
          fill="rgba(255,255,255,0.06)"
          style={{ animationDelay: `${(i * 0.31) % 4}s` }} />
      ))}
      {[[8,22],[82,18],[48,92],[91,52],[6,62],[40,5],[78,90]].map(([x,y],i)=>(
        <circle key={`b${i}`} className="wdr wst" cx={`${x}%`} cy={`${y}%`} r="2.5"
          fill="rgba(255,255,255,0.05)"
          style={{ animationDelay: `${i * 0.9}s` }} />
      ))}
    </svg>
  )
}

export default function WelcomePage() {
  const router = useRouter()
  const [show, setShow] = useState(false)
  useEffect(() => { setTimeout(() => setShow(true), 60) }, [])

  return (
    <div className="h-screen w-screen overflow-hidden relative flex items-center justify-center"
      style={{ background: 'linear-gradient(145deg,#020818 0%,#060e3a 30%,#0d1b6e 65%,#1565C0 100%)' }}>

      <AnimatedBg />

      {/* Blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 1 }}>
        <div className="animate-blob-pulse absolute rounded-full"
          style={{ width:700,height:700,background:'radial-gradient(circle,rgba(41,171,226,0.2),transparent)',top:'-200px',left:'-200px' }}/>
        <div className="animate-blob-pulse delay-2s absolute rounded-full"
          style={{ width:500,height:500,background:'radial-gradient(circle,rgba(124,58,237,0.15),transparent)',bottom:'-130px',right:'-100px' }}/>
        <div className="animate-blob-pulse delay-1s absolute rounded-full"
          style={{ width:400,height:400,background:'radial-gradient(circle,rgba(236,72,153,0.12),transparent)',top:'20%',right:'10%' }}/>
        <div className="absolute inset-0"
          style={{ backgroundImage:'radial-gradient(circle,rgba(255,255,255,0.04) 1px,transparent 1px)', backgroundSize:'40px 40px' }}/>
      </div>

      {/* Dental image — right side */}
      <div className="absolute right-0 top-0 bottom-0 flex items-center justify-end pointer-events-none"
        style={{ width:'55%', zIndex: 2 }}>
        <div className="animate-float-slow relative" style={{ marginRight: '-40px' }}>
          <div className="absolute rounded-full animate-pulse"
            style={{ width:500,height:500,background:'radial-gradient(circle,rgba(41,171,226,0.32) 0%,transparent 65%)',top:'50%',left:'50%',transform:'translate(-50%,-50%)' }}/>
          <Image src="/dental3d.png" alt="Dental 3D" width={640} height={560} priority
            style={{ filter:'drop-shadow(0 30px 80px rgba(41,171,226,0.55)) drop-shadow(0 10px 40px rgba(0,0,30,0.5))', maxHeight:'88vh', width:'auto', objectFit:'contain', position:'relative', zIndex:10 }}/>
        </div>
      </div>

      {/* Glass card */}
      <div className="relative flex items-center justify-center w-full h-full px-8" style={{ zIndex: 3 }}>
        <div className="w-full max-w-[400px]"
          style={{ opacity: show ? 1 : 0, transform: show ? 'translateY(0)' : 'translateY(28px)', transition: 'opacity 0.7s ease, transform 0.7s ease' }}>
          <div className="rounded-3xl px-8 py-8 shadow-2xl"
            style={{
              background: 'rgba(255,255,255,0.07)',
              backdropFilter: 'blur(32px)',
              WebkitBackdropFilter: 'blur(32px)',
              border: '1px solid rgba(255,255,255,0.14)',
              boxShadow: '0 40px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.1)',
            }}>
            <div className="mb-6">
              <Image src="/logo.png" alt="Code Clinic" width={145} height={54} className="brightness-0 invert"/>
            </div>
            <h1 className="text-3xl font-bold text-white leading-tight mb-2" style={{ fontFamily:'Plus Jakarta Sans' }}>
              Code Clinic<br/>Management System
            </h1>
            <p className="text-blue-200 text-sm font-medium mb-8">Painless Dentistry, Lifesaving Smiles.</p>
            <div className="flex gap-3" style={{ opacity:show?1:0, transition:'opacity 0.5s ease 0.5s' }}>
              <button onClick={() => router.push('/login')}
                className="flex-1 py-3.5 rounded-2xl font-bold text-white text-sm transition-all hover:-translate-y-1 hover:shadow-2xl active:scale-[0.97]"
                style={{ background:'linear-gradient(135deg,#1A237E,#29ABE2)', boxShadow:'0 8px 32px rgba(41,171,226,0.4)' }}>
                Log In →
              </button>
              <button onClick={() => router.push('/login')}
                className="flex-1 py-3.5 rounded-2xl font-bold text-white text-sm transition-all hover:-translate-y-1 active:scale-[0.97]"
                style={{ background:'rgba(255,255,255,0.09)', border:'1px solid rgba(255,255,255,0.22)' }}>
                Sign Up
              </button>
            </div>
            <p className="text-center text-[11px] text-blue-300/40 mt-5">©2026 elyrac Ai</p>
          </div>
        </div>
      </div>
    </div>
  )
}
