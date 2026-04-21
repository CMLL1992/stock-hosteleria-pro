/**
 * Tipos alineados con public.usuarios / public.establecimientos (SaaS OPS).
 * `rol` en BD puede ser enum user_role o text según migraciones; el cliente compara por string.
 */
export type UsuarioRol = "superadmin" | "admin" | "staff";

/** Fila de public.establecimientos (UI + API). */
export type EstablecimientoRow = {
  id: string;
  nombre: string;
  plan_suscripcion?: string | null;
  logo_url?: string | null;
  created_at?: string;
};
