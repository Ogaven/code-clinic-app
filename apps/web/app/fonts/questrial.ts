import localFont from 'next/font/local'

// Questrial ships Regular (400) only — no bold/black face exists, so
// callers must not request weights above 400 (see .cc-admin-shell rules
// in globals.css, which flatten Tailwind's font-bold/semibold/black to
// 400 rather than let the browser synthesize a fake bold).
export const questrial = localFont({
  src: './Questrial-Regular.ttf',
  weight: '400',
  style: 'normal',
  display: 'swap',
  variable: '--font-questrial',
})
