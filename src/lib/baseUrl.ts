"use client";

export function getBaseUrl(): string {
  // Para QR: usar origin dinámico tal como pides (localhost / IP / producción).
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}

