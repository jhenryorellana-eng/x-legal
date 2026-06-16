/**
 * BrandLayout — shared react-email wrapper (DOC-73 §3.2).
 *
 * Header (navy + gold wordmark), single-column 600px content, and a footer
 * with the legal line + reason. The unsubscribe link is rendered ONLY when
 * `unsubscribeUrl` is provided (campaigns, CAN-SPAM); transactional emails omit it.
 */

import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { COLORS, FONT_STACK, MAX_WIDTH } from "./theme";
import { footerCopy, type Locale } from "./i18n";

export interface BrandLayoutProps {
  locale: Locale;
  /** Inbox preview snippet (hidden in the body). */
  preview: string;
  children: React.ReactNode;
  /** Campaigns only — renders the mandatory unsubscribe link. */
  unsubscribeUrl?: string;
  /** Optional override of the legal footer line (per-org). */
  footerLegal?: string;
}

export function BrandLayout({
  locale,
  preview,
  children,
  unsubscribeUrl,
  footerLegal,
}: BrandLayoutProps) {
  const f = footerCopy(locale);

  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: COLORS.bg,
          fontFamily: FONT_STACK,
          margin: 0,
          padding: "24px 0",
        }}
      >
        <Container
          style={{
            maxWidth: MAX_WIDTH,
            margin: "0 auto",
            backgroundColor: COLORS.white,
            borderRadius: 12,
            overflow: "hidden",
            border: `1px solid ${COLORS.border}`,
          }}
        >
          {/* Header */}
          <Section style={{ backgroundColor: COLORS.navy, padding: "22px 32px" }}>
            <Text
              style={{
                margin: 0,
                fontSize: 20,
                fontWeight: 800,
                letterSpacing: "0.5px",
                color: COLORS.white,
              }}
            >
              USALATINO<span style={{ color: COLORS.gold }}>PRIME</span>
            </Text>
          </Section>

          {/* Content */}
          <Section style={{ padding: "32px" }}>{children}</Section>

          {/* Footer */}
          <Hr style={{ borderColor: COLORS.border, margin: 0 }} />
          <Section style={{ padding: "24px 32px" }}>
            <Text
              style={{
                margin: "0 0 8px",
                fontSize: 12,
                lineHeight: 1.6,
                color: COLORS.muted,
              }}
            >
              {footerLegal ?? f.legal}
            </Text>
            <Text
              style={{
                margin: "0 0 8px",
                fontSize: 12,
                lineHeight: 1.6,
                color: COLORS.muted,
              }}
            >
              {f.reason}
            </Text>
            {unsubscribeUrl ? (
              <Text style={{ margin: 0, fontSize: 12, color: COLORS.muted }}>
                <Link
                  href={unsubscribeUrl}
                  style={{ color: COLORS.accent, textDecoration: "underline" }}
                >
                  {f.unsubscribe}
                </Link>
              </Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
