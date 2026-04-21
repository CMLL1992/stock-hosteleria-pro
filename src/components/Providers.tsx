"use client";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import type { ReactNode } from "react";
import { useState } from "react";
import { AuthRefresh } from "@/components/AuthRefresh";
import { AuthBootstrap } from "@/components/AuthBootstrap";
import { OfflineSync } from "@/components/OfflineSync";
import { BottomTabBar } from "@/components/BottomTabBar";
import { createIdbPersister } from "@/lib/queryPersist";

export function Providers({ children }: { children: ReactNode }) {
  const [persister] = useState(() => createIdbPersister());
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            // Offline-first: usa caché persistida si no hay red
            staleTime: 1000 * 60 * 5,
            gcTime: 1000 * 60 * 60 * 24
          }
        }
      })
  );

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 60 * 24, // 24h
        buster: "v1"
      }}
    >
      <AuthRefresh />
      <AuthBootstrap />
      <OfflineSync />
      <div className="min-h-dvh bg-gray-50 pb-24">
        {children}
      </div>
      <BottomTabBar />
    </PersistQueryClientProvider>
  );
}

