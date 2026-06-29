import * as React from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/frontend/components/brand/icon";
import { IconTile } from "@/frontend/components/brand/icon-tile";
import { Logo } from "@/frontend/components/brand/logo";
import { HomeBell, type RefetchUnread } from "./home-bell";

/**
 * DashboardScreen — `/home` (DOC-51 §5, prototype `screens6.jsx → DashboardScreen`).
 *
 * Server component: receives already-resolved, serializable data from the page
 * (RSC reads via modules/* index.ts) and renders the multi-case dashboard.
 * The only interactive affordances are links (bell → /avisos, avatar → /config,
 * case cards → their case). No client JS needed here.
 */

export interface DashboardCase {
  caseId: string;
  /** Destination for the card (the case "camino"/path screen). */
  href: string;
  /** Service + party title, e.g. "Visa Juvenil — Mateo". */
  title: string;
  /** "Fase 1 de 3 · Custodia" — already localized by the page. */
  phaseLabel: string | null;
  serviceIcon: IconName;
  serviceColor: string;
  progress: number;
  pendingDocuments: number;
  /** Status line shown when the case has no pending documents (e.g. "En revisión"). */
  statusText?: string;
}

/**
 * A case still in onboarding (`payment_pending`): the client must sign the
 * contract and then pay the first installment before the workspace unlocks.
 * Rendered as a dedicated step card above the active cases.
 *
 *  - "sign"      → contract is `sent`; show the "Firmar" CTA → `signHref` (/firma/{token}).
 *  - "pay"       → contract is `signed`; step 1 done, show the "Pagar" CTA → /pagos.
 *  - "preparing" → contract not yet ready to sign (draft/cancelled) — no CTA.
 */
export interface OnboardingCase {
  caseId: string;
  title: string;
  serviceIcon: IconName;
  serviceColor: string;
  step: "sign" | "pay" | "preparing";
  /** Public signing URL (/firma/{token}); present only when step === "sign". */
  signHref: string | null;
}

export interface DashboardLabels {
  greetingEyebrow: string;
  greeting: string; // already interpolated with {name}
  yourCases: string;
  documentsLeft: string; // "{n} documents left" → uses {n}
  openCase: string;
  paymentPending: string; // "Pago inicial pendiente"
  payNow: string; // "Pagar ahora" — CTA on the onboarding "pay" step
  // Onboarding step card (sign → pay)
  activateTitle: string; // "Activa tu caso"
  stepSign: string; // "Firma tu contrato"
  stepPay: string; // "Paga tu primera cuota"
  signCta: string; // "Firmar"
  stepDoneLabel: string; // "Hecho"
  stepLaterLabel: string; // "Después"
  preparingLabel: string; // "Preparando tu contrato"
  lockedLabel: string; // "Tu caso se activa al completar estos pasos"
  quickAccess: string;
  qServices: string;
  qServicesSub: string;
  qPayments: string;
  qPaymentsSub: string; // already interpolated or "Al día"
  qCommunity: string;
  qCommunitySub: string;
  qSettings: string;
  qSettingsSub: string;
  bellAria: string;
  avatarAria: string;
}

export interface DashboardScreenProps {
  displayName: string;
  avatarInitial: string;
  cases: DashboardCase[];
  /** Cases still in onboarding (sign → pay) — rendered above the active cases. */
  onboardingCases: OnboardingCase[];
  unreadCount: number;
  labels: DashboardLabels;
  /** Auth uid — drives the live realtime bell badge (HomeBell). */
  userId: string;
  locale: "es" | "en";
  /** Server action (injected by the page) for the bell's poll re-sync. */
  refetchUnread: RefetchUnread;
}

const BRAND_NAVY = "var(--brand-navy)";

export function DashboardScreen({
  displayName,
  avatarInitial,
  cases,
  onboardingCases,
  unreadCount,
  labels,
  userId,
  locale,
  refetchUnread,
}: DashboardScreenProps) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        padding: "26px 20px var(--screen-pb)",
        background:
          "radial-gradient(135% 95% at 100% -8%, var(--blue-soft) 0%, transparent 46%), radial-gradient(120% 80% at -12% 4%, color-mix(in srgb, var(--gold-soft) 80%, transparent) 0%, transparent 42%), var(--bg)",
      }}
    >
      {/* Brand */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
        <Logo size={26} withWordmark wordmarkSize={15} />
      </div>

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 22,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--ink-2)", fontSize: 15, fontWeight: 600 }}>
            {labels.greetingEyebrow}
          </div>
          <h1
            className="t-black"
            style={{ margin: "2px 0 0", fontSize: 28, color: "var(--navy)" }}
          >
            {labels.greeting.replace("{name}", displayName)}
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <HomeBell
            userId={userId}
            locale={locale}
            initialUnread={unreadCount}
            ariaLabel={labels.bellAria}
            refetchUnread={refetchUnread}
          />
          <Link
            href="/config"
            aria-label={labels.avatarAria}
            className="mp-pop"
            style={{
              width: 48,
              height: 48,
              borderRadius: 999,
              background: `linear-gradient(135deg, var(--accent), ${BRAND_NAVY})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-title)",
              fontWeight: 800,
              color: "#fff",
              fontSize: 19,
              cursor: "pointer",
              boxShadow: "var(--shadow-soft)",
              textDecoration: "none",
            }}
          >
            {avatarInitial}
          </Link>
        </div>
      </div>

      {/* Tus casos */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <Icon name="briefcase" size={21} color="var(--navy)" />
        <h2
          className="t-title"
          style={{ margin: 0, fontSize: 20, color: "var(--navy)", fontWeight: 700 }}
        >
          {labels.yourCases}
        </h2>
      </div>

      {/* Onboarding step cards (sign → pay) — cases not yet active. Rendered
          above the active cases so the client completes activation first. */}
      {onboardingCases.map((oc) => (
        <OnboardingCard key={oc.caseId} data={oc} labels={labels} />
      ))}

      {/* Active cases — one consistent card per case (DOC-51 §5; unified
          June 2026: dropped the hero/compact split so every case reads the
          same, regardless of position). */}
      {cases.map((c) => (
        <CaseCard key={c.caseId} data={c} labels={labels} />
      ))}

      {/* Accesos rápidos */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "22px 0 12px",
        }}
      >
        <Icon name="bolt" size={20} color="var(--navy)" />
        <h2
          className="t-title"
          style={{ margin: 0, fontSize: 20, color: "var(--navy)", fontWeight: 700 }}
        >
          {labels.quickAccess}
        </h2>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          {
            href: "/servicios",
            icon: "grid" as const,
            color: "var(--accent)",
            label: labels.qServices,
            sub: labels.qServicesSub,
          },
          {
            href: "/pagos",
            icon: "wallet" as const,
            color: "var(--gold)",
            label: labels.qPayments,
            sub: labels.qPaymentsSub,
          },
          {
            href: "/comunidad",
            icon: "family" as const,
            color: "var(--green)",
            label: labels.qCommunity,
            sub: labels.qCommunitySub,
          },
          {
            href: "/config",
            icon: "gear" as const,
            color: "var(--purple, #7C5CFF)",
            label: labels.qSettings,
            sub: labels.qSettingsSub,
          },
        ].map((q) => (
          <Link
            key={q.href}
            href={q.href}
            className="mp-lift"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 11,
              background: "var(--card)",
              borderRadius: 20,
              padding: 16,
              cursor: "pointer",
              textAlign: "left",
              boxShadow: "var(--shadow-soft)",
              textDecoration: "none",
            }}
          >
            <IconTile
              name={q.icon}
              color={q.color}
              size={44}
              radius={13}
              iconSize={23}
            />
            <div>
              <div
                className="t-title"
                style={{ fontSize: 16, color: "var(--navy)", fontWeight: 700 }}
              >
                {q.label}
              </div>
              <div
                style={{
                  fontSize: 12.5,
                  color: "var(--ink-2)",
                  fontWeight: 600,
                  marginTop: 1,
                }}
              >
                {q.sub}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CaseCard — the single, consistent card for an active case. The navy "destacado"
// primitive (DOC-51 §5) is now applied to EVERY case, not just the first, so the
// list reads coherently. Shows the phase, a gold progress bar, and a bottom row
// that surfaces pending documents when there are any — otherwise the case status
// (so in-review / completed cases read clearly instead of "0 documents left").
// ---------------------------------------------------------------------------

function CaseCard({ data, labels }: { data: DashboardCase; labels: DashboardLabels }) {
  const hasPending = data.pendingDocuments > 0;
  const bottomLeft = hasPending
    ? labels.documentsLeft.replace("{n}", String(data.pendingDocuments))
    : data.statusText ?? "";
  return (
    <Link
      href={data.href}
      className="mp-lift"
      style={{
        position: "relative",
        display: "block",
        overflow: "hidden",
        background: `linear-gradient(135deg, ${BRAND_NAVY}, #013a73)`,
        borderRadius: 24,
        padding: 20,
        marginBottom: 14,
        cursor: "pointer",
        textDecoration: "none",
        boxShadow: "0 18px 40px color-mix(in srgb, var(--brand-navy) 25%, transparent)",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          right: -30,
          top: -30,
          width: 140,
          height: 140,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--gold) 20%, transparent), transparent 70%)",
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 13,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            width: 50,
            height: 50,
            borderRadius: 15,
            background: "rgba(255,255,255,0.14)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon name={data.serviceIcon} size={27} color="#fff" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-title" style={{ fontSize: 19, color: "#fff", fontWeight: 800 }}>
            {data.title}
          </div>
          {data.phaseLabel && (
            <div
              style={{
                fontSize: 13.5,
                color: "rgba(255,255,255,0.72)",
                fontWeight: 600,
                marginTop: 1,
              }}
            >
              {data.phaseLabel}
            </div>
          )}
        </div>
      </div>
      <div
        style={{
          position: "relative",
          height: 9,
          borderRadius: 999,
          background: "rgba(255,255,255,0.16)",
          overflow: "hidden",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: `${data.progress}%`,
            height: "100%",
            borderRadius: 999,
            background: "linear-gradient(90deg, var(--gold), var(--gold-deep))",
            transition: "width 0.9s cubic-bezier(.4,0,.2,1)",
          }}
        />
      </div>
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            color: "#fff",
            fontSize: 14.5,
            fontWeight: 700,
            minWidth: 0,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              flexShrink: 0,
              background: "var(--gold)",
              boxShadow: "0 0 0 4px color-mix(in srgb, var(--gold) 20%, transparent)",
            }}
          />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {bottomLeft}
          </span>
        </div>
        <span
          className="t-title"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            flexShrink: 0,
            background: "#fff",
            color: "var(--accent)",
            borderRadius: 999,
            padding: "9px 16px",
            fontSize: 14.5,
            fontWeight: 800,
          }}
        >
          {labels.openCase} <Icon name="chevR" size={17} color="var(--accent)" />
        </span>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// OnboardingCard — a `payment_pending` case's two-step activation (sign → pay)
// ---------------------------------------------------------------------------

const onboardingPillBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: `linear-gradient(135deg, var(--accent), ${BRAND_NAVY})`,
  color: "#fff",
  borderRadius: 999,
  padding: "8px 14px",
  fontSize: 13.5,
  fontWeight: 800,
  textDecoration: "none",
  flexShrink: 0,
};

const onboardingMutedTag: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 700,
  color: "var(--ink-3)",
  flexShrink: 0,
};

function OnboardingStepRow({
  index,
  label,
  done,
  dim,
  children,
}: {
  index: number;
  label: string;
  done: boolean;
  dim?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 12,
        opacity: dim ? 0.55 : 1,
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 999,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 14,
          color: done ? "#fff" : "var(--navy)",
          background: done
            ? "var(--green)"
            : "color-mix(in srgb, var(--gold) 22%, transparent)",
        }}
      >
        {done ? <Icon name="check" size={16} color="#fff" /> : index}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 15,
          fontWeight: 700,
          color: "var(--navy)",
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function OnboardingCard({
  data,
  labels,
}: {
  data: OnboardingCase;
  labels: DashboardLabels;
}) {
  // step "pay" means the contract is already signed (step 1 done).
  const signDone = data.step === "pay";
  const signActive = data.step === "sign";
  const payActive = data.step === "pay";

  return (
    <div
      className="mp-lift"
      style={{
        position: "relative",
        overflow: "hidden",
        background: "var(--card)",
        border: "1px solid color-mix(in srgb, var(--gold) 35%, transparent)",
        borderRadius: 24,
        padding: 18,
        marginBottom: 14,
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          right: -40,
          top: -40,
          width: 140,
          height: 140,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--gold) 22%, transparent), transparent 70%)",
        }}
      />

      {/* Header: service tile + eyebrow + case title */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 13,
          marginBottom: 16,
        }}
      >
        <IconTile
          name={data.serviceIcon}
          color={data.serviceColor}
          size={46}
          radius={13}
          iconSize={24}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: "var(--gold-deep, var(--gold))",
            }}
          >
            {labels.activateTitle}
          </div>
          <div
            className="t-title"
            style={{
              fontSize: 16.5,
              color: "var(--navy)",
              fontWeight: 800,
              marginTop: 1,
            }}
          >
            {data.title}
          </div>
        </div>
      </div>

      {/* Step 1 — sign the contract */}
      <OnboardingStepRow index={1} label={labels.stepSign} done={signDone}>
        {signActive && data.signHref ? (
          <Link href={data.signHref} className="t-title" style={onboardingPillBtn}>
            {labels.signCta} <Icon name="chevR" size={16} color="#fff" />
          </Link>
        ) : signDone ? (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12.5,
              fontWeight: 700,
              color: "var(--green)",
              flexShrink: 0,
            }}
          >
            <Icon name="check" size={14} color="var(--green)" /> {labels.stepDoneLabel}
          </span>
        ) : (
          <span style={onboardingMutedTag}>{labels.preparingLabel}</span>
        )}
      </OnboardingStepRow>

      {/* connector */}
      <div
        aria-hidden
        style={{
          marginLeft: 15,
          height: 14,
          borderLeft: "2px dashed color-mix(in srgb, var(--ink-3) 40%, transparent)",
        }}
      />

      {/* Step 2 — pay the first installment */}
      <OnboardingStepRow
        index={2}
        label={labels.stepPay}
        done={false}
        dim={!payActive}
      >
        {payActive ? (
          <Link href="/pagos" className="t-title" style={onboardingPillBtn}>
            {labels.payNow} <Icon name="chevR" size={16} color="#fff" />
          </Link>
        ) : (
          <span style={onboardingMutedTag}>{labels.stepLaterLabel}</span>
        )}
      </OnboardingStepRow>

      {/* Locked hint — the case workspace opens once both steps are done */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 7,
          marginTop: 14,
          color: "var(--ink-3)",
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        <Icon name="lock" size={14} color="var(--ink-3)" />
        {labels.lockedLabel}
      </div>
    </div>
  );
}
