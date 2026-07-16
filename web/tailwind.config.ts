import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0E1420",       // page background
        panel: "#161D2B",     // cards
        edge: "#242E42",      // borders
        yes: "#27AE60",
        no: "#E64545",
        draw: "#8B93A7",
        accent: "#3B82F6",
      },
    },
  },
  plugins: [],
} satisfies Config;
