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
          600: '#b8956b',
          700: '#9a7a56',
          800: '#7c6145',
          900: '#5e4934',
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
