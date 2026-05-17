// Railway cache bust: 2026-05-06
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  async redirects() {
    return [
      { source: '/privacy', destination: '/privacy.html', permanent: false },
      { source: '/terms',   destination: '/terms.html',   permanent: false },
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
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: '*.up.railway.app' },
      { protocol: 'https', hostname: '*.railway.app' },
      { protocol: 'http',  hostname: 'localhost' },
    ],
  },
}

export default nextConfig
