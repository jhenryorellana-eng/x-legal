/// <reference lib="webworker" />
/**
 * Service worker source (DOC-24 §2). Compiled by @serwist/next into
 * `public/sw.js` at build time (disabled in dev — the committed push-only
 * `public/sw.js` serves development). Precaches the app shell (§2.3 #3), applies
 * the 6 ordered runtime cache strategies (§2.3), falls back to /offline on a
 * failed navigation (§2.4), and keeps the Web Push handlers from F7 (§4.5).
 */
import {
  Serwist,
  NetworkFirst,
  NetworkOnly,
  StaleWhileRevalidate,
  ExpirationPlugin,
  CacheableResponsePlugin,
  type PrecacheEntry,
  type SerwistGlobalConfig,
  type RuntimeCaching,
  type SerwistPlugin,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

// §2.3 global rule: never store a response that forbids it, whichever rule won.
const respectNoStore: SerwistPlugin = {
  cacheWillUpdate: async ({ response }) =>
    (response.headers.get("Cache-Control") ?? "").includes("no-store") ? null : response,
};

const runtimeCaching: RuntimeCaching[] = [
  // 1 — Supabase Storage + any signed URL (token=): PII, NEVER cached.
  {
    matcher: ({ url }) =>
      (url.hostname.endsWith(".supabase.co") && url.pathname.includes("/storage/")) ||
      url.searchParams.has("token"),
    handler: new NetworkOnly(),
  },
  // 2 — Webhooks + auth/session endpoints: never from cache.
  {
    matcher: ({ url }) =>
      url.pathname.startsWith("/api/webhooks/") || url.pathname.startsWith("/auth/"),
    handler: new NetworkOnly(),
  },
  // 4 — Navigations: network-first (3s) → cache → /offline (fallbacks below).
  {
    matcher: ({ request }) => request.mode === "navigate",
    handler: new NetworkFirst({
      cacheName: "pages",
      networkTimeoutSeconds: 3,
      plugins: [new CacheableResponsePlugin({ statuses: [0, 200] }), respectNoStore],
    }),
  },
  // 5 — GET /api/v1/*: network-first (4s), short TTL, GET only (purged at logout).
  {
    matcher: ({ url, request }) =>
      request.method === "GET" && url.pathname.startsWith("/api/v1/"),
    handler: new NetworkFirst({
      cacheName: "api-v1",
      networkTimeoutSeconds: 4,
      plugins: [
        new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 300 }),
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        respectNoStore,
      ],
    }),
  },
  // 6 — Public images/assets (brand/UI only): stale-while-revalidate.
  {
    matcher: ({ url, request, sameOrigin }) =>
      sameOrigin &&
      (url.pathname.startsWith("/assets/") ||
        url.pathname.startsWith("/icons/") ||
        url.pathname.startsWith("/_next/image") ||
        request.destination === "image"),
    handler: new StaleWhileRevalidate({
      cacheName: "images",
      plugins: [
        new ExpirationPlugin({ maxEntries: 96, maxAgeSeconds: 60 * 60 * 24 * 30 }),
        new CacheableResponsePlugin({ statuses: [0, 200] }),
        respectNoStore,
      ],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST, // 3 — app-shell precache
  skipWaiting: false, // §2.5 — never seize control mid-use
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [
      { url: "/offline.html", matcher: ({ request }) => request.destination === "document" },
    ],
  },
});

serwist.addEventListeners();

// §2.5 — apply the waiting worker when the update banner asks for it.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// §4.5 — Web Push (ported from the F7 push-only worker).
self.addEventListener("push", (event) => {
  let data: Record<string, string> = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "X Legal", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "X Legal";
  // `renotify` is valid at runtime but missing from the TS NotificationOptions lib.
  const options: NotificationOptions & { renotify?: boolean } = {
    body: data.body || "",
    icon: data.icon || "/icons/icon-192.png",
    badge: data.badge || "/icons/badge-72.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
    renotify: Boolean(data.tag),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          let sameOrigin = false;
          try {
            sameOrigin = new URL(client.url).origin === self.location.origin;
          } catch {
            sameOrigin = false;
          }
          if (sameOrigin && "focus" in client) {
            client.navigate?.(targetUrl);
            return client.focus();
          }
        }
        return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
      }),
  );
});
