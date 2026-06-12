"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { EmptyState, Modal, Switch, toast } from "@/frontend/components/desktop";
import { Card, GradientBtn, GhostBtn, StatusPill, Chip, Icon, type IconName } from "@/frontend/components/brand";
import { ViewHead, inputStyle } from "../shared/chrome";

/* ───────────────────────── Types ───────────────────────── */

export interface ServiceCardVM {
  id: string;
  slug: string;
  category: string;
  label: string;
  icon: string;
  color: string;
  isActive: boolean;
  isPublic: boolean;
  archived: boolean;
  isEntry: boolean;
  entryParentLabel?: string;
  planKinds: string[];
  phaseCount: number;
}

export interface CatalogListProps {
  services: ServiceCardVM[];
  messages: Record<string, string>;
  actions: {
    archive: (id: string) => Promise<{ success: boolean; error?: { code: string; message: string } }>;
    restore: (id: string) => Promise<{ success: boolean; error?: { code: string; message: string } }>;
    setActive: (id: string, active: boolean) => Promise<{ success: boolean; error?: { code: string; message: string } }>;
    setPublic: (id: string, isPublic: boolean) => Promise<{ success: boolean; error?: { code: string; message: string } }>;
  };
  /** Navigation hrefs the page wires (kept out of the client to stay presentational where possible). */
  newServiceHref: string;
  /** Base path: hrefs are built client-side as `${serviceBasePath}/${id}` (functions cannot cross the RSC boundary). */
  serviceBasePath: string;
}

const SERVICE_COLOR: Record<string, string> = {
  accent: "var(--accent)",
  gold: "var(--gold-deep)",
  green: "var(--green)",
  red: "var(--red)",
  navy: "var(--brand-navy)",
  purple: "var(--purple)",
};

const CATEGORY_LABEL = (t: Record<string, string>, c: string) =>
  c === "migratorio" ? t.catMigratorio : c === "empresarial" ? t.catEmpresarial : t.catFamiliar;

/* ───────────────────────── View ───────────────────────── */

export function CatalogListView({
  services,
  messages: t,
  actions,
  newServiceHref,
  serviceBasePath,
}: CatalogListProps) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [cat, setCat] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [showArchived, setShowArchived] = React.useState(false);
  const [archiveFor, setArchiveFor] = React.useState<ServiceCardVM | null>(null);
  const [menuOpen, setMenuOpen] = React.useState<string | null>(null);

  const filtered = services.filter((s) => {
    if (!showArchived && s.archived) return false;
    if (cat !== "all" && s.category !== cat) return false;
    if (status === "draft" && (s.isActive || s.archived)) return false;
    if (status === "active" && !s.isActive) return false;
    if (status === "hidden" && s.isPublic) return false;
    if (status === "archived" && !s.archived) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!s.label.toLowerCase().includes(q) && !s.slug.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  if (services.filter((s) => !s.archived).length === 0 && !showArchived) {
    return (
      <div className="anim-fade-in-up" style={{ padding: "28px clamp(18px,3vw,36px) 64px", maxWidth: 1320 }}>
        <ViewHead title={t.title} sub={t.sub} />
        <EmptyState
          mood="feliz"
          lexSize={130}
          title={t.emptyTitle}
          subtitle={t.emptySub}
          action={{ label: t.newService, icon: "plus", onClick: () => router.push(newServiceHref) }}
        />
      </div>
    );
  }

  return (
    <div className="anim-fade-in-up" style={{ padding: "28px clamp(18px,3vw,36px) 64px", maxWidth: 1320 }}>
      <ViewHead title={t.title} sub={t.sub}>
        <GradientBtn size="md" full={false} icon="plus" onClick={() => router.push(newServiceHref)}>
          {t.newService}
        </GradientBtn>
      </ViewHead>

      {/* Filters */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18, alignItems: "center" }}>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 300 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>
            <Icon name="search" size={16} color="var(--ink-3)" />
          </span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.filterSearch} style={{ ...inputStyle, paddingLeft: 36 }} />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={filterSelect}>
          <option value="all">{t.filterCategory}</option>
          <option value="migratorio">{t.catMigratorio}</option>
          <option value="empresarial">{t.catEmpresarial}</option>
          <option value="familiar">{t.catFamiliar}</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={filterSelect}>
          <option value="all">{t.filterStatus}</option>
          <option value="draft">{t.statusDraft}</option>
          <option value="active">{t.statusActive}</option>
          <option value="hidden">{t.statusHidden}</option>
          <option value="archived">{t.statusArchived}</option>
        </select>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-2)", cursor: "pointer" }}>
          <Switch checked={showArchived} aria-label={t.showArchived} onCheckedChange={setShowArchived} />
          {t.showArchived}
        </label>
      </div>

      {/* Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {filtered.map((s) => (
          <ServiceCard
            key={s.id}
            s={s}
            t={t}
            onOpen={() => router.push(`${serviceBasePath}/${s.id}`)}
            menuOpen={menuOpen === s.id}
            setMenuOpen={(o) => setMenuOpen(o ? s.id : null)}
            onArchive={() => {
              setMenuOpen(null);
              setArchiveFor(s);
            }}
            onAction={actions}
            refresh={() => router.refresh()}
          />
        ))}
      </div>

      {filtered.length === 0 && (
        <div style={{ marginTop: 16 }}>
          <EmptyState mood="calma" title={t.emptyFiltered ?? t.emptyTitle} subtitle={undefined} />
        </div>
      )}

      {archiveFor && (
        <Modal
          open={!!archiveFor}
          onOpenChange={(o) => !o && setArchiveFor(null)}
          title={t.archiveConfirmTitle}
          description={t.archiveConfirmBody}
          tone="var(--gold-deep)"
          footer={
            <>
              <GhostBtn size="md" full={false} onClick={() => setArchiveFor(null)}>
                {t.cancel}
              </GhostBtn>
              <GradientBtn
                size="md"
                full={false}
                c1="var(--gold-deep)"
                c2="var(--gold-deep)"
                onClick={async () => {
                  const r = await actions.archive(archiveFor.id);
                  if (r.success) {
                    toast.success(t.menuArchive);
                    setArchiveFor(null);
                    router.refresh();
                  } else toast.error(r.error?.message ?? "Error");
                }}
              >
                {t.menuArchive}
              </GradientBtn>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>{archiveFor.label}</p>
        </Modal>
      )}
    </div>
  );
}

/* ───────────────────────── Card ───────────────────────── */

function ServiceCard({
  s,
  t,
  onOpen,
  menuOpen,
  setMenuOpen,
  onArchive,
  onAction,
  refresh,
}: {
  s: ServiceCardVM;
  t: Record<string, string>;
  onOpen: () => void;
  menuOpen: boolean;
  setMenuOpen: (o: boolean) => void;
  onArchive: () => void;
  onAction: CatalogListProps["actions"];
  refresh: () => void;
}) {
  const color = SERVICE_COLOR[s.color] ?? "var(--accent)";
  const [hover, setHover] = React.useState(false);

  async function run(fn: () => Promise<{ success: boolean; error?: { message: string } }>, ok: string) {
    setMenuOpen(false);
    const r = await fn();
    if (r.success) {
      toast.success(ok);
      refresh();
    } else toast.error(r.error?.message ?? "Error");
  }

  return (
    <Card
      interactive
      style={{
        padding: 18,
        position: "relative",
        cursor: "pointer",
        transform: hover ? "translateY(-3px)" : "translateY(0)",
        opacity: s.archived ? 0.62 : 1,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        {/* IconTile */}
        <span
          aria-hidden="true"
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 44,
            height: 44,
            borderRadius: 13,
            background: `color-mix(in srgb, ${color} 14%, transparent)`,
          }}
        >
          <Icon name={(s.icon as IconName) ?? "doc"} size={22} color={color} stroke={2.3} />
        </span>

        {/* Kebab */}
        <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Menú"
            style={{
              display: "inline-grid",
              placeItems: "center",
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "none",
              background: menuOpen ? "var(--hover)" : "transparent",
              cursor: "pointer",
              color: "var(--ink-3)",
              fontSize: 18,
              fontWeight: 900,
            }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              role="menu"
              style={{
                position: "absolute",
                right: 0,
                top: 36,
                zIndex: 5,
                minWidth: 188,
                background: "var(--panel, var(--card))",
                border: "1px solid var(--line)",
                borderRadius: 12,
                boxShadow: "var(--shadow-md)",
                padding: 6,
              }}
            >
              <MenuItem label={t.menuEdit} icon="edit" onClick={() => { setMenuOpen(false); onOpen(); }} />
              {!s.archived && (
                s.isActive ? (
                  <MenuItem label={t.menuDeactivate} icon="x" onClick={() => run(() => onAction.setActive(s.id, false), t.menuDeactivate)} />
                ) : (
                  <MenuItem label={t.menuActivate} icon="check" onClick={() => run(() => onAction.setActive(s.id, true), t.menuActivate)} />
                )
              )}
              {!s.archived && (
                s.isPublic ? (
                  <MenuItem label={t.menuHide} icon="lock" onClick={() => run(() => onAction.setPublic(s.id, false), t.menuHide)} />
                ) : (
                  <MenuItem label={t.menuShow} icon="globe" onClick={() => run(() => onAction.setPublic(s.id, true), t.menuShow)} />
                )
              )}
              {s.archived ? (
                <MenuItem label={t.menuRestore} icon="route" onClick={() => run(() => onAction.restore(s.id), t.menuRestore)} />
              ) : (
                <MenuItem label={t.menuArchive} icon="x" tone="var(--red)" onClick={onArchive} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Title + slug */}
      <h3 style={{ margin: "14px 0 2px", fontFamily: "var(--font-title)", fontWeight: 800, fontSize: 16, color: "var(--ink)" }}>
        {s.label || s.slug}
      </h3>
      <code style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "ui-monospace, monospace" }}>{s.slug}</code>

      {/* Chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14 }}>
        <Chip tone="blue">{CATEGORY_LABEL(t, s.category)}</Chip>
        <Chip tone="blue">{t.phases.replace("{n}", String(s.phaseCount))}</Chip>
        {s.planKinds.includes("self") && <Chip tone="blue">{t.planSelf}</Chip>}
        {s.planKinds.includes("with_lawyer") && <Chip tone="gold">{t.planLawyer}</Chip>}
      </div>

      {/* Status badges */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        {s.archived ? (
          <Chip tone="red">{t.statusArchived}</Chip>
        ) : s.isActive ? (
          <StatusPill kind="aprobado">{t.statusActive}</StatusPill>
        ) : (
          <Chip tone="amber">{t.statusDraft}</Chip>
        )}
        {!s.archived && !s.isPublic && <Chip tone="amber" dot>{t.statusHidden}</Chip>}
        {s.isEntry && s.entryParentLabel && (
          <Chip tone="gold" dot>
            {t.entryBadge.replace("{parent}", s.entryParentLabel).replace("{phase}", "")}
          </Chip>
        )}
      </div>
    </Card>
  );
}

function MenuItem({ label, icon, tone = "var(--ink)", onClick }: { label: string; icon: IconName; tone?: string; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 10px",
        borderRadius: 8,
        border: "none",
        background: "transparent",
        cursor: "pointer",
        color: tone,
        fontSize: 13.5,
        fontWeight: 600,
        textAlign: "left",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--hover)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      <Icon name={icon} size={16} color={tone} />
      {label}
    </button>
  );
}

const filterSelect: React.CSSProperties = {
  ...inputStyle,
  width: "auto",
  cursor: "pointer",
  minWidth: 150,
};
