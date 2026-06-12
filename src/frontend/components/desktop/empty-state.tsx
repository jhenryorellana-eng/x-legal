"use client";

import * as React from "react";
import { Lex, type LexMood } from "@/frontend/components/brand/lex";
import { GradientBtn } from "@/frontend/components/brand/gradient-btn";
import { GhostBtn } from "@/frontend/components/brand/ghost-btn";
import { type IconName } from "@/frontend/components/brand/icon";

/**
 * EmptyState — canonical empty / error pattern (DOC-01 §5.3, DOC-50 SOT-4).
 *
 * Centered card with Lex (mood `calma` for empty, `atento` for error), a
 * title, a subtitle and an optional CTA (DOC-53 §0.5). Never a blank panel.
 * Each list defines its own copy via i18n in the calling component.
 */

export interface EmptyStateAction {
  label: string;
  icon?: IconName;
  onClick: () => void;
}

export interface EmptyStateProps {
  title: string;
  subtitle?: string;
  /** Lex mood — `calma` (empty) or `atento` (error/attention). */
  mood?: LexMood;
  lexSize?: number;
  /** Primary CTA (GradientBtn). */
  action?: EmptyStateAction;
  /** Secondary CTA (GhostBtn). */
  secondaryAction?: EmptyStateAction;
  /** Optional collapsible technical code (admin error states, DOC-53 §0.5). */
  code?: string;
}

export function EmptyState({
  title,
  subtitle,
  mood = "calma",
  lexSize = 120,
  action,
  secondaryAction,
  code,
}: EmptyStateProps) {
  return (
    <div
      role="status"
      className="anim-fade-in-up"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 6,
        padding: "44px 28px",
        background: "var(--panel, var(--card))",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <Lex size={lexSize} mood={mood} />
      <h3
        style={{
          margin: "8px 0 0",
          fontFamily: "var(--font-title)",
          fontWeight: 800,
          fontSize: 16,
          color: "var(--ink)",
        }}
      >
        {title}
      </h3>
      {subtitle && (
        <p
          style={{
            margin: 0,
            maxWidth: 420,
            fontSize: 14,
            lineHeight: 1.5,
            color: "var(--ink-2)",
          }}
        >
          {subtitle}
        </p>
      )}

      {(action || secondaryAction) && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            justifyContent: "center",
            marginTop: 14,
          }}
        >
          {action && (
            <GradientBtn
              size="md"
              full={false}
              icon={action.icon}
              onClick={action.onClick}
            >
              {action.label}
            </GradientBtn>
          )}
          {secondaryAction && (
            <GhostBtn
              size="md"
              full={false}
              icon={secondaryAction.icon}
              onClick={secondaryAction.onClick}
            >
              {secondaryAction.label}
            </GhostBtn>
          )}
        </div>
      )}

      {code && (
        <code
          style={{
            marginTop: 14,
            fontSize: 12,
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            color: "var(--ink-3)",
            background: "var(--chip)",
            padding: "4px 10px",
            borderRadius: 8,
          }}
        >
          {code}
        </code>
      )}
    </div>
  );
}
