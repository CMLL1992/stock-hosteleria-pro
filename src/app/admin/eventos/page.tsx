"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Plus, Save, Trash2 } from "lucide-react";
import { MobileHeader } from "@/components/MobileHeader";
import { Drawer } from "@/components/ui/Drawer";
import { supabase } from "@/lib/supabase";
import { supabaseErrToString } from "@/lib/supabaseErrToString";
import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
import { useMyRole } from "@/lib/useMyRole";
import { getEffectiveRole, hasPermission } from "@/lib/permissions";
import { fetchDashboardProductos, type DashboardProducto } from "@/lib/adminDashboardData";
import { digitsWaPhone, waUrlSendText } from "@/lib/whatsappPedido";

type ProveedorRow = { id: string; nombre: string; telefono_whatsapp: string | null };

type EventoRow = {
  id: string;
  establecimiento_id: string;
  nombre: string;
  fecha: string; // YYYY-MM-DD
  descripcion: string | null;
  // Operativa avanzada (opcional: si existen columnas en tu BD)
  proveedor_id?: string | null;
  nota_extra?: string | null;
  recaudacion_total?: number | null;
  created_at: string;
  updated_at: string | null;
};

type EventoLineaRow = {
  id?: string;
  establecimiento_id: string;
  evento_id: string;
  producto_id: string;
  articulo: string;
  unidad: string | null;
  stock_evento: number;
  recibido_qty: number;
  precio_producto: number;
  precio_envase: number;
  devuelto_producto_qty: number;
  devuelto_vacios_qty: number;
  created_at?: string;
  updated_at?: string | null;
};

type EventoExtraRow = {
  id: string;
  establecimiento_id: string;
  evento_id: string;
  concepto: string;
  tipo: "gasto" | "ingreso";
  importe: number;
  created_at?: string;
  updated_at?: string | null;
};

function isoToday(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtFechaEs(dateIso: string): string {
  const s = String(dateIso ?? "").trim();
  if (!s) return "—";
  const d = new Date(`${s}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return s;
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function userFacingOpsError(e: unknown): string {
  const anyErr = e as { code?: unknown; message?: unknown; status?: unknown };
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";
  const msg = typeof anyErr?.message === "string" ? anyErr.message : "";
  const status = typeof anyErr?.status === "number" ? anyErr.status : null;
  const forbidden = status === 401 || status === 403 || code === "42501" || /permission denied|forbidden/i.test(msg);
  if (forbidden) return "Error de permisos o conexión.";
  if (/failed to fetch|network|timeout/i.test(msg)) return "Error de permisos o conexión.";
  return supabaseErrToString(e);
}

function toInt(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function toEUR(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100) / 100);
}

function parseIntInput(raw: string): number {
  const s = String(raw ?? "").replace(/[^\d]/g, "");
  return toInt(s);
}

function parseEurInput(raw: string): number {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");
  return toEUR(s);
}

function formatEUR(n: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
}

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export default function AdminEventosPage() {
  const { activeEstablishmentId, activeEstablishmentName } = useActiveEstablishment();
  const { data: me, isLoading: loadingRole } = useMyRole();
  const role = getEffectiveRole(me ?? null);

  const canView = hasPermission(role, "staff");
  const canEdit = hasPermission(role, "admin");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [eventos, setEventos] = useState<EventoRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => eventos.find((e) => e.id === selectedId) ?? null, [eventos, selectedId]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<EventoRow | null>(null);
  const [draft, setDraft] = useState<{ nombre: string; fecha: string; descripcion: string }>({
    nombre: "",
    fecha: isoToday(),
    descripcion: ""
  });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // --- Operativa avanzada (por evento) ---
  const [proveedores, setProveedores] = useState<ProveedorRow[]>([]);
  const [catalogo, setCatalogo] = useState<DashboardProducto[]>([]);
  const [precioCompraById, setPrecioCompraById] = useState<Map<string, number>>(new Map());
  const [proveedorIdByProductoId, setProveedorIdByProductoId] = useState<Map<string, string | null>>(new Map());
  const [catalogoSearch, setCatalogoSearch] = useState("");
  const [pickProductoId, setPickProductoId] = useState<string>("");

  const [lineas, setLineas] = useState<EventoLineaRow[]>([]);
  const [extras, setExtras] = useState<EventoExtraRow[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);
  const [opsErr, setOpsErr] = useState<string | null>(null);

  const [opsNotaExtra, setOpsNotaExtra] = useState("");
  const [opsProveedorId, setOpsProveedorId] = useState<string | null>(null);
  const [opsRecaudacionTotal, setOpsRecaudacionTotal] = useState<number>(0);

  const [opsDirty, setOpsDirty] = useState(false);
  const [opsSaving, setOpsSaving] = useState(false);

  const setDraftField = (field: "nombre" | "fecha" | "descripcion", value: string) => {
    setDraft((prev) => ({ ...prev, [field]: value ?? "" }));
  };

  const sorted = useMemo(() => {
    const list = [...eventos];
    list.sort((a, b) => String(b.fecha ?? "").localeCompare(String(a.fecha ?? "")));
    return list;
  }, [eventos]);

  async function loadEventos() {
    if (!activeEstablishmentId) return;
    setLoading(true);
    setErr(null);
    try {
      // Intento con columnas avanzadas (si existen); fallback a select base si no.
      const baseSelect = "id,establecimiento_id,nombre,fecha,descripcion,created_at,updated_at";
      const advancedSelect = `${baseSelect},proveedor_id,nota_extra,recaudacion_total`;
      const resAdv = await supabase()
        .from("eventos")
        .select(advancedSelect)
        .eq("establecimiento_id", activeEstablishmentId)
        .order("fecha", { ascending: false })
        .limit(500);
      if (!resAdv.error) {
        setEventos((resAdv.data ?? []) as unknown as EventoRow[]);
      } else {
        const msg = String((resAdv.error as { message?: unknown })?.message ?? "").toLowerCase();
        const missingCol = msg.includes("column") && (msg.includes("proveedor_id") || msg.includes("nota_extra") || msg.includes("recaudacion_total"));
        if (!missingCol) throw resAdv.error;
        const res = await supabase()
          .from("eventos")
          .select(baseSelect)
          .eq("establecimiento_id", activeEstablishmentId)
          .order("fecha", { ascending: false })
          .limit(500);
        if (res.error) throw res.error;
        setEventos((res.data ?? []) as unknown as EventoRow[]);
      }
    } catch (e) {
      setErr(userFacingOpsError(e));
      setEventos([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadOperativa(ev: EventoRow) {
    if (!activeEstablishmentId) return;
    setOpsLoading(true);
    setOpsErr(null);
    try {
      // Estado local (no pisa si BD no tiene columnas avanzadas: usamos defaults).
      setOpsProveedorId((ev.proveedor_id as string | null | undefined) ?? null);
      setOpsNotaExtra(String(ev.nota_extra ?? "").trim());
      setOpsRecaudacionTotal(toEUR(ev.recaudacion_total ?? 0));

      const [provRes, cat, pRes, lRes, xRes] = await Promise.all([
        supabase()
          .from("proveedores")
          .select("id,nombre,telefono_whatsapp")
          .eq("establecimiento_id", activeEstablishmentId)
          .order("nombre", { ascending: true }),
        fetchDashboardProductos(activeEstablishmentId),
        supabase()
          .from("productos")
          .select("id,precio_compra,proveedor_id")
          .eq("establecimiento_id", activeEstablishmentId)
          .limit(5000),
        supabase()
          .from("evento_lineas")
          .select(
            "id,establecimiento_id,evento_id,producto_id,articulo,unidad,stock_evento,recibido_qty,precio_producto,precio_envase,devuelto_producto_qty,devuelto_vacios_qty,created_at,updated_at"
          )
          .eq("establecimiento_id", activeEstablishmentId)
          .eq("evento_id", ev.id)
          .limit(5000),
        supabase()
          .from("evento_extras")
          .select("id,establecimiento_id,evento_id,concepto,tipo,importe,created_at,updated_at")
          .eq("establecimiento_id", activeEstablishmentId)
          .eq("evento_id", ev.id)
          .order("created_at", { ascending: false })
          .limit(200)
      ]);

      if (provRes.error) throw provRes.error;
      setProveedores((provRes.data as ProveedorRow[]) ?? []);
      setCatalogo(cat ?? []);

      if (pRes.error) throw pRes.error;
      const priceMap = new Map<string, number>();
      const provMap = new Map<string, string | null>();
      for (const r of (pRes.data as Array<{ id: string; precio_compra: number | null; proveedor_id: string | null }> | null) ?? []) {
        const id = String(r?.id ?? "").trim();
        if (!id) continue;
        const v = typeof r?.precio_compra === "number" && Number.isFinite(r.precio_compra) ? r.precio_compra : 0;
        priceMap.set(id, Math.max(0, Math.round(v * 100) / 100));
        provMap.set(id, r?.proveedor_id ? String(r.proveedor_id) : null);
      }
      setPrecioCompraById(priceMap);
      setProveedorIdByProductoId(provMap);

      if (lRes.error) throw lRes.error;
      const rows = ((lRes.data ?? []) as unknown as EventoLineaRow[]).map((r) => ({
        ...r,
        stock_evento: toInt(r.stock_evento),
        recibido_qty: toInt(r.recibido_qty),
        precio_producto: toEUR(r.precio_producto),
        precio_envase: toEUR(r.precio_envase),
        devuelto_producto_qty: toInt(r.devuelto_producto_qty),
        devuelto_vacios_qty: toInt(r.devuelto_vacios_qty)
      }));
      setLineas(rows);

      if (xRes.error) throw xRes.error;
      const xrows = ((xRes.data ?? []) as unknown as EventoExtraRow[]).map((x) => ({
        ...x,
        concepto: String(x.concepto ?? ""),
        tipo: (x.tipo as "gasto" | "ingreso") ?? "gasto",
        importe: toEUR(x.importe)
      }));
      setExtras(xrows);

      setOpsDirty(false);
    } catch (e) {
      setOpsErr(userFacingOpsError(e));
      setLineas([]);
      setExtras([]);
      setProveedores([]);
      setCatalogo([]);
      setPrecioCompraById(new Map());
      setProveedorIdByProductoId(new Map());
    } finally {
      setOpsLoading(false);
    }
  }

  function openCreate() {
    setEditing(null);
    setDraft({ nombre: "", fecha: isoToday(), descripcion: "" });
    setEditorOpen(true);
  }

  function openEdit(ev: EventoRow) {
    setEditing(ev);
    setDraft({
      nombre: String(ev.nombre ?? "").trim(),
      fecha: String(ev.fecha ?? "").trim() || isoToday(),
      descripcion: String(ev.descripcion ?? "")
    });
    setEditorOpen(true);
  }

  async function save() {
    if (!activeEstablishmentId) return;
    if (!canEdit) return;
    const nombre = draft.nombre.trim();
    if (!nombre) {
      setErr("Indica el nombre del evento.");
      return;
    }
    const fecha = String(draft.fecha ?? "").trim() || isoToday();
    setSaving(true);
    setErr(null);
    try {
      const insertPayload = {
        establecimiento_id: activeEstablishmentId,
        nombre,
        fecha,
        descripcion: draft.descripcion.trim() || null
      };
      const updatePayload = {
        nombre,
        fecha,
        descripcion: draft.descripcion.trim() || null
      };
      if (editing?.id) {
        const up = await supabase()
          .from("eventos")
          .update(updatePayload)
          .eq("id", editing.id)
          .eq("establecimiento_id", activeEstablishmentId);
        if (up.error) throw up.error;
      } else {
        const ins = await supabase().from("eventos").insert(insertPayload).select("id").single();
        if (ins.error) throw ins.error;
      }
      setEditorOpen(false);
      setEditing(null);
      await loadEventos();
    } catch (e) {
      setErr(userFacingOpsError(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveOperativa() {
    if (!activeEstablishmentId) return;
    if (!selected) return;
    if (!canEdit) return;
    setOpsSaving(true);
    setOpsErr(null);
    try {
      // 1) Guardar campos avanzados en eventos (si existen). Si no existen, no rompemos: avisamos en opsErr.
      const evPatch: Record<string, unknown> = {
        proveedor_id: opsProveedorId ?? null,
        nota_extra: opsNotaExtra.trim() || null,
        recaudacion_total: toEUR(opsRecaudacionTotal)
      };
      const upEv = await supabase()
        .from("eventos")
        .update(evPatch)
        .eq("id", selected.id)
        .eq("establecimiento_id", activeEstablishmentId);
      if (upEv.error) {
        const msg = String((upEv.error as { message?: unknown })?.message ?? "").toLowerCase();
        const missingCol =
          msg.includes("column") && (msg.includes("proveedor_id") || msg.includes("nota_extra") || msg.includes("recaudacion_total"));
        if (!missingCol) throw upEv.error;
        setOpsErr(
          "La BD no tiene columnas avanzadas en `eventos` (proveedor_id/nota_extra/recaudacion_total). Las líneas/extras sí se guardarán, pero faltan esas columnas."
        );
      } else {
        // Refrescar lista local con los campos guardados.
        setEventos((prev) =>
          prev.map((e) =>
            e.id === selected.id
              ? ({
                  ...e,
                  proveedor_id: opsProveedorId ?? null,
                  nota_extra: opsNotaExtra.trim() || null,
                  recaudacion_total: toEUR(opsRecaudacionTotal)
                } as EventoRow)
              : e
          )
        );
      }

      // 2) Upsert de líneas (por evento+producto).
      const cleanLineas = lineas.map((l) => ({
        establecimiento_id: activeEstablishmentId,
        evento_id: selected.id,
        producto_id: l.producto_id,
        articulo: String(l.articulo ?? "").trim() || "—",
        unidad: l.unidad ? String(l.unidad) : null,
        stock_evento: toInt(l.stock_evento),
        recibido_qty: toInt(l.recibido_qty),
        precio_producto: toEUR(l.precio_producto),
        precio_envase: toEUR(l.precio_envase),
        devuelto_producto_qty: toInt(l.devuelto_producto_qty),
        devuelto_vacios_qty: toInt(l.devuelto_vacios_qty)
      }));
      if (cleanLineas.length) {
        const upL = await supabase().from("evento_lineas").upsert(cleanLineas, { onConflict: "evento_id,producto_id" });
        if (upL.error) throw upL.error;
      }

      // 3) Upsert de extras (por id).
      const cleanExtras = extras.map((x) => ({
        id: x.id,
        establecimiento_id: activeEstablishmentId,
        evento_id: selected.id,
        concepto: String(x.concepto ?? ""),
        tipo: (x.tipo as "gasto" | "ingreso") ?? "gasto",
        importe: toEUR(x.importe)
      }));
      if (cleanExtras.length) {
        const upX = await supabase().from("evento_extras").upsert(cleanExtras, { onConflict: "id" });
        if (upX.error) throw upX.error;
      }

      setOpsDirty(false);
    } catch (e) {
      setOpsErr(userFacingOpsError(e));
    } finally {
      setOpsSaving(false);
    }
  }

  async function remove(ev: EventoRow) {
    if (!activeEstablishmentId) return;
    if (!canEdit) return;
    const ok = typeof window !== "undefined" ? window.confirm(`¿Eliminar el evento "${ev.nombre}"?`) : false;
    if (!ok) return;
    setDeletingId(ev.id);
    setErr(null);
    try {
      const del = await supabase().from("eventos").delete().eq("id", ev.id).eq("establecimiento_id", activeEstablishmentId);
      if (del.error) throw del.error;
      setEventos((prev) => prev.filter((x) => x.id !== ev.id));
    } catch (e) {
      setErr(userFacingOpsError(e));
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    if (!canView) return;
    void loadEventos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEstablishmentId, canView]);

  useEffect(() => {
    if (!selected) return;
    void loadOperativa(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, activeEstablishmentId, canView]);

  const proveedorSelected = useMemo(() => {
    if (!opsProveedorId) return null;
    return proveedores.find((p) => p.id === opsProveedorId) ?? null;
  }, [proveedores, opsProveedorId]);

  const filteredCatalogo = useMemo(() => {
    const q = catalogoSearch.trim().toLowerCase();
    if (!q) return catalogo;
    return catalogo.filter((p) => p.articulo.toLowerCase().includes(q));
  }, [catalogo, catalogoSearch]);

  const catalogoDropdown = useMemo(() => {
    const proveedorId = opsProveedorId ?? null;
    const proveedorNombre = (proveedores.find((p) => p.id === proveedorId)?.nombre ?? "").trim();
    const base = proveedorId
      ? filteredCatalogo.filter((p) => {
          const byId = String(proveedorIdByProductoId.get(p.id) ?? "") === String(proveedorId);
          const byName = !!proveedorNombre && String(p.proveedor?.nombre ?? "").trim() === proveedorNombre;
          return byId || byName;
        })
      : filteredCatalogo;
    const list = base.slice();
    list.sort((a, b) => a.articulo.localeCompare(b.articulo, "es", { sensitivity: "base" }));
    return list;
  }, [filteredCatalogo, proveedorIdByProductoId, proveedores, opsProveedorId]);

  function ensureLinea(p: DashboardProducto): EventoLineaRow {
    const existing = lineas.find((l) => l.producto_id === p.id);
    if (existing) return existing;
    const precioEnvaseAuto = Number.isFinite(Number(p.envase_coste)) ? Math.max(0, Number(p.envase_coste) || 0) : 0;
    const precioProductoAuto = Math.max(0, Number(precioCompraById.get(p.id) ?? 0) || 0);
    return {
      establecimiento_id: activeEstablishmentId ?? "",
      evento_id: selected?.id ?? "",
      producto_id: p.id,
      articulo: p.articulo,
      unidad: p.unidad,
      stock_evento: 0,
      recibido_qty: 0,
      precio_producto: precioProductoAuto,
      precio_envase: precioEnvaseAuto,
      devuelto_producto_qty: 0,
      devuelto_vacios_qty: 0
    };
  }

  function addProductoToEvento(p: DashboardProducto) {
    if (!selected) return;
    const existing = lineas.find((l) => l.producto_id === p.id);
    const precioEnvaseAuto = Number.isFinite(Number(p.envase_coste)) ? Math.max(0, Number(p.envase_coste) || 0) : 0;
    if (existing) {
      // Autocompleta solo si siguen en 0 (no pisa cambios manuales).
      setLineas((prev) =>
        prev.map((l) => {
          if (l.producto_id !== p.id) return l;
          const next = { ...l };
          if ((toEUR(next.precio_envase) || 0) <= 0 && precioEnvaseAuto > 0) next.precio_envase = toEUR(precioEnvaseAuto);
          const precioProdAuto = Math.max(0, Number(precioCompraById.get(p.id) ?? 0) || 0);
          if ((toEUR(next.precio_producto) || 0) <= 0 && precioProdAuto > 0) next.precio_producto = toEUR(precioProdAuto);
          return next;
        })
      );
      return;
    }
    const linea = ensureLinea(p);
    setLineas((prev) => [...prev, linea]);
    setOpsDirty(true);
  }

  function updateLinea(productoId: string, patch: Partial<EventoLineaRow>) {
    setLineas((prev) => prev.map((l) => (l.producto_id === productoId ? { ...l, ...patch } : l)));
    setOpsDirty(true);
  }

  async function deleteLinea(productoId: string) {
    if (!activeEstablishmentId) return;
    if (!selected) return;
    setLineas((prev) => prev.filter((l) => l.producto_id !== productoId));
    setOpsDirty(true);
    try {
      const del = await supabase()
        .from("evento_lineas")
        .delete()
        .eq("establecimiento_id", activeEstablishmentId)
        .eq("evento_id", selected.id)
        .eq("producto_id", productoId);
      if (del.error) throw del.error;
    } catch (e) {
      setOpsErr(userFacingOpsError(e));
    }
  }

  async function deleteExtra(extraId: string) {
    if (!activeEstablishmentId) return;
    if (!selected) return;
    setExtras((prev) => prev.filter((x) => x.id !== extraId));
    setOpsDirty(true);
    try {
      const del = await supabase().from("evento_extras").delete().eq("establecimiento_id", activeEstablishmentId).eq("id", extraId);
      if (del.error) throw del.error;
    } catch (e) {
      setOpsErr(userFacingOpsError(e));
    }
  }

  const waUrl = useMemo(() => {
    if (!selected) return null;
    const prov = proveedorSelected;
    const tel = digitsWaPhone(prov?.telefono_whatsapp);
    const nombreLocal = (activeEstablishmentName ?? "").trim() || "mi local";
    const pedidoLineas = lineas
      .filter((l) => (toInt(l.stock_evento) || 0) > 0)
      .map((l) => `- ${toInt(l.stock_evento)} ${(l.unidad ?? "uds").trim() || "uds"} de ${String(l.articulo ?? "").trim()}`);
    if (!pedidoLineas.length && !opsNotaExtra.trim()) return null;
    const extra = opsNotaExtra.trim();
    const msg = [
      `*PEDIDO PARA EVENTO: ${String(selected.nombre ?? "").trim()}*`,
      `Local: ${nombreLocal}`,
      prov?.nombre ? `Proveedor: ${prov.nombre}` : "",
      "",
      pedidoLineas.length ? "*Material:*" : "",
      ...pedidoLineas,
      extra ? "" : "",
      extra ? "*Nota de material extra:*" : "",
      extra ? extra : ""
    ]
      .filter((x) => String(x).trim() !== "")
      .join("\n");
    return waUrlSendText(msg, tel);
  }, [activeEstablishmentName, lineas, opsNotaExtra, proveedorSelected, selected]);

  function confirmarPedidoYEnviarWhatsApp() {
    if (!selected) return;
    if (!waUrl) return;
    // Lo pedido pasa a "Recibido" si estaba en 0 (sin tocar stock real).
    setLineas((prev) =>
      prev.map((l) => {
        const pedido = toInt(l.stock_evento);
        if (pedido <= 0) return l;
        if (toInt(l.recibido_qty) > 0) return l;
        return { ...l, recibido_qty: pedido };
      })
    );
    setOpsDirty(true);
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }

  const resumen = useMemo(() => {
    const totalPedido = lineas.reduce((acc, l) => {
      const q = toInt(l.stock_evento);
      const unit = toEUR(l.precio_producto) + toEUR(l.precio_envase);
      return acc + q * unit;
    }, 0);
    const totalDevProducto = lineas.reduce((acc, l) => {
      const q = toInt(l.devuelto_producto_qty);
      const unit = toEUR(l.precio_producto) + toEUR(l.precio_envase);
      return acc + q * unit;
    }, 0);
    const totalDevVacios = lineas.reduce((acc, l) => {
      const q = toInt(l.devuelto_vacios_qty);
      const unit = toEUR(l.precio_envase);
      return acc + q * unit;
    }, 0);
    const totalDevoluciones = totalDevProducto + totalDevVacios;

    const extrasGasto = extras.reduce((acc, x) => (x.tipo === "gasto" ? acc + toEUR(x.importe) : acc), 0);
    const extrasIngreso = extras.reduce((acc, x) => (x.tipo === "ingreso" ? acc + toEUR(x.importe) : acc), 0);
    const gastoReal = totalPedido - totalDevoluciones + extrasGasto - extrasIngreso;

    const recaudacionTotal = toEUR(opsRecaudacionTotal);
    const beneficioNeto = recaudacionTotal - gastoReal;
    return {
      totalPedido,
      totalDevProducto,
      totalDevVacios,
      totalDevoluciones,
      extrasGasto,
      extrasIngreso,
      gastoReal,
      recaudacionTotal,
      beneficioNeto
    };
  }, [extras, lineas, opsRecaudacionTotal]);

  if (loadingRole) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Eventos" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28 text-sm text-slate-600">Cargando…</main>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Eventos" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <div className="rounded-3xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">Acceso denegado.</div>
        </main>
      </div>
    );
  }

  if (!activeEstablishmentId) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <MobileHeader title="Eventos" showBack backHref="/admin" />
        <main className="mx-auto max-w-3xl p-4 pb-28">
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">
            Selecciona un establecimiento para ver los eventos.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <MobileHeader title="Eventos" showBack backHref="/admin" />
      <main className="mx-auto w-full max-w-6xl space-y-4 p-4 pb-28">
        <header className="premium-card flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-wide text-slate-500">Establecimiento</p>
            <p className="truncate text-base font-black text-slate-900">{(activeEstablishmentName ?? "").trim() || "Mi local"}</p>
            <p className="mt-1 text-sm text-slate-600">Registro y control de eventos (solo Admin puede editar).</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="premium-btn-secondary inline-flex items-center justify-center"
              onClick={() => void loadEventos()}
              disabled={loading}
            >
              {loading ? "Cargando…" : "Recargar"}
            </button>
            <button
              type="button"
              className="premium-btn-primary inline-flex items-center gap-2"
              onClick={() => openCreate()}
              disabled={!canEdit}
              title={!canEdit ? "Solo Admin/Superadmin puede crear eventos" : "Crear evento"}
            >
              <Plus className="h-5 w-5" aria-hidden />
              Nuevo
            </button>
          </div>
        </header>

        {err ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-900">{err}</div> : null}

        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <section className="space-y-3">
            <div className="premium-card">
              <p className="text-sm font-black text-slate-800">Agenda</p>
              {sorted.length === 0 ? (
                <div className="mt-2 text-sm text-slate-600">{loading ? "Cargando…" : "No hay eventos todavía."}</div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {sorted.map((ev) => {
                    const active = ev.id === selectedId;
                    return (
                      <li key={ev.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(ev.id)}
                          className={[
                            "w-full rounded-2xl border px-4 py-3 text-left shadow-sm transition",
                            active
                              ? "border-premium-blue/40 bg-premium-blue/5 ring-2 ring-premium-blue/15"
                              : "border-slate-200 bg-white hover:bg-slate-50"
                          ].join(" ")}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-base font-black text-slate-900">{ev.nombre}</p>
                              <p className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
                                <CalendarDays className="h-4 w-4 text-slate-500" aria-hidden />
                                {fmtFechaEs(ev.fecha)}
                              </p>
                              {String(ev.descripcion ?? "").trim() ? (
                                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm text-slate-700">
                                  {String(ev.descripcion ?? "").trim()}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-60"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  openEdit(ev);
                                }}
                                disabled={!canEdit}
                                title={!canEdit ? "Solo Admin/Superadmin" : "Editar"}
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-800 shadow-sm hover:bg-rose-100 disabled:opacity-60"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void remove(ev);
                                }}
                                disabled={!canEdit || deletingId === ev.id}
                                aria-label="Eliminar"
                                title="Eliminar"
                              >
                                <Trash2 className="h-5 w-5" aria-hidden />
                              </button>
                            </div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className="space-y-4">
            {!selected ? (
              <div className="premium-card">
                <p className="text-sm font-semibold text-slate-900">Selecciona un evento</p>
                <p className="mt-1 text-sm text-slate-600">
                  En la izquierda tienes la agenda. Selecciona un evento para ver su operativa (proveedor, pedido, devoluciones y balance).
                </p>
              </div>
            ) : (
              <>
                <div className="premium-card premium-topline-orange">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Evento</p>
                      <p className="mt-1 truncate text-2xl font-black tracking-tight text-slate-900">{selected.nombre}</p>
                      <p className="mt-1 text-sm font-semibold text-slate-600">
                        {fmtFechaEs(selected.fecha)} {String(selected.descripcion ?? "").trim() ? "·" : ""}{" "}
                        {String(selected.descripcion ?? "").trim() ? String(selected.descripcion ?? "").trim() : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="premium-btn-primary"
                      onClick={() => void saveOperativa()}
                      disabled={!canEdit || opsSaving || opsLoading || !opsDirty}
                      title={!canEdit ? "Solo Admin/Superadmin" : opsDirty ? "Guardar operativa" : "Sin cambios"}
                    >
                      {opsSaving ? "Guardando…" : opsDirty ? "Guardar operativa" : "Guardado"}
                    </button>
                  </div>

                  {opsErr ? (
                    <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-900">
                      {opsErr}
                    </div>
                  ) : null}

                  {opsLoading ? <p className="mt-3 text-sm text-slate-600">Cargando operativa…</p> : null}

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Proveedor</label>
                      <select
                        className="premium-input w-full"
                        value={opsProveedorId ?? ""}
                        onChange={(e) => {
                          setOpsProveedorId(e.currentTarget.value || null);
                          setOpsDirty(true);
                        }}
                        disabled={!canEdit}
                      >
                        <option value="">(Selecciona proveedor)</option>
                        {proveedores.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-2">
                      <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Nota de material extra</label>
                      <textarea
                        className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-premium-blue/20"
                        value={opsNotaExtra}
                        onChange={(e) => {
                          setOpsNotaExtra(e.currentTarget.value);
                          setOpsDirty(true);
                        }}
                        placeholder="Ej: Necesitamos 200 copas de balón y 4 cubos de hielo"
                        disabled={!canEdit}
                      />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      className={[
                        "premium-btn-primary inline-flex w-full justify-center",
                        waUrl ? "" : "pointer-events-none opacity-50"
                      ].join(" ")}
                      onClick={() => confirmarPedidoYEnviarWhatsApp()}
                    >
                      Enviar Pedido por WhatsApp
                    </button>
                  </div>

                  <p className="mt-3 text-xs text-slate-500">
                    Importante: las cantidades y finanzas de esta pantalla son estrictamente del evento. No actualizan stock real ni estadísticas globales.
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="premium-card max-w-full overflow-hidden">
                    <p className="text-sm font-black tracking-tight text-slate-900">Añadir producto</p>
                    <div className="mt-3 grid gap-2">
                      <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Producto (dropdown)</label>
                      <select
                        className="premium-input w-full"
                        value={pickProductoId}
                        onChange={(e) => {
                          const id = e.currentTarget.value;
                          setPickProductoId(id);
                          const p = catalogo.find((x) => x.id === id);
                          if (!p) return;
                          addProductoToEvento(p);
                          setPickProductoId("");
                        }}
                        disabled={!opsProveedorId}
                      >
                        <option value="">
                          {opsProveedorId ? "Selecciona un producto…" : "Selecciona proveedor para ver productos…"}
                        </option>
                        {opsProveedorId && catalogoDropdown.length === 0 ? (
                          <option value="" disabled>
                            No hay productos para este proveedor
                          </option>
                        ) : null}
                        {catalogoDropdown.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.articulo}
                          </option>
                        ))}
                      </select>
                      <input
                        className="premium-input"
                        value={catalogoSearch}
                        onChange={(e) => setCatalogoSearch(e.currentTarget.value)}
                        placeholder="Filtrar (opcional)…"
                      />
                      <p className="text-xs text-slate-500">
                        Consejo: el dropdown se filtra por proveedor del evento (si el producto tiene proveedor asignado).
                      </p>
                    </div>
                  </div>

                  <div className="premium-card">
                    <p className="text-sm font-black tracking-tight text-slate-900">Líneas del evento</p>
                    {lineas.length === 0 ? (
                      <p className="mt-2 text-sm text-slate-600">Aún no hay productos añadidos.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {lineas
                          .slice()
                          .sort((a, b) => String(a.articulo ?? "").localeCompare(String(b.articulo ?? ""), "es", { sensitivity: "base" }))
                          .map((l) => (
                            <div key={l.producto_id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-black text-slate-900">{l.articulo}</p>
                                  <p className="mt-0.5 text-xs text-slate-500">{(l.unidad ?? "uds").trim() || "uds"}</p>
                                </div>
                                <button
                                  type="button"
                                  className="min-h-10 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-black text-red-600 hover:bg-slate-50"
                                  onClick={() => void deleteLinea(l.producto_id)}
                                  disabled={!canEdit}
                                >
                                  Quitar
                                </button>
                              </div>

                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <label className="grid gap-1">
                                  <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Pedido (stock evento)</span>
                                  <input
                                    className="premium-input text-center tabular-nums"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={String(toInt(l.stock_evento) || "")}
                                    onChange={(e) => updateLinea(l.producto_id, { stock_evento: parseIntInput(e.currentTarget.value) })}
                                    disabled={!canEdit}
                                  />
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Recibido</span>
                                  <input
                                    className="premium-input text-center tabular-nums"
                                    inputMode="numeric"
                                    pattern="[0-9]*"
                                    value={String(toInt(l.recibido_qty) || "")}
                                    onChange={(e) => updateLinea(l.producto_id, { recibido_qty: parseIntInput(e.currentTarget.value) })}
                                    disabled={!canEdit}
                                  />
                                </label>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="premium-card premium-topline-green">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <p className="text-sm font-black tracking-tight text-slate-900">Balance y finanzas del evento</p>
                    <span className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600">
                      Local al evento · No toca stock real
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    Pedido inicial (producto + envase) · Devoluciones (producto+envase y vacíos) · Extras · Balance final.
                  </p>

                  {lineas.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-600">Añade productos para registrar precios, devoluciones y balance.</p>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {lineas.map((l) => {
                        const devProd = toInt(l.devuelto_producto_qty);
                        const devVac = toInt(l.devuelto_vacios_qty);
                        const vendido = Math.max(0, toInt(l.recibido_qty) - devProd);
                        const precioProd = toEUR(l.precio_producto);
                        const precioEnv = toEUR(l.precio_envase);
                        const unitFull = precioProd + precioEnv;
                        const abonoProd = devProd * unitFull;
                        const abonoVac = devVac * precioEnv;
                        return (
                          <div key={l.producto_id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex flex-wrap items-end justify-between gap-2">
                              <p className="min-w-0 truncate text-base font-black tracking-tight text-slate-900">{l.articulo}</p>
                              <p className="text-xs font-semibold text-slate-600">
                                Vendido/Consumido: <span className="font-black tabular-nums text-slate-900">{vendido}</span>
                              </p>
                            </div>

                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Pedido inicial</p>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Cantidad pedida</label>
                                    <div className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-xl font-black tabular-nums text-slate-900 grid place-items-center">
                                      {toInt(l.stock_evento)}
                                    </div>
                                  </div>
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Precio producto (€)</label>
                                    <input
                                      className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-bold tabular-nums text-slate-900"
                                      inputMode="decimal"
                                      value={String(toEUR(l.precio_producto) || "")}
                                      onChange={(e) => updateLinea(l.producto_id, { precio_producto: parseEurInput(e.currentTarget.value) })}
                                      placeholder="0"
                                      disabled={!canEdit}
                                    />
                                  </div>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Precio envase lleno (€)</label>
                                    <input
                                      className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-bold tabular-nums text-slate-900"
                                      inputMode="decimal"
                                      value={String(toEUR(l.precio_envase) || "")}
                                      onChange={(e) => updateLinea(l.producto_id, { precio_envase: parseEurInput(e.currentTarget.value) })}
                                      placeholder="0"
                                      disabled={!canEdit}
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Subtotal pedido</label>
                                    <div className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-black tabular-nums text-slate-900 grid place-items-center">
                                      {formatEUR(toInt(l.stock_evento) * unitFull)}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                <p className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Devoluciones</p>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Producto devuelto (lleno)</label>
                                    <input
                                      className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-xl font-bold tabular-nums text-slate-900"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={String(devProd)}
                                      onChange={(e) =>
                                        updateLinea(l.producto_id, { devuelto_producto_qty: parseIntInput(e.currentTarget.value) })
                                      }
                                      disabled={!canEdit}
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Abono producto+envase</label>
                                    <div className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-black tabular-nums text-slate-900 grid place-items-center">
                                      {formatEUR(abonoProd)}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2">
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Envases vacíos devueltos</label>
                                    <input
                                      className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-xl font-bold tabular-nums text-slate-900"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      value={String(devVac)}
                                      onChange={(e) =>
                                        updateLinea(l.producto_id, { devuelto_vacios_qty: parseIntInput(e.currentTarget.value) })
                                      }
                                      disabled={!canEdit}
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[11px] font-bold text-slate-600">Abono vacíos (solo envase)</label>
                                    <div className="mt-1 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-black tabular-nums text-slate-900 grid place-items-center">
                                      {formatEUR(abonoVac)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Total pedido</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(resumen.totalPedido)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Total devoluciones</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(resumen.totalDevoluciones)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" style={{ borderTopWidth: 4, borderTopColor: "#10B981" }}>
                      <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Gasto real del evento</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(resumen.gastoReal)}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" style={{ borderTopWidth: 4, borderTopColor: "#1D4ED8" }}>
                      <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Beneficio / balance final</p>
                      <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(resumen.beneficioNeto)}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-black tracking-tight text-slate-900">Gastos e ingresos extra</p>
                        <button
                          type="button"
                          className="premium-btn-secondary"
                          onClick={() => {
                            if (!activeEstablishmentId || !selected) return;
                            const id = newId("extra");
                            setExtras((prev) => [{ id, establecimiento_id: activeEstablishmentId, evento_id: selected.id, concepto: "", tipo: "gasto", importe: 0 }, ...prev]);
                            setOpsDirty(true);
                          }}
                          disabled={!canEdit}
                        >
                          + Añadir Gasto/Ingreso Extra
                        </button>
                      </div>

                      {extras.length === 0 ? (
                        <p className="mt-2 text-sm text-slate-600">Sin extras.</p>
                      ) : (
                        <div className="mt-3 space-y-2">
                          {extras.map((x) => (
                            <div key={x.id} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:grid-cols-[120px_1fr_140px_40px]">
                              <select
                                className="premium-input"
                                value={x.tipo}
                                onChange={(e) => {
                                  const tipo = (e.currentTarget.value as "gasto" | "ingreso") ?? "gasto";
                                  setExtras((prev) => prev.map((it) => (it.id === x.id ? { ...it, tipo } : it)));
                                  setOpsDirty(true);
                                }}
                                disabled={!canEdit}
                              >
                                <option value="gasto">Gasto</option>
                                <option value="ingreso">Ingreso</option>
                              </select>
                              <input
                                className="premium-input"
                                value={x.concepto}
                                onChange={(e) => {
                                  const concepto = e.currentTarget.value;
                                  setExtras((prev) => prev.map((it) => (it.id === x.id ? { ...it, concepto } : it)));
                                  setOpsDirty(true);
                                }}
                                placeholder="Concepto…"
                                disabled={!canEdit}
                              />
                              <input
                                className="premium-input text-center tabular-nums"
                                inputMode="decimal"
                                value={String(toEUR(x.importe) || "")}
                                onChange={(e) => {
                                  const importe = parseEurInput(e.currentTarget.value);
                                  setExtras((prev) => prev.map((it) => (it.id === x.id ? { ...it, importe } : it)));
                                  setOpsDirty(true);
                                }}
                                placeholder="€"
                                disabled={!canEdit}
                              />
                              <button
                                type="button"
                                className="min-h-12 rounded-2xl border border-slate-200 bg-white text-sm font-black text-red-600 hover:bg-slate-50 disabled:opacity-60"
                                onClick={() => void deleteExtra(x.id)}
                                aria-label="Eliminar extra"
                                disabled={!canEdit}
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">Extras (gastos)</p>
                          <p className="mt-1 text-lg font-black tabular-nums text-slate-900">{formatEUR(resumen.extrasGasto)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">Extras (ingresos)</p>
                          <p className="mt-1 text-lg font-black tabular-nums text-slate-900">{formatEUR(resumen.extrasIngreso)}</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="text-sm font-black tracking-tight text-slate-900">Recaudación total</p>
                      <p className="mt-1 text-sm text-slate-600">Introduce la recaudación final del evento para calcular el beneficio neto.</p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2 sm:items-end">
                        <div>
                          <label className="text-xs font-extrabold uppercase tracking-wide text-slate-600">Recaudación (€)</label>
                          <input
                            className="premium-input mt-2 text-center text-xl font-bold tabular-nums"
                            inputMode="decimal"
                            value={String(toEUR(opsRecaudacionTotal) || "")}
                            onChange={(e) => {
                              setOpsRecaudacionTotal(parseEurInput(e.currentTarget.value));
                              setOpsDirty(true);
                            }}
                            placeholder="0"
                            disabled={!canEdit}
                          />
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <p className="text-[11px] font-extrabold uppercase tracking-wide text-slate-600">Beneficio neto</p>
                          <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{formatEUR(resumen.beneficioNeto)}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </main>

      <Drawer
        open={editorOpen}
        title={editing ? "Editar evento" : "Nuevo evento"}
        onClose={() => {
          if (saving) return;
          setEditorOpen(false);
        }}
      >
        <div className="space-y-3">
          {!canEdit ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700">
              Modo lectura: solo Admin/Superadmin puede guardar cambios.
            </div>
          ) : null}

          <label className="grid gap-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Nombre</span>
            <input
              className="premium-input"
              value={draft.nombre || ""}
              onChange={(e) => setDraftField("nombre", e.currentTarget.value)}
              placeholder="Ej: Feria de Abril"
              disabled={saving || !canEdit}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Fecha</span>
            <input
              type="date"
              className="premium-input"
              value={draft.fecha || ""}
              onChange={(e) => setDraftField("fecha", e.currentTarget.value)}
              disabled={saving || !canEdit}
            />
          </label>

          <label className="grid gap-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">Descripción</span>
            <textarea
              className="premium-input min-h-28 py-3"
              value={draft.descripcion || ""}
              onChange={(e) => setDraftField("descripcion", e.currentTarget.value)}
              placeholder="Notas, detalles, previsión…"
              disabled={saving || !canEdit}
            />
          </label>

          <button
            type="button"
            className="premium-btn-primary inline-flex w-full items-center justify-center gap-2"
            onClick={() => void save()}
            disabled={!canEdit || saving}
          >
            {saving ? (
              "Guardando…"
            ) : (
              <>
                <Save className="h-5 w-5" aria-hidden />
                Guardar
              </>
            )}
          </button>
        </div>
      </Drawer>
    </div>
  );
}

