# Code Clinic — Walk-in Google Sheets rollout (PR #255)

## Current status
The export is **OFF by default**. Do not turn it on before approval of the destination, fields, retention, Google service-account access, and test plan. This feature must not affect existing patient registration.

## Verified destination (read-only, 14 October 2026)
- Spreadsheet ID: `1xlTWS4OaVWnHfebV0FggFij56Ai9uzHc6GMVR7MhqX4`
- Target tab ID (gid): `1741829078`
- Target tab name: `Form Responses 2`
- Existing A:P columns belong to a historical Google Form; preserve their headings and historical rows.
- Existing column B: `Surname`; C: `Given Name`; D: `Contact`.
- Column Q is reserved for `Code Clinic EMR Intake Event ID`, a stable identifier used to detect duplicate exports.
- The worker **does not create or change column Q**. The owner must approve adding exactly that heading to Q1. Until then it refuses to export.

## Field mapping
| Column | Existing form field | Export source |
| --- | --- | --- |
| A | Timestamp / existing blank heading | EMR intake activity timestamp (UTC) |
| B | Surname | Patient last name |
| C | Given Name | Patient first name |
| D | Contact | Patient phone |
| E | Date of Birth | Blank (not yet mapped) |
| F | Email Address | Patient email |
| G | Residence | Patient address |
| H | What's your concern? | Blank (not yet mapped) |
| I | How did you get to know about us? | Patient referral source |
| J–L | Next-of-kin/other fields | Blank |
| M | Next of Kin (Contact) | Patient next-of-kin phone |
| N–P | Other fields | Blank |
| Q | New reserved heading | Intake activity ID |

Only the fields listed above are sent. Blank fields are **not** evidence that the patient did not provide that information; the mapping is intentionally incomplete pending approved field definitions. Google Sheets is not the clinical source of truth.

## Deployment prerequisites
1. Obtain clinic authorization for sharing the listed patient data with Google and confirm data retention/access permissions.
2. Confirm the exact sheet and headers with the sheet owner; add Q1 **only after explicit approval**. Do not overwrite form responses or existing columns.
3. Enable Google Sheets API for the service account's Google Cloud project. Share only the target spreadsheet with the service account email as Editor. Restrict access to approved clinic staff.
4. Configure server-side secrets in DigitalOcean, never in source control:
   - `WALKIN_SHEETS_SERVICE_ACCOUNT_EMAIL`
   - `WALKIN_SHEETS_PRIVATE_KEY` (PEM; escaped newlines supported)
   - `WALKIN_SHEETS_EXPORT_ENABLED=false` initially.
5. Deploy both Prisma migrations and regenerate the Prisma client before enabling. Confirm both `walkin_sheet_outbox` and `walkin_sheet_export_lease` exist, and the singleton lease row exists.
6. Validate using synthetic patients only, including duplicate retries, transient Google errors, server restart and a second API instance. Confirm no duplicate rows and no patient intake failures.
7. Only after approval and tests, set `WALKIN_SHEETS_EXPORT_ENABLED=true` and restart the API. Monitor retry counts, age of pending events and export error messages.

## Rollback
Set `WALKIN_SHEETS_EXPORT_ENABLED=false` and restart the API. This stops new Sheets writes without disabling walk-in registration or deleting pending tasks. Do not roll back database migrations while application code depends on them.

## Known limitations and safeguards
- The database lease is 30 minutes, is renewed before each queued event, and ownership is rechecked immediately before appending. Google API calls have 30-second timeouts. A process stalled beyond lease expiry still requires monitoring; Sheets does not offer atomic check-and-append.
- Google Sheets has no atomic check-and-append operation; exact-once delivery cannot be guaranteed under every failure mode. Intake activity IDs and pre-append scanning mitigate duplicates.
- If the outbox insert fails but the fallback patient activity is recorded, the worker attempts automatic reconciliation for flagged activities from the past 30 days. Older flagged activities, or submissions for which both the outbox and activity recording fail, require manual investigation. Never silently claim a row was exported.
- Existing form fields not represented in the EMR intake model remain blank. Do not infer missing medical or contact data.
- No production Sheet writes have been performed as part of this PR.
