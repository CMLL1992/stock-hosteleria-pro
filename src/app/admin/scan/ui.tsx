"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QrScanner } from "@/components/scanner/QrScanner";
import { Drawer } from "@/components/ui/Drawer";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useMyRole } from "@/lib/useMyRole";
import { useLanguage } from "@/lib/LanguageContext";

function isMissingEscandallosTable(e: unknown): boolean {
  const anyErr = e as { code?: unknown; message?: unknown };
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";
  const msg = typeof anyErr?.message === "string" ? anyErr.message : "";
  return code === "PGRST205" || /could not find the table/i.test(msg) || /public\.escandallos/i.test(msg);
}

function extractProductId(decodedText: string): string | null {
  const raw = decodedText.trim();
  if (!raw) return null;

  // Si el QR contiene URL, intentamos extraer ?id=... o /p/<uid>
  try {
    const u = new URL(raw);
    const id = u.searchParams.get("id");
    if (id) return decodeURIComponent(id);
    const m = u.pathname.match(/\/p\/([^/]+)$/);
    if (m?.[1]) return decodeURIComponent(m[1]);
  } catch {
    // no-op: no era URL
  }

  // Si no es URL, asumimos que el QR contiene el id/uid
  return raw;
}

export function ScanGoClient() {
  const router = useRouter();
  const { data: me } = useMyRole();
  const { t } = useLanguage();
  const [last, setLast] = useState<string | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Comparar albarán (modo consulta, no guarda)
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareStep, setCompareStep] = useState<"scan" | "compare">("scan");
  const [compareProd, setCompareProd] = useState<null | { id: string; articulo: string; precio_tarifa: number }>(null);
  const [comparePrecio, setComparePrecio] = useState<string>("");
  const [compareMsg, setCompareMsg] = useState<string | null>(null);
  const [compareResult, setCompareResult] = useState<null | { kind: "subida" | "bajada" | "correcto"; diff: number }>(null);

  useEffect(() => {
    // iOS/Safari suele requerir un gesto del usuario para poder reproducir sonido.
    const prime = () => {
      try {
        if (!audioCtxRef.current) {
          const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
            | typeof AudioContext
            | undefined;
          if (Ctx) audioCtxRef.current = new Ctx();
        }
        void audioCtxRef.current?.resume?.();
      } catch {
        // ignore
      }
    };
    window.addEventListener("pointerdown", prime, { once: true });
    return () => window.removeEventListener("pointerdown", prime);
  }, []);

  const beep = useCallback(() => {
    try {
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.13);
    } catch {
      // ignore
    }
  }, []);

  const openCompare = useCallback(() => {
    setCompareOpen(true);
    setCompareStep("scan");
    setCompareProd(null);
    setComparePrecio("");
    setCompareMsg(null);
    setCompareResult(null);
  }, []);

  const compareBeep = useCallback(() => {
    // reutiliza el mismo beep (no duplica sonido)
    beep();
  }, [beep]);

  const onDetected = useCallback(
    (decodedText: string) => {
      const id = extractProductId(decodedText);
      if (!id) return;
      if (last === id) return;
      setLast(id);

      // Haptic feedback simple si el dispositivo lo permite
      try {
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(30);
      } catch {
        // ignore
      }
      beep();

      router.replace(`/stock?id=${encodeURIComponent(id)}&scan=1&return=${encodeURIComponent("/admin/scan")}`);
    },
    [beep, last, router]
  );

  return (
    <div className="relative">
      <div className="absolute left-0 right-0 top-3 z-10 flex justify-center px-3">
        {me?.isAdmin ? (
          <button
            type="button"
            onClick={openCompare}
            className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-white/25 bg-black/35 px-4 text-sm font-semibold text-white backdrop-blur"
          >
            {t("scan.compareDeliveryNote")}
          </button>
        ) : null}
      </div>

      <QrScanner onDetected={onDetected} />

      {me?.isAdmin ? (
        <Drawer
          open={compareOpen}
          title={t("scan.compareDrawerTitle")}
          onClose={() => {
            setCompareOpen(false);
            setCompareMsg(null);
            setCompareResult(null);
          }}
        >
          <div className="space-y-3 pb-4">
            {compareStep === "scan" ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <QrScanner
                  onDetected={async (txt) => {
                    const pid = extractProductId(txt);
                    if (!pid) return;
                    compareBeep();
                    try {
                      try {
                        const { data, error } = await supabase()
                          .from("escandallos")
                          .select("producto_id,precio_tarifa,productos:productos(articulo,nombre)")
                          .eq("producto_id", pid)
                          .maybeSingle();
                        if (error) throw error;
                        const row = (data ?? null) as
                          | null
                          | {
                              producto_id?: string;
                              precio_tarifa?: unknown;
                              productos?:
                                | { articulo?: string | null; nombre?: string | null }
                                | { articulo?: string | null; nombre?: string | null }[]
                                | null;
                            };
                        if (!row?.producto_id) throw new Error(t("scan.productNotFound"));
                        const prodRaw = row.productos;
                        const prod = Array.isArray(prodRaw) ? prodRaw[0] ?? null : prodRaw;
                        setCompareProd({
                          id: String(row.producto_id),
                          articulo: String(prod?.articulo ?? prod?.nombre ?? "—").trim() || "—",
                          precio_tarifa: Number(row.precio_tarifa ?? 0) || 0
                        });
                      } catch (e) {
                        if (!isMissingEscandallosTable(e)) throw e;
                        const { data, error } = await supabase()
                          .from("productos")
                          .select("id,articulo,nombre,precio_tarifa")
                          .eq("id", pid)
                          .maybeSingle();
                        if (error) throw error;
                        const row = (data ?? null) as null | {
                          id?: string;
                          articulo?: string | null;
                          nombre?: string | null;
                          precio_tarifa?: unknown;
                        };
                        if (!row?.id) throw new Error(t("scan.productNotFound"));
                        setCompareProd({
                          id: String(row.id),
                          articulo: String(row.articulo ?? row.nombre ?? "—").trim() || "—",
                          precio_tarifa: Number(row.precio_tarifa ?? 0) || 0
                        });
                      }
                      setCompareStep("compare");
                      setCompareResult(null);
                    } catch (e) {
                      setCompareMsg(supabaseErrToString(e));
                      setCompareResult(null);
                    }
                  }}
                />
              </div>
            ) : null}

            {compareStep === "compare" && compareProd ? (
              <div className="space-y-3">
                {compareMsg ? (
                  <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{compareMsg}</p>
                ) : null}
                {compareResult ? (
                  <p
                    className={[
                      "rounded-2xl border p-3 text-sm font-semibold",
                      compareResult.kind === "correcto"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : compareResult.kind === "subida"
                          ? "border-amber-200 bg-amber-50 text-amber-950"
                          : "border-sky-200 bg-sky-50 text-sky-950"
                    ].join(" ")}
                  >
                    {compareResult.kind === "correcto"
                      ? t("scan.priceOk")
                      : compareResult.kind === "subida"
                        ? t("scan.priceUp", { eur: compareResult.diff.toFixed(2) })
                        : t("scan.priceDown", { eur: compareResult.diff.toFixed(2) })}
                  </p>
                ) : null}
                <p className="text-sm font-semibold text-slate-900">{compareProd.articulo}</p>
                <p className="text-sm text-slate-600">
                  {t("scan.savedPrice")}{" "}
                  <span className="font-semibold tabular-nums text-slate-900">{compareProd.precio_tarifa.toFixed(2)}€</span>
                </p>

                <label className="block text-sm font-semibold text-slate-900">
                  {t("scan.deliveryNotePrice")}
                  <input
                    className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-base tabular-nums text-slate-900"
                    inputMode="decimal"
                    value={comparePrecio}
                    onChange={(e) => setComparePrecio(e.currentTarget.value)}
                    placeholder={t("scan.pricePlaceholder")}
                  />
                </label>

                <button
                  type="button"
                  className="min-h-12 w-full rounded-2xl bg-black px-4 text-sm font-semibold text-white hover:bg-slate-900"
                  onClick={() => {
                    const n = Number(String(comparePrecio).replace(",", "."));
                    if (!Number.isFinite(n) || n <= 0) {
                      setCompareMsg(t("scan.enterValidPrice"));
                      setCompareResult(null);
                      return;
                    }
                    setCompareMsg(null);
                    const signed = n - compareProd.precio_tarifa;
                    const abs = Math.abs(signed);
                    if (abs < 0.005) {
                      setCompareResult({ kind: "correcto", diff: 0 });
                      return;
                    }
                    if (signed > 0) {
                      setCompareResult({ kind: "subida", diff: abs });
                      return;
                    }
                    setCompareResult({ kind: "bajada", diff: abs });
                  }}
                >
                  {t("scan.compare")}
                </button>

                <button
                  type="button"
                  className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50"
                  onClick={() => {
                    setCompareStep("scan");
                    setCompareProd(null);
                    setComparePrecio("");
                    setCompareMsg(null);
                    setCompareResult(null);
                  }}
                >
                  {t("scan.scanAnother")}
                </button>
              </div>
            ) : null}
          </div>
        </Drawer>
      ) : null}
    </div>
  );
}

