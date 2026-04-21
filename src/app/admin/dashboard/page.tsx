 "use client";
 
 import { useMemo } from "react";
 import { useQuery } from "@tanstack/react-query";
 import { MobileHeader } from "@/components/MobileHeader";
 import { supabase } from "@/lib/supabase";
 import { useActiveEstablishment } from "@/lib/useActiveEstablishment";
 import { useMyRole } from "@/lib/useMyRole";
 
 type ProductoRow = {
   id: string;
   articulo: string;
   categoria: string | null;
   stock_actual: number;
   stock_minimo: number | null;
 };
 
 function toInt(v: unknown, fallback = 0): number {
   const n = typeof v === "number" ? v : Number(v);
   if (!Number.isFinite(n)) return fallback;
   return Math.trunc(n);
 }
 
 async function fetchProductosForDashboard(establecimientoId: string) {
   // Compatibilidad: algunos entornos usan `nombre` en vez de `articulo`.
   const withArticulo = await supabase()
     .from("productos")
     .select("id,articulo,categoria,stock_actual,stock_minimo")
     .eq("establecimiento_id", establecimientoId)
     .order("articulo", { ascending: true });
 
   if (!withArticulo.error) {
     return (withArticulo.data as unknown as ProductoRow[]) ?? [];
   }
 
   const msg = (withArticulo.error as { message?: string }).message?.toLowerCase?.() ?? "";
   const looksLikeMissingArticulo =
     msg.includes("articulo") && (msg.includes("does not exist") || msg.includes("could not find") || msg.includes("column"));
   if (!looksLikeMissingArticulo) throw withArticulo.error;
 
   const withNombre = await supabase()
     .from("productos")
     .select("id,nombre,categoria,stock_actual,stock_minimo")
     .eq("establecimiento_id", establecimientoId)
     .order("nombre", { ascending: true });
   if (withNombre.error) throw withNombre.error;
 
   return ((withNombre.data ?? []) as unknown as Array<Omit<ProductoRow, "articulo"> & { nombre: string }>).map((p) => ({
     id: p.id,
     articulo: p.nombre,
     categoria: p.categoria,
     stock_actual: p.stock_actual,
     stock_minimo: p.stock_minimo
   })) as ProductoRow[];
 }
 
 export default function AdminDashboardPage() {
   const { activeEstablishmentId, activeEstablishmentName } = useActiveEstablishment();
   const { data: me, isLoading: roleLoading } = useMyRole();
 
   const productosQuery = useQuery({
     queryKey: ["adminDashboard", "productos", activeEstablishmentId],
     enabled: !!activeEstablishmentId,
     queryFn: () => fetchProductosForDashboard(activeEstablishmentId as string),
     staleTime: 15_000,
     retry: 1
   });
 
   const kpis = useMemo(() => {
     const productos = productosQuery.data ?? [];
     const totalReferencias = productos.length;
     const unidadesEnAlmacen = productos.reduce((acc, p) => acc + toInt(p.stock_actual, 0), 0);
 
     const criticos = productos
       .map((p) => {
         const min = p.stock_minimo;
         if (typeof min !== "number" || !Number.isFinite(min)) return null;
         const actual = toInt(p.stock_actual, 0);
         const minimo = toInt(min, 0);
         const deficit = minimo - actual;
         if (actual > minimo) return null;
         return { ...p, actual, minimo, deficit };
       })
       .filter(Boolean) as Array<
       ProductoRow & {
         actual: number;
         minimo: number;
         deficit: number;
       }
     >;
 
     criticos.sort((a, b) => b.deficit - a.deficit || a.articulo.localeCompare(b.articulo));
     const top5 = criticos.slice(0, 5);
 
     return {
       alertasStock: criticos.length,
       catalogo: totalReferencias,
       pedidosHoy: criticos.length,
       unidadesEnAlmacen,
       top5
     };
   }, [productosQuery.data]);
 
   const isAdmin = !!me?.isAdmin;
 
   if (roleLoading) return <main className="p-4 text-sm text-slate-600">Cargando…</main>;
   if (!isAdmin) {
     return (
       <main className="mx-auto max-w-md p-4">
         <h1 className="text-xl font-semibold">Dashboard (Admin)</h1>
         <p className="mt-2 text-sm text-slate-600">Acceso denegado.</p>
       </main>
     );
   }
 
   return (
     <div className="min-h-dvh">
       <MobileHeader title="Dashboard (Operativo)" showBack backHref="/admin" />
       <main className="mx-auto max-w-6xl bg-slate-50 p-4 pb-28 text-slate-900">
         {activeEstablishmentName ? (
           <p className="mb-4 text-sm text-slate-500">
             Establecimiento: <span className="font-semibold text-slate-800">{activeEstablishmentName}</span>
           </p>
         ) : null}
 
         {productosQuery.isLoading ? (
           <p className="text-sm text-slate-600">Cargando stock…</p>
         ) : productosQuery.error ? (
           <p className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
             {(productosQuery.error as Error).message}
           </p>
         ) : (
           <>
             <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
               <a
                 href="/admin/productos"
                 className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition hover:shadow-md hover:scale-[1.02]"
               >
                 <div className="flex items-start justify-between gap-3">
                   <div>
                     <p className="text-sm font-semibold text-slate-800">🚨 Alertas de Stock</p>
                     <p className="mt-1 text-sm text-slate-500">Por debajo del mínimo</p>
                   </div>
                 </div>
                 <p className="mt-4 text-3xl font-semibold tabular-nums text-rose-600">{kpis.alertasStock}</p>
               </a>
 
               <div className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                 <div className="flex items-start justify-between gap-3">
                   <div>
                     <p className="text-sm font-semibold text-slate-800">📦 Catálogo</p>
                     <p className="mt-1 text-sm text-slate-500">Referencias activas</p>
                   </div>
                 </div>
                 <p className="mt-4 text-3xl font-semibold tabular-nums text-slate-900">{kpis.catalogo}</p>
               </div>
 
               <a
                 href="/admin/pedido-rapido"
                 className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition hover:shadow-md hover:scale-[1.02]"
               >
                 <div className="flex items-start justify-between gap-3">
                   <div>
                     <p className="text-sm font-semibold text-slate-800">🛒 Pedidos</p>
                     <p className="mt-1 text-sm text-slate-500">Necesitan reposición hoy</p>
                   </div>
                 </div>
                 <p className="mt-4 text-3xl font-semibold tabular-nums text-indigo-700">{kpis.pedidosHoy}</p>
               </a>
             </div>
 
             <div className="mt-6 rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
               <div className="mb-4 flex items-end justify-between gap-3">
                 <div>
                   <p className="text-base font-semibold text-slate-800">Urgente: Reponer</p>
                   <p className="mt-1 text-sm text-slate-500">Top 5 por mayor déficit (stock_actual vs stock_minimo)</p>
                 </div>
                 <a
                   href="/admin/productos"
                   className="text-sm font-semibold text-slate-700 underline hover:text-slate-900"
                 >
                   Ver todos
                 </a>
               </div>
 
               {!kpis.top5.length ? (
                 <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                   <p className="text-sm font-semibold text-emerald-900">✅ Stock saneado</p>
                   <p className="mt-1 text-sm text-emerald-800">No hay alertas urgentes.</p>
                 </div>
               ) : (
                 <div className="overflow-x-auto rounded-2xl border border-slate-100">
                   <table className="w-full min-w-[860px] border-collapse text-left text-[13px]">
                     <thead>
                       <tr className="border-b border-slate-100 bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                         <th className="px-4 py-3">Artículo</th>
                         <th className="px-4 py-3">Categoría</th>
                         <th className="px-4 py-3 text-right">Stock actual</th>
                         <th className="px-4 py-3 text-right">Stock mínimo</th>
                         <th className="px-4 py-3 text-right">Acción</th>
                       </tr>
                     </thead>
                     <tbody>
                       {kpis.top5.map((p) => {
                         const badge =
                           p.actual <= 0
                             ? "bg-rose-50 text-rose-700 ring-1 ring-rose-100"
                             : "bg-amber-50 text-amber-800 ring-1 ring-amber-100";
                         return (
                           <tr key={p.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50">
                             <td className="px-4 py-3 font-semibold text-slate-900">{p.articulo}</td>
                             <td className="px-4 py-3 text-slate-700">{p.categoria ?? "—"}</td>
                             <td className="px-4 py-3 text-right">
                               <span
                                 className={[
                                   "inline-flex items-center rounded-full px-2.5 py-1 font-mono text-xs tabular-nums",
                                   badge
                                 ].join(" ")}
                               >
                                 {p.actual}
                               </span>
                             </td>
                             <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-slate-700">
                               {p.minimo}
                             </td>
                             <td className="px-4 py-3 text-right">
                               <a
                                 href="/admin/pedido-rapido"
                                 className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                               >
                                 Pedir →
                               </a>
                             </td>
                           </tr>
                         );
                       })}
                     </tbody>
                   </table>
                 </div>
               )}
             </div>
           </>
         )}
       </main>
     </div>
   );
 }

