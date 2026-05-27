// Railway cache bust: 2026-05-06
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  typescript: {
    ignoreBuildErrors: true,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  images: {
    remotePatterns: [
      // Cloudflare R2 public buckets
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      // Railway deployments
      { protocol: 'https', hostname: '*.up.railway.app' },
      { protocol: 'https', hostname: '*.railway.app' },
      // Production API (serves /uploads/* for local-disk avatar fallback)
      { protocol: 'https', hostname: 'api.codeclinicemr.com' },
      // Local development
      { protocol: 'http',  hostname: 'localhost' },
    ],
  },
}

export default nextConfig
