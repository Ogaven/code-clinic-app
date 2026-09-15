import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatUGX(amount: number | bigint): string {
  const n = typeof amount === 'bigint' ? Number(amount) : amount
  return `UGX ${n.toLocaleString('en-GB')}`
}

export function formatPhone(phone: string): string {
  // +256XXXXXXXXX → +256 7XX XXX XXX
  const cleaned = phone.replace(/\s/g, '')
  if (cleaned.startsWith('+256') && cleaned.length === 13) {
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7, 10)} ${cleaned.slice(10)}`
  }
  return phone
}

export function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase()
}

export function formatKampalaTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Nairobi',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatKampalaDate(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    timeZone: 'Africa/Nairobi',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// "1 September to 15 September" style label for the current Kampala
// month-to-date — used so Patient Overview tooltips (Admin + Receptionist)
// state the real dates their figures cover instead of a static "this month".
export function kampalaMonthToDateLabel(): string {
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: 'numeric', month: 'long' })
  const parts = fmt.formatToParts(new Date())
  const day   = parts.find(p => p.type === 'day')?.value ?? ''
  const month = parts.find(p => p.type === 'month')?.value ?? ''
  return `1 ${month} to ${day} ${month}`
}

export function getGreeting(): string {
  const hour = new Date().toLocaleString('en-GB', {
    timeZone: 'Africa/Nairobi',
    hour: 'numeric',
    hour12: false,
  })
  const h = parseInt(hour)
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
