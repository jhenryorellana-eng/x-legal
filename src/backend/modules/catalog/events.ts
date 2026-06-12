/**
 * Catalog module domain events.
 *
 * DOC-20 §5 defines exactly TWO canonical events for `catalog`:
 * - service.published
 * - form_version.published
 *
 * All other mutations go only to audit_log. No new events are invented here.
 * DOC-40 §5.
 */

import type { I18nText } from "./domain";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface ServicePublishedEvent {
  type: "service.published";
  payload: {
    org_id: string;
    service_id: string;
    slug: string;
    category: "migratorio" | "empresarial" | "familiar";
    label_i18n: I18nText;
    is_public: boolean;
    is_entry_service: boolean;
    published_by: string;
    occurred_at: string;
  };
  occurredAt: Date;
}

export interface FormVersionPublishedEvent {
  type: "form_version.published";
  payload: {
    org_id: string;
    service_id: string;
    service_phase_id: string;
    form_definition_id: string;
    form_slug: string;
    automation_version_id: string;
    version: number;
    previous_version_id: string | null;
    question_count: number;
    published_by: string;
    occurred_at: string;
  };
  occurredAt: Date;
}

export type CatalogEvent = ServicePublishedEvent | FormVersionPublishedEvent;
