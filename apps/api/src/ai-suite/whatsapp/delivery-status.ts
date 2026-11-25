import { prisma } from '../../lib/prisma'

const statuses = ['sent', 'failed', 'delivered', 'read'] as const
type DeliveryStatus = typeof statuses[number]

export function isDeliveryStatus(status: string): status is DeliveryStatus {
  return statuses.some(value => value === status)
}

export function whatsappStatusRank(status: string | null): number {
  return status ? statuses.findIndex(value => value === status.toLowerCase()) : -1
}

export async function recordWhatsAppStatus(
  wamid: string,
  status: DeliveryStatus,
  errorCode: number | null,
  onNewReceipt?: (tx: Pick<typeof prisma, 'metaDeliveryFailure'>) => Promise<void>,
): Promise<boolean> {
  return prisma.$transaction(async tx => {
    // Keep the receipt even if the send response has not been attached to the
    // timeline yet. The inbox joins by exact outbound ID on every poll.
    const receipt = await tx.whatsAppDeliveryReceipt.createMany({
      data: [{ wamid, status, errorCode }],
      skipDuplicates: true,
    })
    if (!receipt.count) return false

    // A verified delivery/read supersedes a failure. A delayed sent receipt
    // cannot regress any later state. The predicate is atomic across workers.
    const strongerStates = statuses.slice(whatsappStatusRank(status))
    await tx.aiMessage.updateMany({
      where: {
        wamid,
        role: 'AGENT',
        conversation: { channel: 'WHATSAPP' },
        OR: [{ status: null }, { status: { notIn: [...strongerStates] } }],
      },
      data: { status },
    })
    await onNewReceipt?.(tx)
    return true
  })
}

export function acceptedWhatsAppMessage(wamid?: string | null) {
  return wamid && wamid !== 'unknown' ? { wamid, status: 'sent' } : {}
}

export async function sendTrackedWhatsAppReply(messageId: string, send: () => Promise<string>) {
  let wamid: string
  try {
    wamid = await send()
  } catch (error) {
    // A structured Meta rejection is definitive. Transport errors and missing IDs
    // leave acceptance unknown and must never be used to justify a resend.
    const code = error instanceof Error ? /^#(\d+)\b/.exec(error.message)?.[1] : undefined
    if (code) {
      await prisma.aiMessage.update({
        where: { id: messageId },
        data: { status: 'failed', deliveryErrorCode: Number(code) },
      })
    }
    throw error
  }
  const accepted = acceptedWhatsAppMessage(wamid)
  if (accepted.wamid) await prisma.aiMessage.update({ where: { id: messageId }, data: accepted })
}
