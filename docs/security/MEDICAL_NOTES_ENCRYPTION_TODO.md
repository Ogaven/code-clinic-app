# SECURITY TODO — `Patient.medicalNotesEncrypted` is not actually encrypted

**Status:** Deferred. Documented here so it isn't lost, not scheduled for this
release. Access to the field is already gated (see
`docs/security/` sibling notes / `apps/api/src/routes/patients.ts`:
`GET /:id` redacts it to `null` for every role except `ADMIN` and `DOCTOR`,
enforced server-side and covered by
`apps/api/src/__tests__/patient-clinical-notes-authorization.test.ts`). This
document is only about the fact that the *stored value itself* is plaintext
despite its name.

## What was verified (2026-09-16), without exposing any real medical-note content

- **Schema**: `packages/database/prisma/schema.prisma` — `medicalNotesEncrypted String?`. A plain nullable string column, no column-level encryption, no application-level cipher metadata (IV, key ID, algorithm tag) stored alongside it.
- **No encrypt/decrypt code path exists**: `grep`-ing `apps/api/src` for `encryptMedicalNotes`, `decryptMedicalNotes`, or any `crypto` usage near this field returns nothing in current source. The only remaining references to those function names are in `apps/api/src/__tests__/agent-tools-data-minimisation.test.ts`, which documents that a `decryptMedicalNotes` helper *used to exist* in `agent-tools.ts` and was deliberately deleted (see commit `bfc6e1d`, "remove clinical notes from receptionist AI") — it was removed as part of a GDPR fix to stop the field reaching the AI agent, not replaced with a proper encrypt/decrypt layer at the field's write/read boundary.
- **Every current read/write path treats it as a plain string**: `apps/api/src/routes/patients.ts` reads `patient.medicalNotesEncrypted` and returns it verbatim (redaction is role-based, not decryption). No route in `apps/api/src/routes` writes this field through any transform either.
- **Conclusion**: the `Encrypted` suffix in the field name is aspirational/historical, not descriptive of current behavior. Whatever is written to this column today is stored, transmitted, and returned exactly as typed by staff — plaintext at rest and in transit (transport is separately protected by HTTPS/TLS, which is unrelated to encryption-at-rest).

## Why this isn't being fixed in this pass

- Real encryption-at-rest requires a key-management decision (where the key lives, who can access it, rotation policy) that is a business/infrastructure decision, not something to improvise inside an unrelated bug-fix pass.
- A migration must decide how to handle **existing** plaintext rows — leaving them unencrypted, backfilling encryption, or a phased dual-read period — each with different operational risk.
- Getting this wrong risks making existing clinical notes unreadable, which is worse than the current (already access-gated) plaintext state.

## Requirements for the future controlled migration

1. **Encryption approach**
   - Field-level symmetric encryption (e.g. AES-256-GCM) applied at the application layer on write, decrypted on read for authorized roles only — not database-level transparent encryption, since the API already needs to gate *who* can see the plaintext, and DB-level encryption doesn't help with that.
   - Store algorithm + key version alongside the ciphertext (e.g. a small JSON envelope `{v, iv, tag, ciphertext}` in the same column, or a sibling column) so future key rotation doesn't require guessing which key/version encrypted a given row.

2. **Key storage/management**
   - Key must live outside the application database (a secrets manager / KMS — not a `.env` value on the same droplet that hosts the data it protects).
   - Define who/what can request decryption (the API process only, never a build artifact or log pipeline).
   - Document the key's blast radius: if it leaks, every historical note is exposed — treat provisioning and access to it accordingly.

3. **Migration/backfill strategy**
   - New writes should use encryption from day one of the migration.
   - Existing plaintext rows need an explicit, reviewed decision: backfill-encrypt in a controlled batch job (with a dry run and count-based verification before/after), or leave historical rows as a clearly-flagged legacy state — do not silently mix the two without a way to tell them apart (e.g. a `medicalNotesEncryptedAt` timestamp or envelope version `0` meaning "legacy plaintext").
   - Any backfill job must run against a **production backup**, be tested against a copy of production data first, and be reversible (see rollback below) before it touches live rows.

4. **Rollback/recovery**
   - Keep the pre-migration column value backed up (e.g. a shadow column or a one-time export) until the migration is verified successful in production for a defined burn-in period.
   - Define an explicit rollback script that can restore plaintext from the backup if decryption starts failing for any row.

5. **Key rotation**
   - The envelope's key-version field (see #1) must let old ciphertext keep decrypting with its original key while new writes use the newest key, until a background re-encryption pass moves old rows forward — never a hard cutover that breaks old rows.

6. **Backward compatibility**
   - Every current reader of this field (`apps/api/src/routes/patients.ts`, any future consumer) must go through a single shared decrypt helper, not re-implement decryption inline — this is exactly the kind of drift that let the AI-agent leak happen previously with the "GDPR-sensitive field" boundary itself.
   - The API response shape for `medicalNotesEncrypted` should not change (still a plain string to clients that are authorized to see it) — decryption happens server-side before the existing redaction check, transparent to every current frontend consumer.

7. **Testing**
   - Unit tests for encrypt→decrypt round-trip, including the legacy-plaintext-row case (must not attempt to "decrypt" a row that was never encrypted).
   - A regression test asserting the existing role-based redaction (`ADMIN`/`DOCTOR` see plaintext, others get `null`) still holds after decryption is introduced — extend `patient-clinical-notes-authorization.test.ts` rather than duplicating it.
   - A test proving a corrupted/undecryptable row fails closed (returns an error or `null`, never raw ciphertext) rather than crashing the whole patient-profile response.

8. **Zero plaintext logging**
   - Audit the decrypt helper and every caller to confirm the plaintext value is never passed to `console.log`/`logger.*`/`logAudit()` — the new `VIEW_SENSITIVE` audit entry added in this pass (`apps/api/src/routes/patients.ts`) already only logs `entityId`/`entityName`, never the note content; the same discipline must carry into the encryption layer's own error handling (a decryption failure log must never include the ciphertext or an attempted-plaintext value).

## Non-goals for this document

This is a scoping document, not an implementation plan with a timeline. No code changes, key provisioning, or schema changes should happen from this document alone — a follow-up task should reference this file and get explicit sign-off on the key-management approach before writing any migration code.
