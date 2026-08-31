'use client'

import { useState } from 'react'
import { BookOpen, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import KnowledgeSourcesPanel from './KnowledgeSourcesPanel'
import KnowledgeTrainerChat from './KnowledgeTrainerChat'

type MobileTab = 'knowledge' | 'chat'

// Shared by both the Admin (/ai-suite/knowledge-base) and Receptionist
// (/receptionist/ai-suite/knowledge) Knowledge Base pages — same underlying
// training system for both roles (subject to each app's own auth/routing),
// rather than two divergent implementations. Each page keeps its own
// surrounding layout/nav; this component owns only the two-pane workspace.
export default function KnowledgeStudioWorkspace() {
  const [mobileTab, setMobileTab] = useState<MobileTab>('knowledge')

  return (
    <div className="h-full flex flex-col">
      {/* Mobile/tablet tab switcher — below lg the two panes never sit side by side */}
      <div className="lg:hidden flex-shrink-0 flex gap-1 p-2 border-b border-gray-100 dark:border-white/8 bg-white dark:bg-transparent">
        {([
          { key: 'knowledge', label: 'Knowledge', icon: BookOpen },
          { key: 'chat', label: 'AI Trainer Chat', icon: MessageSquare },
        ] as { key: MobileTab; label: string; icon: React.ComponentType<any> }[]).map(t => (
          <button key={t.key} onClick={() => setMobileTab(t.key)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold transition-all',
              mobileTab === t.key
                ? 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-700 dark:text-cyan-300'
                : 'text-gray-400 dark:text-white/40 hover:text-gray-600 dark:hover:text-white/60',
            )}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {/* Two-pane workspace on lg+, single-pane + tabs below it */}
      <div className="flex-1 overflow-hidden lg:flex lg:gap-4 lg:p-5 min-h-0">
        <div className={cn(
          'h-full overflow-y-auto p-5 lg:p-0 lg:w-[60%] lg:flex-shrink-0',
          mobileTab === 'knowledge' ? 'block' : 'hidden lg:block',
        )}>
          <KnowledgeSourcesPanel />
        </div>
        <div className={cn(
          'h-full min-h-[480px] p-5 pt-0 lg:p-0 lg:flex-1 lg:min-w-0',
          mobileTab === 'chat' ? 'block' : 'hidden lg:block',
        )}>
          <KnowledgeTrainerChat />
        </div>
      </div>
    </div>
  )
}
