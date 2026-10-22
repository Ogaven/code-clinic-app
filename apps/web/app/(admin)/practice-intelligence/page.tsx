'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Activity, CalendarDays, ClipboardList, Clock3, ShieldCheck, TrendingUp } from 'lucide-react'

/**
 * AI Practice Intelligence — read-only foundation.
 * Reuses the existing admin-only, approved clinical-production summary API.
 * No patient details are fetched and no operational actions are executed here.
 */
type CapacitySummary = { availableMinutes: number | null; partialKnownAvailableMinutes: number; includedDoctorDays: number; excludedDoctorDays: number; basis: string }

type CapacityReadiness = { activeDoctorCount: number; doctorsWithCompleteSchedules: number; doctorsWithIncompleteSchedules: number; incompleteDayCount: number; recordedBlockedTimeCount: number; recordedSpecialDayCount: number; basis: string }

type AppointmentInsights = { startDate: string; endDate: string; bookedCount: number; bookedMinutes: number; uniqueBookedMinutes: number; overlappingMinutes: number; cancelledCount: number; noShowCount: number; importedCount: number; invalidDurationCount: number; basis: string }

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
  const [previousAppointmentInsights, setPreviousAppointmentInsights] = useState<AppointmentInsights | null>(null)
  const [previousAppointmentError, setPreviousAppointmentError] = useState('')
  const [appointmentError, setAppointmentError] = useState('')
  const [capacityReadiness, setCapacityReadiness] = useState<CapacityReadiness | null>(null)
  const [capacityError, setCapacityError] = useState('')
  const [capacitySummary, setCapacitySummary] = useState<CapacitySummary | null>(null)
  const [capacitySummaryError, setCapacitySummaryError] = useState('')
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
        const reportNow = Date.now()
        const endDate = kampalaDay(new Date(reportNow))
        const startDate = kampalaDay(new Date(reportNow - 6 * 86400000))
        try {
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
        } catch (error) {
          if (active) setSummaryError(error instanceof Error ? error.message : 'Unable to load production.')
        }
        try {
          const capacityResponse = await fetch(
            '/api-proxy/scheduling/practice-capacity-summary?startDate=' + startDate + '&endDate=' + endDate,
            { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' },
          )
          if (!capacityResponse.ok) throw new Error('Configured capacity could not be loaded.')
          const capacity: CapacitySummary = await capacityResponse.json()
          if (capacity.basis !== 'CONFIGURED_DOCTOR_TIME_MINUS_RECORDED_BLOCKS') throw new Error('Invalid capacity source.')
          if (active) setCapacitySummary(capacity)
        } catch {
          if (active) setCapacitySummaryError('Configured capacity could not be loaded.')
        }
        try {
          const readinessResponse = await fetch('/api-proxy/scheduling/practice-capacity-readiness', {
            headers: { Authorization: 'Bearer ' + token }, cache: 'no-store',
          })
          if (!readinessResponse.ok) throw new Error('Capacity readiness unavailable.')
          const readiness: CapacityReadiness = await readinessResponse.json()
          if (readiness.basis !== 'SCHEDULE_CONFIGURATION_READINESS') throw new Error('Invalid readiness source.')
          if (active) setCapacityReadiness(readiness)
        } catch {
          if (active) setCapacityError('Capacity readiness unavailable.')
        }
        try {
          const appointmentResponse = await fetch(
            '/api-proxy/scheduling/practice-appointment-insights?startDate=' + startDate + '&endDate=' + endDate,
            { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' },
          )
          if (!appointmentResponse.ok) throw new Error('Appointment insights could not be loaded.')
          const appointmentData: AppointmentInsights = await appointmentResponse.json()
          if (appointmentData.basis !== 'SCHEDULED_APPOINTMENT_MINUTES' ||
              appointmentData.startDate !== startDate ||
              appointmentData.endDate !== endDate ||
              ![appointmentData.bookedCount, appointmentData.noShowCount, appointmentData.cancelledCount].every(value => Number.isSafeInteger(value) && value >= 0)) {
            throw new Error('Invalid appointment insight source.')
          }
          if (active) setAppointmentInsights(appointmentData)
        } catch {
          if (active) setAppointmentError('Appointment insights could not be loaded.')
        }
        // Compare with the immediately preceding, non-overlapping Kampala week.
        // This is historical comparison, never a predictive forecast.
        try {
          const previousEndDate = kampalaDay(new Date(reportNow - 7 * 86400000))
          const previousStartDate = kampalaDay(new Date(reportNow - 13 * 86400000))
          const previousResponse = await fetch(
            '/api-proxy/scheduling/practice-appointment-insights?startDate=' + previousStartDate + '&endDate=' + previousEndDate,
            { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' },
          )
          if (!previousResponse.ok) throw new Error('Previous-week appointment data unavailable.')
          const previous: AppointmentInsights = await previousResponse.json()
          if (previous.basis !== 'SCHEDULED_APPOINTMENT_MINUTES' ||
              previous.startDate !== previousStartDate ||
              previous.endDate !== previousEndDate ||
              ![previous.bookedCount, previous.noShowCount, previous.cancelledCount].every(value => Number.isSafeInteger(value) && value >= 0)) {
            throw new Error('Invalid previous-week appointment evidence.')
          }
          if (active) setPreviousAppointmentInsights(previous)
        } catch {
          if (active) setPreviousAppointmentError('Previous-week appointment data unavailable.')
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

  // Explain observed records without treating correlation as causation or
  // extrapolating a forecast from one seven-day window.
  const appointmentEvidence = appointmentInsights
  const previousWeek = previousAppointmentInsights
  const bookedDifference = appointmentEvidence && previousWeek
    ? appointmentEvidence.bookedCount - previousWeek.bookedCount : null
  const noShowDifference = appointmentEvidence && previousWeek
    ? appointmentEvidence.noShowCount - previousWeek.noShowCount : null
  const cancelledDifference = appointmentEvidence && previousWeek
    ? appointmentEvidence.cancelledCount - previousWeek.cancelledCount : null
  const signedDifference = (value: number) => (value > 0 ? '+' : '') + value.toLocaleString('en-UG')
  const layers = [
    {
      title: 'Performance overview',
      subtitle: 'What happened?',
      description: appointmentEvidence
        ? `${appointmentEvidence.bookedCount} booked visits, ${appointmentEvidence.uniqueBookedMinutes.toLocaleString('en-UG')} unique booked minutes and ${appointmentEvidence.noShowCount} no-shows over seven Kampala days. ${summary ? 'Approved clinical production: UGX ' + summary.netClinicalProductionUGX.toLocaleString('en-UG') + '.' : 'Approved production is unavailable.'}`
        : 'Appointment records are unavailable; no performance totals are estimated.',
      note: appointmentEvidence ? 'Observed appointment records, not confirmed attendance' : 'Awaiting appointment source data',
      icon: Activity,
    },
    {
      title: 'Performance diagnosis',
      subtitle: 'What factors are visible?',
      description: appointmentEvidence
        ? `${appointmentEvidence.cancelledCount} cancelled or rescheduled visits, ${appointmentEvidence.noShowCount} no-shows and ${appointmentEvidence.overlappingMinutes.toLocaleString('en-UG')} overlapping booked minutes. ${capacityReadiness ? capacityReadiness.doctorsWithIncompleteSchedules + ' of ' + capacityReadiness.activeDoctorCount + ' active dentists have incomplete weekly schedules.' : 'Schedule completeness unavailable.'}`
        : 'No reliable appointment evidence is available for a diagnosis.',
      note: 'Descriptive factors only; these do not establish causes',
      icon: ClipboardList,
    },
    {
      title: 'Forecasts and risks',
      subtitle: 'What is likely to happen?',
      description: 'A defensible forecast needs multiple comparable historical periods, stable appointment classifications and validated uncertainty ranges. Seven days of bookings alone cannot establish a reliable future trend.',
      note: 'Forecast withheld — insufficient validated historical evidence',
      icon: TrendingUp,
    },
    {
      title: 'Recommended actions',
      subtitle: 'What should we do?',
      description: capacityReadiness && capacityReadiness.doctorsWithIncompleteSchedules > 0
        ? `Review the ${capacityReadiness.doctorsWithIncompleteSchedules} incomplete doctor schedules and ${capacityReadiness.incompleteDayCount} missing or invalid day records before using capacity or utilization for management decisions. ${appointmentEvidence && appointmentEvidence.overlappingMinutes > 0 ? 'Also review overlapping appointment times in the existing calendar.' : ''}`
        : appointmentEvidence && appointmentEvidence.overlappingMinutes > 0
          ? 'Review overlapping booked appointment times in the existing calendar; confirm whether they are legitimate shared sessions before making changes.'
          : 'Continue checking schedule completeness and treatment production approval before setting operational targets.',
      note: 'Staff-reviewed guidance only — no automatic schedule or patient changes',
      icon: ShieldCheck,
    },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-clinic-blue">Code Clinic</p>
          <h1 className="mt-1 text-2xl font-bold text-clinic-navy dark:text-white">AI Practice Intelligence</h1>
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
            <h2 className="font-semibold text-clinic-navy dark:text-white">Capacity measurements are based on configured schedules</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
              The figures below use recorded appointments and configured doctor availability. They do not prove actual attendance, time worked, or profitability. Missing schedules are shown as incomplete, and approved treatment production is reported separately. No demo values are shown as real data.
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
        <h2 className="text-lg font-bold text-clinic-navy dark:text-white">Doctor capacity data readiness</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-300">
          Before calculating utilization, each active doctor's weekly working days must be explicitly configured.
        </p>
        {summaryLoading ? <p className="mt-3 text-sm text-gray-500">Checking schedule completeness…</p> :
          capacityError ? <p className="mt-3 text-sm text-amber-700" role="alert">{capacityError}</p> :
          capacityReadiness ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div><p className="text-xs text-gray-500">Active dentists</p><p className="text-xl font-bold">{capacityReadiness.activeDoctorCount}</p></div>
                <div><p className="text-xs text-gray-500">Complete schedules</p><p className="text-xl font-bold">{capacityReadiness.doctorsWithCompleteSchedules}</p></div>
                <div><p className="text-xs text-gray-500">Incomplete schedules</p><p className="text-xl font-bold">{capacityReadiness.doctorsWithIncompleteSchedules}</p></div>
                <div><p className="text-xs text-gray-500">Incomplete day records</p><p className="text-xl font-bold">{capacityReadiness.incompleteDayCount}</p></div>
              </div>
              <p className="mt-3 text-xs text-gray-500">
                Recorded blocked periods: {capacityReadiness.recordedBlockedTimeCount}.
                Recorded special days: {capacityReadiness.recordedSpecialDayCount}.
                These are configuration checks, not proof of staff attendance or a utilization calculation.
              </p>
            </>
          ) : <p className="mt-3 text-sm text-gray-500">No schedule readiness data available.</p>}
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
        <h2 className="text-lg font-bold text-clinic-navy dark:text-white">Configured available clinical minutes</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-300">
          Doctor working schedules minus configured breaks, blocked periods and clinic-wide days off.
        </p>
        {summaryLoading ? <p className="mt-3 text-sm text-gray-500">Calculating configured time…</p> :
          capacitySummaryError ? <p className="mt-3 text-sm text-amber-700" role="alert">{capacitySummaryError}</p> :
          capacitySummary ? (
            <>
              <p className="mt-3 text-2xl font-bold text-clinic-navy dark:text-white">
                {capacitySummary.availableMinutes === null ? 'Unavailable — no active doctors or incomplete configuration' :
                  capacitySummary.availableMinutes.toLocaleString() + ' minutes'}
              </p>
              <p className="mt-2 text-xs text-gray-500">
                Configured doctor-days evaluated: {capacitySummary.includedDoctorDays}.
                Doctor-days excluded for incomplete or unsupported configuration: {capacitySummary.excludedDoctorDays}.
                This is planned availability, not actual attendance or clinical utilization.
              </p>
            </>
          ) : <p className="mt-3 text-sm text-gray-500">No configured capacity data available.</p>}
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

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
        <h2 className="text-lg font-bold text-clinic-navy dark:text-white">Appointment trends — two recorded weeks</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-300">
          The latest seven Kampala days compared with the seven days immediately before them. Changes describe recorded appointment statuses, not confirmed attendance or a forecast.
        </p>
        {summaryLoading ? <p className="mt-4 text-sm text-gray-500">Loading historical comparison…</p> :
          previousAppointmentError || appointmentError ? <p className="mt-4 text-sm text-amber-700" role="alert">Historical comparison unavailable. No trend is estimated.</p> :
          appointmentEvidence && previousWeek && bookedDifference !== null && noShowDifference !== null && cancelledDifference !== null ? (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-gray-100 p-4 dark:border-white/10">
                <p className="text-xs text-gray-500">Booked visits</p>
                <p className="mt-1 text-xl font-bold">{appointmentEvidence.bookedCount.toLocaleString('en-UG')}</p>
                <p className="mt-1 text-xs text-gray-500">{signedDifference(bookedDifference)} versus prior week ({previousWeek.bookedCount})</p>
              </div>
              <div className="rounded-xl border border-gray-100 p-4 dark:border-white/10">
                <p className="text-xs text-gray-500">No-shows</p>
                <p className="mt-1 text-xl font-bold">{appointmentEvidence.noShowCount.toLocaleString('en-UG')}</p>
                <p className="mt-1 text-xs text-gray-500">{signedDifference(noShowDifference)} versus prior week ({previousWeek.noShowCount})</p>
              </div>
              <div className="rounded-xl border border-gray-100 p-4 dark:border-white/10">
                <p className="text-xs text-gray-500">Cancelled or rescheduled</p>
                <p className="mt-1 text-xl font-bold">{appointmentEvidence.cancelledCount.toLocaleString('en-UG')}</p>
                <p className="mt-1 text-xs text-gray-500">{signedDifference(cancelledDifference)} versus prior week ({previousWeek.cancelledCount})</p>
              </div>
            </div>
          ) : <p className="mt-4 text-sm text-gray-500">No comparable appointment records available.</p>}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {layers.map(({ title, subtitle, description, note, icon: Icon }) => (
          <section key={title} className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-white/5">
            <Icon size={22} className="text-clinic-blue" aria-hidden="true" />
            <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{subtitle}</p>
            <h2 className="mt-1 text-lg font-bold text-clinic-navy dark:text-white">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">{description}</p>
            <p className="mt-4 text-xs font-semibold text-gray-500 dark:text-gray-400">{note}</p>
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
