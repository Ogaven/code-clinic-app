import type { Metadata, Viewport } from 'next'
import './globals.css'
import OfflineBanner from '@/components/OfflineBanner'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#1A237E',
}

export const metadata: Metadata = {
  title: 'Code Clinic',
  description: 'Painless Dentistry, Lifesaving Smiles. Code Clinic, Kampala Uganda.',
  applicationName: 'Code Clinic',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.png',
    apple: '/icon.png',
    shortcut: '/icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Code Clinic',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="google-site-verification" content="29zkNmb0Eh_JqbhdQ8IvscklTgh0O5DgWUBof5oJP_c" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Code Clinic" />
        <link rel="apple-touch-icon" href="/icon.png" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('cc_theme')||'system';if(t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}else{document.documentElement.classList.remove('dark')}}catch(e){}})()`,
        }} />
        <script dangerouslySetInnerHTML={{
          __html: `if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js')})}`,
        }} />
        <script dangerouslySetInnerHTML={{
          __html: `(function(){var k='cc_chunk_reloaded';sessionStorage.removeItem(k);window.addEventListener('error',function(e){if(e.message&&(e.message.indexOf('Loading chunk')!==-1||e.message.indexOf('ChunkLoadError')!==-1)){if(!sessionStorage.getItem(k)){sessionStorage.setItem(k,'1');window.location.reload();}}});})();`,
        }} />
      </head>
      <body className="min-h-screen bg-clinic-bg font-sans antialiased transition-colors duration-300">
        <OfflineBanner />
        {children}
      </body>
    </html>
  )
}
