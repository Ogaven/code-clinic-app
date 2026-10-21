import Link from 'next/link'
import { Activity, CalendarDays, ClipboardList, Clock3, ShieldCheck, TrendingUp } from 'lucide-react'

/**
 * Practice Intelligence — read-only foundation.
 * No patient data is fetched and no operational actions are executed here.
 * Real clinic KPIs must only be enabled after audited, role-scoped API integration.
 */
export default function PracticeIntelligencePage() {
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
            <h2 className="font-semibold text-clinic-navy dark:text-white">Live measurements are not enabled yet</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
              We are validating appointment duration, dentist availability, verified treatment delivery
              and billing sources before publishing performance numbers. No demo values are shown as real data.
            </p>
          </div>
        </div>
      </div>

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
