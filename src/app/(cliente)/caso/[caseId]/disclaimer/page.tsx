/**
 * Disclaimer + firma — `/caso/[caseId]/disclaimer` · NO_CHROME — DOC-51 §12.
 *
 * Server component. Guards on the terms status (API-CASE-11): if the client has
 * already accepted the org's active terms for this case → straight to Camino (the
 * screen never reappears). Otherwise renders the notice (active terms_version
 * body, or the normative 5-section seed when no managed body exists yet) + the
 * SignaturePad + acceptance flow.
 */

import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getTermsStatusForCase } from "@/backend/modules/contracts";
import {
  DisclaimerScreen,
  type DisclaimerSection,
} from "@/frontend/features/cliente/disclaimer/disclaimer-screen";
import { acceptTermsAction } from "./actions";

export default async function DisclaimerPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const t = await getTranslations("cliente.disclaimer");
  const tSig = await getTranslations("cliente.signature");

  let status;
  try {
    status = await getTermsStatusForCase(actor, caseId);
  } catch {
    notFound();
  }

  // Already accepted the active version → skip straight to Camino.
  if (status.alreadyAccepted) {
    redirect(`/caso/${caseId}/camino`);
  }

  // Notice sections: the normative 5-section seed (managed body rendering arrives
  // with the rich-text terms editor; the seed text IS the terms content here).
  // Dynamic key access → cast the translator (data-driven, validated by check:i18n).
  const tDyn = t as unknown as (key: string) => string;
  const sections: DisclaimerSection[] = [1, 2, 3, 4, 5].map((n) => ({
    title: tDyn(`section${n}.title`),
    body: tDyn(`section${n}.body`),
  }));

  return (
    <DisclaimerScreen
      caseId={caseId}
      sections={sections}
      closing={t("closing")}
      acceptTerms={acceptTermsAction}
      labels={{
        brandPrime: t("brandPrime"),
        title: t("title"),
        subtitle: t("subtitle"),
        scrollHint: t("scrollHint"),
        yourSignature: t("yourSignature"),
        checkbox: t("checkbox"),
        accept: t("accept"),
        closing: t("closing"),
        errGeneric: t("errGeneric"),
      }}
      signatureLabels={{
        draw: tSig("draw"),
        upload: tSig("upload"),
        placeholder: tSig("placeholder"),
        legend: tSig("legend"),
        uploadPrompt: tSig("uploadPrompt"),
        required: tSig("required"),
        ready: tSig("ready"),
        clear: tSig("clear"),
        undo: tSig("undo"),
      }}
    />
  );
}
