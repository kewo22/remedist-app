import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Railway runs the standalone server; it bundles only what the app needs.
  output: 'standalone',
  poweredByHeader: false,
};

export default nextConfig;
