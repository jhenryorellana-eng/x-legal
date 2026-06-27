-- =============================================================================
-- 0040_expediente_translation_item.sql
-- Adds 'translation' to the expediente_items.item_type CHECK so a certified
-- document translation (document_translations) can be its own ordered item in
-- the case file — placed BEFORE its source document, per USCIS practice.
-- Depends on: 0008_expediente.sql
-- =============================================================================

alter table public.expediente_items
  drop constraint if exists expediente_items_item_type_check;

alter table public.expediente_items
  add constraint expediente_items_item_type_check
  check (item_type in (
    'cover','ai_generation','automated_form','client_document','translation','external_file'
  ));

-- ref_id for item_type='translation' is a logical FK to document_translations.id
-- (validated in the service layer, consistent with the other item types).
