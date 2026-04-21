"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { fetchMyRole } from "@/lib/session";
import { supabase } from "@/lib/supabase";

type Proveedor = { id: string; nombre: string; telefono_whatsapp: string | null };

const TIPOS = ["barril", "refresco", "cerveza", "vino", "licor", "agua", "otros"] as const;
const UNIDADES = ["caja", "barril", "botella", "lata", "unidad"] as const;

function newUid() {
  return crypto.randomUUID().replaceAll("-", "");
}

export default function NuevoProductoPage() {
  const [role, setRole] = useState<"admin" | "staff" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);

  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>("otros");
  const [unidad, setUnidad] = useState<(typeof UNIDADES)[number]>("unidad");
  const [categoria, setCategoria] = useState<string>("");
  const [stockMinimo, setStockMinimo] = useState<number>(0);
  const [proveedorId, setProveedorId] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchMyRole()
      .then((r) => {
        if (cancelled) return;
        setRole(r);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (role !== "admin") return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase()
          .from("proveedores")
          .select("id,nombre,telefono_whatsapp")
          .order("nombre", { ascending: true });
        if (cancelled) return;
        if (error) throw error;
        setProveedores((data as unknown as Proveedor[]) ?? []);
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [role]);

  async function crear() {
    setErr(null);
    const uid = newUid();
    const { error } = await supabase().from("productos").insert({
      nombre,
      tipo,
      unidad,
      categoria: categoria.trim() ? categoria.trim() : null,
      stock_minimo: Number.isFinite(stockMinimo) ? stockMinimo : 0,
      proveedor_id: proveedorId || null,
      qr_code_uid: uid
    });
    if (error) {
      setErr(error.message);
      return;
    }
    window.location.href = "/";
  }

  if (loading) return <main className="p-4 text-sm text-zinc-600 dark:text-zinc-300">Cargando…</main>;

  if (role !== "admin") {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold">Crear producto (Admin)</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-300">Acceso denegado.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md bg-slate-50 p-4 pb-28 text-slate-900">
      <h1 className="mb-3 text-xl font-semibold">Crear producto</h1>
      {err ? (
        <p className="mb-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {err}
        </p>
      ) : null}

      <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-900">Nombre</label>
          <input
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={nombre}
            onChange={(e) => setNombre(e.currentTarget.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-900">Tipo</label>
            <select
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={tipo}
              onChange={(e) => setTipo(e.currentTarget.value as (typeof TIPOS)[number])}
            >
              {TIPOS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-900">Unidad</label>
            <select
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
              value={unidad}
              onChange={(e) => setUnidad(e.currentTarget.value as (typeof UNIDADES)[number])}
            >
              {UNIDADES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-900">Stock mínimo</label>
          <input
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
            type="number"
            min={0}
            value={stockMinimo}
            onChange={(e) => setStockMinimo(Number(e.currentTarget.value))}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-900">Categoría (opcional)</label>
          <input
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-black/10"
            placeholder="Ej: cervezas, licores…"
            value={categoria}
            onChange={(e) => setCategoria(e.currentTarget.value)}
          />
          <p className="text-xs text-slate-600">
            Si lo dejas vacío, el filtro usará el campo <span className="font-mono">tipo</span>.
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-semibold text-slate-900">Proveedor</label>
          <select
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-black/10"
            value={proveedorId}
            onChange={(e) => setProveedorId(e.currentTarget.value)}
          >
            <option value="">(Sin proveedor)</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>

        <Button onClick={crear} disabled={!nombre.trim()}>
          Crear
        </Button>
      </div>
    </main>
  );
}

