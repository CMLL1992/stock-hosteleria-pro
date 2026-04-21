"use client";

import type { Persister } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";

const KEY = "rq-cache-v1";

export function createIdbPersister(): Persister {
  return {
    persistClient: async (client) => {
      await set(KEY, client);
    },
    restoreClient: async () => {
      return (await get(KEY)) ?? undefined;
    },
    removeClient: async () => {
      await del(KEY);
    }
  };
}

