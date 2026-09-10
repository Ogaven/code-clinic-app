// Role-aware mobile navigation config — real, existing routes only.
//
// permKey values here are cross-checked against the SERVER-ENFORCED
// ROUTE_FEATURE table in apps/web/middleware.ts (the actual redirect-on-deny
// source of truth), not invented. ADMIN and DEVELOPER bypass all permission
// checks server-side (middleware.ts skips the ROUTE_FEATURE loop for those
// roles) so their nav below carries no permKeys.
//
// A permKey filters visibility client-side only as a UX convenience — it
// mirrors, but does not replace, middleware.ts's enforcement. Do not add an
// item here without a matching real page.tsx on disk.

import type { LucideIcon } from 'lucide-react'
import {
  LayoutDashboard, Users, CalendarDays, Sparkles, Stethoscope, MoreHorizontal,
  UsersRound, ShieldCheck, ClipboardList, Wallet, Receipt, Boxes, Target,
  Megaphone, Handshake, FileBarChart, BookOpen, PhoneCall, Mic, Settings, Zap, Bell,
} from 'lucide-react'

export interface MobileTab {
  key: string
  label: string
  href: string
  icon: LucideIcon
  permKey?: string
}

export interface MoreItem {
  label: string
  href: string
  icon: LucideIcon
  permKey?: string
}

export interface MoreSection {
  heading: string
  items: MoreItem[]
}

export interface MobileNavConfig {
  primary: MobileTab[] // exactly 4 real destinations + a "More" trigger is added by the component
  more: MoreSection[]
}

function visibleTabs(tabs: MobileTab[], perms: Record<string, boolean>): MobileTab[] {
  return tabs.filter(t => !t.permKey || perms[t.permKey] !== false)
}

function visibleSections(sections: MoreSection[], perms: Record<string, boolean>): MoreSection[] {
  return sections
    .map(s => ({ ...s, items: s.items.filter(i => !i.permKey || perms[i.permKey] !== false) }))
    .filter(s => s.items.length > 0)
}

const ADMIN_NAV: MobileNavConfig = {
  primary: [
    { key: 'home',        label: 'Home',         href: '/dashboard',        icon: LayoutDashboard },
    { key: 'patients',    label: 'Patients',     href: '/patients',         icon: Users },
    { key: 'appointments',label: 'Appointments', href: '/scheduling',       icon: CalendarDays },
    { key: 'ai-suite',    label: 'AI Suite',     href: '/ai-suite/inbox',   icon: Sparkles },
  ],
  more: [
    { heading: 'Staff', items: [
      { label: 'Staff List',   href: '/employees',                  icon: UsersRound },
      { label: 'Attendance',   href: '/admin/staff/attendance',     icon: ClipboardList },
      { label: 'Permissions',  href: '/admin/staff/permissions',    icon: ShieldCheck },
    ] },
    { heading: 'Treatments', items: [
      { label: 'Treatment Pipeline', href: '/treatment-pipeline', icon: Target },
    ] },
    { heading: 'Billing', items: [
      { label: 'Accounts',  href: '/accounts/dashboard', icon: Wallet },
      { label: 'Sales',     href: '/accounts/invoices',  icon: Receipt },
      { label: 'Expenses',  href: '/accounts/expenses',  icon: Receipt },
      { label: 'Payroll',   href: '/accounts/payroll',   icon: Wallet },
      { label: 'Stocks',    href: '/stocks',             icon: Boxes },
    ] },
    { heading: 'CRM', items: [
      { label: 'Leads',      href: '/leads',      icon: Target },
      { label: 'Campaigns',  href: '/campaigns',  icon: Megaphone },
      { label: 'Referrals',  href: '/referrals',  icon: Handshake },
    ] },
    { heading: 'Reports', items: [
      { label: 'Case Acceptance',   href: '/reports/case-acceptance', icon: FileBarChart },
      { label: 'Patient Live Flow', href: '/reports/patient-flow',    icon: FileBarChart },
      { label: 'Daily / Weekly',    href: '/reports/clinical',        icon: FileBarChart },
    ] },
    { heading: 'AI Suite', items: [
      { label: 'Knowledge Base',  href: '/ai-suite/knowledge-base', icon: BookOpen },
      { label: 'Call Logs',       href: '/ai-suite/calls',          icon: PhoneCall },
      { label: 'Voice Studio',    href: '/ai-suite/voice-studio',   icon: Mic },
    ] },
    { heading: 'General', items: [
      { label: 'Settings', href: '/settings', icon: Settings },
    ] },
  ],
}

// Matches middleware.ts ROUTE_FEATURE exactly: '/receptionist/scheduling' -> 'scheduling'.
const RECEPTIONIST_NAV: MobileNavConfig = {
  primary: [
    { key: 'home',        label: 'Home',         href: '/receptionist/dashboard',      icon: LayoutDashboard },
    { key: 'patients',    label: 'Patients',     href: '/receptionist/patients',       icon: Users,      permKey: 'patients' },
    { key: 'appointments',label: 'Appointments', href: '/receptionist/scheduling',     icon: CalendarDays, permKey: 'scheduling' },
    { key: 'ai-suite',    label: 'AI Suite',     href: '/receptionist/ai-suite/inbox', icon: Sparkles,   permKey: 'aiSuiteInbox' },
  ],
  more: [
    { heading: 'Clinic', items: [
      { label: 'Live Flow', href: '/receptionist/flow', icon: Zap, permKey: 'liveFlow' },
    ] },
    { heading: 'CRM', items: [
      { label: 'Treatment Pipeline', href: '/receptionist/treatment-pipeline', icon: Target,    permKey: 'treatmentPipeline' },
      { label: 'Leads',              href: '/receptionist/leads',             icon: Target,    permKey: 'leads' },
      { label: 'Referrals',          href: '/receptionist/referrals',         icon: Handshake, permKey: 'referrals' },
      { label: 'Campaigns',          href: '/receptionist/campaigns',         icon: Megaphone, permKey: 'campaigns' },
    ] },
    { heading: 'Reports', items: [
      { label: 'Case Acceptance',   href: '/receptionist/reports?tab=case-acceptance', icon: FileBarChart, permKey: 'reports' },
      { label: 'Patient Live Flow', href: '/receptionist/reports?tab=flow',            icon: FileBarChart, permKey: 'reports' },
      { label: 'Daily / Weekly',    href: '/receptionist/reports?tab=clinical',        icon: FileBarChart, permKey: 'reports' },
    ] },
    { heading: 'AI Suite', items: [
      { label: 'Knowledge Base', href: '/receptionist/ai-suite/knowledge',      icon: BookOpen, permKey: 'knowledgeBase' },
      { label: 'Call Logs',      href: '/receptionist/ai-suite/calls',          icon: PhoneCall, permKey: 'callLogs' },
      { label: 'Voice Studio',   href: '/receptionist/ai-suite/voice-studio',   icon: Mic,       permKey: 'voiceStudio' },
    ] },
    { heading: 'General', items: [
      { label: 'Settings', href: '/receptionist/settings', icon: Settings },
    ] },
  ],
}

const DOCTOR_NAV: MobileNavConfig = {
  primary: [
    { key: 'home',        label: 'Home',         href: '/doctor/dashboard',                  icon: LayoutDashboard },
    { key: 'patients',    label: 'Patients',     href: '/doctor/patients',                   icon: Users,        permKey: 'patients' },
    { key: 'appointments',label: 'Appointments', href: '/doctor/schedule',                   icon: CalendarDays, permKey: 'appointments' },
    { key: 'treatments',  label: 'Treatments',   href: '/doctor/reports/treatment-pipeline', icon: Stethoscope },
  ],
  more: [
    { heading: 'Clinic', items: [
      { label: 'Live Flow', href: '/doctor/flow', icon: Zap, permKey: 'liveFlow' },
    ] },
    { heading: 'AI Suite', items: [
      { label: 'Follow-up Dashboard',     href: '/doctor/ai-suite/followup-dashboard',     icon: FileBarChart, permKey: 'aiSuiteFollowup' },
      { label: 'Confirmation Dashboard',  href: '/doctor/ai-suite/confirmation-dashboard', icon: FileBarChart, permKey: 'aiSuiteConfirmation' },
      { label: 'Knowledge Base',          href: '/doctor/ai-suite/knowledge',              icon: BookOpen,     permKey: 'knowledgeBase' },
    ] },
    { heading: 'General', items: [
      { label: 'Notifications', href: '/doctor/notifications', icon: Bell },
      { label: 'Settings',      href: '/doctor/settings',      icon: Settings },
    ] },
  ],
}

export type MobileRole = 'ADMIN' | 'RECEPTIONIST' | 'DOCTOR'

export function getMobileNav(role: MobileRole, perms: Record<string, boolean>): MobileNavConfig {
  const base = role === 'ADMIN' ? ADMIN_NAV : role === 'RECEPTIONIST' ? RECEPTIONIST_NAV : DOCTOR_NAV
  // ADMIN bypasses permission checks server-side (middleware.ts) — never filter its nav.
  if (role === 'ADMIN') return base
  return { primary: visibleTabs(base.primary, perms), more: visibleSections(base.more, perms) }
}

export const MORE_ICON: LucideIcon = MoreHorizontal