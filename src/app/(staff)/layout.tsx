/**
 * Staff surface layout — minimal guard for F0.
 * Full sidebar + nav arrives in a later phase.
 * The middleware handles most redirects; this is defense-in-depth.
 */

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--bg)",
      }}
    >
      {children}
    </div>
  );
}
