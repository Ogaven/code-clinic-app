// Returns the best greeting name: last non-Luganda word scanning backwards through full name.
// Examples: NUWAHEREZA PATIENCE → Patience, DIANA KIBUUKA → Diana, TUMWESIGYE ALEX → Alex
export function getGreetingName(patient: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!patient) return 'there'
  const toProper = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''
  const allWords = `${patient.firstName || ''} ${patient.lastName || ''}`.trim().split(/\s+/).filter(Boolean)
  if (allWords.length === 0) return 'there'
  const lugandaPrefixes = /^(MU|BA|KA|NA|WA|BU|LU|KI|MA|NY|NG|NJ|NK|SS|KK)/i
  for (let i = allWords.length - 1; i >= 0; i--) {
    const word = allWords[i]
    if (word.length > 2 && !lugandaPrefixes.test(word)) return toProper(word)
  }
  return toProper(allWords[allWords.length - 1])
}
