'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, CalendarDays, Users, Stethoscope, UserCog,
  Wallet, Receipt, ShoppingBag, CreditCard, FileBarChart,
  Bot, Megaphone, UserPlus, QrCode, Settings, HeadphonesIcon,
  ChevronLeft, ChevronRight, Globe, BookOpen, Package, BarChart2,
} from 'lucide-react'
import { useEffect, useState } from 'react'

interface NavItem  { label: string; href: string; icon: React.ElementType }
interface NavGroup { label?: string; items: NavItem[] }

const adminNav: NavGroup[] = [
  {
    label: 'CLINIC',
    items: [
      { label: 'Dashboard',    href: '/dashboard',    icon: LayoutDashboard },
      { label: 'Appointments', href: '/scheduling',   icon: CalendarDays },
      { label: 'Patients',     href: '/patients',     icon: Users },
      { label: 'Treatments',   href: '/treatments',   icon: Stethoscope },
      { label: 'Analytics',    href: '/analytics',    icon: BarChart2 },
      { label: 'Staff List',   href: '/employees',    icon: UserCog },
    ],
  },
  {
    label: 'FINANCE',
    items: [
      { label: 'Accounts',  href: '/accounts/dashboard', icon: Wallet },
      { label: 'Sales',     href: '/accounts/invoices',  icon: Receipt },
      { label: 'Expenses',  href: '/accounts/expenses',  icon: ShoppingBag },
      { label: 'Payroll',   href: '/accounts/payroll',   icon: CreditCard },
      { label: 'Stocks',    href: '/stocks',             icon: Package },
      { label: 'Reports',   href: '/accounts/reports',   icon: FileBarChart },
    ],
  },
  {
    label: 'GROWTH',
    items: [
      { label: 'AI Suite',    href: '/ai-suite',                icon: Bot },
      { label: 'Campaigns',   href: '/campaigns',               icon: Megaphone },
      { label: 'CRM / Leads', href: '/crm/leads',               icon: UserPlus },
      { label: 'QR Capture',  href: '/crm/qr',                  icon: QrCode },
      { label: 'Website',     href: '/crm/website-visitors',    icon: Globe },
      { label: 'Knowledge',   href: '/ai-suite/knowledge-base', icon: BookOpen },
    ],
  },
  {
    items: [
      { label: 'Settings', href: '/settings', icon: Settings },
      { label: 'Support',  href: '/support',  icon: HeadphonesIcon },
    ],
  },
]

export default function Sidebar({ role = 'ADMIN', dark = false }: { role?: string; dark?: boolean }) {
  const pathname  = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  // colour tokens
  const sideBg    = dark ? 'rgba(8,14,52,0.92)'      : 'rgba(255,255,255,0.92)'
  const sideBdr   = dark ? 'rgba(255,255,255,0.07)'  : 'rgba(229,231,235,1)'
  const groupLbl  = dark ? 'rgba(255,255,255,0.35)'  : '#6B7280'
  const inactiveC = dark ? 'rgba(180,200,230,0.8)'   : '#4B5563'
  const hoverBg   = dark ? 'rgba(255,255,255,0.05)'  : '#F9FAFB'
  const activeBg  = dark ? 'rgba(41,171,226,0.14)'   : 'rgba(26,35,126,0.06)'
  const activeC   = dark ? '#E0F0FF' : '#1A237E'
  const activeI   = dark ? '#29ABE2' : '#29ABE2'
  const bdrClr    = dark ? 'rgba(255,255,255,0.06)'  : '#F3F4F6'
  const toggleBdr = dark ? 'rgba(255,255,255,0.1)'   : '#E5E7EB'
  const toggleC   = dark ? 'rgba(148,163,200,0.7)'   : '#9CA3AF'

  return (
    <aside
      className={cn(
        'flex flex-col h-screen transition-all duration-300 z-30 sticky top-0 flex-shrink-0',
        collapsed ? 'w-[64px]' : 'w-[220px]',
      )}
      style={{
        background: sideBg,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderRight: `1px solid ${sideBdr}`,
        transition: 'width 0.3s, background 0.3s, border-color 0.3s',
      }}
    >
      {/* Logo area */}
      <Link href="/dashboard"
        className={cn(
          'flex items-center transition-all duration-200',
          collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2 gap-2',
        )}
        style={{ borderBottom: `1px solid ${bdrClr}` }}
        onMouseEnter={e => (e.currentTarget.style.background = hoverBg)}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        {collapsed ? (
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #1A237E, #29ABE2)' }}>
            <span className="text-white font-black text-[10px]">CC</span>
          </div>
        ) : (
          <Image src="/logo.png" alt="Code Clinic" width={110} height={36}
            className={cn('object-contain transition-all', dark && 'brightness-0 invert')} priority />
        )}
      </Link>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-2 sidebar-nav">
        {adminNav.map((group, gi) => (
          <div key={gi} className="pb-1" style={gi > 0 ? { marginTop: 4, paddingTop: 4, borderTop: `1px solid ${bdrClr}` } : {}}>
            {group.label && !collapsed && (
              <p className="text-[9px] font-black uppercase tracking-[0.15em] px-4 py-2"
                style={{ color: groupLbl }}>
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
              const Icon   = item.icon
              const active =
                pathname === item.href ||
                (item.href !== '/dashboard' && pathname.startsWith(item.href + '/')) ||
                (item.href === '/accounts/dashboard' && pathname.startsWith('/accounts'))

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={cn(
                    'relative flex items-center gap-3 transition-all duration-150 group mx-2 rounded-xl my-0.5',
                    collapsed ? 'justify-center p-2.5' : 'px-3 py-2',
                  )}
                  style={{
                    background: active ? activeBg : 'transparent',
                    color: active ? activeC : inactiveC,
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = hoverBg }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                >
                  {active && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full"
                      style={{ background: 'linear-gradient(to bottom, #1A237E, #29ABE2)' }} />
                  )}

                  <Icon size={17} className="flex-shrink-0 transition-colors"
                    style={{ color: active ? activeI : undefined }} />

                  {!collapsed && (
                    <span className="text-[13px] font-medium truncate"
                      style={{ fontWeight: active ? 600 : 500 }}>{item.label}</span>
                  )}

                  {collapsed && (
                    <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-all z-50 shadow-xl text-xs text-white"
                      style={{ background: '#111827' }}>
                      {item.label}
                      <span className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-gray-900" />
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className="p-3" style={{ borderTop: `1px solid ${bdrClr}` }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-center p-2 rounded-xl transition-all duration-150"
          style={{ border: `1px solid ${toggleBdr}`, color: toggleC }}
          onMouseEnter={e => (e.currentTarget.style.background = hoverBg)}
          onMouseLeave={e => (e.currentTarget.style.background = '')}
        >
          {collapsed ? <ChevronRight size={15} /> : (
            <div className="flex items-center gap-2 text-xs font-medium">
              <ChevronLeft size={15} />
              <span>Collapse</span>
            </div>
          )}
        </button>
      </div>
    </aside>
  )
}
