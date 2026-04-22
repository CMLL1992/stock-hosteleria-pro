import { redirect } from "next/navigation";

export default function PedidosPage() {
  // Alias para no romper enlaces antiguos: la funcionalidad real vive en /admin/pedidos
  redirect("/admin/pedidos");
}

