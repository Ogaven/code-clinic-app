// 'africastalking' ships no type declarations of its own. Both call sites in
// this codebase treat it as untyped (`as any` / plain `require()`), so this
// only needs to satisfy module resolution, not describe the real API shape.
declare module 'africastalking';
