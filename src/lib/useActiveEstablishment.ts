"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useMyRole } from "@/lib/useMyRole";

export type Establecimiento = {
  id: string;
  nombre: string;
  plan_suscripcion: string;
  logo_url?: string | null;
};

const LS_KEY = "ops_active_establecimiento_id";

function readLs(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

function writeLs(v: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (!v) window.localStorage.removeItem(LS_KEY);
    else window.localStorage.setItem(LS_KEY, v);
  } catch {
    // ignore
  }
}

async function fetchEstablecimientos(): Promise<Establecimiento[]> {
  const { data, error } = await supabase()
    .from("establecimientos")
    .select("id,nombre,plan_suscripcion,logo_url")
    .order("nombre", { ascending: true });
  if (error) throw error;
  return (data as unknown as Establecimiento[]) ?? [];
}

async function fetchEstablecimiento(id: string): Promise<Establecimiento | null> {
  const { data, error } = await supabase()
    .from("establecimientos")
    .select("id,nombre,plan_suscripcion,logo_url")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Establecimiento) ?? null;
}

export function useActiveEstablishment() {
  const { data: me, isLoading: meLoading } = useMyRole();
  const isSuperadmin = !!me?.isSuperadmin;

  const estQuery = useQuery({
    queryKey: ["establecimientos", isSuperadmin],
    queryFn: fetchEstablecimientos,
    enabled: isSuperadmin,
    staleTime: 60_000,
    retry: 1
  });

  const [overrideId, setOverrideId] = useState<string | null>(null);

  // Inicializa override desde LS
  useEffect(() => {
    if (!isSuperadmin) return;
    setOverrideId(readLs());
  }, [isSuperadmin]);

  const activeId = useMemo(() => {
    if (isSuperadmin) return overrideId || (estQuery.data?.[0]?.id ?? null);
    return me?.establecimientoId ?? null;
  }, [estQuery.data, isSuperadmin, me?.establecimientoId, overrideId]);

  const activeName = useMemo(() => {
    if (!activeId) return null;
    const list = estQuery.data ?? [];
    return list.find((x) => x.id === activeId)?.nombre ?? null;
  }, [activeId, estQuery.data]);

  const activeDetailQuery = useQuery({
    queryKey: ["establecimiento", activeId],
    queryFn: () => (activeId ? fetchEstablecimiento(activeId) : Promise.resolve(null)),
    enabled: !!activeId && !isSuperadmin,
    staleTime: 60_000,
    retry: 1
  });

  const activeLogoUrl = useMemo(() => {
    if (!activeId) return null;
    if (isSuperadmin) {
      const list = estQuery.data ?? [];
      return list.find((x) => x.id === activeId)?.logo_url ?? null;
    }
    return activeDetailQuery.data?.logo_url ?? null;
  }, [activeDetailQuery.data?.logo_url, activeId, estQuery.data, isSuperadmin]);

  function setActiveId(id: string | null) {
    setOverrideId(id);
    writeLs(id);
  }

  return {
    me,
    meLoading,
    isSuperadmin,
    establishments: estQuery.data ?? [],
    establishmentsLoading: estQuery.isLoading,
    activeEstablishmentId: activeId,
    activeEstablishmentName: activeName,
    activeEstablishmentLogoUrl: activeLogoUrl,
    setActiveEstablishmentId: setActiveId
  };
}

