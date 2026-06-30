/**
 * Renderer — HTML page → PDF, behind a pluggable interface.
 *
 * mupdf (our PDF engine) is a basic HTML renderer, not a browser: it can't render
 * a live news page with JS/CSS fidelity. So an exhibit whose source is an HTML page
 * is rendered by a managed browser service. The interface keeps the provider
 * swappable (managed API today; a self-hosted Playwright worker or mupdf+Readability
 * later) without touching the fetch pipeline. PDF sources are downloaded directly and
 * never reach a Renderer; only `text/html` does.
 *
 * Provider: Urlbox Render API (chosen by Henry). Provenance stamping (source URL +
 * "Accessed on") is applied downstream, not here — this returns the clean PDF.
 */

import { providerEnv } from "./env";
import { logger } from "./logger";

export interface Renderer {
  /** Renders a public URL to a US-Letter PDF and returns the raw bytes. */
  render(url: string): Promise<Uint8Array>;
}

export class RendererError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RendererError";
  }
}

const URLBOX_RENDER_ENDPOINT = "https://api.urlbox.com/v1/render/sync";
const RENDER_TIMEOUT_MS = 60_000;

/** Urlbox options tuned for a court-ready exhibit: Letter page, no ads/cookie
 *  banners, wait for the page to settle so lazy-loaded content is captured. */
const URLBOX_PDF_OPTIONS = {
  format: "pdf",
  pdf_page_size: "Letter",
  pdf_print_background: true,
  block_ads: true,
  hide_cookie_banners: true,
  // Wait for network to settle so lazy-loaded article content is captured.
  // Valid Urlbox values: domloaded | mostrequestsfinished | requestsfinished | loaded.
  wait_until: "requestsfinished",
} as const;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Urlbox Render API implementation. Two steps: POST the render request (sync) to
 * get the `renderUrl`, then download the produced PDF bytes. `fetchFn` is injectable
 * for tests.
 */
export function createUrlboxRenderer(opts: { fetchFn?: typeof fetch } = {}): Renderer {
  const fetchFn = opts.fetchFn ?? fetch;
  return {
    async render(url: string): Promise<Uint8Array> {
      const { URLBOX_SECRET } = providerEnv("urlbox");

      const res = await fetchWithTimeout(
        URLBOX_RENDER_ENDPOINT,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${URLBOX_SECRET}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ url, ...URLBOX_PDF_OPTIONS }),
        },
        RENDER_TIMEOUT_MS,
        fetchFn,
      );
      if (!res.ok) {
        throw new RendererError(`urlbox render failed: ${res.status}`);
      }
      const body = (await res.json()) as { renderUrl?: string };
      if (!body.renderUrl) {
        throw new RendererError("urlbox response missing renderUrl");
      }

      const pdfRes = await fetchWithTimeout(body.renderUrl, { method: "GET" }, RENDER_TIMEOUT_MS, fetchFn);
      if (!pdfRes.ok) {
        throw new RendererError(`urlbox renderUrl download failed: ${pdfRes.status}`);
      }
      const bytes = new Uint8Array(await pdfRes.arrayBuffer());
      logger.info({ url, bytes: bytes.length }, "renderer: urlbox render complete");
      return bytes;
    },
  };
}

let _renderer: Renderer | null = null;

/** Returns the configured Renderer (Urlbox). Lazily built so boot does not require
 *  the provider key until an exhibit is actually rendered. */
export function getRenderer(): Renderer {
  if (!_renderer) _renderer = createUrlboxRenderer();
  return _renderer;
}
