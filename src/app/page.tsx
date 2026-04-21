import { ProductList } from "@/components/ProductList";
import { MobileHeader } from "@/components/MobileHeader";

export default function HomePage() {
  return (
    <div className="min-h-dvh">
      <MobileHeader title="Stock" />
      <main className="mx-auto max-w-3xl p-4 pb-28">
        <ProductList />
      </main>
    </div>
  );
}

