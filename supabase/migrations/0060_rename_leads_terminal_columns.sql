-- 0060_rename_leads_terminal_columns.sql
--
-- Rename the seed labels of the terminal columns on existing LEADS boards so
-- they read coherently for the sales stage (a lead has no case yet):
--   "Ganado"  (is_terminal_won)  -> "Listo para contrato"
--   "Perdido" (is_terminal_lost) -> "Rechazado"
--
-- The behavior is driven by the is_terminal_won/lost flags, NOT the label, so
-- this rename does not change the won/lost workflow. It matches the updated
-- seed in src/backend/modules/kanban/domain.ts (new boards already get these
-- names). Idempotent + non-destructive: only rows still at the exact old
-- default label on a leads board are touched — columns a user already renamed
-- are left untouched.

update public.kanban_columns c
   set label = 'Listo para contrato'
  from public.kanban_boards b
 where c.board_id = b.id
   and b.board_kind = 'leads'
   and c.is_terminal_won
   and c.label = 'Ganado';

update public.kanban_columns c
   set label = 'Rechazado'
  from public.kanban_boards b
 where c.board_id = b.id
   and b.board_kind = 'leads'
   and c.is_terminal_lost
   and c.label = 'Perdido';
