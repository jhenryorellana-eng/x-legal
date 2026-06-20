/**
 * Team-chat bus — a tiny module-level pub/sub that lets in-screen "ask your team"
 * affordances (rendered deep in a feature tree: service detail, document
 * correction, …) open the team-chat overlay (O1). The overlay itself lives in the
 * sibling chrome component (AccountChrome / CaseChrome), so there is no shared
 * parent state to prop-drill — and the screens are server-rendered, so a callback
 * can't be threaded down either.
 *
 * This stays clear of the RNF-036 platform-bridge rule: it's pure in-memory
 * listeners, no DOM/window/navigator APIs. Only one chrome is mounted+visible at a
 * time, so a single `openTeamChat()` opens exactly one overlay.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

/** Request the team-chat overlay to open (handled by the mounted+visible chrome). */
export function openTeamChat(): void {
  for (const listener of listeners) listener();
}

/**
 * Subscribe a chrome to open requests. Returns an unsubscribe function — call it
 * from a `useEffect` cleanup so the listener set never leaks across unmounts.
 */
export function onOpenTeamChat(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
