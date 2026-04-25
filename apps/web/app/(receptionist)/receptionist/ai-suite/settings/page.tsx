'use client'

import { useState } from 'react'
import { Settings, CheckCircle2, Copy } from 'lucide-react'

function StatusRow({ label, value, status }: { label: string; value: string; status: 'ok' | 'missing' }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-50 dark:border-white/5 last:border-0">
      <div>
        <p className="text-sm font-semibold text-gray-800 dark:text-white">{label}</p>
        <p className="text-xs font-mono text-gray-400 dark:text-white/40 mt-0.5">{value || 'Not set'}</p>
      </div>
      <div className="flex items-center gap-2">
        {value && (
          <button onClick={copy} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/8 transition-colors">
            {copied ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} className="text-gray-400" />}
          </button>
        )}
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
          status === 'ok'
            ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
            : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400'
        }`}>
          {status === 'ok' ? '● Set' : '○ Missing'}
        </span>
      </div>
    </div>
  )
}

export default function AISettingsPage() {
  const channels = [
    {
      title: 'WhatsApp (Meta)',
      docs: 'https://developers.facebook.com/docs/whatsapp',
      vars: [
        { label: 'Webhook Verify Token', key: 'WHATSAPP_VERIFY_TOKEN', hint: 'codeclinic-whatsapp-2026' },
        { label: 'Phone Number ID', key: 'WHATSAPP_PHONE_NUMBER_ID', hint: 'From Meta Business > WhatsApp > Phone numbers' },
        { label: 'Access Token', key: 'WHATSAPP_TOKEN', hint: 'System user token with whatsapp_business_messaging permission' },
      ],
    },
    {
      title: 'Facebook Messenger',
      docs: 'https://developers.facebook.com/docs/messenger-platform',
      vars: [
        { label: 'Webhook Verify Token', key: 'FACEBOOK_VERIFY_TOKEN', hint: 'codeclinic-facebook-2026' },
        { label: 'Page Access Token', key: 'FACEBOOK_PAGE_ACCESS_TOKEN', hint: 'From Meta Business > Page settings > Advanced messaging' },
      ],
    },
    {
      title: 'Instagram DMs',
      docs: 'https://developers.facebook.com/docs/instagram-api/overview',
      vars: [
        { label: 'Webhook Verify Token', key: 'INSTAGRAM_VERIFY_TOKEN', hint: 'codeclinic-instagram-2026' },
        { label: 'Access Token', key: 'INSTAGRAM_ACCESS_TOKEN', hint: 'Instagram Business account access token via Meta Graph API' },
      ],
    },
    {
      title: 'SMS (Africa\'s Talking)',
      docs: 'https://developers.africastalking.com/docs',
      vars: [
        { label: 'API Key', key: 'AT_API_KEY', hint: 'From Africa\'s Talking dashboard' },
        { label: 'Username', key: 'AT_USERNAME', hint: 'Your Africa\'s Talking app username' },
        { label: 'From Number', key: 'AT_FROM', hint: 'Shortcode or sender ID (optional)' },
      ],
    },
    {
      title: 'Voice Calls (ElevenLabs + Roke)',
      docs: 'https://elevenlabs.io/docs',
      vars: [
        { label: 'ElevenLabs API Key', key: 'ELEVENLABS_API_KEY', hint: 'From elevenlabs.io/app/settings/api-keys' },
        { label: 'Roke Trunk Host', key: 'ROKE_TRUNK_HOST', hint: '41.191.76.76 (default)' },
        { label: 'Drachtio Host', key: 'DRACHTIO_HOST', hint: 'Internal hostname of drachtio-server service (Railway private network)' },
      ],
    },
  ]

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Settings size={20} className="text-cyan-500" />
        <div>
          <h1 className="text-xl font-black text-gray-800 dark:text-white">AI Suite Settings</h1>
          <p className="text-sm text-gray-400 mt-0.5">Channel configuration and environment variable reference</p>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-2xl p-4 text-sm text-amber-700 dark:text-amber-400">
        <strong>Note:</strong> All secrets are set as environment variables on Railway — never stored in the database. Update them in your Railway service → Variables tab.
      </div>

      {channels.map(ch => (
        <div key={ch.title} className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50 dark:border-white/5">
            <h2 className="text-sm font-bold text-gray-800 dark:text-white">{ch.title}</h2>
            <a href={ch.docs} target="_blank" rel="noopener noreferrer"
              className="text-xs font-bold text-cyan-600 dark:text-cyan-400 hover:underline">
              Docs →
            </a>
          </div>
          <div className="px-5">
            {ch.vars.map(v => (
              <StatusRow key={v.key} label={v.label} value={v.key} status="ok" />
            ))}
          </div>
          <div className="px-5 pb-4 mt-1 space-y-1">
            {ch.vars.map(v => (
              <p key={v.key} className="text-[11px] text-gray-400 dark:text-white/30">
                <span className="font-mono font-bold">{v.key}</span>: {v.hint}
              </p>
            ))}
          </div>
        </div>
      ))}

      <div className="bg-white dark:bg-white/5 rounded-2xl border border-gray-100 dark:border-white/10 shadow-sm p-5 space-y-3">
        <h2 className="text-sm font-bold text-gray-800 dark:text-white">Webhook URLs</h2>
        <p className="text-xs text-gray-400 dark:text-white/40">Register these in the respective developer consoles:</p>
        {[
          { label: 'WhatsApp',  url: 'https://api-production-4c43.up.railway.app/ai-suite/webhook' },
          { label: 'Facebook',  url: 'https://api-production-4c43.up.railway.app/ai-suite/facebook/webhook' },
          { label: 'Instagram', url: 'https://api-production-4c43.up.railway.app/ai-suite/instagram/webhook' },
          { label: 'SMS',       url: 'https://api-production-4c43.up.railway.app/ai-suite/sms/incoming' },
        ].map(({ label, url }) => (
          <div key={label} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-white/5 rounded-xl">
            <span className="text-xs font-bold text-gray-500 dark:text-white/50 w-20">{label}</span>
            <code className="flex-1 text-xs text-gray-700 dark:text-white/70 font-mono truncate">{url}</code>
          </div>
        ))}
      </div>
    </div>
  )
}
