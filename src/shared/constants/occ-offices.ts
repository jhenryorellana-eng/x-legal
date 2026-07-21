/**
 * DHS/ICE Office of the Principal Legal Advisor (OPLA) — Office of the Chief
 * Counsel (OCC) service addresses, keyed by Immigration Court.
 *
 * This is the "opposing party" address that the appeal's **Proof of Service**
 * certifies a copy was served upon. A wrong or stale address here is serious
 * (the BIA rejects any filing without a valid Proof of Service), so entries are
 * added ONLY from a verified official source and an unknown court degrades to an
 * honest "confirm from the EOIR/ICE directory" placeholder — never an invented
 * address.
 *
 * Config-as-data: this is the single place to extend. To add a court, add an
 * entry with the OCC's verified mailing address and the lowercased substrings
 * that identify its court in the decision extraction's `court_location`
 * (format 'Immigration Court, City, ST', but matching is substring-based so
 * variants like 'Houston - S. Gessner Road Immigration Court' also resolve).
 *
 * Future upgrade (out of scope here): move this to a staff-editable DB table.
 */

export interface OccOffice {
  /** Lowercased substrings that identify this office's court in `court_location`. */
  match: string[];
  /** Full mailing address, one line per array entry (rendered joined by line breaks). */
  address: string[];
}

const OPLA_HEADER = [
  "U.S. Department of Homeland Security",
  "Immigration and Customs Enforcement (ICE / OPLA)",
  "Office of the Chief Counsel",
];

/**
 * Verified OCC offices. Sources noted per entry; re-verify against the official
 * directory (https://www.ice.gov/about-ice/opla/field-offices) before relying on
 * one for a real filing, as these can change.
 */
export const OCC_OFFICES: OccOffice[] = [
  {
    // Source: ice.gov OPLA Houston (web-verified 2026-07-17, docs/_evidence/apelacion-ivis/VERIFICACION.md).
    match: ["houston"],
    address: [...OPLA_HEADER, "126 Northpoint Drive, Room 2020", "Houston, TX 77060"],
  },
  {
    // Source: docs/guides/proof-of-service-guia.md (Salt Lake City OCC).
    match: ["salt lake city", "west valley"],
    address: [...OPLA_HEADER, "2975 Decker Lake Drive, Stop C", "West Valley City, UT 84119-6098"],
  },
];

/**
 * Resolves the OCC/OPLA service address for a court, from the decision
 * extraction's `court_location`. Returns the address lines, or `null` when the
 * court is not in the directory (caller keeps the "confirm" placeholder).
 */
export function resolveOccAddress(courtLocation: string | null | undefined): string[] | null {
  if (!courtLocation || typeof courtLocation !== "string") return null;
  const norm = courtLocation.toLowerCase();
  for (const office of OCC_OFFICES) {
    if (office.match.some((m) => norm.includes(m))) return office.address;
  }
  return null;
}
