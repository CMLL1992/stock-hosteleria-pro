import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      keyframes: {
        "stock-alert": {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-2px)" },
          "40%": { transform: "translateX(2px)" },
          "60%": { transform: "translateX(-1px)" },
          "80%": { transform: "translateX(1px)" }
        }
      },
      animation: {
        "stock-alert": "stock-alert 0.45s ease-in-out infinite"
      }
    }
  },
  plugins: []
} satisfies Config;

