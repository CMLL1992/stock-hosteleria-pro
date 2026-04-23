"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MobileHeader } from "@/components/MobileHeader";
import { Drawer } from "@/components/ui/Drawer";
import { supabase } from "@/lib/supabase";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useQueryClient } from "@tanstack/react-query";
import { resolveProductoTituloColumn, tituloColSql } from "@/lib/productosTituloColumn";
import { requireUserId } from "@/lib/session";
import { Camera } from "lucide-react";

type PedidoEstado = "pendiente" | "parcial" | "recibido";

type PedidoRow = {
  id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  estado: PedidoEstado;
  created_at: string;
};

type PedidoItemRow = {
  producto_id: string;
  articulo: string;
  unidad: string | null;
  cantidad_pedida: number;
  cantidad_recibida: number;
};

function toInt(v: unknown): number {
  const n = Math.trunc(Number(String(v ?? "").replace(",", ".")));
  return Number.isFinite(n) ? n : 0;
}

function digitsOnly(raw: string): string {
  return String(raw ?? "").replace(/[^\d]/g, "");
}

function readEvtValue(
  e: { currentTarget?: { value?: unknown }; target?: { value?: unknown } } | null | undefined
): string {
  try {
    const v = e?.currentTarget?.value ?? e?.target?.value;
    return typeof v === "string" ? v : String(v ?? "");
  } catch {
    return "";
  }
}

export default function RecepcionPedidosPage() {
  const router = useRouter();
  const { data: me, isLoading: meLoading } = useMyRole();
  const role = getEffectiveRole(me ?? null);
  const canReceive = hasPermission(role, "staff");
  const canAdmin = hasPermission(role, "admin");

  const { activeEstablishmentId } = useActiveEstablishment();
  const queryClient = useQueryClient();

  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pedidos, setPedidos] = useState<PedidoRow[]>([]);

  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<PedidoRow | null>(null);
  const [items, setItems] = useState<PedidoItemRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [uploadingAlbaran, setUploadingAlbaran] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [albaranOk, setAlbaranOk] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeEstablishmentId) {
      setPedidos([]);
      return;
    }
    setErr(null);
    setLoading(true);
    try {
      const { data, error } = await supabase()
        .from("pedidos")
        .select("id,proveedor_id,estado,created_at,proveedor:proveedores(nombre)")
        .eq("establecimiento_id", activeEstablishmentId)
        .in("estado", ["pendiente", "parcial"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
        const provRaw = r.proveedor as { nombre?: unknown } | { nombre?: unknown }[] | null | undefined;
        const prov = Array.isArray(provRaw) ? provRaw[0] ?? null : provRaw;
        return {
          id: String(r.id ?? ""),
          proveedor_id: String(r.proveedor_id ?? ""),
          proveedor_nombre: String(prov?.nombre ?? "Proveedor").trim() || "Proveedor",
          estado: (String(r.estado ?? "pendiente") as PedidoEstado) ?? "pendiente",
          created_at: String(r.created_at ?? new Date().toISOString())
        } satisfies PedidoRow;
      });
      setPedidos(rows);
    } catch (e) {
      setErr(supabaseErrToString(e));
      setPedidos([]);
    } finally {
      setLoading(false);
    }
  }, [activeEstablishmentId]);

  async function onCaptureAlbaran(file: File | null) {
    if (!file) return;
    if (!activeEstablishmentId) {
      setErr("Selecciona un establecimiento antes de guardar albaranes.");
      return;
    }
    setErr(null);
    setAlbaranOk(null);
    setUploadingAlbaran(true);
    setUploadPct(5);
    try {
      setUploadPct(15);
      const ext = (() => {
        const n = (file.name || "").toLowerCase();
        const m = n.match(/\.([a-z0-9]+)$/);
        if (m?.[1]) return m[1];
        const type = (file.type || "").toLowerCase();
        if (type.includes("png")) return "png";
        if (type.includes("webp")) return "webp";
        return "jpg";
      })();
      const safeName = `${Date.now()}-${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2))}.${ext}`;
      const path = `${activeEstablishmentId}/${safeName}`;
      setUploadPct(35);

      const up = await supabase().storage.from("albaranes").upload(path, file, {
        upsert: false,
        contentType: file.type || undefined,
        cacheControl: "3600"
      });
      if (up.error) throw up.error;
      setUploadPct(70);

      const { data } = supabase().storage.from("albaranes").getPublicUrl(path);
      const publicUrl = data?.publicUrl ?? "";
      if (!publicUrl) throw new Error("No se pudo obtener la URL pública del albarán.");

      setUploadPct(85);
      const ins = await supabase().from("albaranes").insert({
        imagen_url: publicUrl,
        proveedor_id: sel?.proveedor_id ?? null,
        establecimiento_id: activeEstablishmentId
      } as unknown as Record<string, unknown>);
      if (ins.error) throw ins.error;

      setUploadPct(100);
      setAlbaranOk("Albarán guardado para auditoría ✅");
      // refresco suave por si la vista de auditoría está abierta en otra pestaña (Realtime se encargará si está activado)
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setUploadingAlbaran(false);
      setTimeout(() => setUploadPct(0), 600);
      setTimeout(() => setAlbaranOk(null), 2500);
    }
  }

  useEffect(() => {
    if (!canReceive) return;
    void refresh();
  }, [canReceive, refresh]);

  async function openPedido(p: PedidoRow) {
    if (!activeEstablishmentId) return;
    setErr(null);
    setSel(p);
    setOpen(true);
    setItems([]);
    setDraft({});
    try {
      const col = await resolveProductoTituloColumn(activeEstablishmentId);
      const t = tituloColSql(col);
      const { data, error } = await supabase()
        .from("pedido_items")
        .select(`producto_id,cantidad_pedida,cantidad_recibida,productos:productos(${t},unidad)` as "*")
        .eq("pedido_id", p.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (error) throw error;
      const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
        const prodRaw = r.productos as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | null
          | undefined;
        const prod = Array.isArray(prodRaw) ? prodRaw[0] ?? null : prodRaw;
        const title = (prod?.[t] ?? prod?.articulo ?? prod?.nombre ?? "") as unknown;
        const articuloEtiqueta = String(title ?? "").trim() || "Producto no encontrado";
        const unidadRaw = (prod as Record<string, unknown> | null)?.unidad;
        const unidad = unidadRaw != null ? String(unidadRaw) : null;
        return {
          producto_id: String(r.producto_id ?? ""),
          articulo: articuloEtiqueta,
          unidad,
          cantidad_pedida: Math.max(0, toInt(r.cantidad_pedida)),
          cantidad_recibida: Math.max(0, toInt(r.cantidad_recibida))
        } satisfies PedidoItemRow;
      });
      setItems(rows);
      // UX: el input representa "lo que llega hoy", no el total acumulado.
      setDraft(() => {
        const next: Record<string, string> = {};
        for (const it of rows) next[it.producto_id] = "";
        return next;
      });
    } catch (e) {
      setErr(supabaseErrToString(e));
    }
  }

  const anyChange = useMemo(() => {
    return items.some((it) => Math.max(0, toInt(draft[it.producto_id] ?? "")) > 0);
  }, [draft, items]);

  async function confirmar() {
    if (!activeEstablishmentId || !sel) return;
    setErr(null);
    setOkMsg(null);
    setSaving(true);
    try {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(String(activeEstablishmentId).trim())) {
        throw new Error(`establecimiento_id inválido (no es UUID): "${String(activeEstablishmentId)}"`);
      }
      const uid = await requireUserId();
      if (!uuidRe.test(String(uid).trim())) {
        throw new Error(`usuario_id inválido (no es UUID): "${String(uid)}"`);
      }
      const nowIso = new Date().toISOString();

      const receivedByProd = items.map((it) => ({
        producto_id: it.producto_id,
        recibido_hoy: Math.max(0, toInt(draft[it.producto_id] ?? "")),
        pedido: Math.max(0, toInt(it.cantidad_pedida)),
        previo: Math.max(0, toInt(it.cantidad_recibida))
      }));

      // 1) Crear movimientos de entrada SOLO por lo que llega hoy.
      // Nota: capamos por faltante para no exceder la cantidad pedida.
      const movimientos = receivedByProd
        .map((x) => {
          const faltan = Math.max(0, x.pedido - x.previo);
          const delta = Math.min(faltan, Math.max(0, x.recibido_hoy));
          return { ...x, delta };
        })
        .filter((x) => x.delta > 0)
        .map((x) => {
          const clean = {
            producto_id: x.producto_id,
            cantidad: Number(x.delta),
            tipo: "entrada" as const,
            usuario_id: uid,
            establecimiento_id: activeEstablishmentId
          };
          if (!uuidRe.test(String(clean.producto_id ?? "").trim())) {
            throw new Error(`producto_id inválido (no es UUID): "${String(clean.producto_id)}"`);
          }
          if (!Number.isFinite(clean.cantidad) || clean.cantidad <= 0) {
            throw new Error(`cantidad inválida para movimientos: "${String((clean as { cantidad?: unknown }).cantidad)}"`);
          }
          return clean;
          // No enviamos columnas opcionales (timestamp/proveedor_id/client_uuid/motivo) para evitar 400 por schema.
        });

      if (movimientos.length) {
        // eslint-disable-next-line no-console
        console.log("Datos que voy a insertar en movimientos:", movimientos);
        // eslint-disable-next-line no-console
        console.log("Payload movimientos (keys):", Object.keys(movimientos[0] ?? {}));
        const ins = await supabase().from("movimientos").insert(movimientos as unknown as Record<string, unknown>[]);
        if (ins.error) {
          // Log detallado para diagnosticar 400/403 en producción
          // eslint-disable-next-line no-console
          console.error("Error detallado de Supabase (insert movimientos):", ins.error);
          // eslint-disable-next-line no-console
          console.error("Error Supabase (insert movimientos) campos:", {
            message: (ins.error as unknown as { message?: unknown })?.message,
            details: (ins.error as unknown as { details?: unknown })?.details,
            hint: (ins.error as unknown as { hint?: unknown })?.hint,
            code: (ins.error as unknown as { code?: unknown })?.code
          });
          throw ins.error;
        }

        // Importante: si el entorno no tiene trigger que derive stock desde movimientos,
        // actualizamos stock_actual aquí para que la página de Stock refleje el valor al recargar.
        const deltaByProd = new Map<string, number>();
        for (const m of movimientos) {
          const pid = String(m.producto_id ?? "").trim();
          const addRaw = Number((m as { cantidad?: unknown }).cantidad ?? 0) || 0;
          const add = Math.max(0, addRaw);
          if (!pid || add <= 0) continue;
          deltaByProd.set(pid, (deltaByProd.get(pid) ?? 0) + add);
        }
        for (const [pid, add] of deltaByProd.entries()) {
          const { data: prodRow, error: prodSelErr } = await supabase()
            .from("productos")
            .select("id,stock_actual")
            .eq("id", pid)
            .eq("establecimiento_id", activeEstablishmentId)
            .maybeSingle();
          if (prodSelErr) throw prodSelErr;
          const curr = Number((prodRow as { stock_actual?: unknown } | null)?.stock_actual ?? 0) || 0;
          const { error: prodUpErr } = await supabase()
            .from("productos")
            .update({ stock_actual: curr + add })
            .eq("id", pid)
            .eq("establecimiento_id", activeEstablishmentId);
          if (prodUpErr) throw prodUpErr;
        }
      }

      // 2) Actualizar pedido_items sumando lo recibido hoy.
      for (const x of receivedByProd) {
        if (!x.producto_id) continue;
        const faltan = Math.max(0, x.pedido - x.previo);
        const delta = Math.min(faltan, Math.max(0, x.recibido_hoy));
        const nuevoTotal = Math.max(0, x.previo + delta);
        const estado = nuevoTotal <= 0 ? "pendiente" : nuevoTotal < x.pedido ? "parcial" : "recibido";
        const { error: upErr } = await supabase()
          .from("pedido_items")
          .update({ cantidad_recibida: nuevoTotal, estado })
          .eq("pedido_id", sel.id)
          .eq("producto_id", x.producto_id)
          .eq("establecimiento_id", activeEstablishmentId);
        if (upErr) throw upErr;
      }

      // 3) Estado del pedido
      const allReceived = receivedByProd.every((x) => {
        const faltan = Math.max(0, x.pedido - x.previo);
        const delta = Math.min(faltan, Math.max(0, x.recibido_hoy));
        return x.previo + delta >= x.pedido;
      });
      const anyReceived = receivedByProd.some((x) => Math.max(0, x.recibido_hoy) > 0);
      const pedidoEstado = allReceived ? "recibido" : anyReceived ? "parcial" : "pendiente";
      const patch: Record<string, unknown> = { estado: pedidoEstado };
      if (pedidoEstado === "recibido") patch.received_at = nowIso;

      const { error: pedidoErr } = await supabase()
        .from("pedidos")
        .update(patch)
        .eq("id", sel.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (pedidoErr) {
        // eslint-disable-next-line no-console
        console.error("Error detallado de Supabase (update pedido):", pedidoErr);
        throw pedidoErr;
      }

      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["movimientos", activeEstablishmentId] });
      // Invalidación "global" por compatibilidad (algunas pantallas usan keys sin establecimiento).
      await queryClient.invalidateQueries({ queryKey: ["productos"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      await refresh();
      router.refresh();
      setOkMsg(pedidoEstado === "recibido" ? "Recepción completada." : "Recepción parcial guardada. El pedido seguirá pendiente.");
      setOpen(false);
      setSel(null);
      setItems([]);
      setDraft({});
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSaving(false);
    }
  }

  async function aplicarLinea(it: PedidoItemRow) {
    if (!activeEstablishmentId || !sel) return;
    if (!it?.producto_id) return;
    if (saving) return;
    setErr(null);
    setOkMsg(null);
    setSaving(true);
    try {
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRe.test(String(activeEstablishmentId).trim())) {
        throw new Error(`establecimiento_id inválido (no es UUID): "${String(activeEstablishmentId)}"`);
      }
      const uid = await requireUserId();
      if (!uuidRe.test(String(uid).trim())) {
        throw new Error(`usuario_id inválido (no es UUID): "${String(uid)}"`);
      }

      const recibidoHoy = Math.max(0, toInt(draft[it.producto_id] ?? ""));
      if (recibidoHoy <= 0) return;

      const pedido = Math.max(0, toInt(it.cantidad_pedida));
      const previo = Math.max(0, toInt(it.cantidad_recibida));
      const faltan = Math.max(0, pedido - previo);
      const delta = Math.min(faltan, recibidoHoy);
      if (delta <= 0) return;

      // 1) Insert movimiento (entrada) por el delta de esta línea
      const movimiento = {
        producto_id: it.producto_id,
        cantidad: Number(delta),
        tipo: "entrada" as const,
        usuario_id: uid,
        establecimiento_id: activeEstablishmentId
      };
      const ins = await supabase().from("movimientos").insert([movimiento] as unknown as Record<string, unknown>[]);
      if (ins.error) throw ins.error;

      // 2) Stock actual (solo suma, nunca resta)
      const { data: prodRow, error: prodSelErr } = await supabase()
        .from("productos")
        .select("id,stock_actual")
        .eq("id", it.producto_id)
        .eq("establecimiento_id", activeEstablishmentId)
        .maybeSingle();
      if (prodSelErr) throw prodSelErr;
      const curr = Number((prodRow as { stock_actual?: unknown } | null)?.stock_actual ?? 0) || 0;
      const add = Math.max(0, Number(delta) || 0);
      const { error: prodUpErr } = await supabase()
        .from("productos")
        .update({ stock_actual: curr + add })
        .eq("id", it.producto_id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (prodUpErr) throw prodUpErr;

      // 3) Guardar acumulado en pedido_items
      const nuevoTotal = Math.max(0, previo + delta);
      const estado = nuevoTotal <= 0 ? "pendiente" : nuevoTotal < pedido ? "parcial" : "recibido";
      const { error: upErr } = await supabase()
        .from("pedido_items")
        .update({ cantidad_recibida: nuevoTotal, estado })
        .eq("pedido_id", sel.id)
        .eq("producto_id", it.producto_id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (upErr) throw upErr;

      // 4) Refrescar estado local de la línea y limpiar input
      setItems((prev) =>
        prev.map((x) => (x.producto_id === it.producto_id ? { ...x, cantidad_recibida: nuevoTotal } : x))
      );
      setDraft((prev) => ({ ...prev, [it.producto_id]: "" }));

      // 5) Estado del pedido (parcial/recibido) recalculado con items actuales
      const nextRows = items.map((x) =>
        x.producto_id === it.producto_id ? { ...x, cantidad_recibida: nuevoTotal } : x
      );
      const allReceived = nextRows.every((x) => Math.max(0, toInt(x.cantidad_recibida)) >= Math.max(0, toInt(x.cantidad_pedida)));
      const anyReceived = nextRows.some((x) => Math.max(0, toInt(x.cantidad_recibida)) > 0);
      const pedidoEstado = allReceived ? "recibido" : anyReceived ? "parcial" : "pendiente";
      const patch: Record<string, unknown> = { estado: pedidoEstado };
      if (pedidoEstado === "recibido") patch.received_at = new Date().toISOString();
      const { error: pedidoErr } = await supabase()
        .from("pedidos")
        .update(patch)
        .eq("id", sel.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (pedidoErr) throw pedidoErr;

      await queryClient.invalidateQueries({ queryKey: ["productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", activeEstablishmentId] });
      await refresh();
      router.refresh();
      setOkMsg("Stock actualizado.");
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSaving(false);
    }
  }

  async function cerrarPedidoDescartando() {
    if (!activeEstablishmentId || !sel) return;
    if (!canAdmin) {
      setErr("Solo Admin/Superadmin puede cerrar pedidos descartando faltantes.");
      return;
    }
    const ok = window.confirm(
      "¿Cerrar pedido y descartar faltantes?\n\nEl pedido se marcará como RECIBIDO y desaparecerá de pendientes, aunque falten unidades."
    );
    if (!ok) return;
    setErr(null);
    setOkMsg(null);
    setSaving(true);
    try {
      const nowIso = new Date().toISOString();
      const { error: pedidoErr } = await supabase()
        .from("pedidos")
        .update({ estado: "recibido", received_at: nowIso })
        .eq("id", sel.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (pedidoErr) throw pedidoErr;

      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["movimientos", activeEstablishmentId] });
      await refresh();
      router.refresh();
      setOkMsg("Pedido cerrado (faltantes descartados).");
      setOpen(false);
      setSel(null);
      setItems([]);
      setDraft({});
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSaving(false);
    }
  }

  async function eliminarPedido() {
    if (!activeEstablishmentId || !sel) return;
    if (!canAdmin) {
      setErr("Solo Admin/Superadmin puede eliminar pedidos.");
      return;
    }
    const ok = window.confirm(
      "¿Eliminar pedido?\n\nSe borrará el pedido y sus líneas. Esta acción no se puede deshacer."
    );
    if (!ok) return;
    setErr(null);
    setOkMsg(null);
    setSaving(true);
    try {
      const { error: delErr } = await supabase()
        .from("pedidos")
        .delete()
        .eq("id", sel.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (delErr) throw delErr;

      await queryClient.invalidateQueries({ queryKey: ["dashboard", "productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["productos", activeEstablishmentId] });
      await queryClient.invalidateQueries({ queryKey: ["movimientos", activeEstablishmentId] });
      await refresh();
      router.refresh();
      setOkMsg("Pedido eliminado.");
      setOpen(false);
      setSel(null);
      setItems([]);
      setDraft({});
    } catch (e) {
      setErr(supabaseErrToString(e));
    } finally {
      setSaving(false);
    }
  }

  if (meLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
  if (!canReceive) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Recepción de pedidos" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4">
          <p className="text-sm text-slate-600">Acceso denegado.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Recepción de pedidos" showBack backHref="/admin" />
      <main className="mx-auto max-w-3xl p-4 pb-28 text-slate-900">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Pendientes</h1>
            <p className="mt-1 text-sm text-slate-600">Selecciona un pedido para registrar lo recibido.</p>
          </div>
          <button
            type="button"
            className="min-h-12 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50"
            onClick={() => void refresh()}
            disabled={loading || !activeEstablishmentId}
          >
            {loading ? "Cargando…" : "Recargar"}
          </button>
        </div>

        {okMsg ? (
          <p className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
            {okMsg}
          </p>
        ) : null}
        {albaranOk ? (
          <p className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">
            {albaranOk}
          </p>
        ) : null}
        {err ? <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</p> : null}

        {!activeEstablishmentId ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            Selecciona un establecimiento.
          </p>
        ) : pedidos.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            No hay pedidos pendientes.
          </p>
        ) : (
          <div className="space-y-4">
            <section className="space-y-2">
              <ul className="space-y-2">
                {pedidos.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:bg-slate-50"
                      onClick={() => void openPedido(p)}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">{p.proveedor_nombre}</p>
                        <p className="text-xs text-slate-600">
                          Estado: <span className="font-semibold">{p.estado}</span>
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-slate-600">Abrir</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </main>

      {/* Botón flotante para capturar albarán (móvil) */}
      <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+6.75rem)] right-4 z-[90]">
        <label
          className={[
            "flex min-h-14 items-center gap-2 rounded-full px-5 text-sm font-semibold shadow-2xl ring-1 transition",
            uploadingAlbaran
              ? "cursor-not-allowed bg-slate-200 text-slate-700 ring-slate-300"
              : "cursor-pointer bg-blue-600 text-white ring-blue-700 hover:bg-blue-700"
          ].join(" ")}
          title="Escanear Albarán"
        >
          <Camera className="h-5 w-5" aria-hidden />
          <span>{uploadingAlbaran ? "Subiendo…" : "Escanear Albarán"}</span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={uploadingAlbaran}
            onChange={(e) => {
              const f = e.currentTarget.files?.[0] ?? null;
              e.currentTarget.value = "";
              void onCaptureAlbaran(f);
            }}
          />
        </label>
        {uploadingAlbaran ? (
          <div className="mt-2 w-[240px] overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="px-3 py-2">
              <p className="text-xs font-semibold text-slate-700">Subiendo albarán…</p>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-blue-600 transition-[width]" style={{ width: `${Math.max(0, Math.min(100, uploadPct))}%` }} />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <Drawer
        open={open}
        title={sel ? `Recepción · ${sel.proveedor_nombre}` : "Recepción"}
        onClose={() => {
          if (saving) return;
          setOpen(false);
          setSel(null);
          setItems([]);
          setDraft({});
        }}
      >
        <div className="space-y-3 pb-4">
          {items.length === 0 ? (
            <p className="text-sm text-slate-600">No hay líneas.</p>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_96px] gap-2 px-1 text-xs font-bold uppercase tracking-wide text-slate-600">
                <span>Producto</span>
                <span className="text-center">Recibido</span>
              </div>
              <ul className="flex flex-col gap-2">
                {items.map((it) => (
                  <li key={it.producto_id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="grid grid-cols-[1fr_96px] items-center gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-slate-900">{it.articulo}</p>
                        <p className="mt-0.5 text-xs text-slate-600">
                          Pedido: <span className="font-mono font-semibold tabular-nums">{it.cantidad_pedida}</span>
                          {" · "}
                          Ya recibido: <span className="font-mono font-semibold tabular-nums">{it.cantidad_recibida}</span>
                          {" · "}
                          Faltan:{" "}
                          <span className="font-mono font-semibold tabular-nums">
                            {Math.max(0, Math.max(0, toInt(it.cantidad_pedida)) - Math.max(0, toInt(it.cantidad_recibida)))}
                          </span>
                          {" · "}
                          {it.unidad ?? "—"}
                        </p>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="h-14 w-24 rounded-2xl border-2 border-slate-800 bg-white px-2 text-center text-2xl font-black tabular-nums text-slate-900 shadow-inner focus:outline-none focus:ring-4 focus:ring-slate-300"
                        value={draft[it.producto_id] ?? ""}
                        onChange={(e) => {
                          if (!it || !it.producto_id) return;
                          const raw = readEvtValue(e);
                          setDraft((prev) => ({ ...prev, [it.producto_id]: digitsOnly(raw) }));
                        }}
                        onBlur={() => {
                          void aplicarLinea(it);
                        }}
                        disabled={saving}
                        aria-label={`Cantidad que llega hoy para ${it.articulo}`}
                      />
                    </div>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={saving || !sel || items.length === 0 || !anyChange}
                className="min-h-14 w-full rounded-3xl bg-emerald-500 px-4 text-base font-extrabold text-white shadow-md hover:bg-emerald-600 disabled:opacity-50"
              >
                {saving ? "Confirmando…" : "Confirmar recepción"}
              </button>
              {sel?.estado === "parcial" && canAdmin ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void cerrarPedidoDescartando()}
                    disabled={saving || !sel}
                    className="min-h-12 w-full rounded-3xl border border-amber-200 bg-amber-50 px-4 text-sm font-extrabold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                  >
                    Cerrar pedido (descartar)
                  </button>
                  <button
                    type="button"
                    onClick={() => void eliminarPedido()}
                    disabled={saving || !sel}
                    className="min-h-12 w-full rounded-3xl border border-red-200 bg-red-50 px-4 text-sm font-extrabold text-red-800 hover:bg-red-100 disabled:opacity-50"
                  >
                    Eliminar pedido
                  </button>
                </div>
              ) : null}
              <p className="text-center text-xs text-slate-500">
                Se generan movimientos <span className="font-mono">entrada</span> solo por cantidades &gt; 0 (lo que llega hoy).
              </p>
            </>
          )}
        </div>
      </Drawer>
    </div>
  );
}

