"use client";

/**
 * CampanasListView — `/finanzas/campanas` list (Andrium · marketing).
 * DOC-55 §4.1, RF-AND-034. Boundaries: no @/backend imports.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, GradientBtn, Chip, Icon, Lex, type ChipTone } from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";

export type CampaignStatusVM =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export interface CampaignSummaryVM {
  id: string;
  name: string;
  subject: string;
  status: CampaignStatusVM;
  audienceKind: "all_clients" | "by_service" | "custom";
  scheduledAt: string | null;
  sentCount: number;
  createdAt: string;
}

export interface CampanasListVM {
  items: CampaignSummaryVM[];
  nextCursor: string | null;
  locale: "es" | "en";
}

export interface CampaignResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: { code: string };
}

export interface CampanasListViewProps {
  vm: CampanasListVM;
  actions: {
    create: (input: {
      name: string;
      subject: string;
      bodyHtml: string;
      audience: { kind: "all_clients" };
    }) => Promise<CampaignResult<{ id: string }>>;
  };
}

function tt(locale: "es" | "en", es: string, en: string) {
  return locale === "es" ? es : en;
}

const STATUS_META: Record<CampaignStatusVM, { tone: ChipTone; es: string; en: string }> = {
  draft: { tone: "blue", es: "Borrador", en: "Draft" },
  scheduled: { tone: "blue", es: "Programada", en: "Scheduled" },
  sending: { tone: "gold", es: "Enviando…", en: "Sending…" },
  sent: { tone: "green", es: "Enviada", en: "Sent" },
  failed: { tone: "red", es: "Fallida", en: "Failed" },
  cancelled: { tone: "amber", es: "Cancelada", en: "Cancelled" },
};

function audienceLabel(kind: CampaignSummaryVM["audienceKind"], locale: "es" | "en") {
  if (kind === "all_clients") return tt(locale, "Todos los clientes", "All clients");
  if (kind === "by_service") return tt(locale, "Por servicio", "By service");
  return tt(locale, "Personalizada", "Custom");
}

export function CampanasListView({ vm, actions }: CampanasListViewProps) {
  const router = useRouter();
  const locale = vm.locale;
  const [creating, setCreating] = React.useState(false);

  async function handleNew() {
    setCreating(true);
    const res = await actions.create({
      name: tt(locale, "Nueva campaña", "New campaign"),
      subject: tt(locale, "Asunto de la campaña", "Campaign subject"),
      bodyHtml: `<p>${tt(locale, "Escribe aquí el contenido de tu campaña…", "Write your campaign content here…")}</p>`,
      audience: { kind: "all_clients" },
    });
    setCreating(false);
    if (res.ok && res.data) {
      router.push(`/finanzas/campanas/${res.data.id}`);
    } else {
      toast.error(tt(locale, "No se pudo crear la campaña", "Could not create the campaign"));
    }
  }

  return (
    <div style={{ padding: "32px 32px 48px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--ink)", margin: 0, fontFamily: "var(--font-title)" }}>
          {tt(locale, "Campañas de email", "Email campaigns")}
        </h1>
        <GradientBtn size="md" full={false} onClick={handleNew} disabled={creating} style={{ height: 40, padding: "0 18px", borderRadius: 999 }}>
          <Icon name="plus" size={16} color="#fff" /> {tt(locale, "Nueva campaña", "New campaign")}
        </GradientBtn>
      </div>

      {vm.items.length === 0 ? (
        <Card style={{ padding: "48px 0", textAlign: "center" }}>
          <Lex mood="señala" size={92} />
          <p style={{ marginTop: 16, fontWeight: 700, color: "var(--ink)" }}>
            {tt(locale, "Aún no hay campañas", "No campaigns yet")}
          </p>
          <p style={{ marginTop: 6, color: "var(--ink-2)" }}>
            {tt(locale, "Crea tu primera campaña para enviar novedades a tus clientes.", "Create your first campaign to send updates to your clients.")}
          </p>
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 1.6fr 110px 130px 90px 60px",
              gap: 10,
              padding: "10px 16px",
              background: "var(--hover, rgba(47,107,255,0.04))",
              borderBottom: "1px solid var(--line)",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.05em",
              color: "var(--ink-3)",
              textTransform: "uppercase",
            }}
          >
            <span>{tt(locale, "Nombre", "Name")}</span>
            <span>{tt(locale, "Asunto", "Subject")}</span>
            <span>{tt(locale, "Audiencia", "Audience")}</span>
            <span>{tt(locale, "Estado", "Status")}</span>
            <span style={{ textAlign: "right" }}>{tt(locale, "Enviados", "Sent")}</span>
            <span />
          </div>

          {vm.items.map((c) => {
            const meta = STATUS_META[c.status];
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => router.push(`/finanzas/campanas/${c.id}`)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1.6fr 110px 130px 90px 60px",
                  gap: 10,
                  alignItems: "center",
                  width: "100%",
                  textAlign: "left",
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--line)",
                  background: "none",
                  border: "none",
                  borderBottomStyle: "solid",
                  cursor: "pointer",
                  color: "var(--ink)",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                <span style={{ fontSize: 13, color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.subject}</span>
                <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{audienceLabel(c.audienceKind, locale)}</span>
                <span><Chip tone={meta.tone}>{tt(locale, meta.es, meta.en)}</Chip></span>
                <span style={{ textAlign: "right", fontSize: 13, fontWeight: 700 }}>{c.sentCount || "—"}</span>
                <span style={{ textAlign: "right" }}><Icon name="chevR" size={16} color="var(--ink-3)" /></span>
              </button>
            );
          })}
        </Card>
      )}

      {vm.nextCursor && (
        <p style={{ textAlign: "center", marginTop: 16, color: "var(--ink-3)", fontSize: 13 }}>
          {tt(locale, "Mostrando las campañas más recientes.", "Showing the most recent campaigns.")}
        </p>
      )}
    </div>
  );
}
