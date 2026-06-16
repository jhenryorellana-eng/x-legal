/**
 * CampaignEmail — branded wrapper around staff-authored campaign HTML (DOC-73 §3, §4).
 *
 * The `bodyHtml` is authored by staff with the `campaigns:edit` permission and
 * injected verbatim inside the brand layout. The unsubscribe link is MANDATORY
 * (CAN-SPAM) — `unsubscribeUrl` is required, not optional.
 */

import { Section } from "@react-email/components";
import * as React from "react";
import { BrandLayout } from "../BrandLayout";
import { COLORS } from "../theme";
import type { Locale } from "../i18n";

export interface CampaignEmailProps {
  locale: Locale;
  preview: string;
  bodyHtml: string;
  unsubscribeUrl: string;
}

export function CampaignEmail({
  locale,
  preview,
  bodyHtml,
  unsubscribeUrl,
}: CampaignEmailProps) {
  return (
    <BrandLayout locale={locale} preview={preview} unsubscribeUrl={unsubscribeUrl}>
      <Section>
        <div
          style={{ fontSize: 15, lineHeight: 1.6, color: COLORS.text }}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />
      </Section>
    </BrandLayout>
  );
}
