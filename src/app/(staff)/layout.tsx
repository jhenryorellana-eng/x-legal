/**
 * Staff surface root layout — applies the desktop staff token scope.
 *
 * Scopes `.surface-staff` (DOC-01 §3.3) so every staff route — auth pages
 * (login / reset-password / cambiar-password) AND the panel — renders with the
 * desktop staff tokens in light and dark. The middleware owns the surface guard
 * (DOC-22 §5.4); this layer is purely presentational.
 *
 * The sidebar + topbar shell lives one level down in (panel)/layout.tsx so the
 * auth pages stay chrome-free (no sidebar on /login).
 */

export default function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="surface-staff" style={{ minHeight: "100dvh", background: "var(--bg)" }}>
      {children}
    </div>
  );
}
