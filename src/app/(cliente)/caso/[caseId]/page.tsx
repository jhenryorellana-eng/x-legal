/**
 * Case entry router — `/caso/[caseId]` (DOC-51 §0.1, "inicio" del caso).
 *
 * Resolves a bare `/caso/{id}` entry (deep link, push notification, bookmark) to
 * the right screen: first entry — the org has an active terms version the client
 * hasn't accepted yet — → `/disclaimer`; otherwise → `/camino`.
 *
 * The normal flow links the dashboard card straight at the resolved destination
 * (see `home/page.tsx`), so this page is the defense-in-depth entry, NOT the hot
 * path. Crucially the redirect is thrown by THIS leaf page, never by the shared
 * `[caseId]/layout.tsx`: a layout that throws `redirect()` toward a route that
 * re-renders under that same layout blanks on soft navigation (App Router aborts
 * the layout subtree). A leaf-page redirect, with the layout already rendered, is
 * the canonical, reliable gate pattern. Membership is enforced by the layout.
 */

import { redirect } from "next/navigation";
import { getActor } from "@/backend/modules/identity";
import { getTermsStatusForCase } from "@/backend/modules/contracts";

export default async function CaseEntryPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  // Fail open to /camino on a terms read error — same semantics the layout gate
  // had. redirect() throws NEXT_REDIRECT, so keep it OUTSIDE the try/catch.
  let mustAcceptTerms = false;
  try {
    const terms = await getTermsStatusForCase(actor, caseId);
    mustAcceptTerms = !!terms.terms && !terms.alreadyAccepted;
  } catch {
    // Terms unreadable — leave the gate open (→ /camino).
  }

  redirect(
    mustAcceptTerms
      ? `/caso/${caseId}/disclaimer`
      : `/caso/${caseId}/camino`,
  );
}
