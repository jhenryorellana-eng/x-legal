/**
 * NotificationEmail — generic branded transactional template (DOC-73 §3).
 *
 * Driven by the notification's localized title/body/action_url (the same data
 * the in-app notification carries), so every transactional templateKey gets the
 * brand layout without bespoke per-key plumbing. Content is escaped by react-email.
 */

import { Button, Section, Text } from "@react-email/components";
import * as React from "react";
import { BrandLayout } from "../BrandLayout";
import { COLORS } from "../theme";
import type { Locale } from "../i18n";

export interface NotificationEmailProps {
  locale: Locale;
  preview: string;
  title: string;
  body?: string;
  ctaText?: string;
  ctaUrl?: string;
}

export function NotificationEmail({
  locale,
  preview,
  title,
  body,
  ctaText,
  ctaUrl,
}: NotificationEmailProps) {
  return (
    <BrandLayout locale={locale} preview={preview}>
      <Text
        style={{
          margin: "0 0 12px",
          fontSize: 22,
          fontWeight: 700,
          color: COLORS.text,
        }}
      >
        {title}
      </Text>
      {body ? (
        <Text
          style={{
            margin: "0 0 24px",
            fontSize: 15,
            lineHeight: 1.6,
            color: COLORS.body,
          }}
        >
          {body}
        </Text>
      ) : null}
      {ctaUrl && ctaText ? (
        <Section style={{ marginTop: 8 }}>
          <Button
            href={ctaUrl}
            style={{
              backgroundColor: COLORS.accent,
              color: COLORS.white,
              padding: "12px 28px",
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {ctaText}
          </Button>
        </Section>
      ) : null}
    </BrandLayout>
  );
}
