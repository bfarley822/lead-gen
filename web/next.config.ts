import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // SQLite is opened by path string — not statically imported — so the DB must be
  // explicitly included in the serverless bundle (Vercel); otherwise /api/* 500s.
  outputFileTracingIncludes: {
    "/*": ["./data/lead-gen.db"],
  },
};

export default nextConfig;
