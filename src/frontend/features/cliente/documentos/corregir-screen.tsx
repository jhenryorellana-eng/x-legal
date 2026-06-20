"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/frontend/components/brand/icon";
import { IconHalo } from "@/frontend/components/brand/icon-tile";
import { Avatar } from "@/frontend/components/brand/avatar";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { openTeamChat } from "@/frontend/features/messaging/team-chat-bus";

/**
 * CorregirScreen — `/caso/[caseId]/corregir?req&party&doc` (DOC-51 §17, prototype
 * `screens8.jsx → CorrectionScreen`).
 *
 * AMBER tone, never red (RF-CLI-028 CA1). Shows the reviewer's reason + an
 * optional deadline chip. "Subir de nuevo" → upload flow (re-upload chain);
 * "Preguntarle a mi equipo" → opens the case team chat (overlay O1) via the
 * team-chat bus (the case chrome renders the overlay on this route).
 */

export interface CorregirLabels {
  back: string;
  almostThere: string;
  justOneDetail: string;
  deadline: string; // "Tienes hasta el {date}"
  whatToFix: string;
  reviewerSuffix: string; // "· tu abogada"
  okGuide: string;
  badGuide: string;
  uploadAgain: string;
  askTeam: string;
  empathy: string;
}

export function CorregirScreen({
  caseId,
  uploadQuery,
  documentName,
  reviewerName,
  reason,
  deadlineLabel,
  labels,
}: {
  caseId: string;
  uploadQuery: string;
  documentName: string;
  reviewerName: string;
  reason: string;
  deadlineLabel: string | null;
  labels: CorregirLabels;
}) {
  const router = useRouter();

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "54px 20px var(--screen-pb)",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      <Link
        href={`/caso/${caseId}/documentos`}
        className="mp-tap"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--accent)",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 15,
          textDecoration: "none",
          marginBottom: 14,
        }}
      >
        <Icon name="chevL" size={18} color="var(--accent)" /> {labels.back}
      </Link>

      {/* AMBER card (never red) */}
      <div
        style={{
          background: "var(--gold-soft)",
          border: "1.5px solid color-mix(in srgb, var(--gold) 40%, transparent)",
          borderRadius: 24,
          padding: 20,
          marginBottom: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 14 }}>
          <div
            style={{
              position: "relative",
              width: 50,
              height: 50,
              borderRadius: 15,
              background: "var(--card)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            <IconHalo color="var(--gold-deep)" size={50} opacity={0.6} />
            <span style={{ position: "relative", display: "flex" }}>
              <Icon name="info" size={27} color="var(--gold-deep)" />
            </span>
          </div>
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 800,
                color: "var(--gold-deep)",
                textTransform: "uppercase",
                letterSpacing: "0.03em",
              }}
            >
              {labels.almostThere}
            </div>
            <h2
              className="t-title"
              style={{
                margin: "2px 0 0",
                fontSize: 21,
                color: "var(--navy)",
                fontWeight: 800,
                lineHeight: 1.15,
              }}
            >
              {labels.justOneDetail}
            </h2>
          </div>
        </div>
        <div style={{ fontSize: 14, color: "var(--ink-2)", fontWeight: 700, marginBottom: 6 }}>
          {documentName}
        </div>
        {deadlineLabel && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "var(--card)",
              color: "var(--gold-deep)",
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            <Icon name="clock" size={14} color="var(--gold-deep)" /> {deadlineLabel}
          </div>
        )}
      </div>

      <h3
        className="t-title"
        style={{ margin: "0 0 10px", fontSize: 18, color: "var(--navy)", fontWeight: 700 }}
      >
        {labels.whatToFix}
      </h3>
      <div
        style={{
          display: "flex",
          gap: 12,
          background: "var(--card)",
          borderRadius: 18,
          padding: 16,
          marginBottom: 16,
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <Avatar name={reviewerName} variant="staff" size={36} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--navy)", marginBottom: 3 }}>
            {reviewerName} {labels.reviewerSuffix}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 15.5,
              lineHeight: 1.5,
              color: "var(--ink)",
              fontWeight: 500,
              textWrap: "pretty",
            }}
          >
            {reason}
          </p>
        </div>
      </div>

      {/* Mini guide */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[
          { ok: true, t: labels.okGuide },
          { ok: false, t: labels.badGuide },
        ].map((g, i) => (
          <div
            key={i}
            style={{
              background: "var(--card)",
              borderRadius: 16,
              padding: 12,
              boxShadow: "var(--shadow-soft)",
              border: `1.5px solid color-mix(in srgb, ${g.ok ? "var(--green)" : "var(--red)"} 20%, transparent)`,
            }}
          >
            <div
              style={{
                height: 72,
                borderRadius: 11,
                background: "var(--card-alt)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 9,
              }}
            >
              <Icon name="doc" size={34} color={g.ok ? "var(--green)" : "var(--ink-3)"} />
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                fontWeight: 700,
                color: g.ok ? "var(--green)" : "var(--red)",
              }}
            >
              <Icon name={g.ok ? "check" : "x"} size={16} color={g.ok ? "var(--green)" : "var(--red)"} stroke={3} />{" "}
              {g.t}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <GradientBtn
          icon="camera"
          c1="#2F6BFF"
          c2="#002855"
          onClick={() => router.push(`/caso/${caseId}/subir?${uploadQuery}`)}
        >
          {labels.uploadAgain}
        </GradientBtn>
        <GhostBtn icon="chat" onClick={() => openTeamChat()}>
          {labels.askTeam}
        </GhostBtn>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          marginTop: 18,
          color: "var(--ink-3)",
          fontSize: 13.5,
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        <Icon name="heart" size={15} color="var(--green)" /> {labels.empathy}
      </div>
    </div>
  );
}
