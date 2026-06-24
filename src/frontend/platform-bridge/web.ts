"use client";

/**
 * Web implementation of the platform-bridge (DOC-24 §3). Every native browser
 * API the app uses lives behind one of these capability objects. This is the
 * ONLY module under `src/frontend/` allowed to touch `navigator.*`, `window.*`,
 * `SpeechRecognition`, etc. — features go through `getBridge()`.
 *
 * The web Push implementation here is the original logic moved verbatim from
 * `features/notifications/push-helpers.ts` (re-exported there for the shell SW
 * registrar). Behavior is unchanged — only the access path moved.
 */

import type {
  CameraBridge,
  CapturedPhoto,
  DictationBridge,
  DictationError,
  DictationResult,
  FilesBridge,
  HapticsBridge,
  PickedFile,
  PlatformBridge,
  PushBridge,
  PushPermissionStatus,
  PushSubscriptionInfo,
  ShareBridge,
  ShareData,
  TranslatorBridge,
  Unsubscribe,
} from "./index";

// ===========================================================================
// Web Push (moved from features/notifications/push-helpers.ts)
// ===========================================================================

/** Decodes a base64url VAPID public key into the Uint8Array applicationServerKey. */
export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushSupport = "unsupported" | "denied" | "default" | "granted";

/** Reports whether Web Push is usable and the current permission. */
export function pushSupport(): PushSupport {
  if (
    typeof window === "undefined" ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  ) {
    return "unsupported";
  }
  return Notification.permission as PushSupport;
}

/** Registers the service worker (idempotent — returns the ready registration). */
export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    await navigator.serviceWorker.register("/sw.js");
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

export interface BrowserPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Requests permission (if needed) and subscribes via PushManager. Returns the
 * subscription to hand to the server, or null if unsupported / denied / no key.
 */
export async function subscribeToPush(
  vapidPublicKey: string | undefined,
): Promise<BrowserPushSubscription | null> {
  if (pushSupport() === "unsupported" || !vapidPublicKey) return null;

  if (Notification.permission === "default") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return null;
  }
  if (Notification.permission !== "granted") return null;

  const reg = await ensureServiceWorker();
  if (!reg) return null;

  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
}

/** Unsubscribes from PushManager and returns the endpoint that was removed (if any). */
export async function unsubscribeFromPush(): Promise<string | null> {
  const reg = await ensureServiceWorker();
  if (!reg) return null;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}

/** Reads the current subscription endpoint+keys without subscribing. */
async function currentPushSubscription(): Promise<BrowserPushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return null;
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null;
    return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } };
  } catch {
    return null;
  }
}

// ===========================================================================
// Capability factories
// ===========================================================================

function createCameraBridge(): CameraBridge {
  return {
    async isAvailable() {
      return typeof document !== "undefined";
    },
    capturePhoto(opts) {
      if (typeof document === "undefined") return Promise.resolve(null);
      return new Promise<CapturedPhoto | null>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.capture = opts?.facing === "user" ? "user" : "environment";
        input.style.position = "fixed";
        input.style.left = "-9999px";
        let settled = false;
        const cleanup = () => {
          if (input.parentNode) input.parentNode.removeChild(input);
        };
        input.onchange = () => {
          settled = true;
          const file = input.files?.[0] ?? null;
          cleanup();
          if (!file) {
            resolve(null);
            return;
          }
          resolve({
            blob: file,
            mimeType: file.type || "image/jpeg",
            fileName: file.name || undefined,
          });
        };
        // If the user cancels, there's no reliable cross-browser event; fall
        // back to resolving null when focus returns without a selection.
        const onFocus = () => {
          window.setTimeout(() => {
            if (!settled) {
              cleanup();
              window.removeEventListener("focus", onFocus);
              resolve(null);
            }
          }, 500);
        };
        window.addEventListener("focus", onFocus, { once: true });
        document.body.appendChild(input);
        input.click();
      });
    },
  };
}

function createFilesBridge(): FilesBridge {
  return {
    pickFile(opts) {
      if (typeof document === "undefined") return Promise.resolve(null);
      return new Promise<PickedFile | null>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        if (opts.accept.length > 0) input.accept = opts.accept.join(",");
        input.style.position = "fixed";
        input.style.left = "-9999px";
        let settled = false;
        const cleanup = () => {
          if (input.parentNode) input.parentNode.removeChild(input);
        };
        input.onchange = () => {
          settled = true;
          const file = input.files?.[0] ?? null;
          cleanup();
          if (!file) {
            resolve(null);
            return;
          }
          if (opts.maxSizeBytes !== undefined && file.size > opts.maxSizeBytes) {
            resolve(null);
            return;
          }
          resolve({
            blob: file,
            name: file.name,
            mimeType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          });
        };
        const onFocus = () => {
          window.setTimeout(() => {
            if (!settled) {
              cleanup();
              window.removeEventListener("focus", onFocus);
              resolve(null);
            }
          }, 500);
        };
        window.addEventListener("focus", onFocus, { once: true });
        document.body.appendChild(input);
        input.click();
      });
    },
  };
}

// --- dictation (Web Speech API) ---------------------------------------------

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Maps a Web Speech `error` string to the bridge's normalized error code. */
function mapDictationError(raw: string | undefined): DictationError["code"] {
  switch (raw) {
    case "not-allowed":
    case "service-not-allowed":
      return "permission-denied";
    case "no-speech":
      return "no-speech";
    case "network":
      return "network";
    case "aborted":
      return "aborted";
    default:
      return "unknown";
  }
}

function createDictationBridge(): DictationBridge {
  let rec: SpeechRecognitionLike | null = null;
  const resultCbs = new Set<(r: DictationResult) => void>();
  const errorCbs = new Set<(e: DictationError) => void>();
  const endCbs = new Set<() => void>();

  return {
    isSupported() {
      return Promise.resolve(getRecognitionCtor() !== null);
    },
    start(opts) {
      const Ctor = getRecognitionCtor();
      if (!Ctor) {
        errorCbs.forEach((cb) => cb({ code: "not-supported" }));
        return Promise.resolve();
      }
      try {
        const r = new Ctor();
        r.lang = opts.lang;
        r.continuous = true;
        r.interimResults = opts.interimResults ?? true;
        r.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            const transcript = res[0].transcript;
            if (transcript) {
              resultCbs.forEach((cb) => cb({ transcript, isFinal: res.isFinal }));
            }
          }
        };
        r.onerror = (e) => {
          errorCbs.forEach((cb) => cb({ code: mapDictationError(e?.error) }));
        };
        r.onend = () => {
          endCbs.forEach((cb) => cb());
        };
        rec = r;
        r.start();
      } catch {
        errorCbs.forEach((cb) => cb({ code: "unknown" }));
      }
      return Promise.resolve();
    },
    stop() {
      const r = rec;
      if (r) {
        try {
          r.stop();
        } catch {
          /* ignore */
        }
      }
      return Promise.resolve();
    },
    onResult(cb) {
      resultCbs.add(cb);
      return (() => resultCbs.delete(cb)) as Unsubscribe;
    },
    onError(cb) {
      errorCbs.add(cb);
      return (() => errorCbs.delete(cb)) as Unsubscribe;
    },
    onEnd(cb) {
      endCbs.add(cb);
      return (() => endCbs.delete(cb)) as Unsubscribe;
    },
  };
}

function createPushBridge(): PushBridge {
  return {
    isSupported() {
      return Promise.resolve(pushSupport() !== "unsupported");
    },
    getPermissionStatus(): Promise<PushPermissionStatus> {
      const s = pushSupport();
      if (s === "granted") return Promise.resolve("granted");
      if (s === "denied") return Promise.resolve("denied");
      // "default" (prompt) or "unsupported" → prompt is the closest neutral state.
      return Promise.resolve("prompt");
    },
    async requestPermissionAndSubscribe(): Promise<PushSubscriptionInfo | null> {
      const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      const sub = await subscribeToPush(vapid);
      if (!sub) return null;
      return { ...sub, platform: "web" };
    },
    async getCurrentSubscription(): Promise<PushSubscriptionInfo | null> {
      const sub = await currentPushSubscription();
      if (!sub) return null;
      return { ...sub, platform: "web" };
    },
    async unsubscribe() {
      await unsubscribeFromPush();
    },
  };
}

function createShareBridge(): ShareBridge {
  return {
    canShare() {
      return Promise.resolve(typeof navigator !== "undefined" && typeof navigator.share === "function");
    },
    async share(data: ShareData) {
      if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
      try {
        await navigator.share(data);
        return true;
      } catch {
        return false;
      }
    },
    openExternal(url: string) {
      if (typeof window === "undefined") return;
      // tel: (and similar dial/mail schemes) must navigate, not open a blank tab
      // that the browser then closes — DOC-24 §3.
      if (/^(tel|mailto|sms):/i.test(url)) {
        window.location.href = url;
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    },
    async copyText(text: string) {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          /* fall through to legacy path */
        }
      }
      // Legacy fallback for insecure contexts / older browsers.
      if (typeof document === "undefined") return false;
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    },
  };
}

function createHapticsBridge(): HapticsBridge {
  return {
    vibrate(kind: "success" | "light") {
      if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
      // Respect the user's reduced-motion preference.
      if (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return;
      }
      const pattern = kind === "success" ? [12, 40, 12] : 10;
      navigator.vibrate(pattern);
    },
  };
}

// --- translator (Chrome built-in AI: Translator + LanguageDetector) ---------

type TranslatorAvailability = "unavailable" | "downloadable" | "downloading" | "available";
interface TranslatorInstance {
  translate(text: string): Promise<string>;
}
interface TranslatorStatic {
  availability(opts: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorAvailability>;
  create(opts: { sourceLanguage: string; targetLanguage: string; monitor?: (m: EventTarget) => void }): Promise<TranslatorInstance>;
}
interface LanguageDetectorInstance {
  detect(text: string): Promise<Array<{ detectedLanguage: string; confidence: number }>>;
}
interface LanguageDetectorStatic {
  availability(): Promise<TranslatorAvailability>;
  create(opts?: { monitor?: (m: EventTarget) => void }): Promise<LanguageDetectorInstance>;
}

function getTranslatorStatic(): TranslatorStatic | null {
  if (typeof self === "undefined") return null;
  return (self as unknown as { Translator?: TranslatorStatic }).Translator ?? null;
}

function getLanguageDetectorStatic(): LanguageDetectorStatic | null {
  if (typeof self === "undefined") return null;
  return (self as unknown as { LanguageDetector?: LanguageDetectorStatic }).LanguageDetector ?? null;
}

function createTranslatorBridge(): TranslatorBridge {
  // Creating a Translator downloads/loads a model — cache one per direction.
  const cache = new Map<string, Promise<TranslatorInstance | null>>();

  function getTranslator(from: string, to: string): Promise<TranslatorInstance | null> {
    const key = `${from}->${to}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const p = (async () => {
      const T = getTranslatorStatic();
      if (!T) return null;
      try {
        const avail = await T.availability({ sourceLanguage: from, targetLanguage: to });
        if (avail === "unavailable") return null;
        // `create` resolves after the model is ready (downloads it if needed).
        return await T.create({ sourceLanguage: from, targetLanguage: to });
      } catch {
        return null;
      }
    })();
    cache.set(key, p);
    return p;
  }

  return {
    // Reports only whether the Translator global exists — the model may still be
    // "downloadable"/"unavailable". translate() handles that and returns null so
    // the caller falls back to the server translator.
    isSupported() {
      return Promise.resolve(getTranslatorStatic() !== null);
    },
    async detect(text) {
      const D = getLanguageDetectorStatic();
      if (!D || !text.trim()) return null;
      try {
        if ((await D.availability()) === "unavailable") return null;
        const detector = await D.create();
        const res = await detector.detect(text);
        return res[0]?.detectedLanguage ?? null;
      } catch {
        return null;
      }
    },
    async translate(text, { from, to }) {
      if (from === to || !text.trim()) return text;
      const t = await getTranslator(from, to);
      if (!t) return null;
      try {
        return await t.translate(text);
      } catch {
        return null;
      }
    },
  };
}

// ===========================================================================
// Geolocation (DOC-24 §3 — native API funneled through the bridge per RNF-036)
// ===========================================================================

function createGeolocationBridge(): import("./index").GeolocationBridge {
  const supported = () =>
    typeof navigator !== "undefined" && "geolocation" in navigator;

  return {
    isSupported() {
      return Promise.resolve(supported());
    },
    async getPermissionStatus() {
      if (!supported()) return "unsupported";
      try {
        const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
        if (!perms?.query) return "prompt";
        const status = await perms.query({ name: "geolocation" as PermissionName });
        return status.state as "granted" | "denied" | "prompt";
      } catch {
        return "prompt";
      }
    },
    getCurrentPosition() {
      return new Promise((resolve) => {
        if (!supported()) {
          resolve(null);
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
          () => resolve(null), // denied / timeout / unavailable → caller falls back
          { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
        );
      });
    },
  };
}

// ===========================================================================
// Bridge factory
// ===========================================================================

export function createWebBridge(): PlatformBridge {
  return {
    platform: "web",
    camera: createCameraBridge(),
    files: createFilesBridge(),
    dictation: createDictationBridge(),
    push: createPushBridge(),
    share: createShareBridge(),
    haptics: createHapticsBridge(),
    translator: createTranslatorBridge(),
    geolocation: createGeolocationBridge(),
  };
}
