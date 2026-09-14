import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  // @quran/core ships TypeScript source (no build step), so Next must
  // compile it rather than treat it as pre-built runtime code.
  transpilePackages: ['@quran/core'],
};

export default nextConfig;
