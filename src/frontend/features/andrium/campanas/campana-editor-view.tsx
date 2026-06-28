"use client";

/**
 * CampanaEditorView — `/finanzas/campanas/[id]` editor + detail (Andrium · marketing).
 * DOC-55 §4.2-4.4, RF-AND-034..039. Boundaries: no @/backend imports.
 *
 * The body is composed with a VISUAL BLOCK EDITOR (no HTML knowledge required):
 * pick a template, add/reorder/edit blocks (heading, text, button, image, divider,
 * spacer), insert personalisation fields ({{nombre}}, {{org}}), and watch the live
 * preview. The blocks render to body_html server-side (shared/email-blocks).
 *
 * - Draft: editable (name/subject/blocks + audience), live audience count + preview,
 *   sticky actions (test / schedule / send).
 * - Non-draft: read-only + delivery metrics; cancel if scheduled/sending.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, GradientBtn, GhostBtn, Icon, ProgressBar } from "@/frontend/components/brand";
import { Modal, toast } from "@/frontend/components/desktop";
import {
  type EmailBlock,
  type EmailBlockType,
  EMAIL_BLOCK_TYPES,
  emptyBlock,
  renderBlocksToHtml,
  BLOCK_TEMPLATES,
  MERGE_FIELDS,
} from "@/shared/email-blocks";

export type AudKind = "all_clients" | "by_service" | "custom" | "completed";
export type CampaignStatusVM = "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";

export type AudienceSpecVM =
  | { kind: "all_clients" }
  | { kind: "by_service"; serviceIds: string[] }
  | { kind: "custom"; userIds: string[] }
  | { kind: "completed" };

export interface CampaignMetricsVM {
  total: number;
  pending: number;
  sent: number;
  failed: number;
  suppressed: number;
  bounced: number;
  complained: number;
}

export interface AudiencePreviewVM {
  total: number;
  mailable: number;
  suppressed: { noEmail: number; optedOut: number; bounced: number };
}

export interface CampaignResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
}

export interface CampanaEditorVM {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyBlocks: EmailBlock[] | null;
  status: CampaignStatusVM;
  audience: AudienceSpecVM;
  scheduledAt: string | null;
  metrics: CampaignMetricsVM;
  services: Array<{ id: string; label: string }>;
  clients: Array<{ userId: string; name: string; email: string | null }>;
  locale: "es" | "en";
}

export interface CampanaEditorViewProps {
  vm: CampanaEditorVM;
  actions: {
    update: (input: {
      name?: string;
      subject?: string;
      bodyBlocks?: EmailBlock[];
      audience?: AudienceSpecVM;
    }) => Promise<CampaignResult>;
    preview: (audience: AudienceSpecVM) => Promise<CampaignResult<AudiencePreviewVM>>;
    sendTest: () => Promise<CampaignResult>;
    schedule: (scheduledAt: string) => Promise<CampaignResult>;
    send: () => Promise<CampaignResult>;
    cancel: () => Promise<CampaignResult>;
  };
}

function tt(locale: "es" | "en", es: string, en: string) {
  return locale === "es" ? es : en;
}

// Stable-ish unique id for new blocks (client-only; React keys + reorder).
let _bid = 0;
function newBlockId(): string {
  return `b${Date.now().toString(36)}${(_bid++).toString(36)}`;
}

/** Seeds the composer: persisted blocks → else a single text block from legacy html → else one heading. */
function seedBlocks(vm: CampanaEditorVM): EmailBlock[] {
  if (vm.bodyBlocks && vm.bodyBlocks.length > 0) return vm.bodyBlocks;
  const stripped = vm.bodyHtml.replace(/<[^>]+>/g, "").trim();
  if (stripped) return [{ id: newBlockId(), type: "text", text: stripped }];
  return [{ id: newBlockId(), type: "heading", text: "Hola {{nombre}}" }];
}

function buildPreviewHtml(bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#f8f9fa;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
<div style="background:#003366;padding:22px 32px;color:#fff;font-weight:800;font-size:20px;letter-spacing:.5px">X <span style="color:#FFC629">LEGAL</span></div>
<div style="padding:32px;color:#1a1a2e;font-size:15px;line-height:1.6">${bodyHtml}</div>
<div style="padding:24px 32px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;line-height:1.6">UsaLatinoPrime — Servicios de inmigración<br/>Recibes este correo porque tienes una cuenta. · <a style="color:#2F6BFF" href="#">Darse de baja</a></div>
</div></body></html>`;
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)",
  background: "var(--card)", color: "var(--ink)", fontSize: 14, outline: "none",
};
const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "var(--ink-2)", marginBottom: 6, display: "block" };

const BLOCK_META: Record<EmailBlockType, { es: string; en: string; icon: string }> = {
  heading: { es: "Título", en: "Heading", icon: "doc" },
  text: { es: "Texto", en: "Text", icon: "doc" },
  button: { es: "Botón", en: "Button", icon: "send" },
  image: { es: "Imagen", en: "Image", icon: "doc" },
  divider: { es: "Separador", en: "Divider", icon: "doc" },
  spacer: { es: "Espacio", en: "Spacer", icon: "doc" },
};

// ---------------------------------------------------------------------------
// Single block editor
// ---------------------------------------------------------------------------

interface BlockEditorProps {
  block: EmailBlock;
  index: number;
  total: number;
  locale: "es" | "en";
  onChange: (b: EmailBlock) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  onFocusBlock: () => void;
}

function BlockEditor({ block, index, total, locale, onChange, onRemove, onMove, onFocusBlock }: BlockEditorProps) {
  const meta = BLOCK_META[block.type];
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 12, padding: 12, background: "var(--card)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em", flex: 1 }}>
          {tt(locale, meta.es, meta.en)}
        </span>
        <button type="button" aria-label={tt(locale, "Subir", "Move up")} disabled={index === 0}
          onClick={() => onMove(-1)}
          style={{ border: "none", background: "transparent", cursor: index === 0 ? "default" : "pointer", opacity: index === 0 ? 0.3 : 1, padding: 4 }}>
          <Icon name="chevL" size={16} color="var(--ink-2)" />
        </button>
        <button type="button" aria-label={tt(locale, "Bajar", "Move down")} disabled={index === total - 1}
          onClick={() => onMove(1)}
          style={{ border: "none", background: "transparent", cursor: index === total - 1 ? "default" : "pointer", opacity: index === total - 1 ? 0.3 : 1, padding: 4, transform: "rotate(180deg)" }}>
          <Icon name="chevL" size={16} color="var(--ink-2)" />
        </button>
        <button type="button" aria-label={tt(locale, "Eliminar", "Delete")} onClick={onRemove}
          style={{ border: "none", background: "transparent", cursor: "pointer", padding: 4, color: "var(--red)", fontWeight: 800, fontSize: 16, lineHeight: 1 }}>
          ×
        </button>
      </div>

      {block.type === "heading" && (
        <input style={inputStyle} value={block.text} onFocus={onFocusBlock}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
          placeholder={tt(locale, "Escribe el título…", "Write the heading…")} maxLength={300} />
      )}
      {block.type === "text" && (
        <textarea style={{ ...inputStyle, minHeight: 90, resize: "vertical" }} value={block.text} onFocus={onFocusBlock}
          onChange={(e) => onChange({ ...block, text: e.target.value })}
          placeholder={tt(locale, "Escribe tu mensaje…", "Write your message…")} maxLength={5000} />
      )}
      {block.type === "button" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input style={inputStyle} value={block.label} onFocus={onFocusBlock}
            onChange={(e) => onChange({ ...block, label: e.target.value })}
            placeholder={tt(locale, "Texto del botón", "Button label")} maxLength={120} />
          <input style={inputStyle} value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            placeholder="https://…" maxLength={2000} />
        </div>
      )}
      {block.type === "image" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input style={inputStyle} value={block.url}
            onChange={(e) => onChange({ ...block, url: e.target.value })}
            placeholder={tt(locale, "URL de la imagen (https://…)", "Image URL (https://…)")} maxLength={2000} />
          <input style={inputStyle} value={block.alt}
            onChange={(e) => onChange({ ...block, alt: e.target.value })}
            placeholder={tt(locale, "Texto alternativo", "Alt text")} maxLength={300} />
        </div>
      )}
      {(block.type === "divider" || block.type === "spacer") && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-3)" }}>
          {block.type === "divider"
            ? tt(locale, "Una línea divisoria.", "A horizontal divider.")
            : tt(locale, "Un espacio en blanco.", "A blank space.")}
        </p>
      )}
    </div>
  );
}

export function CampanaEditorView({ vm, actions }: CampanaEditorViewProps) {
  const router = useRouter();
  const locale = vm.locale;
  const editable = vm.status === "draft";
  const cancellable = vm.status === "scheduled" || vm.status === "sending";

  const [name, setName] = React.useState(vm.name);
  const [subject, setSubject] = React.useState(vm.subject);
  const [blocks, setBlocks] = React.useState<EmailBlock[]>(() => seedBlocks(vm));
  const [activeBlockId, setActiveBlockId] = React.useState<string | null>(null);
  const [audKind, setAudKind] = React.useState<AudKind>(vm.audience.kind);
  const [serviceIds, setServiceIds] = React.useState<string[]>(
    vm.audience.kind === "by_service" ? vm.audience.serviceIds : [],
  );
  const [userIds, setUserIds] = React.useState<string[]>(
    vm.audience.kind === "custom" ? vm.audience.userIds : [],
  );
  const [clientSearch, setClientSearch] = React.useState("");

  const [preview, setPreview] = React.useState<AudiencePreviewVM | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [scheduleAt, setScheduleAt] = React.useState("");

  const previewHtml = React.useMemo(() => buildPreviewHtml(renderBlocksToHtml(blocks)), [blocks]);

  const currentAudience = React.useCallback((): AudienceSpecVM => {
    if (audKind === "by_service") return { kind: "by_service", serviceIds };
    if (audKind === "custom") return { kind: "custom", userIds };
    if (audKind === "completed") return { kind: "completed" };
    return { kind: "all_clients" };
  }, [audKind, serviceIds, userIds]);

  const audienceValid =
    audKind === "all_clients" ||
    audKind === "completed" ||
    (audKind === "by_service" && serviceIds.length > 0) ||
    (audKind === "custom" && userIds.length > 0);

  // Live audience count (debounced).
  React.useEffect(() => {
    if (!audienceValid) {
      setPreview({ total: 0, mailable: 0, suppressed: { noEmail: 0, optedOut: 0, bounced: 0 } });
      return;
    }
    const aud = currentAudience();
    const handle = setTimeout(async () => {
      const res = await actions.preview(aud);
      if (res.ok && res.data) setPreview(res.data);
    }, 500);
    return () => clearTimeout(handle);
  }, [audienceValid, currentAudience, actions]);

  // --- block mutations ---
  function updateBlock(id: string, next: EmailBlock) {
    setBlocks((bs) => bs.map((b) => (b.id === id ? next : b)));
  }
  function removeBlock(id: string) {
    setBlocks((bs) => bs.filter((b) => b.id !== id));
  }
  function moveBlock(id: string, dir: -1 | 1) {
    setBlocks((bs) => {
      const i = bs.findIndex((b) => b.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= bs.length) return bs;
      const copy = [...bs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }
  function addBlock(type: EmailBlockType) {
    setBlocks((bs) => [...bs, emptyBlock(type, newBlockId())]);
  }
  function loadTemplate(key: string) {
    const tpl = BLOCK_TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    setBlocks(tpl.blocks.map((b) => ({ ...b, id: newBlockId() }) as EmailBlock));
    if (!subject.trim() || subject === vm.subject) setSubject(tpl.subject);
    toast.success(tt(locale, "Plantilla cargada", "Template loaded"));
  }
  function insertMergeField(token: string) {
    const target = blocks.find((b) => b.id === activeBlockId) ?? blocks[blocks.length - 1];
    if (!target) {
      setBlocks((bs) => [...bs, { id: newBlockId(), type: "text", text: token }]);
      return;
    }
    if (target.type === "heading" || target.type === "text") {
      updateBlock(target.id, { ...target, text: `${target.text}${token}` });
    } else if (target.type === "button") {
      updateBlock(target.id, { ...target, label: `${target.label}${token}` });
    } else {
      setBlocks((bs) => [...bs, { id: newBlockId(), type: "text", text: token }]);
    }
  }

  async function saveDraft(silent = false): Promise<boolean> {
    setSaving(true);
    const res = await actions.update({ name, subject, bodyBlocks: blocks, audience: currentAudience() });
    setSaving(false);
    if (!res.ok && !silent) toast.error(tt(locale, "No se pudo guardar", "Could not save"));
    return res.ok;
  }

  async function handleSendTest() {
    if (editable && !(await saveDraft())) return;
    const res = await actions.sendTest();
    if (res.ok) toast.success(tt(locale, "Prueba enviada a tu correo", "Test sent to your email"));
    else toast.error(tt(locale, "No se pudo enviar la prueba", "Could not send the test"));
  }

  async function handleSendNow() {
    if (!preview || preview.mailable <= 0) {
      toast.error(tt(locale, "La audiencia no tiene destinatarios", "The audience has no recipients"));
      return;
    }
    const confirmed = window.confirm(
      tt(
        locale,
        `Se enviará a ${preview.mailable} clientes. La audiencia se evalúa al momento del envío. ¿Continuar?`,
        `This will send to ${preview.mailable} clients. The audience is evaluated at send time. Continue?`,
      ),
    );
    if (!confirmed) return;
    if (editable && !(await saveDraft())) return;
    const res = await actions.send();
    if (res.ok) {
      toast.success(tt(locale, "Campaña en envío", "Campaign sending"));
      router.refresh();
    } else {
      toast.error(tt(locale, "No se pudo enviar", "Could not send"));
    }
  }

  async function handleSchedule() {
    if (!scheduleAt) return;
    if (new Date(scheduleAt).getTime() <= Date.now()) {
      toast.error(tt(locale, "Elige una fecha futura", "Pick a future date"));
      return;
    }
    if (editable && !(await saveDraft())) return;
    const res = await actions.schedule(new Date(scheduleAt).toISOString());
    if (res.ok) {
      toast.success(tt(locale, "Campaña programada", "Campaign scheduled"));
      setScheduleOpen(false);
      router.refresh();
    } else {
      toast.error(tt(locale, "No se pudo programar", "Could not schedule"));
    }
  }

  async function handleCancel() {
    if (!window.confirm(tt(locale, "¿Cancelar esta campaña?", "Cancel this campaign?"))) return;
    const res = await actions.cancel();
    if (res.ok) {
      toast.success(tt(locale, "Campaña cancelada", "Campaign cancelled"));
      router.refresh();
    } else {
      toast.error(tt(locale, "No se pudo cancelar", "Could not cancel"));
    }
  }

  const filteredClients = vm.clients.filter((c) =>
    !clientSearch.trim() || c.name.toLowerCase().includes(clientSearch.trim().toLowerCase()),
  );

  const m = vm.metrics;
  const bounceRate = m.sent > 0 ? (m.bounced / m.sent) * 100 : 0;
  const complaintRate = m.sent > 0 ? (m.complained / m.sent) * 100 : 0;

  return (
    <div style={{ padding: "32px 32px 96px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <GhostBtn size="md" full={false} onClick={() => router.push("/finanzas/campanas")} style={{ height: 36, width: 36, padding: 0, borderRadius: 999 }} aria-label={tt(locale, "Volver", "Back")}>
          <Icon name="chevL" size={18} color="var(--accent)" />
        </GhostBtn>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", margin: 0, fontFamily: "var(--font-title)", flex: 1 }}>
          {editable ? tt(locale, "Editar campaña", "Edit campaign") : name}
        </h1>
        {cancellable && (
          <GhostBtn size="md" full={false} onClick={handleCancel} style={{ height: 38, padding: "0 16px", borderRadius: 999, color: "var(--red)" }}>
            {tt(locale, "Cancelar campaña", "Cancel campaign")}
          </GhostBtn>
        )}
      </div>

      {/* Non-draft metrics banner */}
      {!editable && (
        <Card style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", margin: "0 0 14px" }}>
            {tt(locale, "Entrega", "Delivery")}
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
            {([
              ["total", tt(locale, "Audiencia", "Audience"), "var(--ink)"],
              ["sent", tt(locale, "Enviados", "Sent"), "var(--green)"],
              ["failed", tt(locale, "Fallidos", "Failed"), "var(--red)"],
              ["suppressed", tt(locale, "Suprimidos", "Suppressed"), "var(--ink-3)"],
              ["pending", tt(locale, "Pendientes", "Pending"), "var(--gold-deep)"],
            ] as const).map(([key, label, color]) => (
              <div key={key} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color }}>{m[key]}</div>
                <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{label}</div>
              </div>
            ))}
          </div>
          {(bounceRate >= 4 || complaintRate >= 0.1) && (
            <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "var(--red-soft)", color: "var(--red)", fontSize: 13, fontWeight: 700 }}>
              {bounceRate >= 4 && tt(locale, `Tasa de rebote alta (${bounceRate.toFixed(1)}%) — revisa la calidad de la lista. `, `High bounce rate (${bounceRate.toFixed(1)}%) — review your list quality. `)}
              {complaintRate >= 0.1 && tt(locale, `Tasa de quejas alta (${complaintRate.toFixed(2)}%).`, `High complaint rate (${complaintRate.toFixed(2)}%).`)}
            </div>
          )}
          {vm.status === "sending" && m.total > 0 && (
            <div style={{ marginTop: 16 }}>
              <ProgressBar pct={Math.round(((m.sent + m.failed) / Math.max(1, m.total - m.suppressed)) * 100)} />
            </div>
          )}
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        {/* Left: editor fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle}>{tt(locale, "Nombre (interno)", "Name (internal)")}</label>
                <input style={inputStyle} value={name} disabled={!editable} onChange={(e) => setName(e.target.value)} maxLength={120} />
              </div>
              <div>
                <label style={labelStyle}>{tt(locale, "Asunto", "Subject")}</label>
                <input style={inputStyle} value={subject} disabled={!editable} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
              </div>
            </div>
          </Card>

          {/* Block composer */}
          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <p style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", margin: 0 }}>{tt(locale, "Contenido", "Content")}</p>
            </div>

            {editable && (
              <>
                {/* Templates */}
                <div style={{ marginBottom: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)", display: "block", marginBottom: 6 }}>
                    {tt(locale, "Empezar desde una plantilla", "Start from a template")}
                  </span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {BLOCK_TEMPLATES.map((t) => (
                      <button key={t.key} type="button" onClick={() => loadTemplate(t.key)}
                        style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink-2)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                        {tt(locale, t.nameEs, t.nameEn)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Merge fields */}
                <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: 10, background: "var(--hover, rgba(47,107,255,0.04))" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)" }}>
                    {tt(locale, "Personalizar (clic para insertar):", "Personalise (click to insert):")}
                  </span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {MERGE_FIELDS.map((f) => (
                      <button key={f.token} type="button" onClick={() => insertMergeField(f.token)}
                        title={tt(locale, f.labelEs, f.labelEn)}
                        style={{ padding: "4px 10px", borderRadius: 8, border: "1px dashed var(--accent)", background: "var(--accent-soft, rgba(47,107,255,0.10))", color: "var(--accent)", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-mono, monospace)" }}>
                        {f.token}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Blocks */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {blocks.map((b, i) => (
                    <BlockEditor
                      key={b.id}
                      block={b}
                      index={i}
                      total={blocks.length}
                      locale={locale}
                      onChange={(next) => updateBlock(b.id, next)}
                      onRemove={() => removeBlock(b.id)}
                      onMove={(dir) => moveBlock(b.id, dir)}
                      onFocusBlock={() => setActiveBlockId(b.id)}
                    />
                  ))}
                  {blocks.length === 0 && (
                    <p style={{ fontSize: 13, color: "var(--ink-3)", textAlign: "center", padding: "12px 0" }}>
                      {tt(locale, "Agrega un bloque para empezar.", "Add a block to start.")}
                    </p>
                  )}
                </div>

                {/* Add block menu */}
                <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 12 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-3)", alignSelf: "center" }}>
                    {tt(locale, "Añadir:", "Add:")}
                  </span>
                  {EMAIL_BLOCK_TYPES.map((type) => (
                    <button key={type} type="button" onClick={() => addBlock(type)}
                      style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid var(--accent)", background: "var(--card)", color: "var(--accent)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                      + {tt(locale, BLOCK_META[type].es, BLOCK_META[type].en)}
                    </button>
                  ))}
                </div>
              </>
            )}
            {!editable && (
              <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>
                {tt(locale, "El contenido ya no es editable.", "The content is no longer editable.")}
              </p>
            )}
          </Card>

          {/* Audience */}
          <Card>
            <p style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)", margin: "0 0 12px" }}>{tt(locale, "Audiencia", "Audience")}</p>
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {(["all_clients", "by_service", "custom", "completed"] as const).map((k) => {
                const active = audKind === k;
                const label =
                  k === "all_clients" ? tt(locale, "Todos", "All")
                  : k === "by_service" ? tt(locale, "Por servicio", "By service")
                  : k === "custom" ? tt(locale, "Personalizada", "Custom")
                  : tt(locale, "Completados (win-back)", "Completed (win-back)");
                return (
                  <button key={k} type="button" disabled={!editable} onClick={() => setAudKind(k)}
                    style={{
                      flex: 1, padding: "9px 10px", borderRadius: 10, cursor: editable ? "pointer" : "default", fontSize: 13, fontWeight: 700,
                      border: active ? "1.5px solid var(--accent)" : "1px solid var(--line)",
                      background: active ? "var(--accent-soft, rgba(47,107,255,0.10))" : "var(--card)",
                      color: active ? "var(--accent)" : "var(--ink-2)", opacity: editable ? 1 : 0.7,
                    }}>
                    {label}
                  </button>
                );
              })}
            </div>

            {audKind === "by_service" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflow: "auto" }}>
                {vm.services.map((s) => (
                  <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink)", cursor: editable ? "pointer" : "default" }}>
                    <input type="checkbox" disabled={!editable} checked={serviceIds.includes(s.id)}
                      onChange={(e) => setServiceIds((prev) => e.target.checked ? [...prev, s.id] : prev.filter((x) => x !== s.id))} />
                    {s.label}
                  </label>
                ))}
                {vm.services.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-3)" }}>{tt(locale, "No hay servicios.", "No services.")}</p>}
              </div>
            )}

            {audKind === "custom" && (
              <div>
                <input style={{ ...inputStyle, marginBottom: 8 }} placeholder={tt(locale, "Buscar cliente…", "Search client…")} value={clientSearch} disabled={!editable} onChange={(e) => setClientSearch(e.target.value)} />
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflow: "auto" }}>
                  {filteredClients.map((c) => (
                    <label key={c.userId} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink)", cursor: editable ? "pointer" : "default" }}>
                      <input type="checkbox" disabled={!editable} checked={userIds.includes(c.userId)}
                        onChange={(e) => setUserIds((prev) => e.target.checked ? [...prev, c.userId] : prev.filter((x) => x !== c.userId))} />
                      {c.name}
                    </label>
                  ))}
                  {filteredClients.length === 0 && <p style={{ fontSize: 13, color: "var(--ink-3)" }}>{tt(locale, "Sin clientes.", "No clients.")}</p>}
                </div>
              </div>
            )}

            {/* Live count */}
            <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: "var(--hover, rgba(47,107,255,0.04))", fontSize: 13 }}>
              {preview ? (
                preview.mailable === 0 ? (
                  <span style={{ color: "var(--gold-deep)", fontWeight: 700 }}>
                    {tt(locale, "Esta campaña no tiene destinatarios.", "This campaign has no recipients.")}
                  </span>
                ) : (
                  <span style={{ color: "var(--ink-2)" }}>
                    <strong style={{ color: "var(--ink)" }}>{preview.mailable}</strong> {tt(locale, "destinatarios", "recipients")}
                    {preview.total - preview.mailable > 0 && (
                      <span title={tt(locale, "Sin email, baja de marketing o rebote", "No email, opted out or bounced")}>
                        {" · "}{preview.total - preview.mailable} {tt(locale, "suprimidos", "suppressed")}
                      </span>
                    )}
                  </span>
                )
              ) : (
                <span style={{ color: "var(--ink-3)" }}>{tt(locale, "Calculando…", "Calculating…")}</span>
              )}
            </div>
          </Card>
        </div>

        {/* Right: preview */}
        <Card style={{ padding: 0, overflow: "hidden", position: "sticky", top: 16, alignSelf: "start" }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)", fontSize: 12, fontWeight: 800, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {tt(locale, "Vista previa", "Preview")}
          </div>
          <iframe
            title={tt(locale, "Vista previa del correo", "Email preview")}
            sandbox=""
            srcDoc={previewHtml}
            style={{ width: "100%", height: 560, border: "none", background: "#f8f9fa" }}
          />
        </Card>
      </div>

      {/* Sticky action bar (draft only) */}
      {editable && (
        <div
          style={{
            position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 30,
            background: "var(--card)", borderTop: "1px solid var(--line)",
            padding: "12px 32px", display: "flex", gap: 12, justifyContent: "flex-end", alignItems: "center",
          }}
        >
          {preview && preview.mailable > 0 && (
            <span style={{ marginRight: "auto", fontSize: 13, color: "var(--ink-2)" }}>
              {preview.mailable} {tt(locale, "destinatarios", "recipients")}
            </span>
          )}
          <GhostBtn size="md" full={false} onClick={() => saveDraft()} disabled={saving} style={{ height: 40, padding: "0 16px", borderRadius: 999 }}>
            {saving ? tt(locale, "Guardando…", "Saving…") : tt(locale, "Guardar", "Save")}
          </GhostBtn>
          <GhostBtn size="md" full={false} onClick={handleSendTest} style={{ height: 40, padding: "0 16px", borderRadius: 999 }}>
            <Icon name="send" size={15} color="var(--accent)" /> {tt(locale, "Enviarme prueba", "Send me a test")}
          </GhostBtn>
          <GhostBtn size="md" full={false} onClick={() => setScheduleOpen(true)} disabled={!audienceValid} style={{ height: 40, padding: "0 16px", borderRadius: 999 }}>
            <Icon name="calendar" size={15} color="var(--accent)" /> {tt(locale, "Programar", "Schedule")}
          </GhostBtn>
          <GradientBtn size="md" full={false} onClick={handleSendNow} disabled={!audienceValid} style={{ height: 40, padding: "0 20px", borderRadius: 999 }}>
            {tt(locale, "Enviar ahora", "Send now")}
          </GradientBtn>
        </div>
      )}

      {/* Schedule modal */}
      <Modal
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        title={tt(locale, "Programar envío", "Schedule send")}
        footer={
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <GhostBtn size="md" full={false} onClick={() => setScheduleOpen(false)} style={{ height: 40, padding: "0 18px" }}>
              {tt(locale, "Cancelar", "Cancel")}
            </GhostBtn>
            <GradientBtn size="md" full={false} onClick={handleSchedule} style={{ height: 40, padding: "0 20px" }}>
              {tt(locale, "Programar", "Schedule")}
            </GradientBtn>
          </div>
        }
      >
        <label style={labelStyle}>{tt(locale, "Fecha y hora", "Date and time")}</label>
        <input style={inputStyle} type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
      </Modal>
    </div>
  );
}
