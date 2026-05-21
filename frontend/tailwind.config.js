/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        bg: {
          base:    '#09090d',
          surface: '#0f0f15',
          overlay: '#14141c',
          raised:  '#1a1a24',
          muted:   '#1f1f2b',
        },
        border: {
          subtle:  '#1e1e28',
          DEFAULT: '#252533',
          strong:  '#32324a',
        },
        text: {
          primary:   '#eeeef5',
          secondary: '#8888a8',
          tertiary:  '#55556e',
          disabled:  '#3a3a52',
        },
        accent: {
          DEFAULT:   '#5c6bc0',
          hover:     '#4a58a8',
          subtle:    '#5c6bc015',
          ring:      '#5c6bc040',
        },
        success: {
          DEFAULT: '#34a853',
          subtle:  '#34a85315',
          text:    '#4eca6a',
        },
        danger: {
          DEFAULT: '#e53935',
          subtle:  '#e5393515',
          text:    '#f06060',
        },
        warning: {
          DEFAULT: '#f9a825',
          subtle:  '#f9a82515',
          text:    '#fbbf24',
        },
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '8px',
        lg: '10px',
        xl: '14px',
      },
      fontSize: {
        '2xs': ['10px', { lineHeight: '14px', letterSpacing: '0.04em' }],
        xs:    ['11px', { lineHeight: '16px', letterSpacing: '0.02em' }],
        sm:    ['12px', { lineHeight: '18px' }],
        base:  ['13px', { lineHeight: '20px' }],
        md:    ['14px', { lineHeight: '22px' }],
        lg:    ['16px', { lineHeight: '24px' }],
        xl:    ['18px', { lineHeight: '28px' }],
        '2xl': ['22px', { lineHeight: '32px' }],
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.4), 0 1px 2px rgba(0,0,0,0.3)',
        dropdown: '0 8px 24px rgba(0,0,0,0.6)',
        glow: '0 0 0 3px rgba(92,107,192,0.25)',
      },
    },
  },
  plugins: [],
}
