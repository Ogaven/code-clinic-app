'use client'

// Admin now shares the exact same Knowledge Studio workspace as Receptionist
// (apps/web/components/knowledge-studio/KnowledgeStudioWorkspace.tsx) rather
// than a separate ~680-line implementation. That older page's "Search test"
// and per-chunk "Preview" buttons called POST /ai-suite/knowledge/search and
// GET /ai-suite/knowledge/:id/preview, which do not exist anywhere in
// apps/api/src/ai-suite/knowledge/ — they were already non-functional (silent
// 404s) before this change. Its "Paste Text" tab was real and is preserved in
// the shared KnowledgeSourcesPanel. The new AI Training Chat (right pane) is
// a genuine net-new capability neither role had before.
import KnowledgeStudioWorkspace from '@/components/knowledge-studio/KnowledgeStudioWorkspace'

export default function KnowledgeBasePage() {
  return <KnowledgeStudioWorkspace />
}
