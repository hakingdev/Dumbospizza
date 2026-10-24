/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#faf8f5',
          100: '#f5f0e8',
          200: '#ebe0d0',
          300: '#e0d1b8',
          400: '#d6c1a0',
          500: '#cbac85',
          // 600 — основной фирменный цвет кнопок/ссылок: белый текст на нём и он
          // сам на белом/бежевом фоне должны давать ≥4,5:1 (WCAG AA). Прежний
          // #b8956b давал 2,78:1 на всех главных кнопках.
          600: '#8a6942',
          700: '#735735',
          800: '#5e4934',
          900: '#4a3a29',
          950: '#3d2f21',
        },
        secondary: {
          50: '#fef2f3',
          100: '#fde6e7',
          200: '#fbd0d5',
          300: '#f7aab2',
          400: '#f27a8a',
          500: '#e94e64',
          600: '#d42a47',
          700: '#b21e3d',
          800: '#951c39',
          900: '#7e1c37',
          950: '#45090b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
