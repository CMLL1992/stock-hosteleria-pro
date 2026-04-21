"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchMyRole } from "@/lib/session";

export function useMyRole() {
  return useQuery({
    queryKey: ["myRole"],
    queryFn: fetchMyRole,
    staleTime: 30_000
  });
}

