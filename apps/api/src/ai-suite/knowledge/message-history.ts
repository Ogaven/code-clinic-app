export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

// ROOT CAUSE of "Failed to get a response from the clinic AI": the user turn
// is persisted BEFORE the provider call (by design, so Retry has a row to
// target). If the provider call ever fails, that row stays in the DB as an
// unanswered 'user' message. The NEXT turn in that conversation (a fresh
// message, or even a Retry) reloads history fresh from the DB and would then
// contain two consecutive role:'user' entries with no assistant reply
// between them. Anthropic's Messages API requires strict user/assistant
// alternation starting with 'user' and rejects non-alternating input — so
// the provider call throws again, producing this exact same generic error.
// Because history is always reloaded from the DB, this doesn't self-heal:
// once a single failure happens, EVERY later turn in that conversation fails
// the same way forever (only "New Chat" recovered it, before this fix).
//
// Fix: collapse consecutive same-role runs into one turn (joining their
// text) before sending to the provider, so an orphaned unanswered user row
// never breaks alternation for whatever comes after it. Extracted as a pure
// function so it can be unit tested directly (see
// __tests__/message-history.test.ts) without a live Anthropic call or a DB.
export function collapseToAlternatingRoles(ordered: HistoryMessage[]): HistoryMessage[] {
  const out: HistoryMessage[] = []
  for (const m of ordered) {
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content += `\n\n${m.content}`
    else out.push({ role: m.role, content: m.content })
  }
  // The provider requires the sequence to start with 'user' — true for
  // every real conversation here (the first row is always the first user
  // message), but guarded defensively in case a future data path changes
  // that invariant.
  while (out.length > 0 && out[0].role !== 'user') out.shift()
  return out
}
