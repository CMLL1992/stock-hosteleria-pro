"use client";

import { useState } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { Drawer } from "@/components/ui/Drawer";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { QRCodeCanvas } from "qrcode.react";
import { QrCode } from "lucide-react";

export default function AdminEstablecimientoPage() {
  const { activeEstablishmentName, activeEstablishmentSlug, activePublicBookingUrl } = useActiveEstablishment();
  const [copied, setCopied] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);

  async function copyUrl() {
    const url = (activePublicBookingUrl ?? "").trim();
    if (!url) return;
    setCopied(null);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied("Copiado ✓");
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      setCopied("No se pudo copiar");
      window.setTimeout(() => setCopied(null), 1400);
    }
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Establecimiento" showBack backHref="/admin" />
      <main className="mx-auto w-full max-w-3xl p-4 pb-28">
        <section className="premium-card space-y-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Perfil del local</p>
            <p className="mt-1 text-lg font-black tracking-tight text-slate-900">{(activeEstablishmentName ?? "").trim() || "Mi local"}</p>
            <p className="mt-1 text-sm text-slate-600">
              Slug: <span className="font-semibold text-slate-900">{activeEstablishmentSlug ?? "—"}</span>
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-sm font-semibold text-slate-900">Tu URL de reservas es:</p>
            <p className="mt-2 break-all rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-extrabold text-slate-900">
              {activePublicBookingUrl ?? "—"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyUrl()}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-premium-blue px-4 text-sm font-extrabold text-white shadow-sm hover:brightness-110 active:brightness-95 disabled:opacity-60"
                disabled={!activePublicBookingUrl}
              >
                {copied ?? "Copiar al portapapeles"}
              </button>
              <button
                type="button"
                onClick={() => setQrOpen(true)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                disabled={!activePublicBookingUrl}
              >
                <QrCode className="h-4 w-4" aria-hidden />
                Generar QR
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">Recomendado: pon el QR en mesas y el link en redes sociales.</p>
          </div>
        </section>
      </main>

      <Drawer open={qrOpen} title="QR del enlace de reservas" onClose={() => setQrOpen(false)}>
        <div className="space-y-4 pb-4">
          <div className="flex items-center justify-center rounded-3xl border border-slate-200 bg-white p-6">
            {activePublicBookingUrl ? <QRCodeCanvas value={activePublicBookingUrl} size={240} includeMargin /> : null}
          </div>
          <p className="break-all text-xs font-semibold text-slate-600">{activePublicBookingUrl ?? ""}</p>
        </div>
      </Drawer>
    </div>
  );
}

