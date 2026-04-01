/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          "JetBrains Mono",
          "SF Mono",
          "Fira Code",
          "ui-monospace",
          "monospace",
        ],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem" }],
      },
      colors: {
        noc: {
          bg: "hsl(220 20% 7%)",
          card: "hsl(220 18% 10%)",
          surface: "hsl(220 16% 13%)",
          border: "hsl(220 15% 16%)",
          "border-subtle": "hsl(220 15% 12%)",
          muted: "hsl(220 15% 24%)",
          text: "hsl(210 20% 88%)",
          "text-muted": "hsl(215 15% 55%)",
          "text-dim": "hsl(215 12% 40%)",
        },
        accent: {
          DEFAULT: "hsl(190 90% 50%)",
          muted: "hsl(190 90% 50% / 0.15)",
          strong: "hsl(190 90% 60%)",
        },
        traffic: {
          in: "hsl(174 72% 46%)",
          "in-muted": "hsl(174 72% 46% / 0.15)",
          out: "hsl(36 100% 55%)",
          "out-muted": "hsl(36 100% 55% / 0.15)",
        },
        node: {
          router: "hsl(36 100% 55%)",
          "switch-l3": "hsl(270 60% 60%)",
          "switch-l2": "hsl(210 80% 55%)",
          server: "hsl(152 60% 44%)",
          firewall: "hsl(0 72% 50%)",
          cloud: "hsl(190 90% 50%)",
          internet: "hsl(340 65% 55%)",
        },
      },
      borderRadius: {
        DEFAULT: "0.375rem",
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out forwards",
        shimmer: "shimmer 1.5s ease-in-out infinite",
        "pulse-subtle": "pulse-subtle 2s ease-in-out infinite",
        "spin-slow": "spin 1.2s linear infinite",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-subtle": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "0.7" },
        },
      },
    },
  },
  plugins: [],
};
