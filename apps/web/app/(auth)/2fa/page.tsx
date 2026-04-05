'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function TwoFAPage() {
  const router = useRouter()
  const [digits, setDigits] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    inputRefs.current[0]?.focus()
  }, [])

  function handleDigit(index: number, value: string) {
    const cleaned = value.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = cleaned
    setDigits(next)
    if (cleaned && index < 5) {
      inputRefs.current[index + 1]?.focus()
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus()
    }
  }

  async function handleVerify() {
    const code = digits.join('')
    if (code.length !== 6) return

    const tempToken = sessionStorage.getItem('cc_temp_token')
    if (!tempToken) { router.push('/login'); return }

    setError(null)
    setLoading(true)

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/auth/2fa/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tempToken}`,
        },
        body: JSON.stringify({ token: code }),
        credentials: 'include',
      })

      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Invalid code'); return }

      sessionStorage.removeItem('cc_temp_token')
      localStorage.setItem('cc_token', data.accessToken)
      localStorage.setItem('cc_user', JSON.stringify(data.user))

      const role = data.user.role
      if (role === 'ADMIN') router.push('/dashboard')
      else if (role === 'DOCTOR') router.push('/doctor/dashboard')
      else if (role === 'RECEPTIONIST') router.push('/receptionist/dashboard')
      else if (role === 'ACCOUNTS') router.push('/accounts/dashboard')
      else router.push('/dashboard')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (digits.every((d) => d !== '')) handleVerify()
  }, [digits])

  return (
    <div className="min-h-screen bg-clinic-bg flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <ShieldCheck size={28} className="text-clinic-blue" />
        </div>
        <h2 className="text-2xl font-bold text-clinic-navy mb-2">Two-factor authentication</h2>
        <p className="text-gray-500 text-sm mb-8">
          Enter the 6-digit code from your authenticator app
        </p>

        <div className="flex justify-center gap-2 mb-6">
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleDigit(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className={cn(
                'w-11 h-12 text-center text-xl font-bold border-2 rounded-lg',
                'focus:outline-none focus:border-clinic-blue transition-colors',
                d ? 'border-clinic-blue bg-blue-50 text-clinic-navy' : 'border-gray-200 text-gray-800',
              )}
            />
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
            {error}
          </div>
        )}

        <button
          onClick={handleVerify}
          disabled={loading || digits.some((d) => !d)}
          className={cn(
            'w-full py-2.5 rounded-lg font-semibold text-white text-sm transition-all',
            'bg-clinic-blue hover:bg-[#1a96cc] flex items-center justify-center gap-2',
            (loading || digits.some((d) => !d)) && 'opacity-60 cursor-not-allowed',
          )}
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          Verify
        </button>

        <button
          onClick={() => router.push('/login')}
          className="mt-4 text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          ← Back to login
        </button>
      </div>
    </div>
  )
}
