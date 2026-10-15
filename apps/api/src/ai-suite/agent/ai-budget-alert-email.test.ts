import { describe, expect, it } from 'vitest'
import { aiBudgetAlertMailConfigFromEnv } from './ai-budget-alert-email'

describe('AI budget alert email configuration', () => {
  const env = {
    AI_BUDGET_ALERT_SMTP_HOST: 'smtp.example.test',
    AI_BUDGET_ALERT_SMTP_PORT: '587',
    AI_BUDGET_ALERT_SMTP_USER: 'budget@example.test',
    AI_BUDGET_ALERT_SMTP_PASSWORD: 'test-password',
    AI_BUDGET_ALERT_EMAIL_FROM: 'alerts@example.test',
    AI_BUDGET_ALERT_EMAIL_TO: 'admin@example.test',
  }
  it('remains disabled unless all configuration is present', () => {
    expect(aiBudgetAlertMailConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull()
    expect(aiBudgetAlertMailConfigFromEnv({ ...env, AI_BUDGET_ALERT_EMAIL_TO: '' } as NodeJS.ProcessEnv)).toBeNull()
  })
  it('accepts complete configuration without exposing secrets', () => {
    const result = aiBudgetAlertMailConfigFromEnv(env as NodeJS.ProcessEnv)
    expect(result).toMatchObject({ host: 'smtp.example.test', port: 587, secure: false, to: 'admin@example.test' })
  })
  it('rejects invalid ports and header injection', () => {
    expect(aiBudgetAlertMailConfigFromEnv({ ...env, AI_BUDGET_ALERT_SMTP_PORT: '0' } as NodeJS.ProcessEnv)).toBeNull()
    expect(aiBudgetAlertMailConfigFromEnv({ ...env, AI_BUDGET_ALERT_EMAIL_TO: 'admin@example.test' + String.fromCharCode(13, 10) + 'Bcc: bad@example.test' } as NodeJS.ProcessEnv)).toBeNull()
  })
})
