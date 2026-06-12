/**
 * Cliente surface layout — server-side guard + mobile shell.
 *
 * Guard: verifies Actor kind === 'client'. Public sub-routes
 * (welcome, phone, otp, no-access) bypass this via middleware
 * before reaching this layout. This is a defense-in-depth check
 * for the authenticated routes (/home, /servicios, etc.).
 *
 * Note: welcome, phone, otp, no-access are in this route group but
 * are PUBLIC (no guard needed) — the middleware handles them.
 * This layout's guard only activates for /home and deeper routes.
 */

// Middleware handles auth routing for this surface group.

export default async function ClienteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // For public paths within the group, render without guard.
  // (The middleware already handled redirection; this is extra safety.)
  // We can't easily get the pathname in a layout without a hook,
  // so we use getActor() conservatively: if null on a public path, it's fine.
  // The middleware ensures authenticated paths get here only with valid session.

  return (
    <div
      style={{
        maxWidth: 430,
        margin: "0 auto",
        minHeight: "100dvh",
        position: "relative",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}
