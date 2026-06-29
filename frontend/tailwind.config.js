/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Cores oficiais Gol Plus (Manual da Marca):
        // Azul institucional #13294B (Pantone 2767 C) · Laranja #ff6413 (Pantone 1585 C)
        golplus: {
          blue:   { DEFAULT: '#13294B', 50:'#eef1f6',100:'#cdd6e4',200:'#9badc4',300:'#6981a3',400:'#3d5680',500:'#24406a',600:'#1a3358',700:'#13294B',800:'#0f2140',900:'#0a1730' },
          orange: { DEFAULT: '#ff6413', 50:'#fff1e8',100:'#ffd9c2',200:'#ffb88c',300:'#ff9456',400:'#ff7c2e',500:'#ff6413',600:'#e85304',700:'#bf4304',800:'#97370a',900:'#7a2d0c' },
        },
      },
      fontFamily: { sans: ['Nunito','Poppins','ui-sans-serif','system-ui','sans-serif'] },
      borderRadius: { xl: '1rem', '2xl': '1.25rem' },
    },
  },
  plugins: [],
}
