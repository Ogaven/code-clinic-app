'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronDown, ChevronUp, MessageSquare, Send, HelpCircle, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'

const FAQS = [
  {
    q: 'How do I check in when I arrive at the clinic?',
    a: 'Tap the "Check In" button on your dashboard (green button in the hero card or sidebar). This logs your arrival time and notifies the admin and receptionist. You can only check in once per session — checking in again after checking out creates a new record.',
  },
  {
    q: 'How do I block time off in my schedule?',
    a: 'Go to Schedule → Block Time Off section. Pick a date, reason (Lunch Break, Meeting, Holiday, etc.), and either set a time range or toggle "All day". Add an optional note and tap "Block This Time". Blocked slots prevent new appointments from being booked during that window.',
  },
  {
    q: 'Can I view my patients\' dental charts from the doctor app?',
    a: 'Yes. Go to My Patients, find the patient, and tap "Dental Chart". This opens the full dental chart in the main admin UI at /patients/[id]?tab=dental. You can view charted teeth, treatment plans, and perio readings.',
  },
  {
    q: 'What does the AI assistant Sarah know about my patients?',
    a: 'Sarah has access to the clinic knowledge base (procedures, pricing, policies) and can reason about patient care. She does NOT have direct access to individual patient records in real-time, but you can paste a summary or ask general clinical questions. Tap the chat bubble (bottom-right) to open Sarah.',
  },
  {
    q: 'How do I change my working days or availability?',
    a: 'Go to Profile → Availability section. Tap the day buttons (Mon–Sun) to toggle working days on or off, then tap "Save Availability". This updates your availability in the scheduling system so receptionists see correct slots when booking.',
  },
  {
    q: 'How do I reset my password?',
    a: 'Go to Profile → Change Password. Enter your current password, then your new password (must match confirmation). Tap "Update Password". If you\'ve forgotten your password, contact the admin to reset it from the admin console.',
  },
  {
    q: 'Why is my notification badge not clearing?',
    a: 'Tap Messages or Notifications and use "Mark all read". The badge resets after the API call succeeds. If it persists, tap the refresh icon to re-fetch. The badge polls every 30 seconds automatically.',
  },
  {
    q: 'How do I switch between light and dark mode?',
    a: 'Use the theme toggle in the sidebar (bottom of the left panel on desktop). "System" follows your device preference. "Light" and "Dark" override it regardless of device setting. Your preference is saved locally and persists across sessions.',
  },
]

const SUBJECTS = [
  'Technical issue',
  'Scheduling problem',
  'Account / login issue',
  'Feature request',
  'Patient data question',
  'Other',
]

export default function DoctorSupportPage() {
  const [open, setOpen]           = useState<number | null>(null)
  const [subject, setSubject]     = useState(SUBJECTS[0])
  const [message, setMessage]     = useState('')
  const [sending, setSending]     = useState(false)
  const [sent, setSent]           = useState(false)
  const [error, setError]         = useState('')

  const token = typeof window !== 'undefined' ? localStorage.getItem('cc_token') : null
  const user  = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('cc_user') || '{}') : {}

  async function sendMessage() {
    if (!message.trim() || !token) return
    setSending(true); setError('')
    try {
      // Create a notification to admin
      const res = await fetch('/api-proxy/receptionist/notifications/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: `Support: ${subject}`,
          body: `From Dr. ${user.name || user.email}: ${message}`,
          type: 'SYSTEM',
          href: '/dashboard',
          roles: ['ADMIN'],
        }),
      })
      if (res.ok || res.status === 201) {
        setSent(true); setMessage('')
        setTimeout(() => setSent(false), 5000)
      } else {
        setError('Could not send message. Please try again.')
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-5 p-4 md:p-6 pb-24 md:pb-6 animate-fade-in max-w-3xl">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/doctor/dashboard" className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 text-gray-400 transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">Help & Support</h1>
          <p className="text-sm text-gray-400 mt-0.5">FAQs, contact admin, and AI assistant</p>
        </div>
      </div>

      {/* Sarah AI quick button */}
      <div className="bg-gradient-to-r from-[#1A237E] to-[#29ABE2] rounded-2xl p-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
          <Bot size={24} className="text-white" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-white">Ask Sarah AI</p>
          <p className="text-xs text-blue-100 mt-0.5">Get instant answers about clinic procedures, protocols, and patient care</p>
        </div>
        <div className="text-white text-xs font-semibold bg-white/20 px-3 py-1.5 rounded-lg">
          Chat bubble →
        </div>
      </div>

      {/* FAQ Accordion */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 dark:border-white/[0.06] flex items-center gap-2">
          <HelpCircle size={16} className="text-blue-500" />
          <h2 className="font-bold text-gray-800 dark:text-white">Frequently Asked Questions</h2>
        </div>
        <div className="divide-y divide-gray-50 dark:divide-white/[0.04]">
          {FAQS.map((faq, i) => (
            <div key={i}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-start justify-between gap-4 px-5 py-4 text-left hover:bg-gray-50 dark:hover:bg-white/[0.03] transition-colors"
              >
                <span className="text-sm font-semibold text-gray-700 dark:text-white leading-snug">{faq.q}</span>
                {open === i
                  ? <ChevronUp size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />
                  : <ChevronDown size={16} className="text-gray-400 flex-shrink-0 mt-0.5" />}
              </button>
              {open === i && (
                <div className="px-5 pb-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{faq.a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Contact Admin form */}
      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-50 dark:border-white/[0.06] flex items-center gap-2">
          <MessageSquare size={16} className="text-purple-500" />
          <h2 className="font-bold text-gray-800 dark:text-white">Contact Admin</h2>
        </div>
        <div className="p-5 space-y-4">
          {sent && (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/30 rounded-xl px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300 font-semibold">
              Message sent! Admin has been notified.
            </div>
          )}
          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/30 rounded-xl px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">Subject</label>
            <select value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none">
              {SUBJECTS.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5 block">Description</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={4}
              placeholder="Describe the issue or question in detail…"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-white/10 dark:bg-gray-800 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
            />
          </div>
          <button
            onClick={sendMessage}
            disabled={sending || !message.trim()}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-white transition-all min-h-[44px]',
              sending || !message.trim()
                ? 'opacity-50 cursor-not-allowed bg-gray-400'
                : 'hover:-translate-y-0.5 active:translate-y-0',
            )}
            style={sending || !message.trim() ? {} : { background: 'linear-gradient(135deg,#1A237E,#29ABE2)' }}
          >
            <Send size={14} />
            {sending ? 'Sending…' : 'Send to Admin'}
          </button>
        </div>
      </div>

      {/* Footer info */}
      <div className="text-center text-xs text-gray-400 pb-2 space-y-1">
        <p>Code Clinic · Kampala, Uganda</p>
        <p>For urgent issues, contact reception directly or use the clinic intercom.</p>
      </div>
    </div>
  )
}
