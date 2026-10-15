import nodemailer from 'nodemailer'
import type { AiBudgetAlertDelivery } from './ai-budget-alert-dispatcher'

export type AiBudgetAlertMailConfig = {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
  from: string
  to: string
}

/**
 * Optional transport configuration, deliberately separate from existing clinic
 * email settings. No messages are sent unless all values are provided.
 */
export function aiBudgetAlertMailConfigFromEnv(env: NodeJS.ProcessEnv): AiBudgetAlertMailConfig | null {
  const host = env.AI_BUDGET_ALERT_SMTP_HOST?.trim()
  const port = Number(env.AI_BUDGET_ALERT_SMTP_PORT)
  const username = env.AI_BUDGET_ALERT_SMTP_USER?.trim()
  const password = env.AI_BUDGET_ALERT_SMTP_PASSWORD
  const from = env.AI_BUDGET_ALERT_EMAIL_FROM?.trim()
  const to = env.AI_BUDGET_ALERT_EMAIL_TO?.trim()
  if (!host || !Number.isSafeInteger(port) || port < 1 || port > 65535 ||
      !username || !password || !from || !to ||
      /[\r\n]/.test(from) || /[\r\n]/.test(to)) return null
  return { host, port, secure: env.AI_BUDGET_ALERT_SMTP_SECURE === 'true', username, password, from, to }
}

export function createAiBudgetAlertEmailDelivery(
  config: AiBudgetAlertMailConfig,
): AiBudgetAlertDelivery {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.username, pass: config.password },
  })
  return async alert => {
    const subject = alert.level === 'critical'
      ? 'Code Clinic AI budget critical: $12 threshold'
      : 'Code Clinic AI budget warning: $10 threshold'
    const info = await transport.sendMail({
      from: config.from,
      to: config.to,
      subject,
      text: `Code Clinic AI spending alert for ${alert.monthKey}.\nThreshold: ${alert.level}.\nPlease review OpenAI and DeepSeek billing dashboards and the AI budget ledger.\nThis alert is not proof of a hard provider billing cap.\n`,
    })
    if (!info.messageId || (info.rejected?.length ?? 0) > 0 || (info.accepted?.length ?? 0) === 0) {
      throw new Error('AI budget alert email not accepted by SMTP transport')
    }
  }
}
