"use client";

/**
 * Mis clientes — case list (DOC-52 §5.1, RF-VAN-039).
 *
 * Each row is a case (1 contract = 1 case). By-case / by-client toggle, "Nuevo
 * caso" → modal, Lex tip. Clicking a row navigates to the shared-case workspace
 * (/ventas/clientes/[caseId], reusing the F2 shared-case feature). Progress from
 * docs/forms; pending-signature rows show "Enviar contrato →".
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { MSym } from "../shared/msym";
import { Chip, Initials } from "../shared/ui";
import { LexBubble } from "../shared/lex";
import { useLexPrefs } from "../shared/lex-prefs";

export interface CaseRowVM {
  id: string;
  clientName: string;
  serviceLabel: string;
  members: string[];
  jurisdiction: string;
  updatedLabel: string;
  contractState: "borrador" | "enviado" | "firmado";
  seqIndex: number;
  seqTotal: number;
  docsApproved: number;
  docsTotal: number;
  formsPct: number;
  ready: boolean;
  sameClient: boolean;
}

export interface ClientesStrings {
  title: string;
  sub: string;
  byCase: string;
  byClient: string;
  newCase: string;
  lexTipHtml: string;
  openTo: string;
  pendingSign: string;
  readyDiana: string;
  sameClient: string;
  sendContract: string;
  docs: string;
  forms: string;
  empty: string;
  caseCount: string;
  caseCountOne: string;
  lexEnabled: boolean;
}

export interface ClientesListViewProps {
  cases: CaseRowVM[];
  strings: ClientesStrings;
  basePath: string;
  onNewCase: () => void;
  readyClientName: string | null;
  readyCaseId: string | null;
}

export function ClientesListView({
  cases,
  strings,
  basePath,
  onNewCase,
  readyClientName,
  readyCaseId,
}: ClientesListViewProps) {
  const router = useRouter();
  const { bubbles } = useLexPrefs();
  const [group, setGroup] = React.useState<"caso" | "cliente">("caso");

  const open = (id: string) => router.push(`${basePath}/${id}`);

  const byClient = React.useMemo(() => {
    const map = new Map<string, CaseRowVM[]>();
    for (const c of cases) {
      const arr = map.get(c.clientName) ?? [];
      arr.push(c);
      map.set(c.clientName, arr);
    }
    return Array.from(map.entries());
  }, [cases]);

  const Row = ({ c }: { c: CaseRowVM }) => {
    const pending = c.contractState !== "firmado";
    const docPct = c.docsTotal ? Math.round((c.docsApproved / c.docsTotal) * 100) : 0;
    const avg = Math.round((docPct + c.formsPct) / 2);
    return (
      <button type="button" className="client-card" onClick={() => open(c.id)}>
        <div className="client-av">{Initials({ name: c.clientName })}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 900, fontSize: 16, color: "var(--ink)" }}>{c.clientName}</span>
            <Chip tone="gold" icon="workspace_premium">{c.serviceLabel}</Chip>
            {pending ? (
              <Chip tone="amber" icon="draft">{strings.pendingSign}</Chip>
            ) : (
              <Chip tone="blue">Cita {c.seqIndex} de {c.seqTotal}</Chip>
            )}
            {c.ready && <Chip tone="green" icon="check_circle">{strings.readyDiana}</Chip>}
            {c.sameClient && <Chip>{strings.sameClient}</Chip>}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", fontWeight: 700, marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <MSym name="group" size={15} color="var(--brand-gold)" />
            {c.members.join(", ")} · {c.jurisdiction} · act. {c.updatedLabel}
          </div>
        </div>
        {pending ? (
          <span className="vbtn vbtn-primary vbtn-sm" style={{ pointerEvents: "none" }}>
            {strings.sendContract}
            <MSym name="arrow_forward" size={18} />
          </span>
        ) : (
          <div className="cprog">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, fontWeight: 800, marginBottom: 5 }}>
              <span style={{ color: "var(--ink-2)" }}>{strings.docs.replace("{x}", String(c.docsApproved)).replace("{y}", String(c.docsTotal))}</span>
              <span style={{ color: "var(--ink)" }}>{strings.forms.replace("{f}", String(c.formsPct))}</span>
            </div>
            <div className="cprog-track">
              <div className="cprog-fill" style={{ width: `${avg}%` }} />
            </div>
          </div>
        )}
        <MSym name="chevron_right" size={20} color="var(--ink-3)" />
      </button>
    );
  };

  return (
    <div className="fade-up">
      <div className="v-head">
        <div>
          <h1 className="v-title">{strings.title}</h1>
          <div className="v-sub">{strings.sub}</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <div className="seg">
            <button type="button" className={group === "caso" ? "on" : ""} onClick={() => setGroup("caso")}>{strings.byCase}</button>
            <button type="button" className={group === "cliente" ? "on" : ""} onClick={() => setGroup("cliente")}>{strings.byClient}</button>
          </div>
          <button type="button" className="vbtn vbtn-primary vbtn-sm" onClick={onNewCase}>
            <MSym name="create_new_folder" size={18} />
            {strings.newCase}
          </button>
        </div>
      </div>

      {readyClientName && (
        <LexBubble
          dismissKey="cli-tip"
          orb={30}
          enabled={strings.lexEnabled && bubbles}
          html={strings.lexTipHtml.replace("{name}", readyClientName)}
          actions={[{ label: strings.openTo.replace("{name}", readyClientName.split(" ")[0]), icon: "open_in_new", onClick: () => readyCaseId && open(readyCaseId) }]}
        />
      )}

      {cases.length === 0 ? (
        <div className="kcol-empty" style={{ padding: "40px" }}>{strings.empty}</div>
      ) : group === "caso" ? (
        cases.map((c) => <Row key={c.id} c={c} />)
      ) : (
        byClient.map(([name, group]) => (
          <div key={name} style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, margin: "8px 2px 10px" }}>
              <span style={{ fontWeight: 900, fontSize: 15, color: "var(--ink)" }}>{name}</span>
              <Chip>
                {(group.length > 1 ? strings.caseCount : strings.caseCountOne).replace("{n}", String(group.length))}
              </Chip>
            </div>
            {group.map((c) => <Row key={c.id} c={c} />)}
          </div>
        ))
      )}
    </div>
  );
}
