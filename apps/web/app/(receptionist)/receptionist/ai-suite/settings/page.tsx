'use client'

import { useEffect, useRef, useState, KeyboardEvent } from 'react'
import {
  MessageSquare, Facebook, Instagram, Phone, Mic2,
  CheckCircle2, XCircle, Loader2, Plus, Trash2, Edit3, Save, X,
  ChevronDown, ChevronUp, ExternalLink, ArrowLeft, Copy, Globe,
  Mail, MapPin, Upload, Lock, MoreVertical, AlertTriangle,
  Image as ImageIcon, Link2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// ── API ────────────────────────────────────────────────────────────────────────
const API = '/api-proxy'
function authH(json = false) {
  const t = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const h: Record<string, string> = { Authorization: `Bearer ${t}` }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

// ── Shared UI atoms ────────────────────────────────────────────────────────────
type SipTrunk = {
  id: string; name: string; host: string; port: number; netmask: number
  protocol: string; allowInbound: boolean; allowOutbound: boolean
  optionsPing: boolean; username?: string | null; password?: string | null
  useSipRegistration: boolean; leadingPlus: boolean
  techPrefix?: string | null; sipDiversionHeader?: string | null
}

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

function Inp({ value, onChange, placeholder, type = 'text', disabled }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; disabled?: boolean
}) {
  return (
    <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
      className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed" />
  )
}

function SaveBtn({ saving, onClick, label = 'Save' }: { saving: boolean; onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} disabled={saving}
      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-60"
      style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
      {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
      {label}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// WHATSAPP PANEL — GHL-style
// ═══════════════════════════════════════════════════════════════════════════════

type WaNumber = { id: string; phoneNumber: string; name: string; status: string; qualityRating: string; country: string }
type WaProfile = { displayName: string; category: string; description: string; address: string; email: string; website: string; imageUrl: string | null }
type WaInsights = { tier: string; messagingLimit: number; qualityRating: string }

const WA_CATEGORIES = [
  { value: 'AUTOMOTIVE',                label: 'Automotive'             },
  { value: 'BEAUTY_SPA_AND_SALON',      label: 'Beauty, Spa & Salon'    },
  { value: 'CLOTHING_AND_APPAREL',      label: 'Clothing & Apparel'     },
  { value: 'EDUCATION',                 label: 'Education'              },
  { value: 'ENTERTAINMENT',             label: 'Entertainment'          },
  { value: 'EVENT_PLANNING_AND_SERVICE',label: 'Event Planning'         },
  { value: 'FINANCE_AND_BANKING',       label: 'Finance & Banking'      },
  { value: 'FOOD_AND_GROCERY',          label: 'Food & Grocery'         },
  { value: 'HOTEL_AND_LODGING',         label: 'Hotel & Lodging'        },
  { value: 'MEDICAL_AND_HEALTH',        label: 'Medical & Health'       },
  { value: 'NONPROFIT',                 label: 'Nonprofit'              },
  { value: 'PROFESSIONAL_SERVICES',     label: 'Professional Services'  },
  { value: 'SHOPPING_AND_RETAIL',       label: 'Shopping & Retail'      },
  { value: 'TRAVEL_AND_TRANSPORTATION', label: 'Travel & Transportation'},
  { value: 'RESTAURANT',                label: 'Restaurant'             },
  { value: 'OTHER',                     label: 'Other'                  },
]

const COUNTRY_CODES = [
  { code: '+256', flag: '🇺🇬', name: 'Uganda'       },
  { code: '+254', flag: '🇰🇪', name: 'Kenya'        },
  { code: '+255', flag: '🇹🇿', name: 'Tanzania'     },
  { code: '+250', flag: '🇷🇼', name: 'Rwanda'       },
  { code: '+251', flag: '🇪🇹', name: 'Ethiopia'     },
  { code: '+234', flag: '🇳🇬', name: 'Nigeria'      },
  { code: '+27',  flag: '🇿🇦', name: 'South Africa' },
  { code: '+44',  flag: '🇬🇧', name: 'UK'           },
  { code: '+1',   flag: '🇺🇸', name: 'USA'          },
  { code: '+91',  flag: '🇮🇳', name: 'India'        },
]

// ── OTP input ──────────────────────────────────────────────────────────────────
function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>(Array(6).fill(null))
  const digits = value.padEnd(6, '').split('').slice(0, 6)

  function handleChange(i: number, raw: string) {
    const d = raw.replace(/\D/g, '').slice(-1)
    const next = [...digits]; next[i] = d
    onChange(next.join('').replace(/\s/g, ''))
    if (d && i < 5) refs.current[i + 1]?.focus()
  }
  function handleKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus()
  }
  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    onChange(pasted)
    refs.current[Math.min(pasted.length, 5)]?.focus()
  }

  return (
    <div className="flex gap-3 justify-center" onPaste={handlePaste}>
      {digits.map((d, i) => (
        <input key={i} ref={el => { refs.current[i] = el }}
          type="text" inputMode="numeric" maxLength={1} value={d}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKey(i, e)}
          className="w-12 h-14 text-center text-2xl font-bold border-2 border-gray-200 rounded-2xl focus:border-blue-500 outline-none transition-colors bg-gray-50" />
      ))}
    </div>
  )
}

// ── 4-Step Add Number Wizard ───────────────────────────────────────────────────
const PREREQS = [
  'Active Meta Business account (business.facebook.com)',
  'Meta Business verification completed',
  'WhatsApp Business Account (WABA) created in Meta Business Suite',
  'Phone number NOT already registered on WhatsApp',
]

const META_ERRORS: Record<string, string> = {
  '100':    'Invalid parameter — double-check your App ID and WABA ID.',
  '190':    'Access token expired or invalid — generate a new permanent System Token.',
  '200':    'Insufficient permissions — ensure the token has whatsapp_business_management scope.',
  '10':     'App not approved — your Meta App must have WhatsApp product added and approved.',
  '368':    'Temporarily blocked for policy violations — review Meta policies.',
  '80007':  'Rate limit reached — wait a few minutes and try again.',
  'default':'Something went wrong. Check your credentials and try again.',
}
function friendlyMetaError(code?: string | number) {
  return META_ERRORS[String(code)] || META_ERRORS.default
}

function AddNumberModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [step,          setStep]          = useState<1 | 2 | 3 | 4>(1)
  // Step 2 state
  const [appId,         setAppId]         = useState('')
  const [appSecret,     setAppSecret]     = useState('')
  const [wabaId,        setWabaId]        = useState('')
  const [systemToken,   setSystemToken]   = useState('')
  // Step 3 state
  const [displayName,   setDisplayName]   = useState('Code Clinic')
  const [countryCode,   setCountryCode]   = useState('+256')
  const [localPhone,    setLocalPhone]    = useState('')
  // Step 4 state
  const [otp,           setOtp]           = useState('')
  const [phoneNumberId, setPhoneNumberId] = useState('')
  // Shared
  const [loading,       setLoading]       = useState(false)
  const [error,         setError]         = useState('')
  const [checked,       setChecked]       = useState<boolean[]>(PREREQS.map(() => false))

  function toggleCheck(i: number) { setChecked(c => c.map((v, j) => j === i ? !v : v)) }
  const allChecked = checked.every(Boolean)

  async function sendOtp() {
    if (!displayName.trim() || !localPhone.trim()) { setError('Please fill in all fields'); return }
    setError(''); setLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/connections/whatsapp/register`, {
        method: 'POST', headers: authH(true),
        body: JSON.stringify({
          displayName,
          phoneNumber: countryCode + localPhone.replace(/\D/g, ''),
          appId, appSecret, wabaId, systemToken,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(friendlyMetaError(data.code || data.errorCode)); return }
      setPhoneNumberId(data.phoneNumberId)
      setStep(4)
    } catch { setError('Network error — please try again') } finally { setLoading(false) }
  }

  async function verify() {
    if (otp.length < 6) { setError('Enter the 6-digit code'); return }
    setError(''); setLoading(true)
    try {
      const res = await fetch(`${API}/ai-suite/connections/whatsapp/verify`, {
        method: 'POST', headers: authH(true),
        body: JSON.stringify({ phoneNumberId, otp }),
      })
      const data = await res.json()
      if (!res.ok) { setError(friendlyMetaError(data.code || data.errorCode)); return }
      onSuccess()
    } catch { setError('Network error — please try again') } finally { setLoading(false) }
  }

  const inputCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl bg-gray-50 focus:outline-none focus:border-[#25D366] focus:ring-2 focus:ring-[#25D366]/10 transition-colors'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#25D36618' }}>
              <MessageSquare size={18} style={{ color: '#25D366' }} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-800">Connect WhatsApp</h3>
              <p className="text-[11px] text-gray-400">Step {step} of 4</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={18} /></button>
        </div>

        {/* Step progress */}
        <div className="flex items-center gap-0 px-6 py-3 border-b border-gray-50 flex-shrink-0">
          {([1,2,3,4] as const).map((s, i) => (
            <div key={s} className="flex items-center flex-1">
              <div className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-black transition-all flex-shrink-0',
                step > s ? 'bg-[#25D366] text-white' :
                step === s ? 'bg-[#1A237E] text-white' :
                'bg-gray-100 text-gray-400',
              )}>
                {step > s ? <CheckCircle2 size={14} /> : s}
              </div>
              {i < 3 && <div className={cn('flex-1 h-0.5 mx-1', step > s ? 'bg-[#25D366]' : 'bg-gray-100')} />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* ── Step 1: Prerequisites ── */}
          {step === 1 && (
            <>
              <div>
                <p className="text-base font-bold text-gray-800 mb-0.5">Before you begin</p>
                <p className="text-xs text-gray-400">Check that you have everything ready to connect via the Meta API.</p>
              </div>
              <div className="space-y-3">
                {PREREQS.map((req, i) => (
                  <button key={i} onClick={() => toggleCheck(i)}
                    className={cn(
                      'w-full flex items-start gap-3 p-3.5 rounded-2xl border-2 text-left transition-all',
                      checked[i]
                        ? 'border-[#25D366] bg-[#25D366]/5'
                        : 'border-gray-200 bg-gray-50 hover:border-gray-300',
                    )}>
                    <div className={cn(
                      'w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all',
                      checked[i] ? 'border-[#25D366] bg-[#25D366]' : 'border-gray-300',
                    )}>
                      {checked[i] && <CheckCircle2 size={11} className="text-white" />}
                    </div>
                    <span className={cn('text-sm leading-relaxed', checked[i] ? 'text-gray-700 font-medium' : 'text-gray-500')}>{req}</span>
                  </button>
                ))}
              </div>
              <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 leading-relaxed">
                  Once connected, this number <strong>cannot be used</strong> on the WhatsApp mobile app simultaneously.
                </p>
              </div>
            </>
          )}

          {/* ── Step 2: API Credentials ── */}
          {step === 2 && (
            <>
              <div>
                <p className="text-base font-bold text-gray-800 mb-0.5">Meta API credentials</p>
                <p className="text-xs text-gray-400">Find these in your <strong>Meta Developer Dashboard</strong> under your WhatsApp app.</p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Meta App ID</label>
                  <input value={appId} onChange={e => setAppId(e.target.value)} placeholder="123456789012345" className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Meta App Secret</label>
                  <input value={appSecret} onChange={e => setAppSecret(e.target.value)} placeholder="••••••••••••••••" type="password" className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">WhatsApp Business Account ID (WABA ID)</label>
                  <input value={wabaId} onChange={e => setWabaId(e.target.value)} placeholder="111222333444555" className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Permanent System Token</label>
                  <input value={systemToken} onChange={e => setSystemToken(e.target.value)} placeholder="EAABs..." type="password" className={inputCls} />
                  <p className="text-[11px] text-gray-400 mt-1">Generate a permanent token via a System User in Meta Business Settings.</p>
                </div>
              </div>
              {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
            </>
          )}

          {/* ── Step 3: Phone number ── */}
          {step === 3 && (
            <>
              <div>
                <p className="text-base font-bold text-gray-800 mb-0.5">Add phone number</p>
                <p className="text-xs text-gray-400">This must be the number registered in your WhatsApp Business Account.</p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Display Name</label>
                  <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Code Clinic" className={inputCls} />
                  <p className="text-[11px] text-gray-400 mt-1">Must match your approved Meta display name. <a href="https://www.facebook.com/business/help/757569725593362" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Guidelines ↗</a></p>
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block">Phone number</label>
                  <div className="flex gap-2">
                    <select value={countryCode} onChange={e => setCountryCode(e.target.value)}
                      className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 dark:text-white focus:outline-none focus:border-[#25D366] transition-colors">
                      {COUNTRY_CODES.map(c => <option key={c.code} value={c.code} className="dark:bg-gray-800">{c.flag} {c.code}</option>)}
                    </select>
                    <input value={localPhone} onChange={e => setLocalPhone(e.target.value)} placeholder="741 087 667" className={cn(inputCls, 'flex-1')} />
                  </div>
                </div>
              </div>
              {error && <p className="text-xs text-red-600 font-semibold">{error}</p>}
            </>
          )}

          {/* ── Step 4: OTP ── */}
          {step === 4 && (
            <>
              <div className="text-center">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                  <MessageSquare size={28} style={{ color: '#25D366' }} />
                </div>
                <p className="text-sm font-bold text-gray-800 mb-1">Verify your number</p>
                <p className="text-xs text-gray-500">
                  Enter the 6-digit code sent to <strong>{countryCode} {localPhone}</strong>
                </p>
              </div>
              <OtpInput value={otp} onChange={setOtp} />
              {error && <p className="text-xs text-red-600 font-semibold text-center">{error}</p>}
              <p className="text-xs text-gray-400 text-center">Didn't receive a code? <button className="text-blue-600 hover:underline">Resend</button></p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button
            onClick={() => step === 1 ? onClose() : setStep((step - 1) as 1|2|3|4)}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 border border-gray-200 hover:bg-gray-50 transition-colors">
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          {step === 1 && (
            <button onClick={() => setStep(2)} disabled={!allChecked}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5 disabled:opacity-40 disabled:hover:translate-y-0"
              style={{ background: allChecked ? '#25D366' : '#9CA3AF' }}>
              I'm ready to proceed →
            </button>
          )}
          {step === 2 && (
            <button onClick={() => { if (!appId || !wabaId || !systemToken) { setError('All fields are required'); return } setError(''); setStep(3) }}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white bg-[#1A237E] hover:bg-[#0d1857] transition-colors">
              Next → Add phone number
            </button>
          )}
          {step === 3 && (
            <button onClick={sendOtp} disabled={loading}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white bg-[#1A237E] hover:bg-[#0d1857] disabled:opacity-60 transition-colors">
              {loading && <Loader2 size={13} className="animate-spin" />}
              Send verification code →
            </button>
          )}
          {step === 4 && (
            <button onClick={verify} disabled={loading}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white disabled:opacity-60 transition-colors"
              style={{ background: '#25D366' }}>
              {loading && <Loader2 size={13} className="animate-spin" />}
              Verify & Connect
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Phone frame preview ────────────────────────────────────────────────────────
function PhonePreview({ profile }: { profile: WaProfile }) {
  const catLabel = WA_CATEGORIES.find(c => c.value === profile.category)?.label || profile.category
  return (
    <div className="flex-shrink-0 w-[240px]">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3 text-center">Live Preview</p>
      <div className="bg-gray-900 rounded-[38px] p-2.5 shadow-2xl border-4 border-gray-900">
        {/* Notch */}
        <div className="relative flex justify-center mb-0.5">
          <div className="w-20 h-5 bg-gray-950 rounded-full" />
        </div>
        {/* Screen */}
        <div className="bg-white rounded-[28px] overflow-hidden" style={{ height: 480 }}>
          {/* WA header */}
          <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: '#075E54' }}>
            <span className="text-white/70 text-lg leading-none">‹</span>
            <div className="flex-1">
              <p className="text-white text-xs font-bold leading-tight truncate">{profile.displayName || 'Code Clinic'}</p>
            </div>
          </div>
          {/* Profile banner */}
          <div className="h-24 flex items-center justify-center relative" style={{ background: '#128C7E' }}>
            {profile.imageUrl ? (
              <img src={profile.imageUrl} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-white" />
            ) : (
              <div className="w-16 h-16 rounded-full flex items-center justify-center border-2 border-white" style={{ background: '#25D366' }}>
                <span className="text-white text-xl font-black">CC</span>
              </div>
            )}
          </div>
          {/* Info */}
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs font-bold text-gray-800 truncate">{profile.displayName || 'Code Clinic'}</p>
            <p className="text-[10px] text-[#25D366] font-semibold">Share</p>
          </div>
          <div className="overflow-y-auto" style={{ height: 220 }}>
            {profile.description && (
              <div className="px-3 py-2 border-b border-gray-100">
                <p className="text-[10px] text-gray-600 leading-relaxed line-clamp-3">{profile.description}</p>
              </div>
            )}
            <div className="px-3 py-2 space-y-1.5">
              {catLabel && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px]">🏥</span>
                  <span className="text-[10px] text-gray-500">{catLabel}</span>
                </div>
              )}
              {profile.address && (
                <div className="flex items-center gap-1.5">
                  <MapPin size={9} className="text-gray-400 flex-shrink-0" />
                  <span className="text-[10px] text-gray-500 truncate">{profile.address}</span>
                </div>
              )}
              {profile.email && (
                <div className="flex items-center gap-1.5">
                  <Mail size={9} className="text-gray-400 flex-shrink-0" />
                  <span className="text-[10px] text-gray-500 truncate">{profile.email}</span>
                </div>
              )}
              {profile.website && (
                <div className="flex items-center gap-1.5">
                  <Globe size={9} className="text-[#25D366] flex-shrink-0" />
                  <span className="text-[10px] text-[#25D366] truncate">{profile.website}</span>
                </div>
              )}
            </div>
          </div>
          {/* Add to Contacts */}
          <div className="px-3 py-2 border-t border-gray-100">
            <div className="w-full py-1.5 rounded-full text-center text-[10px] font-bold text-white" style={{ background: '#25D366' }}>
              Add to Contacts
            </div>
          </div>
        </div>
        {/* Home bar */}
        <div className="flex justify-center mt-2">
          <div className="w-20 h-1 bg-white/20 rounded-full" />
        </div>
      </div>
    </div>
  )
}

// ── Insights tab ───────────────────────────────────────────────────────────────
function InsightsTab({ phoneNumber }: { phoneNumber: string }) {
  const [data, setData] = useState<WaInsights | null>(null)

  useEffect(() => {
    fetch(`${API}/ai-suite/connections/whatsapp/insights`, { headers: authH() })
      .then(r => r.json()).then(setData).catch(() => {})
  }, [])

  const TIERS = [
    { tier: 'TIER_1K',        label: '1,000'    },
    { tier: 'TIER_10K',       label: '10,000'   },
    { tier: 'TIER_100K',      label: '100,000'  },
    { tier: 'TIER_UNLIMITED', label: 'Unlimited'},
  ]
  const currentIdx = data ? TIERS.findIndex(t => t.tier === data.tier) : 0

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-base font-bold text-gray-800 dark:text-white">Messaging Limits</h3>
          <div className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center cursor-help" title="Business-initiated conversation limits">
            <span className="text-[9px] font-black text-gray-500">i</span>
          </div>
        </div>
        <p className="text-xs text-gray-400 mb-5">Business-initiated conversations in a rolling 24-hour period</p>

        {/* Tier row */}
        <div className="flex items-center gap-0 overflow-x-auto pb-2">
          {TIERS.map((t, i) => {
            const isCurrent = i === currentIdx
            const isNext    = i === currentIdx + 1
            const isLocked  = i > currentIdx
            return (
              <div key={t.tier} className="flex items-center">
                <div className={cn(
                  'flex flex-col items-center px-4 py-3 rounded-xl border-2 min-w-[100px] transition-all',
                  isCurrent ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30'  : '',
                  isNext    ? 'border-amber-300  bg-amber-50 dark:bg-amber-900/30'     : '',
                  !isCurrent && !isNext ? 'border-gray-200 bg-gray-50 dark:bg-white/5 dark:border-white/10' : '',
                )}>
                  <div className="flex items-center gap-1 mb-1">
                    {isLocked && !isNext && <Lock size={11} className="text-gray-400" />}
                    <span className={cn('text-base font-black',
                      isCurrent ? 'text-emerald-700' : isNext ? 'text-amber-700' : 'text-gray-400')}>
                      {t.label}
                    </span>
                  </div>
                  <span className={cn('text-[10px] font-semibold',
                    isCurrent ? 'text-emerald-600' : isNext ? 'text-amber-600' : 'text-gray-400')}>
                    {isCurrent ? 'Current' : isNext ? 'Next Level' : 'Locked'}
                  </span>
                </div>
                {i < TIERS.length - 1 && (
                  <div className={cn('w-8 h-0.5', i < currentIdx ? 'bg-emerald-300' : 'bg-gray-200')} />
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-5 flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-700/30 rounded-xl">
          <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-[9px] font-black text-white">i</span>
          </div>
          <p className="text-xs text-blue-700 dark:text-blue-300">
            Initiate conversations with <strong>500 unique customers</strong> in a rolling 7 days period to qualify for the next tier.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Profile tab ────────────────────────────────────────────────────────────────
function ProfileTab({ phoneNumber }: { phoneNumber: string }) {
  const imgRef = useRef<HTMLInputElement>(null)
  const [profile, setProfile]  = useState<WaProfile>({ displayName: 'Code Clinic', category: 'MEDICAL_AND_HEALTH', description: '', address: '', email: '', website: '', imageUrl: null })
  const [saving,  setSaving]   = useState(false)
  const [saved,   setSaved]    = useState(false)

  useEffect(() => {
    fetch(`${API}/ai-suite/connections/whatsapp/profile`, { headers: authH() })
      .then(r => r.json())
      .then(d => {
        if (d && typeof d.displayName === 'string') setProfile(d)
      })
      .catch(() => {})
  }, [])

  function set(k: keyof WaProfile, v: string) {
    setProfile(p => ({ ...p, [k]: v }))
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const base64 = ev.target?.result as string
      setProfile(p => ({ ...p, imageUrl: base64 }))
      await fetch(`${API}/ai-suite/connections/whatsapp/profile/image`, {
        method: 'POST', headers: authH(true), body: JSON.stringify({ imageBase64: base64 }),
      }).catch(() => {})
    }
    reader.readAsDataURL(file)
  }

  async function save() {
    setSaving(true)
    try {
      await fetch(`${API}/ai-suite/connections/whatsapp/profile`, {
        method: 'PATCH', headers: authH(true),
        body: JSON.stringify({ category: profile.category, description: profile.description, address: profile.address, email: profile.email, website: profile.website }),
      })
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } catch {} finally { setSaving(false) }
  }

  return (
    <div className="flex gap-8 p-6">
      {/* Form side */}
      <div className="flex-1 min-w-0 space-y-5">
        <div>
          <p className="text-base font-bold text-gray-800 dark:text-white">Personal Info</p>
          <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Update your photo and personal details here</p>
        </div>

        {/* Image upload */}
        <div className="flex items-start gap-4 pb-5 border-b border-gray-100">
          <div>
            {profile.imageUrl ? (
              <img src={profile.imageUrl} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-gray-200" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-[#25D366]/20 flex items-center justify-center border-2 border-gray-200">
                <span className="text-[#25D366] text-xl font-black">CC</span>
              </div>
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-700 dark:text-white/70 mb-1">Display Image</p>
            <p className="text-xs text-gray-400 dark:text-white/40 mb-2">PNG or JPG, square, max 5 MB. 640×640 recommended.</p>
            <button onClick={() => imgRef.current?.click()}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold text-gray-700 dark:text-white/70 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              <Upload size={12} /> Upload Image
            </button>
            <input ref={imgRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleImageUpload} />
          </div>
        </div>

        {/* Display name (readonly) */}
        <div className="pb-5 border-b border-gray-100">
          <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Display Name</label>
          <input value={profile.displayName} disabled
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 text-gray-400 dark:text-white/30 cursor-not-allowed" />
          <p className="text-[11px] text-gray-400 dark:text-white/30 mt-1">Display Name can't be edited after verification.</p>
        </div>

        {/* Category */}
        <div className="pb-5 border-b border-gray-100">
          <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Category</label>
          <select value={profile.category} onChange={e => set('category', e.target.value)}
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 dark:text-white focus:outline-none focus:border-cyan-500 transition-colors">
            {WA_CATEGORIES.map(c => <option key={c.value} value={c.value} className="dark:bg-gray-800">{c.label}</option>)}
          </select>
        </div>

        {/* Description */}
        <div className="pb-5 border-b border-gray-100">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide">Description</label>
            <span className="text-[11px] text-gray-400 dark:text-white/30">{(profile.description || '').length}/512</span>
          </div>
          <textarea value={profile.description} onChange={e => set('description', e.target.value.slice(0, 512))}
            rows={3} placeholder="Describe your business..."
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500 transition-colors resize-none" />
        </div>

        {/* Address */}
        <div className="pb-5 border-b border-gray-100">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide">Address</label>
            <span className="text-[11px] text-gray-400 dark:text-white/30">{(profile.address || '').length}/256</span>
          </div>
          <input value={profile.address} onChange={e => set('address', e.target.value.slice(0, 256))}
            placeholder="123 Kampala Rd, Kampala, Uganda"
            className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500 transition-colors" />
        </div>

        {/* Email */}
        <div className="pb-5 border-b border-gray-100">
          <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide mb-1.5 block">Email Address</label>
          <div className="relative">
            <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={profile.email} onChange={e => set('email', e.target.value)} placeholder="clinic@example.com" type="email"
              className="w-full pl-9 pr-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500 transition-colors" />
          </div>
        </div>

        {/* Website */}
        <div className="pb-5 border-b border-gray-100">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide">Website</label>
            <span className="text-[11px] text-gray-400 dark:text-white/30">{(profile.website || '').length}/256</span>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-mono">https://</span>
            <input value={profile.website} onChange={e => set('website', e.target.value.slice(0, 256))} placeholder="www.yourclinic.com"
              className="w-full pl-16 pr-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:border-cyan-500 transition-colors" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 transition-colors">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Save
          </button>
          {saved && <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1"><CheckCircle2 size={13} /> Saved!</span>}
        </div>
      </div>

      {/* Phone preview */}
      <PhonePreview profile={profile} />
    </div>
  )
}

// ── Message Links tab ──────────────────────────────────────────────────────────
function MessageLinksTab({ phoneNumber }: { phoneNumber: string }) {
  const [copied,       setCopied]       = useState(false)
  const [customText,   setCustomText]   = useState('')
  const imgRef = useRef<HTMLImageElement>(null)
  const rawPhone = phoneNumber.replace(/[^\d]/g, '')
  const waLink   = customText.trim()
    ? `https://wa.me/${rawPhone}?text=${encodeURIComponent(customText)}`
    : `https://wa.me/${rawPhone}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(waLink)}&bgcolor=ffffff&color=000000&margin=2`

  function copy() {
    navigator.clipboard.writeText(waLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})
  }

  function downloadQR() {
    const a = document.createElement('a')
    a.href = qrUrl
    a.download = `code-clinic-whatsapp-qr.png`
    a.target = '_blank'
    a.click()
  }

  return (
    <div className="p-6 max-w-lg space-y-6">
      {/* Click-to-Chat Link */}
      <div>
        <h3 className="text-base font-bold text-gray-800 dark:text-white mb-1">Click-to-Chat Link</h3>
        <p className="text-xs text-gray-400 mb-4">Share this link so customers can start a WhatsApp conversation with you.</p>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl min-w-0">
            <Link2 size={14} className="text-gray-400 flex-shrink-0" />
            <span className="text-sm text-gray-700 dark:text-white/70 font-mono truncate">{waLink}</span>
          </div>
          <button onClick={copy}
            className={cn('flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all flex-shrink-0',
              copied ? 'bg-emerald-500 text-white' : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/15')}>
            <Copy size={13} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Pre-filled message */}
      <div>
        <h3 className="text-sm font-bold text-gray-700 dark:text-white/70 mb-1.5">Pre-filled Message (optional)</h3>
        <textarea
          value={customText}
          onChange={e => setCustomText(e.target.value)}
          rows={2}
          placeholder="Hi Code Clinic! I'd like to book an appointment…"
          className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 rounded-xl bg-gray-50 dark:bg-white/5 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#25D366]/20 focus:border-[#25D366] transition-all resize-none"
        />
        <p className="text-[11px] text-gray-400 mt-1">When set, opening the link pre-fills this text in the patient's WhatsApp compose box.</p>
      </div>

      {/* QR Code */}
      <div>
        <h3 className="text-base font-bold text-gray-800 dark:text-white mb-3">QR Code</h3>
        <div className="flex items-start gap-4">
          <div className="inline-block p-3 bg-white border-2 border-gray-100 rounded-2xl shadow-sm flex-shrink-0">
            <img ref={imgRef} src={qrUrl} alt="WhatsApp QR Code" width={140} height={140} className="rounded-lg block" crossOrigin="anonymous" />
          </div>
          <div className="space-y-2 pt-1">
            <p className="text-xs text-gray-500 dark:text-white/50 leading-relaxed">Customers scan this code to open a WhatsApp chat instantly.</p>
            <button onClick={downloadQR}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold border border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
              <ImageIcon size={13} /> Download QR Code
            </button>
            <button
              onClick={() => window.open(waLink, '_blank')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5"
              style={{ background: '#25D366' }}>
              <MessageSquare size={13} /> Share Link
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Manage page ────────────────────────────────────────────────────────────────
function WhatsAppManagePage({ number, onBack }: { number: WaNumber; onBack: () => void }) {
  const [tab, setTab] = useState<'insights' | 'profile' | 'links'>('insights')
  return (
    <div className="min-h-full bg-gray-50 dark:bg-transparent">
      {/* Back + header */}
      <div className="bg-white dark:bg-white/5 border-b border-gray-100 dark:border-white/10 px-6 py-4">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 dark:text-white/50 dark:hover:text-white mb-3 transition-colors">
          <ArrowLeft size={15} /> Back to WhatsApp
        </button>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: '#25D36618' }}>
            <MessageSquare size={22} style={{ color: '#25D366' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-black text-gray-800 dark:text-white">{number.phoneNumber}</span>
              <span className="text-sm font-semibold text-gray-500 dark:text-white/50">{number.name}</span>
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={9} /> {number.status}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">● {number.qualityRating}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center border-b border-gray-100 dark:border-white/10 bg-white dark:bg-white/5 px-6">
        {([
          { key: 'insights', label: 'Insights'      },
          { key: 'profile',  label: 'Profile'       },
          { key: 'links',    label: 'Message Links' },
        ] as { key: typeof tab; label: string }[]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-all',
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-700')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="overflow-y-auto">
        {tab === 'insights' && <InsightsTab phoneNumber={number.phoneNumber} />}
        {tab === 'profile'  && <ProfileTab  phoneNumber={number.phoneNumber} />}
        {tab === 'links'    && <MessageLinksTab phoneNumber={number.phoneNumber} />}
      </div>
    </div>
  )
}

// ── WhatsApp Panel (GHL-style numbers list) ────────────────────────────────────
function WhatsAppPanel({ onManage }: { onManage: (n: WaNumber) => void }) {
  const [waTab,       setWaTab]       = useState<'numbers' | 'templates' | 'flows'>('numbers')
  const [numbers,     setNumbers]     = useState<WaNumber[]>([])
  const [loading,     setLoading]     = useState(true)
  const [showAdd,     setShowAdd]     = useState(false)
  const [openMenu,    setOpenMenu]    = useState<string | null>(null)

  const isConnected = numbers.length > 0

  function load() {
    setLoading(true)
    fetch(`${API}/ai-suite/connections/whatsapp/numbers`, { headers: authH() })
      .then(r => r.json()).then(d => { setNumbers(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  function flagFor(phone: string) {
    if (phone.startsWith('+256')) return '🇺🇬'
    if (phone.startsWith('+254')) return '🇰🇪'
    if (phone.startsWith('+255')) return '🇹🇿'
    if (phone.startsWith('+234')) return '🇳🇬'
    if (phone.startsWith('+27'))  return '🇿🇦'
    return '🌍'
  }

  return (
    <>
      {showAdd && (
        <AddNumberModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); load() }}
        />
      )}

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        {/* Panel header */}
        <div className="px-5 pt-5 pb-4 border-b border-gray-100 dark:border-white/8">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#25D36618' }}>
                <MessageSquare size={18} style={{ color: '#25D366' }} />
              </div>
              <span className="text-base font-black text-gray-800 dark:text-white">WhatsApp</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-600 dark:text-white/60 border border-gray-200 dark:border-white/15 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                Create Engagement Ad
              </button>
              <button onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white transition-all hover:-translate-y-0.5"
                style={{ background: '#111827' }}>
                <Plus size={13} /> Add Number
              </button>
            </div>
          </div>

          {/* Account status badges */}
          {isConnected && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40">
                <CheckCircle2 size={9} /> Approved
              </span>
              <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40">
                <CheckCircle2 size={9} /> Meta business verification: Verified
              </span>
              <span className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700/40">
                <CheckCircle2 size={9} /> Marketing messages: Enabled
              </span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-gray-800 dark:text-white">
                Phone numbers — {String(numbers.length).padStart(2, '0')} Numbers
              </p>
              <p className="text-xs text-gray-400 dark:text-white/40 mt-0.5">Manage WhatsApp numbers</p>
            </div>
          </div>

          {/* Sub-tabs */}
          <div className="flex items-center gap-0 mt-3 border-b border-gray-100 dark:border-white/8 -mx-5 px-5">
            {([
              { key: 'numbers',   label: 'Numbers'   },
              { key: 'templates', label: 'Templates' },
              { key: 'flows',     label: 'Flows'     },
            ] as { key: typeof waTab; label: string }[]).map(t => (
              <button key={t.key} onClick={() => setWaTab(t.key)}
                className={cn('px-4 py-2 text-xs font-bold border-b-2 -mb-px transition-all',
                  waTab === t.key ? 'border-[#25D366] text-[#25D366]' : 'border-transparent text-gray-400 hover:text-gray-600')}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        {waTab === 'numbers' && (
          <div>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 size={20} className="animate-spin text-gray-300" />
              </div>
            ) : numbers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center px-6">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-3" style={{ background: '#25D36610' }}>
                  <MessageSquare size={28} style={{ color: '#25D366' }} />
                </div>
                <p className="text-sm font-bold text-gray-700 dark:text-white/70 mb-1">No numbers connected</p>
                <p className="text-xs text-gray-400 dark:text-white/40 mb-4">Add a WhatsApp number to get started</p>
                <button onClick={() => setShowAdd(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
                  style={{ background: '#25D366' }}>
                  <Plus size={14} /> Add Number
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-white/8">
                      {['Phone Number', 'Country', 'Status', 'Name', 'Quality Rating', 'Actions'].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-[10px] font-black text-gray-400 dark:text-white/40 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {numbers.map(num => (
                      <tr key={num.id} className="border-b border-gray-50 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/3 transition-colors">
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="text-sm font-semibold text-gray-800 dark:text-white">
                            {flagFor(num.phoneNumber)} {num.phoneNumber}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-600 dark:text-white/60 whitespace-nowrap">{num.country}</td>
                        <td className="px-5 py-3.5 whitespace-nowrap">
                          <span className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                            {num.status}
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-sm text-gray-700 dark:text-white/70">{num.name}</td>
                        <td className="px-5 py-3.5">
                          <span className="text-[11px] font-bold text-green-600">● {num.qualityRating}</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => onManage(num)}
                              className="px-3 py-1.5 rounded-lg text-xs font-bold text-gray-700 dark:text-white/70 border border-gray-200 dark:border-white/15 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                              Manage
                            </button>
                            <div className="relative">
                              <button onClick={() => setOpenMenu(openMenu === num.id ? null : num.id)}
                                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
                                <MoreVertical size={14} />
                              </button>
                              {openMenu === num.id && (
                                <div className="absolute right-0 top-8 z-20 bg-white dark:bg-[#0e2045] border border-gray-100 dark:border-white/10 rounded-xl shadow-xl py-1 min-w-[140px]">
                                  <button onClick={() => { onManage(num); setOpenMenu(null) }}
                                    className="w-full text-left px-4 py-2 text-xs font-semibold text-gray-700 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors">
                                    Manage
                                  </button>
                                  <button onClick={() => setOpenMenu(null)}
                                    className="w-full text-left px-4 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                                    Remove Number
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {waTab === 'templates' && (
          <div className="flex flex-col items-center justify-center py-14 text-center px-6">
            <p className="text-sm font-bold text-gray-500 dark:text-white/50 mb-1">Templates</p>
            <p className="text-xs text-gray-400 dark:text-white/30">Message templates will appear here once you have an approved number.</p>
          </div>
        )}
        {waTab === 'flows' && (
          <div className="flex flex-col items-center justify-center py-14 text-center px-6">
            <p className="text-sm font-bold text-gray-500 dark:text-white/50 mb-1">Flows</p>
            <p className="text-xs text-gray-400 dark:text-white/30">WhatsApp Flows will appear here once configured.</p>
          </div>
        )}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// OTHER CHANNEL SECTIONS (unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

function FacebookSection({ toast }: { toast: (m: string) => void }) {
  const [status,        setStatus]        = useState<{ connected: boolean; pageName: string | null } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    fetch(`${API}/ai-suite/connections/facebook/status`, { headers: authH() })
      .then(r => r.json()).then(setStatus).catch(() => {})
  }, [])

  async function connect() {
    const r = await fetch(`${API}/ai-suite/connections/facebook/generate-state`, { headers: authH() })
    if (!r.ok) { toast('Session error — please log in again'); return }
    const { state } = await r.json()
    const w = window.open(`${API}/ai-suite/connections/facebook/oauth?state=${state}`, '_blank', 'width=600,height=700')
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
      setStatus({ connected: false, pageName: null }); toast('Facebook disconnected')
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
              <span>Connected to page: <strong>{status.pageName}</strong></span>
            </div>
            <button onClick={disconnect} disabled={disconnecting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-60">
              {disconnecting ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />} Disconnect
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-400 dark:text-white/40">Connect your Facebook Page to receive and send Messenger messages through Sarah.</p>
            <button onClick={connect}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
              style={{ background: '#1877F2' }}>
              <Facebook size={14} /> Connect with Facebook <ExternalLink size={12} className="opacity-70" />
            </button>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function InstagramSection({ toast }: { toast: (m: string) => void }) {
  const [status,        setStatus]        = useState<{ connected: boolean; accountName: string | null } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    fetch(`${API}/ai-suite/connections/instagram/status`, { headers: authH() })
      .then(r => r.json()).then(setStatus).catch(() => {})
  }, [])

  async function connect() {
    const r = await fetch(`${API}/ai-suite/connections/instagram/generate-state`, { headers: authH() })
    if (!r.ok) { toast('Session error — please log in again'); return }
    const { state } = await r.json()
    const w = window.open(`${API}/ai-suite/connections/instagram/oauth?state=${state}`, '_blank', 'width=600,height=700')
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
      setStatus({ connected: false, accountName: null }); toast('Instagram disconnected')
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
              <CheckCircle2 size={14} /><span>Connected: <strong>{status.accountName}</strong></span>
            </div>
            <button onClick={disconnect} disabled={disconnecting}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-60">
              {disconnecting ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />} Disconnect
            </button>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-400 dark:text-white/40">Connect your Instagram Business account to manage DMs through Sarah.</p>
            <button onClick={connect}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
              style={{ background: 'linear-gradient(135deg,#E4405F,#833AB4,#F77737)' }}>
              <Instagram size={14} /> Connect with Instagram <ExternalLink size={12} className="opacity-70" />
            </button>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function SmsSection({ toast }: { toast: (m: string) => void }) {
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
        method: 'PATCH', headers: authH(true),
        body: JSON.stringify({ ...(apiKey && { apiKey }), username }),
      })
      const d = await res.json()
      setConnected(d.connected); setApiKey(''); toast('SMS settings saved')
    } catch { toast('Failed to save') } finally { setSaving(false) }
  }

  return (
    <SectionCard
      icon={<div className="w-8 h-8 rounded-xl flex items-center justify-center bg-cyan-50 dark:bg-cyan-900/20"><Phone size={16} className="text-cyan-500" /></div>}
      label="SMS (Africa's Talking)"
      badge={<StatusBadge connected={connected} />}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="API Key"><Inp value={apiKey} onChange={setApiKey} placeholder="Leave blank to keep existing" type="password" /></Field>
          <Field label="Username"><Inp value={username} onChange={setUsername} placeholder="Your AT username" /></Field>
        </div>
        <SaveBtn saving={saving} onClick={save} />
      </div>
    </SectionCard>
  )
}

const BLANK_TRUNK: Omit<SipTrunk, 'id'> = {
  name: '', host: '', port: 5060, netmask: 32, protocol: 'UDP',
  allowInbound: true, allowOutbound: true, optionsPing: false,
  username: '', password: '', useSipRegistration: false,
  leadingPlus: false, techPrefix: '', sipDiversionHeader: '',
}

function SipTrunksSection({ toast }: { toast: (m: string) => void }) {
  const [trunks,  setTrunks]  = useState<SipTrunk[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<SipTrunk | null>(null)
  const [adding,  setAdding]  = useState(false)
  const [form,    setForm]    = useState<typeof BLANK_TRUNK>({ ...BLANK_TRUNK })
  const [saving,  setSaving]  = useState(false)

  useEffect(() => {
    fetch(`${API}/ai-suite/connections/sip-trunks`, { headers: authH() })
      .then(r => r.json()).then(d => setTrunks(Array.isArray(d) ? d : [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  function startEdit(t: SipTrunk) {
    setEditing(t)
    setForm({ name: t.name, host: t.host, port: t.port, netmask: t.netmask, protocol: t.protocol,
      allowInbound: t.allowInbound, allowOutbound: t.allowOutbound, optionsPing: t.optionsPing,
      username: t.username || '', password: t.password || '', useSipRegistration: t.useSipRegistration,
      leadingPlus: t.leadingPlus, techPrefix: t.techPrefix || '', sipDiversionHeader: t.sipDiversionHeader || '' })
    setAdding(true)
  }

  async function save() {
    if (!form.name || !form.host) return toast('Name and host are required')
    setSaving(true)
    try {
      if (editing) {
        const res = await fetch(`${API}/ai-suite/connections/sip-trunks/${editing.id}`, { method: 'PATCH', headers: authH(true), body: JSON.stringify(form) })
        const updated = await res.json()
        setTrunks(ts => ts.map(t => t.id === editing.id ? updated : t)); toast('Trunk updated')
      } else {
        const res = await fetch(`${API}/ai-suite/connections/sip-trunks`, { method: 'POST', headers: authH(true), body: JSON.stringify(form) })
        const created = await res.json()
        setTrunks(ts => [...ts, created]); toast('Trunk added')
      }
      setAdding(false); setEditing(null)
    } catch { toast('Failed to save') } finally { setSaving(false) }
  }

  async function remove(id: string) {
    if (!confirm('Delete this SIP trunk?')) return
    await fetch(`${API}/ai-suite/connections/sip-trunks/${id}`, { method: 'DELETE', headers: authH() })
    setTrunks(ts => ts.filter(t => t.id !== id)); toast('Trunk deleted')
  }

  function setF(k: keyof typeof BLANK_TRUNK, v: any) { setForm(f => ({ ...f, [k]: v })) }

  return (
    <SectionCard
      icon={<div className="w-8 h-8 rounded-xl flex items-center justify-center bg-purple-50 dark:bg-purple-900/20"><Mic2 size={16} className="text-purple-500" /></div>}
      label="SIP Trunks (Voice)">
      <div className="space-y-4">
        {loading ? <Loader2 size={16} className="animate-spin text-gray-400" />
        : trunks.length === 0 ? <p className="text-sm text-gray-400 dark:text-white/40">No SIP trunks configured yet.</p>
        : (
          <div className="divide-y divide-gray-50 dark:divide-white/5">
            {trunks.map(t => (
              <div key={t.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white">{t.name}</p>
                  <p className="text-xs text-gray-400 dark:text-white/40 font-mono">{t.host}:{t.port} · {t.protocol}</p>
                  <div className="flex gap-2 mt-1">
                    {t.allowInbound  && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600">Inbound</span>}
                    {t.allowOutbound && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600">Outbound</span>}
                    {t.useSipRegistration && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600">Registered</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => startEdit(t)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 dark:hover:bg-white/10 transition-colors text-gray-400 hover:text-gray-600"><Edit3 size={13} /></button>
                  <button onClick={() => remove(t.id)} className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
        {!adding ? (
          <button onClick={() => { setEditing(null); setForm({ ...BLANK_TRUNK }); setAdding(true) }}
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
              <Field label="Name"><Inp value={form.name} onChange={v => setF('name', v)} placeholder="Roke Telecom" /></Field>
              <Field label="Host"><Inp value={form.host} onChange={v => setF('host', v)} placeholder="41.191.76.76" /></Field>
              <Field label="Port"><Inp value={String(form.port)} onChange={v => setF('port', parseInt(v) || 5060)} /></Field>
              <Field label="Protocol">
                <select value={form.protocol} onChange={e => setF('protocol', e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 dark:text-white focus:outline-none focus:border-cyan-500">
                  {['UDP','TCP','TLS'].map(p => <option key={p} className="dark:bg-gray-800">{p}</option>)}
                </select>
              </Field>
              <Field label="Username (optional)"><Inp value={form.username || ''} onChange={v => setF('username', v)} placeholder="trunk_user" /></Field>
              <Field label="Password (optional)"><Inp value={form.password || ''} onChange={v => setF('password', v)} placeholder="••••••••" type="password" /></Field>
            </div>
            <div className="flex flex-wrap gap-4 py-1">
              {([['allowInbound','Allow Inbound'],['allowOutbound','Allow Outbound'],['useSipRegistration','SIP Registration'],['leadingPlus','Leading +'],['optionsPing','OPTIONS Ping']] as [keyof typeof BLANK_TRUNK, string][]).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 text-xs text-gray-600 dark:text-white/60 cursor-pointer">
                  <input type="checkbox" checked={!!form[k]} onChange={e => setF(k, e.target.checked)} className="w-3.5 h-3.5 rounded accent-cyan-500" />
                  {label}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tech Prefix"><Inp value={form.techPrefix || ''} onChange={v => setF('techPrefix', v)} placeholder="Optional" /></Field>
              <Field label="SIP Diversion Header"><Inp value={form.sipDiversionHeader || ''} onChange={v => setF('sipDiversionHeader', v)} placeholder="Optional" /></Field>
            </div>
            <SaveBtn saving={saving} onClick={save} />
          </div>
        )}
      </div>
    </SectionCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSITE CHATBOT SECTION
// ═══════════════════════════════════════════════════════════════════════════════

const EMBED_CODE = `<!-- Code Clinic Chat Widget -->
<script>
  window.CodeClinicChatConfig = {
    clinicId: 'codeclinic',
    primaryColor: '#29ABE2',
    avatarUrl: 'https://codeclinic-production-73f628.up.railway.app/sarah.jpg'
  };
</script>
<script src="https://codeclinic-production-73f628.up.railway.app/chatbot-widget.js" async></script>`

function WebsiteChatbotSection() {
  const [copied, setCopied] = useState(false)

  function copyCode() {
    navigator.clipboard.writeText(EMBED_CODE).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <SectionCard
      icon={<Globe size={16} className="text-cyan-500" />}
      label="Website Chatbot"
      expandedDefault
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/30 rounded-xl">
          <Globe size={14} className="text-blue-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-blue-700 dark:text-blue-400">
            Add the snippet below to your website — Sarah will appear as a floating chat button. Works on any website including WordPress, Squarespace, and Wix.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-gray-500 dark:text-white/50 uppercase tracking-wide">Embed Code</p>
            <button
              onClick={copyCode}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all',
                copied
                  ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'
                  : 'bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-white/60 hover:bg-gray-200 dark:hover:bg-white/15',
              )}>
              <Copy size={12} />
              {copied ? 'Copied!' : 'Copy Code'}
            </button>
          </div>
          <pre className="bg-gray-900 text-gray-100 text-[11px] rounded-xl p-4 overflow-x-auto leading-relaxed select-all whitespace-pre-wrap break-all font-mono">
            {EMBED_CODE}
          </pre>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div className="p-3 bg-gray-50 dark:bg-white/3 rounded-xl border border-gray-100 dark:border-white/5">
            <p className="text-xs font-semibold text-gray-700 dark:text-white/70 mb-1">Widget Preview</p>
            <p className="text-xs text-gray-400 dark:text-white/40">Sarah avatar &bull; Bouncing &bull; Teal glow &bull; Chat with us tooltip</p>
          </div>
          <div className="p-3 bg-gray-50 dark:bg-white/3 rounded-xl border border-gray-100 dark:border-white/5">
            <p className="text-xs font-semibold text-gray-700 dark:text-white/70 mb-1">Live Widget Page</p>
            <a
              href="/chatbot-widget"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-cyan-600 dark:text-cyan-400 hover:underline mt-0.5">
              Open chatbot-widget <ExternalLink size={10} />
            </a>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function ConnectionsPage() {
  const [toast,          setToast]          = useState<string | null>(null)
  const [managingNumber, setManagingNumber] = useState<WaNumber | null>(null)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  if (managingNumber) {
    return (
      <div className="h-full overflow-y-auto">
        {toast && (
          <div className="fixed top-5 right-5 z-50 bg-gray-900 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl">{toast}</div>
        )}
        <WhatsAppManagePage number={managingNumber} onBack={() => setManagingNumber(null)} />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl space-y-5">
      {toast && (
        <div className="fixed top-5 right-5 z-50 bg-gray-900 text-white text-sm font-semibold px-4 py-3 rounded-2xl shadow-xl">{toast}</div>
      )}

      <div>
        <h1 className="text-xl font-black text-gray-800 dark:text-white">Connections</h1>
        <p className="text-sm text-gray-400 mt-0.5">Connect Sarah to your messaging channels</p>
      </div>

      <WhatsAppPanel onManage={num => setManagingNumber(num)} />

      <div className="space-y-5 max-w-3xl">
        <FacebookSection      toast={showToast} />
        <InstagramSection     toast={showToast} />
        <SmsSection           toast={showToast} />
        <SipTrunksSection     toast={showToast} />
        <WebsiteChatbotSection />
      </div>
    </div>
  )
}
