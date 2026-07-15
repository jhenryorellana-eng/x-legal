/**
 * Default permission presets per staff role (DOC-22 §6).
 *
 * Mirror of the backend `buildPermissionPreset` matrix, exposed in shared/ so
 * the admin UI can pre-fill the "new employee" modal and the "apply preset"
 * action WITHOUT importing backend internals (boundary rule: everyone may
 * depend on shared/). The backend remains the source of truth at write time —
 * this is a presentational convenience that the server re-validates.
 *
 * E = view+edit · V = view-only · — = no access.
 */

import { MODULE_KEYS, type ModuleKey } from "./modules";

type Cell = "E" | "V" | "-";
type RolePreset = Record<ModuleKey, { view: boolean; edit: boolean }>;

const MATRIX: Record<ModuleKey, { sales: Cell; paralegal: Cell; finance: Cell }> = {
  dashboard: { sales: "V", paralegal: "V", finance: "V" },
  leads: { sales: "E", paralegal: "-", finance: "-" },
  clients: { sales: "V", paralegal: "V", finance: "V" },
  cases: { sales: "V", paralegal: "E", finance: "V" },
  // Citas/agenda son responsabilidad de Ventas (Vanessa). El paralegal (Diana)
  // NO gestiona citas → sin acceso a calendar (decisión de Henry, 2026-07-09;
  // supersede DOC-22 §6 / DOC-54 §0.2 que daban al paralegal agenda read-only).
  calendar: { sales: "E", paralegal: "-", finance: "-" },
  availability: { sales: "E", paralegal: "-", finance: "-" },
  metrics: { sales: "V", paralegal: "-", finance: "-" },
  catalog: { sales: "-", paralegal: "-", finance: "-" },
  datasets: { sales: "-", paralegal: "-", finance: "-" },
  employees: { sales: "-", paralegal: "-", finance: "-" },
  billing: { sales: "-", paralegal: "-", finance: "E" },
  collections: { sales: "-", paralegal: "-", finance: "E" },
  printing: { sales: "-", paralegal: "-", finance: "E" },
  campaigns: { sales: "-", paralegal: "-", finance: "E" },
  accounting: { sales: "-", paralegal: "-", finance: "E" },
  expedientes: { sales: "-", paralegal: "E", finance: "V" },
  validations: { sales: "-", paralegal: "E", finance: "-" },
  messaging: { sales: "E", paralegal: "E", finance: "E" },
  community: { sales: "-", paralegal: "-", finance: "E" },
  audit: { sales: "-", paralegal: "-", finance: "-" },
  // Lifecycle "después" / fidelización — Andrium (finance) owns these surfaces.
  promotions: { sales: "-", paralegal: "-", finance: "E" },
  referrals: { sales: "-", paralegal: "-", finance: "E" },
  reviews: { sales: "-", paralegal: "-", finance: "E" },
  retention: { sales: "-", paralegal: "-", finance: "E" },
  // Llenar/editar respuestas de formularios del cliente en su nombre, y corregir las
  // enviadas o aprobadas. Ventas (Vanessa, captura asistida RF-VAN-043) y paralegal
  // (Diana) por defecto; el admin puede concederlo/quitarlo a quien quiera. Finance no.
  // Solo el toggle Editar cuenta. (Decisión Henry 2026-07-08 + 2026-07-14.)
  formEdit: { sales: "E", paralegal: "E", finance: "-" },
};

function presetFor(role: "sales" | "paralegal" | "finance"): RolePreset {
  const out = {} as RolePreset;
  for (const k of MODULE_KEYS) {
    const cell = MATRIX[k][role];
    out[k] = { view: cell !== "-", edit: cell === "E" };
  }
  return out;
}

/** Preset maps keyed by role. `admin` has full access (matrix doesn't apply). */
export const ROLE_PRESETS: Record<string, RolePreset> = {
  admin: Object.fromEntries(MODULE_KEYS.map((k) => [k, { view: true, edit: true }])) as RolePreset,
  sales: presetFor("sales"),
  paralegal: presetFor("paralegal"),
  finance: presetFor("finance"),
};
