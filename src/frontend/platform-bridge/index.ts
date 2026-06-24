/**
 * platform-bridge (DOC-24 §3 + §5) — the single seam between feature code and
 * the host platform. Features NEVER touch native browser APIs directly; they
 * import `getBridge()` and call capabilities through it. Today the bridge maps
 * to the web (`./web`); tomorrow a Capacitor build swaps in `./capacitor`
 * (loaded dynamically so it never inflates the web bundle — RNF-035).
 *
 * The ESLint rule RNF-036 (eslint.config.mjs) blocks raw native access under
 * `src/frontend/features/**`, funneling everything through this module. The
 * platform-bridge directory itself lives outside `features/` and is therefore
 * naturally exempt — this is the one place native APIs are allowed.
 */

import { createWebBridge } from "./web";

export type BridgePlatform = "web" | "capacitor";
export type Unsubscribe = () => void;

// --- camera ------------------------------------------------------------------

export interface CapturedPhoto {
  blob: Blob;
  mimeType: string;
  fileName?: string;
}

export interface CameraBridge {
  isAvailable(): Promise<boolean>;
  capturePhoto(opts?: { facing?: "environment" | "user" }): Promise<CapturedPhoto | null>;
}

// --- files -------------------------------------------------------------------

export interface PickedFile {
  blob: Blob;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

export interface FilesBridge {
  pickFile(opts: { accept: string[]; maxSizeBytes?: number }): Promise<PickedFile | null>;
}

// --- dictation ---------------------------------------------------------------

export type DictationLang = "es-US" | "en-US";

export interface DictationResult {
  transcript: string;
  isFinal: boolean;
}

export type DictationErrorCode =
  | "not-supported"
  | "permission-denied"
  | "no-speech"
  | "network"
  | "aborted"
  | "unknown";

export interface DictationError {
  code: DictationErrorCode;
}

export interface DictationBridge {
  isSupported(): Promise<boolean>;
  start(opts: { lang: DictationLang; interimResults?: boolean }): Promise<void>;
  stop(): Promise<void>;
  onResult(cb: (r: DictationResult) => void): Unsubscribe;
  onError(cb: (e: DictationError) => void): Unsubscribe;
  onEnd(cb: () => void): Unsubscribe;
}

// --- push --------------------------------------------------------------------

export interface PushSubscriptionInfo {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  platform: "web" | "capacitor";
}

export type PushPermissionStatus = "granted" | "denied" | "prompt";

export interface PushBridge {
  isSupported(): Promise<boolean>;
  getPermissionStatus(): Promise<PushPermissionStatus>;
  requestPermissionAndSubscribe(): Promise<PushSubscriptionInfo | null>;
  getCurrentSubscription(): Promise<PushSubscriptionInfo | null>;
  unsubscribe(): Promise<void>;
}

// --- share -------------------------------------------------------------------

export interface ShareData {
  title?: string;
  text?: string;
  url?: string;
}

export interface ShareBridge {
  canShare(): Promise<boolean>;
  share(data: ShareData): Promise<boolean>;
  openExternal(url: string): void;
  copyText(text: string): Promise<boolean>;
}

// --- haptics -----------------------------------------------------------------

export interface HapticsBridge {
  vibrate(kind: "success" | "light"): void;
}

// --- geolocation -------------------------------------------------------------

export interface GeoCoords {
  latitude: number;
  longitude: number;
}

export type GeoPermissionStatus = "granted" | "denied" | "prompt" | "unsupported";

export interface GeolocationBridge {
  isSupported(): Promise<boolean>;
  getPermissionStatus(): Promise<GeoPermissionStatus>;
  /**
   * Requests the device's current position (prompts for permission the first
   * time). Returns null when unsupported, denied, or on timeout/error — the
   * caller falls back to the browser timezone / manual selection.
   */
  getCurrentPosition(): Promise<GeoCoords | null>;
}

// --- translator --------------------------------------------------------------

export type TranslatorLang = "en" | "es";

export interface TranslatorBridge {
  /** True when on-device translation (Chrome built-in Translator API) is usable. */
  isSupported(): Promise<boolean>;
  /** Best-effort source-language detection (BCP-47 code, e.g. "en"), or null. */
  detect(text: string): Promise<string | null>;
  /**
   * Translates `text` from → to using on-device translation. Returns the
   * translated string, or `null` if unsupported / the model is unavailable /
   * it failed — in which case the caller should fall back to a server-side
   * translator. If `from === to`, returns `text` unchanged.
   */
  translate(text: string, opts: { from: TranslatorLang; to: TranslatorLang }): Promise<string | null>;
}

// --- bridge ------------------------------------------------------------------

export interface PlatformBridge {
  readonly platform: BridgePlatform;
  camera: CameraBridge;
  files: FilesBridge;
  dictation: DictationBridge;
  push: PushBridge;
  share: ShareBridge;
  haptics: HapticsBridge;
  translator: TranslatorBridge;
  geolocation: GeolocationBridge;
}

// --- singleton selection -----------------------------------------------------

type CapacitorGlobal = { Capacitor?: { isNativePlatform?: () => boolean } };

function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as CapacitorGlobal).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

let cached: PlatformBridge | null = null;

/**
 * Returns the process-wide bridge singleton.
 *
 * SSR-safe: on the server (`typeof window === 'undefined'`) it returns the web
 * bridge, whose capabilities are all guarded (no-op / "unsupported") so nothing
 * touches a missing DOM during render. On the client it caches the selected
 * bridge for the lifetime of the page.
 *
 * Capacitor selection is synchronous-best-effort: the first call after the
 * Capacitor runtime is detected kicks off a dynamic import of `./capacitor`
 * and, until it resolves, the web bridge is returned (safe superset). This
 * keeps the web bundle free of the Capacitor stub (RNF-035) while remaining a
 * synchronous API for callers.
 */
export function getBridge(): PlatformBridge {
  if (cached) return cached;

  // Server / pre-hydration: always the web bridge (its methods are guarded).
  if (typeof window === "undefined") {
    // Do NOT cache on the server — let the client re-select after hydration.
    return createWebBridgeSync();
  }

  if (isCapacitorNative()) {
    // Default to the web bridge synchronously, then upgrade to Capacitor once
    // its module loads. Dynamic import keeps it out of the web bundle.
    cached = createWebBridgeSync();
    void import("./capacitor").then((m) => {
      cached = m.createCapacitorBridge();
    });
    return cached;
  }

  cached = createWebBridgeSync();
  return cached;
}

// Synchronous web-bridge factory (statically imported — the default platform).
function createWebBridgeSync(): PlatformBridge {
  return createWebBridge();
}
