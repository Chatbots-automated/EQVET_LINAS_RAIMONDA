import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Turbopack's persistent build cache (on by default since 16.3) records
    // the values of env vars read by server code — including
    // INVOICE123_TOKEN_ENCRYPTION_KEY — and Netlify keeps .next/cache between
    // builds. Don't let a secret sit in a cache file; builds are fast anyway.
    turbopackFileSystemCacheForBuild: false,
  },
};

export default nextConfig;
