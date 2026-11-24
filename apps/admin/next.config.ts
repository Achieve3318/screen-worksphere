import type { NextConfig } from 'next'

const apiUrl = process.env.SCREENVAULT_API_URL ?? 'http://127.0.0.1:4000'

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ['95.216.116.55'],
  transpilePackages: ['@screenvault/ui', '@screenvault/shared', '@screenvault/types'],
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${apiUrl}/api/v1/:path*` }]
  },
}

export default nextConfig
