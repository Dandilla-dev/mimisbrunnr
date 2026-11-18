/** Палитра и шрифты — из заготовок интерфейса Мимира. @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111713',
        'rail-bg': '#0D120F',
        panel: '#161C18',
        'panel-2': '#1C231E',
        hairline: '#2A332C',
        'hairline-soft': '#1F2621',
        stone: '#D6D9DD',
        mist: '#8A93A6',
        'mist-dim': '#5C6660',
        bronze: '#B98D55',
        'bronze-dim': 'rgba(185,141,85,0.14)',
        'bronze-hover': 'rgba(185,141,85,0.28)',
        fjord: '#5C82A6',
        'fjord-dim': 'rgba(92,130,166,0.14)',
        moss: '#7FA08A',
        'moss-dim': 'rgba(127,160,138,0.14)',
        danger: '#B85C5C',
        'danger-soft': '#D98787',
        'danger-hover': 'rgba(184,92,92,0.14)',
      },
      fontFamily: {
        display: ['Spectral', 'Georgia', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      keyframes: {
        'modal-in': { from: { opacity: 0, transform: 'translateY(8px) scale(0.98)' }, to: { opacity: 1, transform: 'translateY(0) scale(1)' } },
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
      },
      animation: { 'modal-in': 'modal-in 0.18s ease', 'fade-in': 'fade-in 0.3s ease' },
    },
  },
  plugins: [],
};
