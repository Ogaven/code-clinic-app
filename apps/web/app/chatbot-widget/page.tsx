import { redirect } from 'next/navigation'

// Server-side HTTP redirect — no JS chunks needed, bypasses browser cache issues entirely.
export default function ChatbotWidgetPage() {
  redirect('https://api.codeclinicemr.com/chatbot-widget-test')
}
