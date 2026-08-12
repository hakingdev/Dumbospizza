/** @type {import('next').NextConfig} */
// ВАЖНО: ключ `i18n` в next.config — это фича Pages Router и ЛОМАЕТ App Router
// (RSC-навигация отдаёт 404 на `/?_rsc=…`, клики по ссылкам/логотипу не работают).
// Проект на App Router, переводы — клиентские (react-i18next / LanguageContext),
// поэтому next.config.i18n НЕ нужен и удалён.

const nextConfig = {
  reactStrictMode: true,
  // Несколько параллельных `next dev` на одном .next дают ложные 500
  // (см. заметку next-dev-shared-cache-500) — второй инстанс запускать
  // с NEXT_DIST_DIR=.next-<имя>
  distDir: process.env.NEXT_DIST_DIR || '.next',
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
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
