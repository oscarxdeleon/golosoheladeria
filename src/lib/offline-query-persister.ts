import type { QueryClient } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { get, set, del } from "idb-keyval";

// Query keys que vale la pena persistir para operar en modo lectura offline.
// Nunca persistir datos sensibles/mutables por usuario (roles caducan, caja,
// sesiones); esos deben refrescarse siempre contra el servidor.
const OFFLINE_ALLOWED_KEYS: readonly string[] = [
  "products",
  "products-all",
  "public-products",
  "categories",
  "categories-all",
  "modifier-groups-all",
  "mod-groups",
  "mods",
  "mods-for",
  "branches-all",
  "restaurant-tables",
  "tables",
  "settings",
];

function isAllowedQuery(queryKey: readonly unknown[]): boolean {
  const first = queryKey[0];
  if (typeof first !== "string") return false;
  return OFFLINE_ALLOWED_KEYS.includes(first);
}

/**
 * Habilita persistencia de queries en IndexedDB para que la app funcione
 * en modo lectura tras un corte de red. Sólo persiste keys allowlisted —
 * jamás sesiones ni datos de caja.
 */
export function enableOfflineQueryPersistence(queryClient: QueryClient): void {
  if (typeof window === "undefined") return;

  const persister = createAsyncStoragePersister({
    storage: {
      getItem: (key) => get<string>(key).then((v) => v ?? null),
      setItem: (key, value) => set(key, value),
      removeItem: (key) => del(key),
    },
    key: "goloso-rq-cache-v2",
    throttleTime: 1500,
  });

  void persistQueryClient({
    queryClient,
    persister,
    maxAge: 1000 * 60 * 60 * 24, // 24h — datos más viejos se descartan
    buster: import.meta.env.VITE_BUILD_ID ?? "v2-cash-session-guard",
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => {
        if (query.state.status !== "success") return false;
        return isAllowedQuery(query.queryKey);
      },
    },
  });
}
