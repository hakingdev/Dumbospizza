/** @type {import('next').NextConfig} */
const { i18n } = require('./next-i18next.config');

// Исправление ошибки "localeDetection"
if (i18n && i18n.localeDetection === undefined) {
  i18n.localeDetection = false;
}

const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: ['localhost', 'res.cloudinary.com'],
  },
  i18n,
  // Настройки для Docker
  output: 'standalone',
  experimental: {
    // Оптимизации для Docker
    outputFileTracingRoot: __dirname,
  },
  // Встроенная конфигурация webpack для hot-reload в Docker
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      // Важно для горячей перезагрузки в Docker
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
      };
    }
    return config;
  },
  async rewrites() {
    return [
      {
        source: '/uploads/:path*',
        destination: '/api/uploads/:path*'
      }
    ];
  }
}

module.exports = nextConfig
