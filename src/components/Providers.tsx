"use client";

import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import type { ReactNode } from "react";
import { useState } from "react";
import { AuthRefresh } from "@/components/AuthRefresh";
import { AuthBootstrap } from "@/components/AuthBootstrap";
import { AuthQuerySync } from "@/components/AuthQuerySync";
import { OfflineSync } from "@/components/OfflineSync";
import { BottomTabBar } from "@/components/BottomTabBar";
import { createIdbPersister } from "@/lib/queryPersist";
import { Footer } from "@/components/Footer";
import { CookieBanner } from "@/components/CookieBanner";
import { SessionGuard } from "@/components/SessionGuard";
import { GlobalRealtimeSync } from "@/components/GlobalRealtimeSync";
import { ToastProvider } from "@/components/ui/ToastCenter";
import { ActivityRealtimeToasts } from "@/components/ActivityRealtimeToasts";

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
      <ToastProvider>
        <AuthRefresh />
        <AuthQuerySync />
        <AuthBootstrap />
        <SessionGuard />
        <GlobalRealtimeSync />
        <ActivityRealtimeToasts />
        <OfflineSync />
        <div className="min-h-dvh bg-slate-50 pb-[calc(env(safe-area-inset-bottom)+6.5rem)] text-slate-900">
          {children}
          <Footer />
        </div>
        <CookieBanner />
        <BottomTabBar />
      </ToastProvider>
    </PersistQueryClientProvider>
  );
}

