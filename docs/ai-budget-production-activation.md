# Code Clinic hybrid AI: production activation runbook

**Status: NOT APPROVED FOR ACTIVATION.** This is a read-only verification checklist, not an instruction to enable production flags. Keep `HYBRID_AI_ENABLED=false`, `AI_METERED_OPENAI_ENABLED=false` and `AI_BUDGET_ALERT_EMAIL_ENABLED=false` until all checks pass. No patient content may be sent to DeepSeek.

## 1. Confirm deployment and migration status (read only)

On the DigitalOcean Code Clinic server, in the deployed repository root, verify the current commit and database package location:

```sh
pwd
git rev-parse HEAD
ls packages/database/prisma/migrations | grep -E '20261015070000_hybrid_ai_budget_ledger|20261015080000_ai_budget_reconciliation_guard|20261015120000_ai_budget_alert_outbox'
```

The three migration directories existing in Git **does not** mean they are applied to PostgreSQL. Inspect `_prisma_migrations` with a database operator's existing authenticated tooling and confirm each has a non-null `finished_at` and null `rolled_back_at`. Do not paste database credentials, full environment files, or patient data into chat. Do not run `prisma migrate deploy` as part of read-only verification.

## 2. Verify paid-call coverage and actual provider bills

* Reconcile OpenAI and DeepSeek provider invoices/usage to the application ledger for the **current UTC billing month**, including usage before the ledger existed.
* Inventory all paid calls (Responses, chat completions, transcription, embeddings, vision, agent tools, WhatsApp media, website, and any other routes); prove none bypass the metered gateway when enabled.
* Confirm exact deployed model IDs and verified per-token/per-minute rates, not estimates. Configure `AI_OPENAI_VERIFIED_MODEL_PRICING_JSON` only with checked rates.
* Confirm any in-flight reservations, UNKNOWN charges, and overrun treatment. The application ledger is not a provider-enforced spending cap.

## 3. Verify alerts separately

* Dedicated alert SMTP credentials and recipient must be configured **on the server**, not in GitHub, issue comments or chat.
* Required settings: `AI_BUDGET_ALERT_SMTP_HOST`, `AI_BUDGET_ALERT_SMTP_PORT`, `AI_BUDGET_ALERT_SMTP_USER`, `AI_BUDGET_ALERT_SMTP_PASSWORD`, `AI_BUDGET_ALERT_EMAIL_FROM`, `AI_BUDGET_ALERT_EMAIL_TO`. Optional `AI_BUDGET_ALERT_SMTP_SECURE`.
* Only after confirming the outbox migration, SMTP acceptance, recipient authorization, and no competing scheduler processes should operators consider `AI_BUDGET_ALERT_EMAIL_ENABLED=true`. Its five-minute loop is off by default.
* **Concurrency caveat:** the current dispatcher has an in-process overlap guard but no cross-process claim/lease. If multiple API replicas run, concurrent dispatchers could email the same alert more than once. Do not enable on multiple replicas before distributed claim is implemented.
* Email thresholds are **$10 warning / $12 critical**, not proof of a hard $15 stop.

## 4. Hybrid routing approval

* DeepSeek only for fixed, approved public FAQ; never send patient identifiers, messages, medical records, appointment details, or conversation histories.
* Verify DeepSeek prepaid balance; a $0 balance cannot service requests.
* Complete regression testing for bookings, reschedules, cancellations, clinical escalation, WhatsApp, website chatbot, and failure/fallback handling.
* Get clinic owner approval before switching any production flags. Roll back immediately by disabling hybrid routing if correctness, privacy or cost controls fail.

## Evidence to record (no secrets)

Record deployment SHA, migration status, provider billing period and totals, covered paid-call inventory, exact pricing source/date, single-worker evidence, alert delivery test result, and approval decision. Do not mark the $15 target guaranteed unless the upstream providers themselves enforce compatible limits.
