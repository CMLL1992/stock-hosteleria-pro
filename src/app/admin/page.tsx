import { AdminHomeClient } from "@/app/admin/ui";

export default function AdminHomePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const deniedRaw = searchParams?.denied;
  const denied = Array.isArray(deniedRaw) ? deniedRaw[0] : deniedRaw ?? null;
  return <AdminHomeClient denied={denied} />;
}

