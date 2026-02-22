/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{vue,js,ts}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f2ff',
          100: '#e0e5ff',
          200: '#c7cdfe',
          300: '#a4abfc',
          400: '#8185f8',
          500: '#667eea',
          600: '#5a6fd6',
          700: '#4a5ab8',
          800: '#3d4a96',
          900: '#364078',
        },
        accent: {
          500: '#764ba2',
          600: '#6a4292',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
