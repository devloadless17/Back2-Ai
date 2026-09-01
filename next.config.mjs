/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /*
   * Standalone output, for the container — and only for the container.
   *
   * Next traces the files each route actually imports and emits a server that
   * carries only those, so the image ships without the full `node_modules` —
   * which for this project is dominated by build-time weight (esbuild, the
   * Prisma CLI, tsx, the corpus scripts' dependencies) that a running server
   * never touches.
   *
   * The Prisma query engine is the one thing tracing cannot see, because it is
   * a platform binary resolved at runtime rather than an import. The Dockerfile
   * copies it explicitly; if that COPY is ever dropped, the container builds
   * cleanly and every database call fails at runtime.
   *
   * Switched off on Vercel, which does its own tracing and packaging per
   * function. Leaving it on there makes the build emit a second, complete
   * server directory that nothing serves — pure build time and disk on every
   * deploy. `VERCEL` is set by the platform on every build and runtime.
   */
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
  /*
   * Left as real `require`s rather than bundled.
   *
   * Prisma resolves a platform-specific query engine at runtime, which webpack
   * cannot follow. The transformers/ONNX pair is here for the opposite reason:
   * it must not be followed. See `src/lib/ai/embeddings.ts` — the local
   * embedding provider is loaded through an opaque specifier precisely so the
   * 69 MB ONNX runtime stays out of every serverless function, and naming the
   * packages here keeps any future static import from quietly undoing that.
   */
  serverExternalPackages: ['@prisma/client', '@huggingface/transformers', 'onnxruntime-node'],
  eslint: {
    // Lint is run explicitly in CI; do not couple it to the production build.
    ignoreDuringBuilds: true,
  },
  async headers() {
    // Baseline hardening. This system serves an official examination workflow,
    // so these are enforced at the edge rather than left to the host config.
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
