"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Chip, Icon, IconTile } from "@/frontend/components/brand";
import { ScreenHead } from "@/frontend/components/mobile/screen-head";
import type { DemoFlow } from "../use-demo-flow";

/**
 * FormulariosStage — replica of the client Formularios list (DOC-51). Each form
 * is shown already 100% complete with a "Revisar" action that opens the review
 * panel; submitted forms read "Enviado".
 */
export function FormulariosStage({ flow }: { flow: DemoFlow }) {
  const t = useTranslations("cliente.formularios");
  const td = useTranslations("staff.demo");
  const { state, actions, scenario } = flow;

  return (
    <div style={{ minHeight: "100%", padding: "16px 20px 130px" }}>
      <ScreenHead
        eyebrow={t("eyebrow")}
        title={t("title")}
        sub="Tus formularios ya están completos. Revísalos y envíalos."
        lexMood="atento"
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {scenario.forms.map((form) => {
          const sent = state.sentForms.includes(form.id);
          return (
            <div
              key={form.id}
              className="mp-lift"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                background: "var(--card)",
                border: "1px solid var(--line)",
                borderRadius: 22,
                padding: 16,
                boxShadow: "0 10px 30px rgba(11,27,51,0.06)",
              }}
            >
              <IconTile name="form" color="var(--accent)" size={48} radius={14} iconSize={25} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t-title" style={{ fontSize: 16, fontWeight: 800, color: "var(--navy)" }}>
                  {form.label}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 600, marginTop: 1, lineHeight: 1.35 }}>
                  {form.caption}
                </div>
                <div style={{ marginTop: 8 }}>
                  {sent ? (
                    <Chip tone="green" dot>
                      {t("submitted")}
                    </Chip>
                  ) : (
                    <Chip tone="green" dot>
                      {td("completeLabel")}
                    </Chip>
                  )}
                </div>
              </div>
              {sent ? (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    color: "var(--green)",
                    fontFamily: "var(--font-title)",
                    fontWeight: 800,
                    fontSize: 13.5,
                    flexShrink: 0,
                  }}
                >
                  <Icon name="check" size={17} color="var(--green)" stroke={2.8} />
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => actions.review(form.id)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    background: "var(--accent)",
                    color: "#fff",
                    border: "none",
                    cursor: "pointer",
                    borderRadius: 999,
                    padding: "10px 16px",
                    fontFamily: "var(--font-title)",
                    fontWeight: 800,
                    fontSize: 13.5,
                    flexShrink: 0,
                    boxShadow: "0 6px 16px color-mix(in srgb, var(--accent) 27%, transparent)",
                  }}
                >
                  {td("reviewForm")}
                  <Icon name="chevR" size={16} color="#fff" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
