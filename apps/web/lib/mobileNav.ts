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
  MessageSquare, AlertTriangle, CalendarClock, BadgeCheck, LineChart, Bot, ScrollText,
} from 'lucide-react'

// A primary tab either navigates directly (`link`) or opens a compact mobile
// menu/sheet of sub-destinations (`menu`) — e.g. ADMIN's "Reports" tab opens
// a sheet rather than navigating, since there is no single "/reports" page
// that covers Case Acceptance + Staff together. RECEPTIONIST/DOCTOR keep
// their existing plain-link tabs (`type: 'link'` on every primary entry)
// unchanged this pass — only ADMIN's primary tabs use `menu`.
export interface LinkTab {
  type: 'link'
  key: string
  label: string
  // Tab-bar-only short label for labels that don't fit a 6-column mobile bar
  // (e.g. "Appointments" -> "Appts"). Full `label` is still used for
  // aria-label and anywhere else the tab name is shown.
  shortLabel?: string
  href: string
  icon: LucideIcon
  permKey?: string
}

export interface MenuTab {
  type: 'menu'
  key: string
  label: string
  icon: LucideIcon
  permKey?: string
  sections: MoreSection[]
}

export type MobileTab = LinkTab | MenuTab

export interface MoreItem {
  label: string
  href: string
  icon: LucideIcon
  permKey?: string
  // Optional one-level drill-down (e.g. Patients -> Billing). When present,
  // tapping this item does not navigate — it swaps the sheet to `children`.
  children?: MoreSection[]
}

export interface MoreSection {
  heading: string
  items: MoreItem[]
}

export interface MobileNavConfig {
  primary: MobileTab[]
  more: MoreSection[] // legacy "More" sheet sections — empty for ADMIN, which has no More button
}

function visibleTabs(tabs: MobileTab[], perms: Record<string, boolean>): MobileTab[] {
  return tabs
    .filter(t => !t.permKey || perms[t.permKey] !== false)
    .map(t => t.type === 'menu' ? { ...t, sections: visibleSections(t.sections, perms) } : t)
    .filter(t => t.type === 'link' || t.sections.length > 0)
}

function visibleSections(sections: MoreSection[], perms: Record<string, boolean>): MoreSection[] {
  return sections
    .map(s => ({
      ...s,
      items: s.items
        .filter(i => !i.permKey || perms[i.permKey] !== false)
        .map(i => i.children ? { ...i, children: visibleSections(i.children, perms) } : i),
    }))
    .filter(s => s.items.length > 0)
}

// ADMIN mobile nav: 6 primary destinations, no "Home" tab (the logo in
// MobileHeader is Home) and no "More" button (every former More destination
// now lives behind one of these 6 tabs' own menu — see `more: []` below).
const ADMIN_NAV: MobileNavConfig = {
  primary: [
    {
      type: 'menu', key: 'patients', label: 'Patients', icon: Users,
      sections: [{
        heading: 'Patients',
        items: [
          { label: 'Patients', href: '/patients', icon: Users },
          {
            label: 'Billing', href: '#', icon: Wallet,
            children: [{
              heading: 'Billing',
              items: [
                { label: 'Accounts',  href: '/accounts/dashboard', icon: Wallet },
                { label: 'Sales',     href: '/accounts/invoices',  icon: Receipt },
                { label: 'Expenses',  href: '/accounts/expenses',  icon: Receipt },
                { label: 'Payroll',   href: '/accounts/payroll',   icon: Wallet },
                { label: 'Stocks',    href: '/stocks',             icon: Boxes },
              ],
            }],
          },
        ],
      }],
    },
    { type: 'link', key: 'appointments', label: 'Appointments', shortLabel: 'Appts', href: '/scheduling', icon: CalendarDays },
    {
      type: 'menu', key: 'ai-suite', label: 'AI Suite', icon: Sparkles,
      sections: [{
        heading: 'AI Suite',
        items: [
          { label: 'Conversations',     href: '/ai-suite/inbox',                  icon: MessageSquare },
          { label: 'Knowledge Base',    href: '/ai-suite/knowledge-base',         icon: BookOpen },
          { label: 'Escalations',       href: '/ai-suite/escalations',            icon: AlertTriangle },
          { label: 'Follow-ups',        href: '/ai-suite/followup-dashboard',     icon: CalendarClock },
          { label: 'Confirmations',     href: '/ai-suite/confirmation-dashboard', icon: BadgeCheck },
          { label: 'Agent Control',     href: '/ai-suite',                        icon: Bot },
          { label: 'Call Logs',         href: '/ai-suite/calls',                  icon: PhoneCall },
          { label: 'Voice Studio',      href: '/ai-suite/voice-studio',           icon: Mic },
          { label: 'Analytics & Costs', href: '/ai-suite/analytics',              icon: LineChart },
          { label: 'AI Settings',       href: '/ai-suite/settings',               icon: Settings },
        ],
      }],
    },
    { type: 'link', key: 'treatment', label: 'Treatment', href: '/treatment-pipeline', icon: Target },
    {
      type: 'menu', key: 'crm', label: 'CRM', icon: Handshake,
      sections: [{
        heading: 'CRM',
        items: [
          { label: 'Leads',     href: '/leads',     icon: Target },
          { label: 'Campaigns', href: '/campaigns', icon: Megaphone },
          { label: 'Referrals', href: '/referrals',  icon: Handshake },
        ],
      }],
    },
    {
      type: 'menu', key: 'reports', label: 'Reports', icon: FileBarChart,
      sections: [
        { heading: 'Reports', items: [
          { label: 'Case Acceptance',   href: '/reports/case-acceptance', icon: FileBarChart },
          { label: 'Patient Live Flow', href: '/reports/patient-flow',    icon: FileBarChart },
          { label: 'Daily / Weekly',    href: '/reports/clinical',        icon: FileBarChart },
        ] },
        { heading: 'Staff', items: [
          { label: 'Staff List',        href: '/employees',               icon: UsersRound },
          { label: 'Attendance',        href: '/admin/staff/attendance',  icon: ClipboardList },
          { label: 'Staff Permissions', href: '/admin/staff/permissions', icon: ShieldCheck },
          { label: 'Audit Logs',        href: '/audit-log',               icon: ScrollText },
        ] },
      ],
    },
  ],
  more: [],
}

// Matches middleware.ts ROUTE_FEATURE exactly: '/receptionist/scheduling' -> 'appointments'
// (canonical key post scheduling/appointments merge — see middleware.ts).
const RECEPTIONIST_NAV: MobileNavConfig = {
  primary: [
    { type: 'link', key: 'home',        label: 'Home',         href: '/receptionist/dashboard',      icon: LayoutDashboard },
    { type: 'link', key: 'patients',    label: 'Patients',     href: '/receptionist/patients',       icon: Users,      permKey: 'patients' },
    { type: 'link', key: 'appointments',label: 'Appointments', href: '/receptionist/scheduling',     icon: CalendarDays, permKey: 'appointments' },
    { type: 'link', key: 'ai-suite',    label: 'AI Suite',     href: '/receptionist/ai-suite/inbox', icon: Sparkles,   permKey: 'aiSuiteInbox' },
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
    { type: 'link', key: 'home',        label: 'Home',         href: '/doctor/dashboard',                  icon: LayoutDashboard },
    { type: 'link', key: 'patients',    label: 'Patients',     href: '/doctor/patients',                   icon: Users,        permKey: 'patients' },
    { type: 'link', key: 'appointments',label: 'Appointments', href: '/doctor/schedule',                   icon: CalendarDays, permKey: 'appointments' },
    { type: 'link', key: 'treatments',  label: 'Treatments',   href: '/doctor/reports/treatment-pipeline', icon: Stethoscope },
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