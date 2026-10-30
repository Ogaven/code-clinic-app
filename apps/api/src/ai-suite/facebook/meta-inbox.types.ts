export type MetaInboxProvider = 'FACEBOOK' | 'INSTAGRAM'

export type MetaInboxPayload =
  | { kind: 'message'; fromId: string; text: string; mid?: string }
  | { kind: 'comment'; commentId: string; postId: string; fromId: string; fromName: string; text: string; parentId?: string }

export type MetaInboxStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'
