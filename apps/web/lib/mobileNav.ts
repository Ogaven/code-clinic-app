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
  Users, CalendarDays, Sparkles, MoreHorizontal,
  UsersRound, ShieldCheck, ClipboardList, Wallet, Receipt, Boxes, Target,
  Megaphone, Handshake, FileBarChart, BookOpen, PhoneCall, Mic, Zap, Settings,
  MessageSquare, AlertTriangle, CalendarClock, BadgeCheck, LineChart, Bot, ScrollText,
} from 'lucide-react'

// A primary tab either navigates directly (`link`) or opens a compact mobile
// menu/sheet of sub-destinations (`menu`) — e.g. ADMIN's "Reports" tab opens
// a sheet rather than navigating, since there is no single "/reports" page
// that covers Case Acceptance + Staff together. RECEPTIONIST's "AI Suite",
// "CRM" and "Reports" tabs and DOCTOR's "AI Suite" tab use the same pattern,
// for the same reason.
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
          { label: 'Dashboard', href: '/crm', icon: LineChart },
          {
            label: 'Leads', href: '#', icon: Target,
            children: [{
              heading: 'Leads',
              items: [
                { label: 'Pipeline',        href: '/leads',                  icon: Target },
                { label: 'Needs Attention', href: '/crm/needs-attention',    icon: AlertTriangle },
                { label: 'Sources',         href: '/crm/sources',            icon: Megaphone },
                { label: 'Campaigns',       href: '/campaigns',              icon: Megaphone },
                { label: 'Referrals',       href: '/crm/referrals',          icon: Handshake },
                { label: 'Revenue',         href: '/crm/revenue',            icon: Wallet },
                { label: 'Reports',         href: '/crm/reports',            icon: FileBarChart },
              ],
            }],
          },
          {
            label: 'Patient Engagement', href: '#', icon: UsersRound,
            children: [{
              heading: 'Patient Engagement',
              items: [
                { label: 'Recall',             href: '/crm/recall',             icon: CalendarClock },
                { label: 'Treatment Follow-up', href: '/crm/treatment-followup', icon: ClipboardList },
                { label: 'Reactivation',        href: '/crm/reactivation',       icon: AlertTriangle },
                { label: 'Waitlist',            href: '/waitlist',               icon: CalendarDays },
                { label: 'Reviews',             href: '/crm/reviews',            icon: BadgeCheck },
                { label: 'Collections',         href: '/crm/collections',        icon: Wallet },
              ],
            }],
          },
          { label: 'Settings', href: '/admin/crm-automation', icon: Settings },
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

// Reworked per clinic feedback: reception's bottom nav previously buried Live
// Flow, CRM and Reports behind a catch-all "More" sheet, and staff couldn't
// get to them in one tap. Home is intentionally dropped from the primary bar
// (matches ADMIN_NAV's convention — the MobileHeader logo is Home); the
// dashboard route itself still exists for anyone linking to it directly.
// 6 primary destinations, following ADMIN_NAV's "menu tab per group" pattern
// so nothing needs a "More" sheet at all (`more: []`) — CRM/Reports/AI Suite
// sub-pages that used to live in `more` now live inside their own tab's menu.
// Matches middleware.ts ROUTE_FEATURE exactly: '/receptionist/scheduling' -> 'appointments'
// (canonical key post scheduling/appointments merge — see middleware.ts).
const RECEPTIONIST_NAV: MobileNavConfig = {
  primary: [
    { type: 'link', key: 'patients',    label: 'Patients',     href: '/receptionist/patients',   icon: Users,        permKey: 'patients' },
    { type: 'link', key: 'appointments',label: 'Appointments', shortLabel: 'Appts', href: '/receptionist/scheduling', icon: CalendarDays, permKey: 'appointments' },
    { type: 'link', key: 'live-flow',   label: 'Live Flow',    href: '/receptionist/flow',       icon: Zap,          permKey: 'liveFlow' },
    {
      type: 'menu', key: 'ai-suite', label: 'AI Suite', icon: Sparkles, permKey: 'aiSuiteInbox',
      sections: [{
        heading: 'AI Suite',
        items: [
          { label: 'Conversations',        href: '/receptionist/ai-suite/inbox',                 icon: MessageSquare, permKey: 'aiSuiteInbox' },
          { label: 'Escalations',          href: '/receptionist/ai-suite/escalations',            icon: AlertTriangle, permKey: 'aiSuiteInbox' },
          { label: 'Follow-up Dashboard',  href: '/receptionist/ai-suite/followup-dashboard',     icon: CalendarClock, permKey: 'aiSuiteFollowup' },
          { label: 'Confirmation Dashboard', href: '/receptionist/ai-suite/confirmation-dashboard', icon: BadgeCheck,  permKey: 'aiSuiteConfirmation' },
          { label: 'Knowledge Base',        href: '/receptionist/ai-suite/knowledge',              icon: BookOpen,     permKey: 'knowledgeBase' },
          { label: 'Call Logs',            href: '/receptionist/ai-suite/calls',                  icon: PhoneCall,    permKey: 'callLogs' },
          { label: 'Voice Studio',          href: '/receptionist/ai-suite/voice-studio',           icon: Mic,          permKey: 'voiceStudio' },
        ],
      }],
    },
    {
      type: 'menu', key: 'crm', label: 'CRM', icon: Handshake,
      sections: [{
        heading: 'CRM',
        items: [
          // Dashboard/Needs Attention/Sources ride the existing 'leads'
          // permission — see the matching comment in ReceptionistTopBar.tsx
          // for why no new permission key was added. Patient Engagement
          // items ride 'patients' instead — they concern existing patients,
          // not leads, and no Revenue/Collections/Settings here (Admin/
          // Accounts only, matching the backend's accountsOrAdmin gate).
          { label: 'Dashboard',          href: '/receptionist/crm',                icon: LineChart, permKey: 'leads' },
          { label: 'Treatment Pipeline', href: '/receptionist/treatment-pipeline', icon: Target,    permKey: 'treatmentPipeline' },
          {
            label: 'Leads', href: '#', icon: Target, permKey: 'leads',
            children: [{
              heading: 'Leads',
              items: [
                { label: 'Pipeline',        href: '/receptionist/leads',              icon: Target,        permKey: 'leads' },
                { label: 'Needs Attention', href: '/receptionist/crm/needs-attention', icon: AlertTriangle, permKey: 'leads' },
                { label: 'Sources',         href: '/receptionist/crm/sources',        icon: Megaphone,     permKey: 'leads' },
                { label: 'Campaigns',       href: '/receptionist/campaigns',          icon: Megaphone,     permKey: 'campaigns' },
                { label: 'Referrals',       href: '/receptionist/crm/referrals',      icon: Handshake,     permKey: 'referrals' },
                { label: 'Reports',         href: '/receptionist/crm/reports',        icon: FileBarChart,  permKey: 'leads' },
              ],
            }],
          },
          {
            label: 'Patient Engagement', href: '#', icon: UsersRound, permKey: 'patients',
            children: [{
              heading: 'Patient Engagement',
              items: [
                { label: 'Recall',             href: '/receptionist/crm/recall',             icon: CalendarClock, permKey: 'patients' },
                { label: 'Treatment Follow-up', href: '/receptionist/crm/treatment-followup', icon: ClipboardList, permKey: 'patients' },
                { label: 'Reactivation',        href: '/receptionist/crm/reactivation',       icon: AlertTriangle, permKey: 'patients' },
                { label: 'Waitlist',            href: '/receptionist/waitlist',               icon: CalendarDays,  permKey: 'patients' },
              ],
            }],
          },
        ],
      }],
    },
    {
      type: 'menu', key: 'reports', label: 'Reports', icon: FileBarChart, permKey: 'reports',
      sections: [{
        heading: 'Reports',
        items: [
          { label: 'Case Acceptance',   href: '/receptionist/reports?tab=case-acceptance', icon: FileBarChart, permKey: 'reports' },
          { label: 'Patient Live Flow', href: '/receptionist/reports?tab=flow',            icon: FileBarChart, permKey: 'reports' },
          { label: 'Daily / Weekly',    href: '/receptionist/reports?tab=clinical',        icon: FileBarChart, permKey: 'reports' },
        ],
      }],
    },
  ],
  more: [],
}

// Doctor gets its own 5-tab set — never inherits Reception/Admin's nav.
// "My Patients" is a label-only change (same /doctor/patients route); "AI
// Suite" replaces the old "Treatments" primary tab (doctor's real AI Suite
// pages — follow-up/confirmation dashboards, knowledge base — were
// previously buried in More, which contradicted having an AI Suite tab at
// all). "Reports" points at the one real doctor reports page that exists
// today (treatment-pipeline) — there is no general /doctor/reports index to
// link to instead.
const DOCTOR_NAV: MobileNavConfig = {
  primary: [
    { type: 'link', key: 'patients',    label: 'My Patients',  href: '/doctor/patients', icon: Users,        permKey: 'patients' },
    { type: 'link', key: 'appointments',label: 'Appointments', shortLabel: 'Appts', href: '/doctor/schedule', icon: CalendarDays, permKey: 'appointments' },
    { type: 'link', key: 'live-flow',   label: 'Live Flow',    href: '/doctor/flow',     icon: Zap,          permKey: 'liveFlow' },
    {
      type: 'menu', key: 'ai-suite', label: 'AI Suite', icon: Sparkles,
      sections: [{
        heading: 'AI Suite',
        items: [
          { label: 'Follow-up Dashboard',    href: '/doctor/ai-suite/followup-dashboard',     icon: CalendarClock, permKey: 'aiSuiteFollowup' },
          { label: 'Confirmation Dashboard', href: '/doctor/ai-suite/confirmation-dashboard', icon: BadgeCheck,    permKey: 'aiSuiteConfirmation' },
          { label: 'Knowledge Base',         href: '/doctor/ai-suite/knowledge',              icon: BookOpen,      permKey: 'knowledgeBase' },
        ],
      }],
    },
    { type: 'link', key: 'reports', label: 'Reports', href: '/doctor/reports/treatment-pipeline', icon: FileBarChart },
  ],
  more: [],
}

export type MobileRole = 'ADMIN' | 'RECEPTIONIST' | 'DOCTOR'

export function getMobileNav(role: MobileRole, perms: Record<string, boolean>): MobileNavConfig {
  const base = role === 'ADMIN' ? ADMIN_NAV : role === 'RECEPTIONIST' ? RECEPTIONIST_NAV : DOCTOR_NAV
  // ADMIN bypasses permission checks server-side (middleware.ts) — never filter its nav.
  if (role === 'ADMIN') return base
  return { primary: visibleTabs(base.primary, perms), more: visibleSections(base.more, perms) }
}

export const MORE_ICON: LucideIcon = MoreHorizontal