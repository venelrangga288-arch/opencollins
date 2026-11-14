import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: "#2563eb",
          hover: "#1d4ed8",
        },
        // Collins-style obsidian dark palette (workstation / operator)
        obsidian: {
          950: "#0b0b0a",
          900: "#111110",
          850: "#161615",
          800: "#1c1c1a",
          750: "#171716",
          700: "#222220",
          600: "#262624",
          500: "#292927",
          400: "#333330",
        },
        haze: {
          DEFAULT: "#8a8a86", // muted text
          soft: "#a1a19b",
          mid: "#c8c8c4",
          lite: "#d4d4d0",
          bright: "#e6e6e3",
          white: "#f4f4f2",
        },
        glint: "#67dcf2", // cyan accent
        spark: "#1fa8f5", // blue accent (selection/focus)
      },
      fontFamily: {
        sans: ['"Public Sans"', "Tahoma", "Verdana", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "monospace"],
        // Collins display faces
        display: ['"Syne"', "Georgia", "serif"],
        editorial: ['"Instrument Serif"', "Georgia", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
