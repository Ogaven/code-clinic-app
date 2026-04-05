/**
 * Uganda Tax Engine
 * PAYE bands (URA 2024/25), NSSF contributions, VAT
 */

export const VAT_RATE = 0.18 // 18%

// ── PAYE ─────────────────────────────────────────────────────────────────────
// Monthly income bands (UGX)
// 0 – 235,000         → 0%
// 235,001 – 335,000   → 10% on excess over 235,000
// 335,001 – 410,000   → 20% on excess over 335,000 + 10,000
// 410,001+            → 30% on excess over 410,000 + 25,000

export function calculatePAYE(grossMonthlyUGX: number): number {
  if (grossMonthlyUGX <= 235_000) return 0
  if (grossMonthlyUGX <= 335_000) return Math.round((grossMonthlyUGX - 235_000) * 0.10)
  if (grossMonthlyUGX <= 410_000) return Math.round((grossMonthlyUGX - 335_000) * 0.20 + 10_000)
  return Math.round((grossMonthlyUGX - 410_000) * 0.30 + 25_000)
}

// ── NSSF ─────────────────────────────────────────────────────────────────────
// Employee contribution: 5% of gross
// Employer contribution: 10% of gross

export function calculateNSSF(grossMonthlyUGX: number): {
  employeeNSSF: number
  employerNSSF: number
  totalNSSF: number
} {
  const employeeNSSF = Math.round(grossMonthlyUGX * 0.05)
  const employerNSSF = Math.round(grossMonthlyUGX * 0.10)
  return { employeeNSSF, employerNSSF, totalNSSF: employeeNSSF + employerNSSF }
}

// ── Net Pay ───────────────────────────────────────────────────────────────────
export function calculateNetPay(grossMonthlyUGX: number): {
  gross: number
  nssfEmployee: number
  nssfEmployer: number
  paye: number
  net: number
} {
  const { employeeNSSF, employerNSSF } = calculateNSSF(grossMonthlyUGX)
  const taxableIncome = grossMonthlyUGX - employeeNSSF
  const paye = calculatePAYE(taxableIncome)
  const net = grossMonthlyUGX - employeeNSSF - paye
  return {
    gross: grossMonthlyUGX,
    nssfEmployee: employeeNSSF,
    nssfEmployer: employerNSSF,
    paye,
    net,
  }
}

// ── VAT ───────────────────────────────────────────────────────────────────────
export function addVAT(amountUGX: number): { net: number; vat: number; total: number } {
  const vat = Math.round(amountUGX * VAT_RATE)
  return { net: amountUGX, vat, total: amountUGX + vat }
}

export function extractVAT(totalWithVAT: number): { net: number; vat: number; total: number } {
  const net = Math.round(totalWithVAT / (1 + VAT_RATE))
  const vat = totalWithVAT - net
  return { net, vat, total: totalWithVAT }
}

// ── Invoice number generator ──────────────────────────────────────────────────
export function generateInvoiceNumber(sequenceNumber: number): string {
  const year = new Date().getFullYear()
  return `CC-${year}-${String(sequenceNumber).padStart(5, '0')}`
}
