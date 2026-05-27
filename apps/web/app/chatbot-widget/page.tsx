import Script from 'next/script'

export const metadata = { title: 'Chat with Code Clinic' }

export default function ChatbotWidgetPage() {
  return (
    <>
      {/* Load the upgraded widget from the API */}
      <Script
        src="https://api.codeclinicemr.com/widget.js"
        data-clinic-name="Code Clinic"
        strategy="afterInteractive"
      />

      {/* Minimal page body so visitors see something while the bubble loads */}
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        background: 'linear-gradient(135deg,#f0f4ff 0%,#e8f4fd 100%)',
        gap: '12px',
        padding: '24px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: '48px' }}>🦷</div>
        <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#0c1e50', margin: 0 }}>
          Code Clinic — Live Chat
        </h1>
        <p style={{ fontSize: '15px', color: '#555', margin: 0, maxWidth: '340px', lineHeight: 1.5 }}>
          Click the green chat bubble in the bottom-right corner to start a conversation with Sarah, our AI assistant.
        </p>
      </div>
    </>
  )
}
