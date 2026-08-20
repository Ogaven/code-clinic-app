const lugandaPrefixes = /^(MU|BA|KA|NA|WA|BU|LU|KI|MA|NY|NG|NJ|NK|SS|KK)/i

export const toProper = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''

// For split records (lastName present): check firstName first, then lastName (forward scan).
// For single-field full names (lastName empty, e.g. nextOfKinName): backward scan to find the
// given name in a string like "NUWAHEREZA PATIENCE" or "PEACE M KABUGO".
export function getGreetingName(patient: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!patient) return 'there'

  const hasLastName = !!(patient.lastName && patient.lastName.trim())

  if (hasLastName) {
    // Case A: properly split record — firstName is the given name slot, check it first
    const firstWord = (patient.firstName || '').trim().split(/\s+/)[0] || ''
    const lastWord  = (patient.lastName  || '').trim().split(/\s+/)[0] || ''
    if (firstWord && !lugandaPrefixes.test(firstWord)) return toProper(firstWord)
    if (lastWord  && !lugandaPrefixes.test(lastWord))  return toProper(lastWord)
    return toProper(firstWord || lastWord)
  }

  // Case B: full name crammed into one field — backward scan finds the given name
  const allWords = (patient.firstName || '').trim().split(/\s+/).filter(Boolean)
  if (allWords.length === 0) return 'there'
  for (let i = allWords.length - 1; i >= 0; i--) {
    const word = allWords[i]
    if (word.length > 2 && !lugandaPrefixes.test(word)) return toProper(word)
  }
  return toProper(allWords[allWords.length - 1])
}

export function isMinor(dob: Date | null | undefined): boolean {
  if (!dob) return false
  const age = (Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 365.25)
  return age < 18
}

export function normalizeRelation(relation: string | null | undefined): string {
  if (!relation) return 'guardian'
  const r = relation.trim().toLowerCase()
  const map: Record<string, string> = {
    mum: 'mum', mother: 'mum', mom: 'mum',
    dad: 'dad', father: 'dad',
    husband: 'husband', wife: 'wife',
    sister: 'sister', brother: 'brother',
    son: 'son', daughter: 'daughter',
    friend: 'friend', boss: 'guardian',
  }
  return map[r] || 'guardian'
}

// Returns a warm relational title suitable for greeting a minor's guardian.
// "mum" → "Mummy", "dad" → "Daddy", "aunt" + name → "Auntie Grace", etc.
// Falls back to the guardian's first name, then 'there'.
export function guardianTitle(
  relation: string | null | undefined,
  firstName: string | null | undefined,
): string {
  const r = (relation || '').trim().toLowerCase()
  const name = firstName && firstName.trim() ? firstName.trim() : null

  if (r === 'mum' || r === 'mother' || r === 'mom' || r === 'mama') return 'Mummy'
  if (r === 'dad' || r === 'father' || r === 'papa' || r === 'baba') return 'Daddy'
  if (r === 'aunt' || r === 'auntie' || r === 'aunty') return name ? `Auntie ${name}` : 'Auntie'
  if (r === 'uncle') return name ? `Uncle ${name}` : 'Uncle'
  if (r === 'grandma' || r === 'grandmother' || r === 'granny') return 'Grandma'
  if (r === 'grandpa' || r === 'grandfather') return 'Grandpa'
  return name || 'there'
}
