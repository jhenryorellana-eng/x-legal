"use client";

import * as React from "react";
import { Icon } from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";
import { StructureEditor } from "./structure-editor";
import { PublishStage } from "./publish-stage";
import { VersionChips } from "./pdf-mode";
import type { FormEditorVM, FormEditorActions, QuestionGroupVM } from "./types";
import type { FormEditorStrings } from "./strings";

/**
 * QuestionnaireMode — editor for the PDF-less `questionnaire` kind (Etapa B).
 *
 * A companion questionnaire of an ai_letter: its answers feed the generation. Same
 * question infra as pdf_automation (groups/questions, AI-field sources, conditions)
 * but with NO PDF — so just two stages: Estructurar (full-width StructureEditor,
 * noPdf) and Publicar. Immutable published versions get a "make editable" action.
 */

const STAGES = [
  { id: "structure", key: "stageStructure" },
  { id: "publish", key: "stagePublish" },
] as const;
type StageId = (typeof STAGES)[number]["id"];

export interface QuestionnaireModeProps {
  vm: FormEditorVM;
  strings: FormEditorStrings;
  actions: FormEditorActions;
  activeVersionId: string | null;
  onSelectVersion: (id: string) => void;
}

export function QuestionnaireMode({ vm, strings, actions, activeVersionId, onSelectVersion }: QuestionnaireModeProps) {
  const open = vm.openVersion;
  const readOnly = !!open && open.version.status !== "draft";
  const [stage, setStage] = React.useState<StageId>("structure");
  const [groups, setGroups] = React.useState<QuestionGroupVM[]>(open?.groups ?? []);
  const [duplicating, setDuplicating] = React.useState(false);

  React.useEffect(() => {
    setGroups(open?.groups ?? []);
  }, [open?.version.id, open?.groups]);

  async function handleDuplicate() {
    if (!open) return;
    setDuplicating(true);
    const r = await actions.duplicateVersion(open.version.id);
    if (r.success && r.data) {
      window.location.href = `${window.location.pathname}?v=${r.data.id}`;
    } else {
      setDuplicating(false);
      toast.error(r.error?.code ?? "Error");
    }
  }

  return (
    <div>
      <VersionChips versions={vm.versions} activeId={activeVersionId} onSelect={onSelectVersion} strings={strings} />

      {readOnly && (
        <div style={{ marginTop: 12, marginBottom: 4, display: "flex", alignItems: "center", gap: 10, background: "var(--gold-soft)", border: "1px solid var(--gold-deep)", borderRadius: 12, padding: "10px 14px" }}>
          <Icon name="lock" size={15} />
          <span style={{ flex: 1, fontSize: 13, color: "var(--gold-deep)", fontWeight: 600 }}>{strings.immutableBanner}</span>
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={duplicating}
            style={{ flexShrink: 0, height: 32, padding: "0 14px", borderRadius: 999, border: "none", background: "var(--gold-deep)", color: "#fff", fontSize: 12.5, fontWeight: 800, cursor: duplicating ? "default" : "pointer", opacity: duplicating ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Icon name="copy" size={13} color="#fff" /> {duplicating ? strings.saving : strings.editableCopy}
          </button>
        </div>
      )}

      {/* 2-stage bar */}
      <div style={{ display: "flex", gap: 8, margin: "18px 0 22px", flexWrap: "wrap" }}>
        {STAGES.map((s, i) => {
          const on = stage === s.id;
          const reachable = !!open;
          return (
            <button
              key={s.id}
              type="button"
              disabled={!reachable}
              onClick={() => reachable && setStage(s.id)}
              aria-current={on ? "step" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                height: 40,
                padding: "0 16px",
                borderRadius: 12,
                border: `1.5px solid ${on ? "transparent" : "var(--line)"}`,
                background: on ? "linear-gradient(120deg, var(--accent), var(--brand-navy))" : "var(--card,#fff)",
                color: on ? "#fff" : reachable ? "var(--ink)" : "var(--ink-3)",
                fontWeight: 800,
                fontSize: 13.5,
                cursor: reachable ? "pointer" : "not-allowed",
                opacity: reachable ? 1 : 0.55,
              }}
            >
              <span style={{ width: 22, height: 22, borderRadius: 99, background: on ? "rgba(255,255,255,.22)" : "var(--chip)", color: on ? "#fff" : "var(--ink-2)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{i + 1}</span>
              {strings[s.key]}
            </button>
          );
        })}
      </div>

      {stage === "structure" && open && (
        <StructureEditor
          vm={vm}
          groups={groups}
          setGroups={setGroups}
          pdfUrl={null}
          versionId={open.version.id}
          readOnly={readOnly}
          lang="es"
          strings={strings}
          actions={actions}
          noPdf
        />
      )}

      {stage === "publish" && open && (
        <PublishStage
          versionId={open.version.id}
          versionNumber={open.version.version}
          strings={strings}
          actions={actions}
        />
      )}
    </div>
  );
}
