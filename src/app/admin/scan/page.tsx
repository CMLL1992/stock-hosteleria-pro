import { MobileHeader } from "@/components/MobileHeader";
import { ScanGoClient } from "@/app/admin/scan/ui";

export default function AdminScanPage() {
  return (
    <div className="min-h-dvh bg-black">
      <MobileHeader title="Escanear" showBack backHref="/stock" />
      <main className="mx-auto w-full max-w-3xl pb-28">
        <ScanGoClient />
      </main>
    </div>
  );
}

