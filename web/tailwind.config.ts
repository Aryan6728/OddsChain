import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1D2B39",       // primary text
        sub: "#66788C",       // secondary text
        faint: "#98A4B3",     // tertiary text
        panel: "#FFFFFF",     // cards
        soft: "#F2F4F7",      // pills / inputs
        softer: "#E8EBF0",    // pill hover
        edge: "#E5E9EF",      // borders
        yes: "#27AE60",
        no: "#E64545",
        draw: "#66788C",
        accent: "#2D5BE3",    // primary blue
        accent2: "#2249C4",   // blue hover
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.05)",
        btn: "0 2px 0 rgba(16, 24, 40, 0.12)",
      },
    },
  },
  plugins: [],
} satisfies Config;
