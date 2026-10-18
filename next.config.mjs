/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pdfkit'],
  outputFileTracingIncludes: { '/api/kesiswaan/report': ['./public/fonts/kesiswaan/*', './node_modules/pdfkit/js/data/**/*'] },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
