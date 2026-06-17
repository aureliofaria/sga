/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#FF7A00',
          50: '#FFF3E8',
          100: '#FFE2C7',
          500: '#FF7A00',
          600: '#E66E00',
          700: '#CC6200',
        },
        slate: {
          header: '#1E293B',
        },
      },
    },
  },
  plugins: [],
};
