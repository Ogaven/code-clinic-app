// Anti-hallucination guard — validates that every factual claim
// in the agent response is backed by a tool result.

export interface ToolRecord {
  tool: string
  result: any
}

export interface GuardResult {
  safe: boolean
  reason?: string
}

// ── Extractors from response text ──────────────────────────────

function extractUGXPrices(text: string): number[] {
  const matches = text.matchAll(/(\d{1,3}(?:,\d{3})*)\s*(?:UGX|shillings|\/\-)/gi)
  return [...matches].map(m => parseInt(m[1].replace(/,/g, ''), 10))
}

function extractTimeMentions(text: string): string[] {
  const matches = text.matchAll(/\b(\d{1,2}:\d{2})\s*(?:am|pm|AM|PM)?\b/g)
  return [...matches].map(m => m[1])
}

function extractDoctorNames(text: string): string[] {
  const matches = text.matchAll(/\bDr\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g)
  return [...matches].map(m => m[1].toLowerCase())
}

function hasBookingConfirmationLanguage(text: string): boolean {
  const patterns = [
    /appointment\s+(has\s+been\s+)?booked/i,
    /successfully\s+booked/i,
    /confirmation\s+number/i,
    /appointment\s+is\s+confirmed/i,
    /booked\s+you\s+in/i,
  ]
  return patterns.some(p => p.test(text))
}

function hasCancellationLanguage(text: string): boolean {
  return /appointment\s+(has\s+been\s+)?cancelled/i.test(text)
}

// ── Extractors from tool results ────────────────────────────────

function getAllPricesFromTools(tools: ToolRecord[]): number[] {
  const prices: number[] = []
  for (const t of tools) {
    if (!t.result || t.result.error) continue
    // get_services → array of { price_ugx }
    if (Array.isArray(t.result)) {
      for (const item of t.result) {
        if (item.price_ugx) prices.push(item.price_ugx)
        if (item.total_ugx) prices.push(item.total_ugx)
        if (item.balance_ugx) prices.push(item.balance_ugx)
      }
    }
    // get_patient_balance → { outstanding_ugx, invoices: [] }
    if (t.result.outstanding_ugx !== undefined) prices.push(t.result.outstanding_ugx)
    if (Array.isArray(t.result.invoices)) {
      for (const inv of t.result.invoices) {
        if (inv.total_ugx) prices.push(inv.total_ugx)
        if (inv.balance_ugx) prices.push(inv.balance_ugx)
      }
    }
    // get_patient_appointments → array with price_ugx
    if (Array.isArray(t.result) && t.result[0]?.price_ugx) {
      for (const appt of t.result) prices.push(appt.price_ugx)
    }
  }
  return prices
}

function getAllTimeSlotsFromTools(tools: ToolRecord[]): string[] {
  const slots: string[] = []
  for (const t of tools) {
    if (!t.result || t.result.error) continue
    // get_doctor_availability → { available_slots: ['09:00', ...] }
    if (Array.isArray(t.result.available_slots)) {
      slots.push(...t.result.available_slots)
    }
    // get_patient_appointments → array with time field
    if (Array.isArray(t.result)) {
      for (const item of t.result) {
        if (item.time) slots.push(item.time.split(' ')[0]) // strip AM/PM
      }
    }
    // book_appointment / reschedule → confirmation_details.time
    if (t.result.confirmation_details?.time) slots.push(t.result.confirmation_details.time)
    if (t.result.new_time) slots.push(t.result.new_time)
  }
  return slots
}

function getAllDoctorNamesFromTools(tools: ToolRecord[]): string[] {
  const names: string[] = []
  const addName = (n: string) => {
    if (n) names.push(n.replace(/^Dr\.\s*/i, '').toLowerCase())
  }
  for (const t of tools) {
    if (!t.result || t.result.error) continue
    // get_all_doctors → array of { name: 'Dr. ...' }
    if (Array.isArray(t.result)) {
      for (const item of t.result) {
        if (item.name) addName(item.name)
        if (item.doctor_name) addName(item.doctor_name)
        if (item.doctor) addName(item.doctor)
      }
    }
    // get_patient_by_phone → { last_doctor }
    if (t.result.last_doctor) addName(t.result.last_doctor)
    // get_patient_appointments → array with doctor_name
    if (Array.isArray(t.result)) {
      for (const item of t.result) if (item.doctor_name) addName(item.doctor_name)
    }
    // book_appointment → confirmation_details.doctor
    if (t.result.confirmation_details?.doctor) addName(t.result.confirmation_details.doctor)
  }
  return names
}

function anyToolHadError(tools: ToolRecord[]): { hasError: boolean; toolName: string } {
  for (const t of tools) {
    if (t.result?.error && t.tool !== 'search_knowledge_base') {
      return { hasError: true, toolName: t.tool }
    }
  }
  return { hasError: false, toolName: '' }
}

// ── Main guard ──────────────────────────────────────────────────

export async function antiHallucinationGuard(
  responseText: string,
  toolResults: ToolRecord[]
): Promise<GuardResult> {
  // If no tools were called and response mentions specifics — that's fine for greetings/general talk
  if (toolResults.length === 0) return { safe: true }

  // 1. Did any tool return an error?
  const { hasError, toolName } = anyToolHadError(toolResults)
  if (hasError) {
    return { safe: false, reason: `Tool '${toolName}' returned an error — cannot trust response` }
  }

  // 2. Does response mention a UGX price not confirmed by tools?
  const mentionedPrices = extractUGXPrices(responseText)
  if (mentionedPrices.length > 0) {
    const confirmedPrices = getAllPricesFromTools(toolResults)
    // get_services or get_patient_balance must have been called
    const priceToolsCalled = toolResults.some(t =>
      ['get_services', 'get_patient_balance', 'get_patient_appointments', 'book_appointment'].includes(t.tool)
    )
    if (!priceToolsCalled) {
      return { safe: false, reason: 'Price mentioned but no price lookup tool was called' }
    }
    // Check each mentioned price exists in tool results (allow ±1000 UGX rounding)
    for (const price of mentionedPrices) {
      const close = confirmedPrices.some(p => Math.abs(p - price) <= 1000)
      if (!close && price > 0) {
        return { safe: false, reason: `Price ${price.toLocaleString()} UGX mentioned but not found in database results` }
      }
    }
  }

  // 3. Does response mention doctor names not from tool results?
  const mentionedDoctors = extractDoctorNames(responseText)
  if (mentionedDoctors.length > 0) {
    const confirmedDoctors = getAllDoctorNamesFromTools(toolResults)
    const doctorToolsCalled = toolResults.some(t =>
      ['get_all_doctors', 'get_patient_appointments', 'get_patient_by_phone', 'book_appointment', 'get_doctor_availability'].includes(t.tool)
    )
    if (!doctorToolsCalled) {
      return { safe: false, reason: 'Doctor name mentioned but no doctor lookup tool was called' }
    }
    for (const name of mentionedDoctors) {
      const found = confirmedDoctors.some(d => d.includes(name) || name.includes(d))
      if (!found && confirmedDoctors.length > 0) {
        return { safe: false, reason: `Doctor name '${name}' mentioned but not found in database results` }
      }
    }
  }

  // 4. Booking language → book_appointment must have been called and succeeded
  if (hasBookingConfirmationLanguage(responseText)) {
    const bookingCall = toolResults.find(t => t.tool === 'book_appointment')
    if (!bookingCall) {
      return { safe: false, reason: 'Booking confirmed in response but book_appointment tool was not called' }
    }
    if (!bookingCall.result?.success) {
      return { safe: false, reason: 'Booking confirmed in response but tool returned failure' }
    }
  }

  // 5. Cancellation language → cancel_appointment must have been called
  if (hasCancellationLanguage(responseText)) {
    const cancelCall = toolResults.find(t => t.tool === 'cancel_appointment')
    if (!cancelCall) {
      return { safe: false, reason: 'Cancellation confirmed in response but cancel_appointment tool was not called' }
    }
  }

  return { safe: true }
}
