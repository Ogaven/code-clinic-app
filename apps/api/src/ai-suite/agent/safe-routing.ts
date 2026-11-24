import { chooseAiProvider, type AiProvider, type AiWorkload } from './provider-config'

/**
 * DeepSeek may receive only pre-approved, public clinic FAQs. Never forward
 * arbitrary inbound messages, user text, conversation history or patient data.
 */
export const PUBLIC_ROUTINE_FAQS = Object.freeze({
  clinic_hours: 'What are Code Clinic opening hours?',
  clinic_location: 'Where is Code Clinic located?',
  general_services: 'What general dental services does Code Clinic offer?',
} as const)

export type PublicRoutineFaq = keyof typeof PUBLIC_ROUTINE_FAQS

export type RoutingRequest =
  | { workload: 'routine'; publicFaq: PublicRoutineFaq; patientContextPresent: false }
  | { workload: Exclude<AiWorkload, 'routine'>; publicFaq?: never; patientContextPresent?: boolean }

export type SafeRoutingDecision =
  | { provider: 'deepseek'; approvedPrompt: string }
  | { provider: 'openai'; approvedPrompt: null }

/**
 * This is an allowlist gate, NOT a classifier of patient text. A trusted caller
 * must establish the FAQ intent without passing raw patient text to DeepSeek.
 */
export function selectSafeAiRoute(request: RoutingRequest): SafeRoutingDecision {
  const provider: AiProvider = chooseAiProvider(request.workload)
  if (provider !== 'deepseek' || request.workload !== 'routine' || request.patientContextPresent !== false) {
    return { provider: 'openai', approvedPrompt: null }
  }
  if (!Object.prototype.hasOwnProperty.call(PUBLIC_ROUTINE_FAQS, request.publicFaq)) {
    return { provider: 'openai', approvedPrompt: null }
  }
  return { provider: 'deepseek', approvedPrompt: PUBLIC_ROUTINE_FAQS[request.publicFaq] }
}

// Exact, standalone questions only. Extra text can change the intent or carry
// personal information, so it stays on the existing conversation path.
export function matchPublicRoutineFaq(message: string): 'clinic_location' | 'clinic_hours' | null {
  const question = message.trim().toLowerCase().replace(/[?.!]+$/, '').trim()
  if (['where is code clinic located', 'where are you located', 'what is your address'].includes(question)) {
    return 'clinic_location'
  }
  if (['what are code clinic opening hours', 'what are your opening hours', 'what are your clinic hours'].includes(question)) {
    return 'clinic_hours'
  }
  return null
}
