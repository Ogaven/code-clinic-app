// The 'africastalking' SDK ships no type declarations and no @types package
// exists for it. sms.service.ts already treats the imported module as `any`
// (dynamic import cast), so this only needs to satisfy TS7016 — no need to
// hand-type the whole SDK surface.
declare module 'africastalking'
