/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        background: '#ffffff',
        text: '#1a1a2e',
        accent: '#2563eb',
        muted: '#6b7280',
        'code-bg': '#f8fafc',
      },
      fontFamily: {
        heading: ['Inter', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        code: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
};
