/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        wa: {
          header: '#075E54',
          headerLight: '#128C7E',
          bg: '#ECE5DD',
          sent: '#DCF8C6',
          online: '#25D366',
        },
      },
      keyframes: {
        'bounce-dot': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
      animation: {
        'bounce-dot': 'bounce-dot 0.8s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
