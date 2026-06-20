"use client";

import * as React from "react";
import { Icon, GradientBtn, GhostBtn, Lex } from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";
import { I18nField } from "../shared/i18n-field";
import { QuestionCard } from "./question-card";
import { PdfViewer } from "./pdf-viewer";
import type { FormEditorVM, QuestionGroupVM, QuestionVM, FormEditorActions } from "./types";
import type { FormEditorStrings } from "./strings";

/**
 * StructureEditor — the two-panel "Estructurar" stage (DOC-53 §5.1.2).
 *
 * LEFT: accordion of groups (drag-orderable) with question cards. RIGHT: the PDF
 * viewer with field overlays synced to selection. Autosave per field via the
 * injected actions; the mapping counter and legend live on the viewer.
 */

export interface StructureEditorProps {
  vm: FormEditorVM;
  groups: QuestionGroupVM[];
  setGroups: React.Dispatch<React.SetStateAction<QuestionGroupVM[]>>;
  pdfUrl: string | null;
  versionId: string;
  readOnly: boolean;
  lang: "es" | "en";
  strings: FormEditorStrings;
  actions: FormEditorActions;
}

export function StructureEditor({
  vm,
  groups,
  setGroups,
  pdfUrl,
  versionId,
  readOnly,
  strings,
  actions,
}: StructureEditorProps) {
  const [expandedQ, setExpandedQ] = React.useState<string | null>(null);
  const [selectedField, setSelectedField] = React.useState<string | null>(null);
  const [savingFlash, setSavingFlash] = React.useState(false);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiMenuOpen, setAiMenuOpen] = React.useState(false);
  const [openGroups, setOpenGroups] = React.useState<Set<string>>(() => new Set(groups.map((g) => g.id)));

  const detectedFields = vm.openVersion?.version.detected_fields ?? [];
  const allQuestions = groups.flatMap((g) => g.questions);
  const mappedNames = React.useMemo(() => {
    const s = new Set<string>();
    for (const q of allQuestions) if (q.pdf_field_name) s.add(q.pdf_field_name);
    return s;
  }, [allQuestions]);

  // Duplicate-mapping detection (E2 inline warning).
  const dupNames = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const q of allQuestions) if (q.pdf_field_name) counts.set(q.pdf_field_name, (counts.get(q.pdf_field_name) ?? 0) + 1);
    return new Set([...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n));
  }, [allQuestions]);

  const groupChoices = groups.map((g) => ({ id: g.id, label: g.title_i18n.es || g.title_i18n.en || "Grupo" }));

  function flashSaved() {
    setSavingFlash(true);
    window.setTimeout(() => setSavingFlash(false), 1500);
  }

  // --- Clicking a PDF field: if a question is being edited, ASSIGN the field to
  // it ("click the box on the PDF where this answer goes"). Otherwise, jump to the
  // question already mapped to that field. (Read-only published versions never assign.)
  function handleSelectField(name: string) {
    setSelectedField(name);
    if (expandedQ && !readOnly) {
      const target = allQuestions.find((x) => x.id === expandedQ);
      if (target) {
        if (target.pdf_field_name !== name) {
          patchQuestion(target, { pdf_field_name: name });
          toast.success(strings.fieldAssigned);
        }
        return;
      }
    }
    const q = allQuestions.find((x) => x.pdf_field_name === name);
    if (q) setExpandedQ(q.id);
  }

  // --- Group operations ---
  async function addGroup() {
    const position = groups.length;
    const r = await actions.upsertGroup({ automation_version_id: versionId, title_i18n: { es: "Nuevo grupo", en: "New group" }, position });
    if (!r.success) return toast.error(r.error?.code ?? "Error");
    const id = r.data!.id;
    setGroups((g) => [...g, { id, automation_version_id: versionId, title_i18n: { es: "Nuevo grupo", en: "New group" }, position, questions: [] }]);
    setOpenGroups((s) => new Set(s).add(id));
    flashSaved();
  }

  async function renameGroup(groupId: string, title_i18n: { es?: string; en?: string }) {
    setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, title_i18n } : g)));
    const r = await actions.upsertGroup({ id: groupId, automation_version_id: versionId, title_i18n: title_i18n as Record<string, string> });
    if (r.success) flashSaved();
  }

  async function deleteGroup(groupId: string) {
    const g = groups.find((x) => x.id === groupId);
    if (g && g.questions.length > 0 && !window.confirm(strings.deleteGroupConfirm)) return;
    const r = await actions.deleteGroup(groupId);
    if (!r.success) return toast.error(r.error?.code ?? "Error");
    setGroups((gs) => gs.filter((x) => x.id !== groupId));
    flashSaved();
  }

  async function reproposeGroup(groupId: string) {
    setAiBusy(true);
    const r = await actions.aiPropose({ version_id: versionId, group_id: groupId, mode: "merge" });
    setAiBusy(false);
    if (!r.success) return toast.error(strings.aiFailed);
    toast.success(`${r.data!.questions}`);
    window.location.reload();
  }

  // --- Question operations ---
  async function addQuestion(groupId: string) {
    const group = groups.find((g) => g.id === groupId)!;
    const position = group.questions.length;
    const draft: Record<string, unknown> = {
      group_id: groupId,
      question_i18n: { es: "", en: "" },
      help_i18n: null,
      field_type: "text",
      options: null,
      pdf_field_name: null,
      source: "client_answer",
      source_ref: null,
      is_required: true,
      position,
      validation: null,
    };
    const r = await actions.upsertQuestion(draft);
    if (!r.success) return toast.error(r.error?.code ?? "Error");
    const id = r.data!.id;
    const q: QuestionVM = { ...(draft as unknown as QuestionVM), id, group_id: groupId };
    setGroups((gs) => gs.map((g) => (g.id === groupId ? { ...g, questions: [...g.questions, q] } : g)));
    setExpandedQ(id);
    flashSaved();
  }

  async function patchQuestion(q: QuestionVM, patch: Partial<QuestionVM>) {
    const next = { ...q, ...patch };
    setGroups((gs) => gs.map((g) => (g.id === q.group_id ? { ...g, questions: g.questions.map((x) => (x.id === q.id ? next : x)) } : g)));
    // Persist (autosave per field). source_ref/options carried through.
    const r = await actions.upsertQuestion({
      id: next.id,
      group_id: next.group_id,
      question_i18n: next.question_i18n,
      help_i18n: next.help_i18n.es || next.help_i18n.en ? next.help_i18n : null,
      field_type: next.field_type,
      options: next.field_type === "select" ? next.options : null,
      pdf_field_name: next.pdf_field_name,
      source: next.source,
      source_ref: next.source_ref,
      is_required: next.is_required,
      position: next.position,
      validation: next.validation,
      // Only persist a fully-formed condition (a controlling question is set);
      // a half-configured one would fail server validation and block the save.
      condition: next.condition && next.condition.when?.question ? next.condition : null,
    });
    if (r.success) flashSaved();
    else if (r.error) toast.error(r.error.code);
  }

  async function deleteQuestion(q: QuestionVM) {
    const r = await actions.deleteQuestion(q.id);
    if (!r.success) return toast.error(r.error?.code ?? "Error");
    setGroups((gs) => gs.map((g) => (g.id === q.group_id ? { ...g, questions: g.questions.filter((x) => x.id !== q.id) } : g)));
    flashSaved();
  }

  async function moveQuestion(q: QuestionVM, toGroupId: string) {
    await patchQuestion(q, { group_id: toGroupId });
    setGroups((gs) => {
      const without = gs.map((g) => ({ ...g, questions: g.questions.filter((x) => x.id !== q.id) }));
      return without.map((g) => (g.id === toGroupId ? { ...g, questions: [...g.questions, { ...q, group_id: toGroupId }] } : g));
    });
  }

  async function runAiPropose(mode: "replace" | "merge") {
    setAiMenuOpen(false);
    setAiBusy(true);
    const r = await actions.aiPropose({ version_id: versionId, mode });
    setAiBusy(false);
    if (!r.success) return toast.error(strings.aiFailed);
    window.location.reload();
  }

  return (
    <div style={{ position: "relative" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        {!readOnly && (
          <div style={{ position: "relative" }}>
            <GradientBtn size="md" full={false} onClick={() => setAiMenuOpen((o) => !o)}>
              {strings.aiPropose}
              <Icon name="chevD" size={15} />
            </GradientBtn>
            {aiMenuOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 30, background: "var(--card,#fff)", border: "1px solid var(--line)", borderRadius: 12, boxShadow: "var(--shadow-md, 0 8px 28px rgba(7,17,33,.16))", overflow: "hidden", minWidth: 220 }}>
                <MenuItem label={strings.aiModeReplace} onClick={() => runAiPropose("replace")} />
                <MenuItem label={strings.aiModeMerge} onClick={() => runAiPropose("merge")} />
              </div>
            )}
          </div>
        )}
        {!readOnly && <GhostBtn size="md" full={false} onClick={addGroup}>{strings.addGroup}</GhostBtn>}
        <div style={{ flex: 1 }} />
        {savingFlash && (
          <span style={{ fontSize: 12, color: "var(--ink-3)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="check" size={13} /> {strings.autosaved}
          </span>
        )}
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-2)" }}>
          {strings.mappedCounter.replace("{n}", String(mappedNames.size)).replace("{total}", String(detectedFields.length))}
        </span>
      </div>

      {/* Two-panel grid */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.05fr)", gap: 16, alignItems: "start" }}>
        {/* LEFT — groups + questions */}
        <div style={{ minWidth: 0 }}>
          {groups.length === 0 && (
            <div style={{ textAlign: "center", padding: "32px 16px", color: "var(--ink-2)" }}>
              <Lex mood="calma" size={92} />
              <p style={{ fontSize: 13.5, marginTop: 10 }}>{strings.structureEmpty}</p>
            </div>
          )}
          {groups.map((group) => (
            <GroupAccordion
              key={group.id}
              group={group}
              open={openGroups.has(group.id)}
              readOnly={readOnly}
              strings={strings}
              onToggleOpen={() =>
                setOpenGroups((s) => {
                  const n = new Set(s);
                  if (n.has(group.id)) n.delete(group.id);
                  else n.add(group.id);
                  return n;
                })
              }
              onRename={(t) => renameGroup(group.id, t)}
              onDelete={() => deleteGroup(group.id)}
              onRepropose={() => reproposeGroup(group.id)}
              onAddQuestion={() => addQuestion(group.id)}
            >
              {group.questions.map((q) => (
                <QuestionCard
                  key={q.id}
                  question={q}
                  expanded={expandedQ === q.id}
                  selected={selectedField !== null && q.pdf_field_name === selectedField}
                  duplicateMapping={q.pdf_field_name !== null && dupNames.has(q.pdf_field_name)}
                  detectedFields={detectedFields}
                  sources={vm.sources}
                  groups={groupChoices}
                  siblingQuestions={allQuestions
                    .filter((x) => x.id !== q.id)
                    .map((x) => ({ id: x.id, label: x.question_i18n.es || x.question_i18n.en || x.pdf_field_name || "Pregunta" }))}
                  strings={strings}
                  readOnly={readOnly}
                  onToggle={() => {
                    setExpandedQ((e) => (e === q.id ? null : q.id));
                    setSelectedField(q.pdf_field_name);
                  }}
                  onChange={(patch) => patchQuestion(q, patch)}
                  onDelete={() => deleteQuestion(q)}
                  onMoveToGroup={(gid) => moveQuestion(q, gid)}
                  onFocusField={setSelectedField}
                />
              ))}
            </GroupAccordion>
          ))}
        </div>

        {/* RIGHT — PDF viewer */}
        <div style={{ position: "sticky", top: 12, height: "calc(100dvh - 220px)", minHeight: 460 }}>
          <PdfViewer
            src={pdfUrl}
            fields={detectedFields}
            mappedNames={mappedNames}
            selectedField={selectedField}
            onSelectField={handleSelectField}
            strings={strings}
          />
        </div>
      </div>

      {/* AI overlay (up to 180s) */}
      {aiBusy && (
        <div
          role="status"
          aria-live="polite"
          style={{ position: "fixed", inset: 0, zIndex: 60, background: "color-mix(in srgb, var(--navy) 55%, transparent)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div style={{ background: "var(--card,#fff)", borderRadius: 20, padding: "28px 32px", textAlign: "center", maxWidth: 380, boxShadow: "var(--shadow-lg, 0 20px 60px rgba(7,17,33,.3))" }}>
            <Lex mood="atento" size={120} />
            <p style={{ fontSize: 14, color: "var(--ink)", marginTop: 12, lineHeight: 1.45 }}>{strings.aiOverlay}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", padding: "11px 14px", fontSize: 13, color: "var(--ink)", cursor: "pointer" }}>
      {label}
    </button>
  );
}

function GroupAccordion({
  group,
  open,
  readOnly,
  strings,
  onToggleOpen,
  onRename,
  onDelete,
  onRepropose,
  onAddQuestion,
  children,
}: {
  group: QuestionGroupVM;
  open: boolean;
  readOnly: boolean;
  strings: FormEditorStrings;
  onToggleOpen: () => void;
  onRename: (t: { es?: string; en?: string }) => void;
  onDelete: () => void;
  onRepropose: () => void;
  onAddQuestion: () => void;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);

  return (
    <div style={{ borderRadius: 16, border: "1px solid var(--line)", background: "var(--panel-2, var(--card-alt))", marginBottom: 12, overflow: "visible" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
        <button type="button" onClick={onToggleOpen} aria-expanded={open} aria-label={open ? "Cerrar grupo" : "Abrir grupo"} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--ink-3)", display: "inline-flex", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }}>
          <Icon name="chevR" size={16} />
        </button>
        <span aria-hidden style={{ color: "var(--ink-3)", display: "inline-flex" }}><Icon name="route" size={15} /></span>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>
          {group.title_i18n.es || group.title_i18n.en || "Grupo"}
        </span>
        {!readOnly && (
          <div style={{ position: "relative" }}>
            <button type="button" onClick={() => setMenuOpen((o) => !o)} aria-label="Menú del grupo" style={{ border: "none", background: "none", cursor: "pointer", color: "var(--ink-2)", display: "inline-flex" }}>
              <Icon name="gear" size={16} />
            </button>
            {menuOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 25, background: "var(--card,#fff)", border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow-md, 0 8px 28px rgba(7,17,33,.16))", minWidth: 200, overflow: "hidden" }}>
                <MenuItem label={strings.renameGroup} onClick={() => { setRenaming(true); setMenuOpen(false); }} />
                <MenuItem label={strings.reproposeGroup} onClick={() => { onRepropose(); setMenuOpen(false); }} />
                <MenuItem label={strings.deleteGroup} onClick={() => { onDelete(); setMenuOpen(false); }} />
              </div>
            )}
          </div>
        )}
      </div>

      {renaming && (
        <div style={{ padding: "0 12px 12px" }}>
          <I18nField label={strings.renameGroup} value={group.title_i18n} onChange={onRename} />
          <GhostBtn onClick={() => setRenaming(false)}>OK</GhostBtn>
        </div>
      )}

      {open && (
        <div style={{ padding: "0 12px 12px" }}>
          {children}
          {!readOnly && (
            <button type="button" onClick={onAddQuestion} style={{ marginTop: 4, border: "1.5px dashed var(--line)", background: "none", borderRadius: 12, padding: "9px 12px", width: "100%", color: "var(--accent)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              {strings.addQuestion}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
