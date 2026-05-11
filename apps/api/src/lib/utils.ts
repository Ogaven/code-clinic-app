export function formatPatientId(num: number): string {
  return `CC-${String(num).padStart(4, '0')}`
}
