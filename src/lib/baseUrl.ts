"use client";

export function getBaseUrl(): string {
  // Para QR: preferimos una URL canónica configurada para evitar
  // generar etiquetas apuntando a previews/IPs distintas (muy común en móvil).
  const envBase = (process.env.NEXT_PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (envBase) return envBase;

  if (typeof window !== "undefined") return window.location.origin;

  return "http://localhost:3000";
}

