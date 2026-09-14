'use client'

// iOS/iPadOS has no beforeinstallprompt — this is the honest, real
// instruction flow for Safari's Add to Home Screen mechanism. The profile
// action itself is always labelled "Install App"; only this explanatory
// sheet mentions the underlying Share-menu steps.
//
// Shared by both the mobile profile sheet (components/mobile/MobileProfileSheet.tsx)
// and the desktop profile dropdown (components/layout/ProfileMenu.tsx) so the
// instructions never drift between the two surfaces.

import { useEffect } from 'react'
import { Download, Share, PlusSquare, Check } from 'lucide-react'

export default function IOSInstallInstructions({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[160] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Install Code Clinic"
        className="w-full max-w-sm overflow-hidden rounded-t-[28px] border-t border-gray-200/70 bg-white p-6 shadow-2xl animate-fade-in dark:border-white/10 dark:bg-[#0a1730] sm:rounded-[28px] sm:border"
        style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl" style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
          <Download size={24} className="text-white" />
        </div>
        <h3 className="text-center text-lg font-black text-gray-800 dark:text-white">Install Code Clinic</h3>
        <p className="mt-1 text-center text-sm text-gray-500 dark:text-slate-400">To install Code Clinic on your device:</p>
        <ol className="mt-5 space-y-4">
          <InstallStep n={1} icon={Share}>Tap the <strong>Share</strong> icon in Safari</InstallStep>
          <InstallStep n={2} icon={PlusSquare}>Select <strong>Add to Home Screen</strong></InstallStep>
          <InstallStep n={3} icon={Check}>Tap <strong>Add</strong></InstallStep>
        </ol>
        <button onClick={onClose} className="mt-6 w-full rounded-2xl py-3 text-sm font-bold text-white" style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>
          Got it
        </button>
      </div>
    </div>
  )
}

function InstallStep({ n, icon: Icon, children }: { n: number; icon: any; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-xs font-black text-white" style={{ background: 'linear-gradient(135deg,#0c1e50,#29ABE2)' }}>{n}</span>
      <span className="flex items-center gap-2 pt-0.5 text-sm text-gray-700 dark:text-slate-200">
        <Icon size={15} className="flex-shrink-0 text-gray-400" />
        {children}
      </span>
    </li>
  )
}
