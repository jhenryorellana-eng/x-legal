"use client";

import * as React from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Chip, GhostBtn, GradientBtn, ProgressBar } from "@/frontend/components/brand";
import { Modal } from "@/frontend/components/desktop/modal";
import { DEMO_ASSET_MAX_BYTES, getDemoAssetSlots } from "@/shared/constants/demo-assets";

/**
 * DemoDataModal — "⋯ → Data" on a /admin/demo card. One row per declared asset
 * slot (shared constants): the admin uploads/replaces/deletes the REAL PDF the
 * staff view shows when that generation finishes. A slot without a PDF keeps
 * the pure-UI HTML simulation.
 *
 * Real upload flow (pattern: cliente/documentos/upload-screen.tsx): pick a PDF
 * → signed upsert URL (server action) → PUT with real XHR progress → confirm
 * (server-side magic-bytes validation) → row refresh.
 */

export interface DemoAssetSlotStatusVM {
  key: string;
  uploaded: boolean;
  updatedAt: string | null;
  sizeBytes: number | null;
}

/** Structurally match the demo-assets server actions. */
export type DemoAssetActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string } };

export interface DemoAssetActions {
  listStatus: (input: { slug: string }) => Promise<DemoAssetActionResult<DemoAssetSlotStatusVM[]>>;
  startUpload: (input: {
    slug: string;
    slotKey: string;
  }) => Promise<DemoAssetActionResult<{ signedUrl: string }>>;
  confirmUpload: (input: {
    slug: string;
    slotKey: string;
  }) => Promise<DemoAssetActionResult<DemoAssetSlotStatusVM>>;
  deleteAsset: (input: { slug: string; slotKey: string }) => Promise<DemoAssetActionResult<null>>;
}

type SlotErrorCode = "errType" | "errTooBig" | "errUpload" | "errDelete";

type SlotUi =
  | { phase: "idle" }
  | { phase: "uploading"; pct: number }
  | { phase: "deleting" }
  | { phase: "error"; code: SlotErrorCode };

const IDLE: SlotUi = { phase: "idle" };

function putWithProgress(
  url: string,
  file: File,
  onProgress: (pct: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    // The bucket enforces its MIME allowlist on the PUT — the header is required.
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.send(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DemoDataModal({
  slug,
  open,
  onOpenChange,
  actions,
}: {
  slug: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: DemoAssetActions;
}) {
  const t = useTranslations("staff.demo.assets");
  const format = useFormatter();
  const slots = getDemoAssetSlots(slug);

  const [statuses, setStatuses] = React.useState<Record<string, DemoAssetSlotStatusVM>>({});
  const [loadError, setLoadError] = React.useState(false);
  const [slotUi, setSlotUi] = React.useState<Record<string, SlotUi>>({});
  const [confirmingDelete, setConfirmingDelete] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const pendingSlotRef = React.useRef<string | null>(null);

  const setUi = React.useCallback((key: string, ui: SlotUi) => {
    setSlotUi((prev) => ({ ...prev, [key]: ui }));
  }, []);

  const refresh = React.useCallback(async () => {
    const res = await actions.listStatus({ slug });
    if (res.ok) {
      setStatuses(Object.fromEntries(res.data.map((s) => [s.key, s])));
      setLoadError(false);
    } else {
      setLoadError(true);
    }
  }, [actions, slug]);

  React.useEffect(() => {
    if (!open) return;
    setConfirmingDelete(null);
    void refresh();
  }, [open, refresh]);

  const pickFileFor = (slotKey: string) => {
    pendingSlotRef.current = slotKey;
    fileInputRef.current?.click();
  };

  const onFilePicked = async (file: File | null) => {
    const slotKey = pendingSlotRef.current;
    pendingSlotRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file || !slotKey) return;

    if (file.type !== "application/pdf") return setUi(slotKey, { phase: "error", code: "errType" });
    if (file.size > DEMO_ASSET_MAX_BYTES) return setUi(slotKey, { phase: "error", code: "errTooBig" });

    setUi(slotKey, { phase: "uploading", pct: 0 });
    const start = await actions.startUpload({ slug, slotKey });
    if (!start.ok) return setUi(slotKey, { phase: "error", code: "errUpload" });

    const putOk = await putWithProgress(start.data.signedUrl, file, (pct) =>
      setUi(slotKey, { phase: "uploading", pct }),
    );
    if (!putOk) return setUi(slotKey, { phase: "error", code: "errUpload" });

    const confirm = await actions.confirmUpload({ slug, slotKey });
    if (!confirm.ok) return setUi(slotKey, { phase: "error", code: "errUpload" });

    setStatuses((prev) => ({ ...prev, [slotKey]: confirm.data }));
    setUi(slotKey, IDLE);
  };

  const onDelete = async (slotKey: string) => {
    if (confirmingDelete !== slotKey) {
      setConfirmingDelete(slotKey);
      return;
    }
    setConfirmingDelete(null);
    setUi(slotKey, { phase: "deleting" });
    const res = await actions.deleteAsset({ slug, slotKey });
    if (!res.ok) return setUi(slotKey, { phase: "error", code: "errDelete" });
    setStatuses((prev) => ({
      ...prev,
      [slotKey]: { key: slotKey, uploaded: false, updatedAt: null, sizeBytes: null },
    }));
    setUi(slotKey, IDLE);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("modalTitle")}
      description={t("modalSubtitle")}
      width={580}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: "none" }}
        onChange={(e) => void onFilePicked(e.target.files?.[0] ?? null)}
      />

      {loadError && (
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--red)", marginBottom: 12 }}>
          {t("errLoad")}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 16 }}>
        {slots.map((slot) => {
          const status = statuses[slot.key];
          const ui = slotUi[slot.key] ?? IDLE;
          const busy = ui.phase === "uploading" || ui.phase === "deleting";

          return (
            <div
              key={slot.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
                background: "var(--bg)",
                border: "1px solid var(--line)",
                borderRadius: 14,
                padding: "12px 14px",
              }}
            >
              <div style={{ flex: 1, minWidth: 200 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: "var(--ink-3, var(--ink-2))",
                  }}
                >
                  {slot.tabLabel}
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: "var(--navy)", marginTop: 2 }}>
                  {slot.title}
                </div>
                <div style={{ marginTop: 6, minHeight: 20 }}>
                  {ui.phase === "uploading" ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, maxWidth: 220 }}>
                        <ProgressBar pct={ui.pct} />
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-2)" }}>
                        {t("uploading", { pct: ui.pct })}
                      </span>
                    </div>
                  ) : ui.phase === "error" ? (
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--red)" }}>
                      {t(ui.code)}
                    </span>
                  ) : status?.uploaded ? (
                    <Chip tone="green">
                      {t("slotUploaded", {
                        date: status.updatedAt
                          ? format.dateTime(new Date(status.updatedAt), {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "—",
                      })}
                      {status.sizeBytes != null ? ` · ${formatSize(status.sizeBytes)}` : ""}
                    </Chip>
                  ) : (
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>
                      {t("slotEmpty")}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {status?.uploaded ? (
                  <>
                    <GhostBtn size="md" full={false} disabled={busy} onClick={() => pickFileFor(slot.key)}>
                      {t("replace")}
                    </GhostBtn>
                    <GhostBtn
                      size="md"
                      full={false}
                      color="var(--red)"
                      disabled={busy}
                      onClick={() => void onDelete(slot.key)}
                    >
                      {confirmingDelete === slot.key ? t("confirmRemove") : t("remove")}
                    </GhostBtn>
                  </>
                ) : (
                  <GradientBtn size="sm" full={false} disabled={busy} onClick={() => pickFileFor(slot.key)}>
                    {t("upload")}
                  </GradientBtn>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
