export interface InboxMessage {
  id: string
  role: 'USER' | 'AGENT'
  content: string
  createdAt: string
  status?: string | null
  wamid?: string | null
  metadata?: string | null
  deliveryErrorCode?: number | null
}

export function sameInboxMessages(previous: InboxMessage[], incoming: InboxMessage[]): boolean {
  return previous.length === incoming.length && previous.every((message, index) => {
    const next = incoming[index]
    return message.id === next.id
      && message.role === next.role
      && message.content === next.content
      && message.createdAt === next.createdAt
      && message.metadata === next.metadata
      && message.status === next.status
      && message.wamid === next.wamid
      && message.deliveryErrorCode === next.deliveryErrorCode
  })
}
