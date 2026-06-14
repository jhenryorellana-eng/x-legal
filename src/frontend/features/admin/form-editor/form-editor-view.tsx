"use client";

import * as React from "react";
import { Icon, Chip } from "@/frontend/components/brand";
import { PdfMode } from "./pdf-mode";
import { AiLetterMode } from "./ai-letter-mode";
import type { FormEditorVM, FormEditorActions } from "./types";
import type { FormEditorStrings } from "./strings";

/**
 * FormEditorView — the form editor shell (DOC-53 §5). Breadcrumb header
 * (Service → Phase → Form) + version/mode chips, then the mode body:
 * PdfMode (pdf_automation) or AiLetterMode (ai_letter).
 */

export interface FormEditorViewProps {
  vm: FormEditorVM;
  strings: FormEditorStrings;
  actions: FormEditorActions;
  lang: "es" | "en";
  datasetsHref: string;
}

export function FormEditorView({ vm, strings, actions, lang, datasetsHref }: FormEditorViewProps) {
  const [activeVersionId, setActiveVersionId] = React.useState<string | null>(vm.openVersion?.version.id ?? null);

  const pick = (v: { es?: string; en?: string }) => (lang === "es" ? v.es : v.en) || v.es || v.en || "";
  const isPdf = vm.form.kind === "pdf_automation";

  return (
    <div style={{ padding: 28 }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-3)", marginBottom: 6 }}>
        <span>{pick(vm.form.serviceLabel)}</span>
        <Icon name="chevR" size={13} />
        <span>{strings.stageStructure /* phase placeholder; phase label resolved by host */}</span>
        <Icon name="chevR" size={13} />
        <span style={{ color: "var(--ink)", fontWeight: 700 }}>{pick(vm.form.label)}</span>
      </div>

      {/* Title + kind chip */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontFamily: "var(--font-title)", fontWeight: 900, fontSize: 24, letterSpacing: "-0.02em", color: "var(--navy)" }}>
          {pick(vm.form.label) || vm.form.slug}
        </h1>
        {isPdf ? <Chip tone="blue">PDF oficial</Chip> : <Chip tone="gold">Generación IA</Chip>}
      </div>

      {isPdf ? (
        <PdfMode
          vm={vm}
          strings={strings}
          actions={actions}
          activeVersionId={activeVersionId}
          onSelectVersion={(id) => {
            setActiveVersionId(id);
            // Reload with the version param so the RSC re-reads the chosen tree.
            const url = new URL(window.location.href);
            url.searchParams.set("v", id);
            window.location.href = url.toString();
          }}
        />
      ) : (
        <AiLetterMode vm={vm} strings={strings} actions={actions} datasetsHref={datasetsHref} />
      )}
    </div>
  );
}
