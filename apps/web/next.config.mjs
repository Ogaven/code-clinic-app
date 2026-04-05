/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // Proxy all /api-proxy/* calls to the real API — works at runtime, no rebuild needed
  async rewrites() {
    const apiUrl = process.env.API_URL || 'https://api-production-4c43.up.railway.app'
    return [
      {
        source: '/api-proxy/:path*',
        destination: `${apiUrl}/:path*`,
      },
    ]
  },

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
    ],
  },
}

export default nextConfig
