/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/web/**/*.{ts,tsx,html}', './src/web/index.html'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f2f6fb',
          100: '#e2ecf6',
          200: '#c0d5ea',
          300: '#94b8d9',
          400: '#6195c4',
          500: '#3f77aa',
          600: '#2f5e8e',
          700: '#284b73',
          800: '#244061',
          900: '#142b47',
          950: '#0c1c31',
        },
        brand: {
          50: '#effcf9',
          100: '#c9f7ee',
          200: '#93eddf',
          300: '#55dccd',
          400: '#23c2b8',
          500: '#0da49e',
          600: '#068483',
          700: '#08696b',
          800: '#0a5455',
          900: '#0b4547',
          950: '#032a2c',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 34 58 / 0.06), 0 1px 3px 0 rgb(15 34 58 / 0.08)',
        pop: '0 10px 30px -10px rgb(15 34 58 / 0.25)',
      },
      keyframes: {
        'slide-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(16px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
      animation: {
        'slide-in': 'slide-in 0.18s ease-out',
        'slide-in-right': 'slide-in-right 0.22s ease-out',
      },
    },
  },
  plugins: [],
};
