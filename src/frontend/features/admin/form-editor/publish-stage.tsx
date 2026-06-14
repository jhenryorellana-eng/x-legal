"use client";

import * as React from "react";
import { GradientBtn, Icon, Lex } from "@/frontend/components/brand";
import { toast } from "@/frontend/components/desktop";
import type { FormEditorActions } from "./types";
import type { FormEditorStrings } from "./strings";

/**
 * PublishStage — stage 4 (DOC-53 §5.1.4).
 *
 * Runs publishVersion (which returns the PublicationCheck). Blocking issues
 * (red dot) disable the CTA; warnings (gold dot) require the "acknowledge
 * unmapped" checkbox. On success → green banner.
 */

interface Issue {
  code: string;
  severity: "blocking" | "warning";
  detail: string;
}

export interface PublishStageProps {
  versionId: string;
  versionNumber: number;
  strings: FormEditorStrings;
  actions: FormEditorActions;
}

export function PublishStage({ versionId, versionNumber, strings, actions }: PublishStageProps) {
  const [issues, setIssues] = React.useState<Issue[] | null>(null);
  const [ack, setAck] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [published, setPublished] = React.useState(false);

  // Dry-run the check on mount (publish with ack=false returns the issues only).
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const r = await actions.publish({ version_id: versionId, acknowledge_unmapped: false });
      if (cancelled) return;
      if (r.success && r.data) {
        if (r.data.ok) setPublished(true);
        else setIssues(r.data.issues);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionId]);

  const blocking = (issues ?? []).filter((i) => i.severity === "blocking");
  const warnings = (issues ?? []).filter((i) => i.severity === "warning");
  const canPublish = blocking.length === 0 && (warnings.length === 0 || ack);

  async function doPublish() {
    setBusy(true);
    const r = await actions.publish({ version_id: versionId, acknowledge_unmapped: ack });
    setBusy(false);
    if (!r.success) return toast.error(r.error?.code ?? "Error");
    if (r.data?.ok) {
      setPublished(true);
    } else {
      setIssues(r.data?.issues ?? []);
      toast.error("Revisa la lista de publicación");
    }
  }

  if (published) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <Lex mood="celebra" size={120} />
        <div style={{ marginTop: 16, background: "var(--green-soft)", border: "1px solid var(--green)", borderRadius: 16, padding: "16px 20px", display: "inline-block", maxWidth: 460 }}>
          <p style={{ margin: 0, fontSize: 14, color: "var(--green)", fontWeight: 700, lineHeight: 1.5 }}>
            <Icon name="check" size={16} /> {strings.publishedBanner.replace("{n}", String(versionNumber))}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h3 style={{ fontSize: 16, fontWeight: 800, color: "var(--ink)", margin: "0 0 16px" }}>{strings.publishTitle}</h3>

      {issues === null && <p style={{ color: "var(--ink-3)", fontSize: 13 }}>…</p>}

      {issues && blocking.length === 0 && warnings.length === 0 && (
        <p style={{ fontSize: 13.5, color: "var(--green)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="check" size={15} /> {strings.allClear}
        </p>
      )}

      {blocking.length > 0 && (
        <ChecklistGroup title={strings.publishBlocking} dot="var(--red)">
          {blocking.map((i, idx) => <ChecklistRow key={idx} dot="var(--red)" detail={i.detail} code={i.code} />)}
        </ChecklistGroup>
      )}

      {warnings.length > 0 && (
        <ChecklistGroup title={strings.publishWarnings} dot="var(--gold-deep)">
          {warnings.map((i, idx) => <ChecklistRow key={idx} dot="var(--gold-deep)" detail={i.detail} code={i.code} />)}
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10, cursor: "pointer" }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 18, height: 18, marginTop: 1 }} />
            <span style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.4 }}>{strings.ackUnmapped}</span>
          </label>
        </ChecklistGroup>
      )}

      <div style={{ marginTop: 22 }}>
        <GradientBtn onClick={doPublish} disabled={!canPublish || busy}>
          {strings.publishBtn.replace("{n}", String(versionNumber))}
        </GradientBtn>
      </div>
    </div>
  );
}

function ChecklistGroup({ title, children }: { title: string; dot: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h4 style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)", margin: "0 0 10px" }}>{title}</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

function ChecklistRow({ dot, detail, code }: { dot: string; detail: string; code: string }) {
  const [showCode, setShowCode] = React.useState(false);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, background: "var(--panel-2, var(--card-alt))", borderRadius: 12, padding: "10px 12px" }}>
      <span style={{ width: 9, height: 9, borderRadius: 99, background: dot, marginTop: 5, flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink)" }}>{detail}</p>
        {showCode && <code style={{ fontSize: 11, color: "var(--ink-3)" }}>{code}</code>}
      </div>
      <button type="button" onClick={() => setShowCode((s) => !s)} aria-label="Ver código técnico" style={{ border: "none", background: "var(--chip)", borderRadius: 6, padding: "2px 6px", fontSize: 10, color: "var(--ink-3)", cursor: "pointer" }}>{"</>"}</button>
    </div>
  );
}
