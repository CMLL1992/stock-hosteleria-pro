import type { AppRole } from "@/lib/session";

export type Role = AppRole;

const ROLE_RANK: Record<Role, number> = {
  staff: 1,
  admin: 2,
  superadmin: 3
};

export function hasPermission(userRole: Role | null | undefined, requiredRole: Role): boolean {
  if (!userRole) return false;
  return ROLE_RANK[userRole] >= ROLE_RANK[requiredRole];
}

export function getEffectiveRole(
  me:
    | {
        role: Role | null;
        isAdmin?: boolean;
        isSuperadmin?: boolean;
      }
    | null
    | undefined
): Role | null {
  if (!me) return null;
  if (me.role) return me.role;
  if (me.isSuperadmin) return "superadmin";
  if (me.isAdmin) return "admin";
  return null;
}

export function canSeePrices(role: Role | null | undefined): boolean {
  return hasPermission(role, "admin");
}

export function canEditCatalog(role: Role | null | undefined): boolean {
  return hasPermission(role, "admin");
}

export function canGenerateQr(role: Role | null | undefined): boolean {
  return hasPermission(role, "admin");
}

export function canAdjustStockAbsolute(role: Role | null |undefined): boolean {
  // Ajustar "stock actual" directo (convertido a movimiento) es una acción de gestión.
  // STAFF solo debe poder registrar entradas/salidas desde la UI operativa.
  return hasPermission(role, "admin");
}

