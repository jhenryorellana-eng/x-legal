"use client";

import * as React from "react";

/**
 * useDemoAssetBlobs — pre-loads the demo's real PDFs as blob URLs, once, on
 * mount. The signed download URLs expire after 5 minutes; fetching them into
 * blobs up-front means that during the live there is ZERO network and no TTL:
 * the reader opens instantly from memory. A slot whose fetch fails is simply
 * omitted — the tab falls back to the HTML simulation.
 *
 * Lives in DemoExperience (outside the `key={runId}` subtree) so resetting the
 * demo never re-fetches.
 */

/** slot key → signed URL (null = no PDF uploaded). */
export type DemoAssetUrlMap = Record<string, string | null>;

export function useDemoAssetBlobs(urls: DemoAssetUrlMap | null): Record<string, string> {
  const [blobs, setBlobs] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!urls) return;
    let cancelled = false;
    const created: string[] = [];

    (async () => {
      const entries = await Promise.all(
        Object.entries(urls).map(async ([key, url]) => {
          if (!url) return null;
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error("demo_asset_fetch_failed");
            const blob = await res.blob();
            if (cancelled) return null;
            const blobUrl = URL.createObjectURL(blob);
            created.push(blobUrl);
            return [key, blobUrl] as const;
          } catch {
            return null; // slot falls back to the simulation
          }
        }),
      );
      if (cancelled) return;
      setBlobs(Object.fromEntries(entries.filter((e): e is [string, string] => e !== null)));
    })();

    return () => {
      cancelled = true;
      for (const u of created) URL.revokeObjectURL(u);
    };
  }, [urls]);

  return blobs;
}
