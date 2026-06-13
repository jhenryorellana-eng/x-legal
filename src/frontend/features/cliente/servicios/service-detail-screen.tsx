"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@/frontend/components/brand/icon";
import { IconHalo } from "@/frontend/components/brand/icon-tile";
import { Card } from "@/frontend/components/brand/card";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";

/**
 * ServiceDetailScreen — `/servicios/[slug]` (DOC-51 §7, prototype `screens6.jsx
 * → ServiceDetailScreen`).
 *
 * The "Me interesa, contáctenme" CTA is gated by the `NEXT_PUBLIC_FEATURE_INTERES`
 * flag (nota H-7 / PS-3): the lead action arrives in F3. When the flag is off the
 * button is present but disabled with an explanatory tooltip-less label change
 * (it never silently disappears, per the spec's anti-pattern rule on disabled
 * states). "Preguntar por mensaje" opens the messaging sheet (overlay O1) — wired
 * to the launcher once O1 lands; for now it is a no-op affordance.
 */

export interface ServiceDetailLabels {
  eyebrow: string;
  whatIs: string;
  howWeHelp: string;
  costsNote: string;
  interested: string;
  interestedSoon: string;
  askByMessage: string;
}

export interface ServiceDetailScreenProps {
  name: string;
  shortDescription: string;
  longDescription: string;
  benefits: string[];
  icon: IconName;
  color: string;
  /** When false, the lead CTA renders disabled (feature flag off). */
  interestEnabled: boolean;
  labels: ServiceDetailLabels;
}

export function ServiceDetailScreen({
  name,
  shortDescription,
  longDescription,
  benefits,
  icon,
  color,
  interestEnabled,
  labels,
}: ServiceDetailScreenProps) {
  const router = useRouter();

  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "26px 20px 120px",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      {/* Back + eyebrow */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <button
          type="button"
          onClick={() => router.push("/servicios")}
          aria-label={labels.eyebrow}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            border: "none",
            background: "var(--card)",
            boxShadow: "var(--shadow-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <Icon name="arrowL" size={22} color="var(--navy)" />
        </button>
        <div
          style={{
            color: "var(--ink-2)",
            fontWeight: 700,
            fontSize: 15,
            marginTop: 12,
          }}
        >
          {labels.eyebrow}
        </div>
      </div>

      {/* Hero */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          marginBottom: 22,
        }}
      >
        <div
          style={{
            position: "relative",
            width: 84,
            height: 84,
            borderRadius: 24,
            background: "var(--card)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
            boxShadow: `0 12px 28px color-mix(in srgb, ${color} 20%, transparent)`,
            marginBottom: 14,
          }}
        >
          <IconHalo color={color} size={84} opacity={0.7} />
          <span style={{ position: "relative", display: "flex" }}>
            <Icon name={icon} size={42} color={color} />
          </span>
        </div>
        <h1
          className="t-black"
          style={{
            margin: "0 0 6px",
            fontSize: 27,
            color: "var(--navy)",
            textWrap: "balance",
          }}
        >
          {name}
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: 16,
            color: "var(--ink-2)",
            fontWeight: 500,
            maxWidth: 320,
            textWrap: "pretty",
          }}
        >
          {shortDescription}
        </p>
      </div>

      {/* ¿Qué es? */}
      <Card style={{ padding: 18, marginBottom: 14 }}>
        <h3
          className="t-title"
          style={{
            margin: "0 0 8px",
            fontSize: 18,
            color: "var(--navy)",
            fontWeight: 700,
          }}
        >
          {labels.whatIs}
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: 15.5,
            lineHeight: 1.6,
            color: "var(--ink-2)",
            fontWeight: 500,
            textWrap: "pretty",
          }}
        >
          {longDescription}
        </p>
      </Card>

      {/* ¿Cómo te ayudamos? */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "8px 0 12px",
        }}
      >
        <h3
          className="t-title"
          style={{ margin: 0, fontSize: 18, color: "var(--navy)", fontWeight: 700 }}
        >
          {labels.howWeHelp}
        </h3>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          marginBottom: 18,
        }}
      >
        {benefits.map((h, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              background: "var(--card)",
              borderRadius: 16,
              padding: 14,
              boxShadow: "var(--shadow-soft)",
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 999,
                background: "var(--green-soft)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                marginTop: 1,
              }}
            >
              <Icon name="check" size={18} color="var(--green)" stroke={3} />
            </div>
            <span
              style={{
                fontSize: 15,
                lineHeight: 1.5,
                color: "var(--ink)",
                fontWeight: 600,
              }}
            >
              {h}
            </span>
          </div>
        ))}
      </div>

      {/* Costs note (no prices in the app — RF-CLI-069 CA2) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--gold-soft)",
          borderRadius: 16,
          padding: 14,
          marginBottom: 22,
        }}
      >
        <Icon name="info" size={20} color="var(--gold-deep)" />
        <span
          style={{
            fontSize: 14,
            color: "var(--ink)",
            fontWeight: 600,
            lineHeight: 1.45,
          }}
        >
          {labels.costsNote}
        </span>
      </div>

      {/* CTAs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <GradientBtn
          icon="sparkle"
          c1="#2F6BFF"
          c2="#002855"
          disabled={!interestEnabled}
          // The lead action arrives in F3 (PS-3); enabled wiring lands then.
          onClick={interestEnabled ? () => {} : undefined}
        >
          {interestEnabled ? labels.interested : labels.interestedSoon}
        </GradientBtn>
        <GhostBtn icon="chat" onClick={() => {}}>
          {labels.askByMessage}
        </GhostBtn>
      </div>
    </div>
  );
}
