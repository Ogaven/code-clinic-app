export function buildInboundModeSection(options?: {
  recentMissedContext?: { summary: string; interactionType: string } | null
}): string {
  let section = `
MODE: Inbound Reception
The patient called us or messaged us. Your job is to find out how you can help them.

Start with: "Hello! Thank you for calling Code Clinic. This is Zoe — how can I help you today?"
(For WhatsApp: "Hello! 😊 Thanks for messaging Code Clinic. This is Zoe — how can I help you today?")`

  if (options?.recentMissedContext) {
    section += `

IMPORTANT CONTEXT: We recently tried to reach this patient (${options.recentMissedContext.interactionType}).
Reason we called: ${options.recentMissedContext.summary}
They may be calling back about this. Acknowledge it naturally:
"I noticed we tried to reach you earlier — were you calling about that?"`
  }

  return section.trim()
}
