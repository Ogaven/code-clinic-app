'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Activity, CalendarDays, ClipboardList, Clock3, ShieldCheck, TrendingUp } from 'lucide-react'

/**
 * Practice Intelligence — read-only foundation.
 * Reuses the existing admin-only, approved clinical-production summary API.
 * No patient details are fetched and no operational actions are executed here.
 */
type AppointmentInsights = { bookedCount: number; bookedMinutes: number; uniqueBookedMinutes: number; overlappingMinutes: number; cancelledCount: number; noShowCount: number; importedCount: number; invalidDurationCount: number; basis: string }

type ProductionGoals = { weekdayProductionGoalUGX: number | null; saturdayProductionGoalUGX: number | null }

type ProductionSummary = {
  startDate: string
  endDate: string
  netClinicalProductionUGX: number
  deliveryCount: number
  reversalCount: number
  adjustmentCount: number
  basis: 'APPROVED_CLINICAL_PRODUCTION_LEDGER'
}

function kampalaDay(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kampala', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const value = (part: string) => parts.find(item => item.type === part)?.value ?? ''
  return value('year') + '-' + value('month') + '-' + value('day')
}

export default function PracticeIntelligencePage() {
  const [summary, setSummary] = useState<ProductionSummary | null>(null)
  const [goals, setGoals] = useState<ProductionGoals | null>(null)
  const [goalsError, setGoalsError] = useState('')
  const [appointmentInsights, setAppointmentInsights] = useState<AppointmentInsights | null>(null)
  const [appointmentError, setAppointmentError] = useState('')
  const [summaryError, setSummaryError] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const raw = localStorage.getItem('cc_user')
        const user = raw ? JSON.parse(raw) as { role?: string } : null
        if (user?.role !== 'ADMIN') {
          if (active) setSummaryError('Administrator access is required for verified production reporting.')
          return
        }
        if (active) setAuthorized(true)
        const token = localStorage.getItem('cc_token')
        if (!token) throw new Error('Sign in to view verified production figures.')
        const endDate = kampalaDay(new Date())
        const startDate = kampalaDay(new Date(Date.now() - 6 * 86400000))
        const response = await fetch(
          '/api-proxy/clinical-production/summary?startDate=' + startDate + '&endDate=' + endDate,
          { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' },
        )
        if (!response.ok) throw new Error('Unable to load verified production (' + response.status + ').')
        const result: ProductionSummary = await response.json()
        if (result.basis !== 'APPROVED_CLINICAL_PRODUCTION_LEDGER' ||
            !Number.isSafeInteger(result.netClinicalProductionUGX) ||
            !Number.isSafeInteger(result.deliveryCount)) {
          throw new Error('The production report did not return verified ledger figures.')
        }
        if (active) setSummary(result)
        try {
          const appointmentResponse = await fetch(
            '/api-proxy/scheduling/practice-appointment-insights?startDate=' + startDate + '&endDate=' + endDate,
            { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' },
          )
          if (!appointmentResponse.ok) throw new Error('Appointment insights could not be loaded.')
          const appointmentData: AppointmentInsights = await appointmentResponse.json()
          if (appointmentData.basis !== 'SCHEDULED_APPOINTMENT_MINUTES') throw new Error('Invalid appointment insight source.')
          if (active) setAppointmentInsights(appointmentData)
        } catch {
          if (active) setAppointmentError('Appointment insights could not be loaded.')
        }
        try {
          const goalsResponse = await fetch('/api-proxy/scheduling/practice-production-goals', {
            headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
          })
          if (!goalsResponse.ok) throw new Error('Production goals could not be loaded.')
          const data: ProductionGoals = await goalsResponse.json()
          if (active) setGoals(data)
        } catch {
          if (active) setGoalsError('Production goals could not be loaded.')
        }
      } catch (error) {
        if (active) setSummaryError(error instanceof Error ? error.message : 'Unable to load production.')
      } finally {
        if (active) setSummaryLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  const layers = [
    {
      title: 'Performance overview',
      subtitle: 'What happened?',
      description: 'Appointment attendance, available clinical minutes and approved production will appear here after the source-data audit.',
      icon: Activity,
    },
    {
      title: 'Performance diagnosis',
      subtitle: 'Why did it happen?',
      description: 'Evidence-backed explanations of cancellations, schedule gaps and staff availability. No unsupported causal claims.',
      icon: ClipboardList,
    },
    {
      title: 'Forecasts and risks',
      subtitle: 'What is likely to happen?',
      description: 'Predictions will be enabled only when there is sufficient reliable history to show meaningful confidence ranges.',
      icon: TrendingUp,
    },
    {
      title: 'Recommended actions',
      subtitle: 'What should we do?',
      description: 'Future recommendations will be reviewed by authorized staff before any appointment or patient communication changes.',
      icon: ShieldCheck,
    },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-clinic-blue">Code Clinic</p>
          <h1 className="mt-1 text-2xl font-bold text-clinic-navy dark:text-white">Practice Intelligence</h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-500 dark:text-gray-300">
            A new operational intelligence workspace. The existing calendar, doctor and receptionist
            workflows remain unchanged.
          </p>
        </div>
        <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800">
          Read-only foundation
        </span>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
        <div className="flex items-start gap-3">
          <Clock3 className="mt-0.5 shrink-0 text-clinic-blue" size={20} aria-hidden="true" />
          <div>
            <h2 className="font-semibold text-clinic-navy dark:text-white">Appointment capacity measurements are not enabled yet</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
              We are validating appointment duration, dentist availability and billing sources before publishing capacity or profitability numbers. Approved treatment production is reported separately below. No demo values are shown as real data.
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">Last 7 Kampala calendar days · verified treatment delivery</p>
        <h2 className="mt-2 text-lg font-bold text-clinic-navy dark:text-white">Approved clinical production</h2>
        {summaryLoading ? (
          <p className="mt-3 text-sm text-gray-500" role="status">Loading verified figures…</p>
        ) : summaryError ? (
          <p className="mt-3 text-sm text-amber-700" role="alert">{summaryError}</p>
        ) : authorized && summary ? (
          <>
            <p className="mt-3 text-3xl font-bold text-clinic-navy dark:text-white">
              {'UGX ' + summary.netClinicalProductionUGX.toLocaleString('en-UG')}
            </p>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
              {summary.deliveryCount} approved deliveries · {summary.reversalCount} reversals · {summary.adjustmentCount} adjustments
            </p>
            <p className="mt-2 text-xs text-gray-500">
              {summary.startDate} to {summary.endDate}. Excludes pending/rejected entries, invoices and cash collections.
              Zero means no approved net production recorded for this period, not necessarily no treatment performed.
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-gray-500">No verified report available.</p>
        )}
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
        <h2 className="text-lg font-bold text-clinic-navy dark:text-white">Appointment time — last 7 Kampala days</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-300">Read-only scheduled appointment durations; not a measure of doctor capacity or utilization.</p>
        {summaryLoading ? <p className="mt-3 text-sm text-gray-500">Loading appointment figures…</p> :
          appointmentError ? <p className="mt-3 text-sm text-amber-700" role="alert">{appointmentError}</p> :
          appointmentInsights ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div><p className="text-xs text-gray-500">Unique booked minutes</p><p className="text-xl font-bold">{appointmentInsights.uniqueBookedMinutes.toLocaleString()}</p></div>
                <div><p className="text-xs text-gray-500">Booked visits</p><p className="text-xl font-bold">{appointmentInsights.bookedCount}</p></div>
                <div><p className="text-xs text-gray-500">Cancelled / rescheduled</p><p className="text-xl font-bold">{appointmentInsights.cancelledCount}</p></div>
                <div><p className="text-xs text-gray-500">No-shows</p><p className="text-xl font-bold">{appointmentInsights.noShowCount}</p></div>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                Imported records excluded: {appointmentInsights.importedCount}. Invalid durations: {appointmentInsights.invalidDurationCount}.
                Raw appointment minutes: {appointmentInsights.bookedMinutes.toLocaleString()}; overlapping minutes: {appointmentInsights.overlappingMinutes.toLocaleString()}. Unique booked time is deduplicated per dentist. Capacity and utilization remain unavailable until staffing and blocked-time checks are completed.
              </p>
            </>
          ) : <p className="mt-3 text-sm text-gray-500">No appointment figures available.</p>}
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
        <h2 className="text-lg font-bold text-clinic-navy dark:text-white">Manager-defined daily production goals</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-300">
          Goals measure intended value of approved treatment delivery, not the number of appointments.
        </p>
        {summaryLoading ? <p className="mt-3 text-sm text-gray-500">Loading goals…</p> :
          goalsError ? <p className="mt-3 text-sm text-amber-700" role="alert">{goalsError}</p> :
          goals ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-gray-500">Monday–Friday</p>
                <p className="mt-1 text-xl font-bold text-clinic-navy dark:text-white">
                  {goals.weekdayProductionGoalUGX == null ? 'Not set' : 'UGX ' + goals.weekdayProductionGoalUGX.toLocaleString('en-UG')}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500">Saturday</p>
                <p className="mt-1 text-xl font-bold text-clinic-navy dark:text-white">
                  {goals.saturdayProductionGoalUGX == null ? 'Not set' : 'UGX ' + goals.saturdayProductionGoalUGX.toLocaleString('en-UG')}
                </p>
              </div>
            </div>
          ) : <p className="mt-3 text-sm text-gray-500">No goal data available.</p>}
        <Link href="/settings" className="mt-4 inline-block text-sm font-semibold text-clinic-blue hover:underline">
          Manage goals in Settings
        </Link>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {layers.map(({ title, subtitle, description, icon: Icon }) => (
          <section key={title} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
            <Icon size={22} className="text-clinic-blue" aria-hidden="true" />
            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{subtitle}</p>
            <h2 className="mt-1 text-lg font-bold text-clinic-navy dark:text-white">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">{description}</p>
            <p className="mt-4 text-xs font-semibold text-gray-500 dark:text-gray-400">Awaiting verified data integration</p>
          </section>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-100 bg-white p-5 dark:border-white/10 dark:bg-white/5">
        <CalendarDays className="text-clinic-blue" size={20} aria-hidden="true" />
        <p className="flex-1 text-sm text-gray-600 dark:text-gray-300">
          Appointment management continues in the existing scheduling calendar.
        </p>
        <Link href="/scheduling" className="rounded-xl bg-clinic-navy px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
          Open existing calendar
        </Link>
      </div>
    </div>
  )
}
