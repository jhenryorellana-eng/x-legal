/**
 * Capacitor implementation of the platform-bridge (DOC-24 §3) — STUB for F8.
 *
 * This module is imported ONLY dynamically from `index.ts` (`getBridge()`),
 * gated behind `window.Capacitor?.isNativePlatform?.()`. Keeping it dynamic
 * means it is never pulled into the web bundle (RNF-035).
 *
 * Each capability currently reports "unavailable" / no-ops so the app keeps
 * working inside a Capacitor shell before the native plugins are wired. As
 * each native plugin lands (@capacitor/camera, @capacitor/filesystem,
 * @capacitor/push-notifications, @capacitor/share, @capacitor/haptics, a
 * speech-recognition plugin) its implementation replaces the corresponding
 * stub here — feature code never changes.
 */

import type {
  CameraBridge,
  DictationBridge,
  FilesBridge,
  GeolocationBridge,
  HapticsBridge,
  PlatformBridge,
  PushBridge,
  ShareBridge,
  TranslatorBridge,
  Unsubscribe,
} from "./index";

const noopUnsub: Unsubscribe = () => {};

const cameraStub: CameraBridge = {
  isAvailable() {
    return Promise.resolve(false);
  },
  capturePhoto() {
    return Promise.resolve(null);
  },
};

const filesStub: FilesBridge = {
  pickFile() {
    return Promise.resolve(null);
  },
};

const dictationStub: DictationBridge = {
  isSupported() {
    return Promise.resolve(false);
  },
  start() {
    return Promise.resolve();
  },
  stop() {
    return Promise.resolve();
  },
  onResult() {
    return noopUnsub;
  },
  onError() {
    return noopUnsub;
  },
  onEnd() {
    return noopUnsub;
  },
};

const pushStub: PushBridge = {
  isSupported() {
    return Promise.resolve(false);
  },
  getPermissionStatus() {
    return Promise.resolve("prompt");
  },
  requestPermissionAndSubscribe() {
    return Promise.resolve(null);
  },
  getCurrentSubscription() {
    return Promise.resolve(null);
  },
  unsubscribe() {
    return Promise.resolve();
  },
};

const shareStub: ShareBridge = {
  canShare() {
    return Promise.resolve(false);
  },
  share() {
    return Promise.resolve(false);
  },
  openExternal() {
    /* no-op until @capacitor/browser is wired */
  },
  copyText() {
    return Promise.resolve(false);
  },
};

const hapticsStub: HapticsBridge = {
  vibrate() {
    /* no-op until @capacitor/haptics is wired */
  },
};

// Native shells have no Chrome built-in Translator — always report unsupported
// so the caller falls back to the server-side translator (Gemini).
const translatorStub: TranslatorBridge = {
  isSupported() {
    return Promise.resolve(false);
  },
  detect() {
    return Promise.resolve(null);
  },
  translate() {
    return Promise.resolve(null);
  },
};

// Geolocation: until @capacitor/geolocation is wired, report unsupported so the
// caller falls back to the browser timezone / manual selection.
const geolocationStub: GeolocationBridge = {
  isSupported() {
    return Promise.resolve(false);
  },
  getPermissionStatus() {
    return Promise.resolve("unsupported");
  },
  getCurrentPosition() {
    return Promise.resolve(null);
  },
};

export function createCapacitorBridge(): PlatformBridge {
  return {
    platform: "capacitor",
    camera: cameraStub,
    files: filesStub,
    dictation: dictationStub,
    push: pushStub,
    share: shareStub,
    haptics: hapticsStub,
    translator: translatorStub,
    geolocation: geolocationStub,
  };
}
