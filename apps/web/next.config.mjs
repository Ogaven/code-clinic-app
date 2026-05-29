/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // Gzip/Brotli compression for all responses
  compress: true,

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

  async headers() {
    return [
      {
        // Content-hashed static assets — safe to cache for 1 year
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Public images and icons — cache for 7 days
        source: '/:path(.*\\.(?:png|jpg|jpeg|svg|ico|webp|gif))',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=604800, stale-while-revalidate=86400',
          },
        ],
      },
    ]
  },
}

export default nextConfig
