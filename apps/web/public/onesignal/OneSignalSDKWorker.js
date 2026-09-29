// Dedicated OneSignal worker. It intentionally lives under /onesignal/ so it
// does not replace Code Clinic's existing /sw.js PWA/offline worker.
importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js')
