/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // Framework-level redirect — runs before any page is rendered, never cached.
  async redirects() {
    return [
      {
        source: '/chatbot-widget',
        destination: 'https://api.codeclinicemr.com/chatbot-widget-test',
        permanent: false, // 307 — preserves method
      },
    ]
  },

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
      // Production API (serves /uploads/* for local-disk avatar fallback)
      { protocol: 'https', hostname: 'api.codeclinicemr.com' },
      // Local development
      { protocol: 'http',  hostname: 'localhost' },
    ],
  },
}

export default nextConfig
