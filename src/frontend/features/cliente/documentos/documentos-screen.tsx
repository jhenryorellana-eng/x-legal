"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/frontend/components/brand/icon";
import { IconTile } from "@/frontend/components/brand/icon-tile";
import { Card } from "@/frontend/components/brand/card";
import { ProgressRing } from "@/frontend/components/brand/progress-ring";
import { StatusPill } from "@/frontend/components/brand/status-pill";
import { ScreenHead } from "@/frontend/components/mobile";

/**
 * DocumentosScreen — `/caso/[caseId]/documentos` (DOC-51 §14, prototype
 * `screens2.jsx → DocsScreen`). Checklist by category, per-requirement status.
 *
 * Client component (category accordion is interactive). Rejected docs render in
 * AMBER (StatusPill never used for "corregir" → red button + reason text, per
 * the spec's tone rule RF-CLI-028).
 *
 * Multiple requirements (allow_multiple) list every uploaded file with its
 * client-chosen name, a delete action (only while pending review), and an
 * "Add file" button. Single slots keep the classic upload/fix flow plus a
 * delete affordance while the upload is still pending review.
 */

/** One uploaded file within a slot (the unit a multiple requirement lists). */
export interface DocUploadItem {
  documentId: string;
  name: string;
  status: "revision" | "aprobado" | "corregir";
  /** True only while the file is pending review ('uploaded') → client may delete it. */
  canDelete: boolean;
}

export interface DocItem {
  key: string;
  /** Effective label (includes party suffix when per-party). */
  label: string;
  category: string;
  status: "pendiente" | "revision" | "aprobado" | "corregir";
  rejectionReason: string | null;
  /** Query string for the upload/fix route (carries requirement + party). */
  query: string;
  /** True when the admin marked this requirement as multiple (≥1 file). */
  allowMultiple: boolean;
  /** Optional requirement (is_required=false): visible, badged, never blocks. */
  optional: boolean;
  /** Human name of the upload that COVERS this pending slot (AI detected its
   *  content inside another document), or null. */
  coveredByName: string | null;
  /** Current (non-replaced) files for this slot. */
  uploads: DocUploadItem[];
}

export interface DocumentosLabels {
  title: string;
  subtitle: string; // "...de tu fase de {phase}..."
  ofWord: string;
  completed: string;
  tip: string; // bold "Consejo:" prefix handled in copy
  approved: string;
  inReview: string;
  upload: string;
  fix: string;
  addFile: string;
  remove: string;
  confirm: string;
  cancel: string;
  /** Chip on optional (never-blocking) requirements. */
  optionalBadge: string;
  /** "Cubierto por tu {source} ✨" — {source} replaced by the screen. */
  coveredBy: string;
  /** Ghost CTA on a covered slot (own upload supersedes the coverage). */
  uploadSeparately: string;
  /** "{done} de {total} opcionales" — placeholders replaced by the screen. */
  optionalProgress: string;
}

export type DeleteResult = { ok: boolean; error?: { code: string } };

export function DocumentosScreen({
  items,
  done,
  total,
  optionalDone,
  optionalTotal,
  progress,
  phaseName,
  caseId,
  labels,
  onDelete,
}: {
  items: DocItem[];
  /** Required requirements only — the gate/progress math (RF-ADM-027). */
  done: number;
  total: number;
  /** Optional requirements, shown as a secondary line ("y N opcionales"). */
  optionalDone: number;
  optionalTotal: number;
  progress: number;
  phaseName: string;
  caseId: string;
  labels: DocumentosLabels;
  onDelete: (input: { caseId: string; documentId: string }) => Promise<DeleteResult>;
}) {
  const router = useRouter();
  const categories = React.useMemo(
    () => Array.from(new Set(items.map((d) => d.category))),
    [items],
  );
  const [open, setOpen] = React.useState<string[]>(categories);
  const toggle = (c: string) =>
    setOpen((o) => (o.includes(c) ? o.filter((x) => x !== c) : [...o, c]));

  // Two-step inline delete: first tap arms (sets confirmingId), second confirms.
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function handleDelete(documentId: string) {
    setBusyId(documentId);
    const r = await onDelete({ caseId, documentId });
    setBusyId(null);
    setConfirmingId(null);
    if (r.ok) router.refresh();
  }

  function goUpload(d: DocItem) {
    router.push(
      d.status === "corregir"
        ? `/caso/${caseId}/corregir?${d.query}`
        : `/caso/${caseId}/subir?${d.query}`,
    );
  }

  /** Trash / confirm inline control for a deletable upload. */
  function DeleteControl({ documentId }: { documentId: string }) {
    if (confirmingId === documentId) {
      return (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => handleDelete(documentId)}
            disabled={busyId === documentId}
            style={{
              height: 36,
              padding: "0 12px",
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              background: "var(--red)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 13.5,
            }}
          >
            {busyId === documentId ? "…" : labels.confirm}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingId(null)}
            style={{
              height: 36,
              padding: "0 12px",
              borderRadius: 999,
              border: "1px solid var(--line)",
              cursor: "pointer",
              background: "var(--card)",
              color: "var(--ink-2)",
              fontWeight: 700,
              fontSize: 13.5,
            }}
          >
            {labels.cancel}
          </button>
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setConfirmingId(documentId)}
        aria-label={labels.remove}
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          border: "none",
          cursor: "pointer",
          background: "var(--red-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Icon name="x" size={17} color="var(--red)" />
      </button>
    );
  }

  /** "Opcional" chip next to a never-blocking requirement's label. */
  function OptionalBadge() {
    return (
      <span
        style={{
          marginLeft: 8,
          display: "inline-block",
          verticalAlign: "middle",
          padding: "2px 9px",
          borderRadius: 999,
          background: "var(--blue-soft)",
          color: "var(--accent)",
          fontSize: 11.5,
          fontWeight: 800,
        }}
      >
        {labels.optionalBadge}
      </span>
    );
  }

  /** "Cubierto por tu {source} ✨" — golden check under a covered slot. */
  function CoveredLine({ source }: { source: string }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
        <Icon name="check" size={15} color="var(--gold-deep)" />
        <span style={{ fontSize: 13, color: "var(--gold-deep)", fontWeight: 700 }}>
          {labels.coveredBy.replace("{source}", source)}
        </span>
      </div>
    );
  }

  /** A single uploaded file row inside a multiple slot. */
  function UploadRow({ u }: { u: DocUploadItem }) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          background: "var(--panel-2)",
          borderRadius: 12,
        }}
      >
        <Icon name="doc" size={18} color="var(--accent)" />
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: "var(--navy)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {u.name}
        </span>
        {u.status !== "corregir" && (
          <StatusPill kind={u.status}>
            {u.status === "aprobado" ? labels.approved : labels.inReview}
          </StatusPill>
        )}
        {u.canDelete && <DeleteControl documentId={u.documentId} />}
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 20px var(--screen-pb)",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      <ScreenHead
        title={labels.title}
        sub={labels.subtitle.replace("{phase}", phaseName)}
        lexMood="señala"
      />

      <Card style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16, padding: 18 }}>
        <ProgressRing pct={progress} size={78} stroke={9} />
        <div style={{ flex: 1 }}>
          <div
            className="t-title"
            style={{ fontSize: 21, color: "var(--navy)", fontWeight: 800 }}
          >
            {done} {labels.ofWord} {total}
          </div>
          <div style={{ fontSize: 15, color: "var(--ink-2)", fontWeight: 500 }}>
            {labels.completed}
          </div>
          {optionalTotal > 0 && (
            <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 600, marginTop: 2 }}>
              {labels.optionalProgress
                .replace("{done}", String(optionalDone))
                .replace("{total}", String(optionalTotal))}
            </div>
          )}
        </div>
      </Card>

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          background: "var(--blue-soft)",
          borderRadius: 18,
          padding: "14px 16px",
          marginBottom: 20,
        }}
      >
        <IconTile name="camera" color="var(--accent)" size={38} radius={999} iconSize={22} />
        <div
          style={{
            fontSize: 14.5,
            color: "var(--navy)",
            fontWeight: 500,
            lineHeight: 1.4,
          }}
        >
          {labels.tip}
        </div>
      </div>

      {categories.map((cat) => (
        <div key={cat} style={{ marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => toggle(cat)}
            aria-expanded={open.includes(cat)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "none",
              border: "none",
              padding: "4px 4px 10px",
              cursor: "pointer",
            }}
          >
            <span
              className="t-title"
              style={{ fontSize: 17, color: "var(--navy)", fontWeight: 700 }}
            >
              {cat}
            </span>
            <span
              style={{
                transform: open.includes(cat) ? "rotate(0)" : "rotate(-90deg)",
                transition: "transform 0.2s",
                display: "flex",
              }}
            >
              <Icon name="chevD" size={20} color="var(--ink-3)" />
            </span>
          </button>
          {open.includes(cat) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items
                .filter((d) => d.category === cat)
                .map((d) =>
                  d.allowMultiple ? (
                    // ── Multiple slot: list of files + "add file" button ──────
                    <div
                      key={d.key}
                      style={{
                        background: "var(--card)",
                        borderRadius: 20,
                        padding: 16,
                        boxShadow: "var(--shadow-soft)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                        <IconTile name="doc" color="var(--accent)" size={44} radius={13} iconSize={24} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            className="t-title"
                            style={{ fontSize: 16, color: "var(--navy)", fontWeight: 700, lineHeight: 1.25 }}
                          >
                            {d.label}
                            {d.optional && <OptionalBadge />}
                          </div>
                          {d.uploads.length === 0 && d.coveredByName && (
                            <CoveredLine source={d.coveredByName} />
                          )}
                        </div>
                      </div>

                      {d.uploads.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {d.uploads.map((u) => (
                            <UploadRow key={u.documentId} u={u} />
                          ))}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => router.push(`/caso/${caseId}/subir?${d.query}`)}
                        className="mp-pop"
                        style={{
                          height: 44,
                          padding: "0 18px",
                          borderRadius: 999,
                          border: "1.5px dashed color-mix(in srgb, var(--accent) 50%, transparent)",
                          cursor: "pointer",
                          background: "var(--blue-soft)",
                          color: "var(--accent)",
                          fontFamily: "var(--font-title)",
                          fontWeight: 700,
                          fontSize: 15,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 7,
                        }}
                      >
                        <Icon name="plus" size={18} color="var(--accent)" />
                        {labels.addFile}
                      </button>
                    </div>
                  ) : (
                    // ── Single slot: classic upload/fix + status, delete if pending ──
                    <div
                      key={d.key}
                      className="mp-lift"
                      style={{
                        background: "var(--card)",
                        borderRadius: 20,
                        padding: 16,
                        display: "flex",
                        alignItems: "center",
                        gap: 13,
                        boxShadow: "var(--shadow-soft)",
                      }}
                    >
                      <IconTile name="doc" color="var(--accent)" size={44} radius={13} iconSize={24} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          className="t-title"
                          style={{
                            fontSize: 16,
                            color: "var(--navy)",
                            fontWeight: 700,
                            lineHeight: 1.25,
                          }}
                        >
                          {d.label}
                          {d.optional && <OptionalBadge />}
                        </div>
                        {d.status === "pendiente" && d.coveredByName && (
                          <CoveredLine source={d.coveredByName} />
                        )}
                        {d.status === "corregir" && d.rejectionReason && (
                          <div
                            style={{
                              fontSize: 13,
                              color: "var(--gold-deep)",
                              fontWeight: 700,
                              marginTop: 3,
                            }}
                          >
                            {d.rejectionReason}
                          </div>
                        )}
                        {(d.status === "aprobado" || d.status === "revision") && (
                          <div style={{ marginTop: 6 }}>
                            <StatusPill kind={d.status}>
                              {d.status === "aprobado" ? labels.approved : labels.inReview}
                            </StatusPill>
                          </div>
                        )}
                      </div>
                      {/* Delete a pending (not-yet-reviewed) single upload to free the slot. */}
                      {d.status === "revision" && d.uploads[0]?.canDelete && (
                        <DeleteControl documentId={d.uploads[0].documentId} />
                      )}
                      {d.status === "pendiente" && d.coveredByName ? (
                        // Covered slot: the requirement already counts — offer a
                        // quiet "upload separately" (own upload supersedes).
                        <button
                          type="button"
                          onClick={() => goUpload(d)}
                          style={{
                            height: 40,
                            padding: "0 14px",
                            borderRadius: 999,
                            border: "1.5px solid var(--line)",
                            cursor: "pointer",
                            background: "var(--card)",
                            color: "var(--ink-2)",
                            fontFamily: "var(--font-title)",
                            fontWeight: 700,
                            fontSize: 13.5,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            whiteSpace: "nowrap",
                          }}
                        >
                          <Icon name="upload" size={16} color="var(--ink-2)" />
                          {labels.uploadSeparately}
                        </button>
                      ) : (
                        (d.status === "pendiente" || d.status === "corregir") && (
                          <button
                            type="button"
                            onClick={() => goUpload(d)}
                            className="mp-pop"
                            style={{
                              height: 44,
                              padding: "0 18px",
                              borderRadius: 999,
                              border: "none",
                              cursor: "pointer",
                              // "corregir" CTA is amber (gold-deep), NOT red — tone rule.
                              background:
                                d.status === "corregir"
                                  ? "var(--gold-deep)"
                                  : "var(--accent)",
                              color: "#fff",
                              fontFamily: "var(--font-title)",
                              fontWeight: 700,
                              fontSize: 15,
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              boxShadow: `0 6px 14px color-mix(in srgb, ${d.status === "corregir" ? "var(--gold-deep)" : "var(--accent)"} 27%, transparent)`,
                              whiteSpace: "nowrap",
                            }}
                          >
                            <Icon
                              name={d.status === "corregir" ? "edit" : "upload"}
                              size={18}
                              color="#fff"
                            />
                            {d.status === "corregir" ? labels.fix : labels.upload}
                          </button>
                        )
                      )}
                    </div>
                  ),
                )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
