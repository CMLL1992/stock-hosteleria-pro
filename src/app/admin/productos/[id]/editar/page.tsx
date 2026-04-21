import { EditarProductoClient } from "@/app/admin/productos/[id]/editar/ui";

export default function EditarProductoPage({ params }: { params: { id: string } }) {
  // Server Component: garantiza que `params.id` existe y evita crashes de cliente/hidratación.
  return <EditarProductoClient id={params.id} />;
}

