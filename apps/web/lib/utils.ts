import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatUGX(amount: number | bigint): string {
  const n = typeof amount === 'bigint' ? Number(amount) : amount
  return `UGX ${n.toLocaleString('en-UG')}`
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
  return date.toLocaleTimeString('en-UG', {
    timeZone: 'Africa/Kampala',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function formatKampalaDate(date: Date): string {
  return date.toLocaleDateString('en-UG', {
    timeZone: 'Africa/Kampala',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function getGreeting(): string {
  const hour = new Date().toLocaleString('en-UG', {
    timeZone: 'Africa/Kampala',
    hour: 'numeric',
    hour12: false,
  })
  const h = parseInt(hour)
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}
