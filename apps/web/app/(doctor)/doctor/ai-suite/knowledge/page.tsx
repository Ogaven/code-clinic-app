'use client'

// Same shared Knowledge Studio workspace Admin and Receptionist use
// (apps/web/components/knowledge-studio/KnowledgeStudioWorkspace.tsx) —
// backend routes are already authorized for DOCTOR via the `clinicalStaff`
// RBAC group (apps/api/src/ai-suite/knowledge/knowledge.routes.ts), and the
// knowledge base is clinic-wide reference content by design (not per-doctor
// data), so no additional scoping is needed here.
import KnowledgeStudioWorkspace from '@/components/knowledge-studio/KnowledgeStudioWorkspace'

export default function DoctorKnowledgeBasePage() {
  return <KnowledgeStudioWorkspace />
}