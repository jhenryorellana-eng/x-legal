/**
 * Subir documento — `/caso/[caseId]/subir?req&party&doc` · NO_CHROME — DOC-51 §15.
 *
 * Server component. Resolves the document name + current phase progress from the
 * documents matrix and injects the upload action wrappers (DOC-50 §2) into the
 * client UploadScreen, which performs the real signed-URL upload.
 */

import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getActor } from "@/backend/modules/identity";
import { getDocumentsMatrix } from "@/backend/modules/cases";
import { pickLocale, type Locale } from "@/frontend/features/cliente/shared/i18n";
import { UploadScreen } from "@/frontend/features/cliente/documentos/upload-screen";
import { startUploadAction, confirmUploadAction } from "./actions";

export default async function SubirPage({
  params,
  searchParams,
}: {
  params: Promise<{ caseId: string }>;
  searchParams: Promise<{ req?: string; party?: string }>;
}) {
  const { caseId } = await params;
  const { req, party } = await searchParams;
  const actor = await getActor();
  if (!actor || actor.kind !== "client") redirect("/welcome");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("cliente.subir");

  let matrix;
  try {
    matrix = await getDocumentsMatrix(actor, caseId);
  } catch {
    notFound();
  }

  // Resolve the target document name (by requirement + party) for the header.
  const target =
    matrix.items.find(
      (d) =>
        d.requirementId === (req ?? null) && d.partyId === (party ?? null),
    ) ?? matrix.items.find((d) => d.status === "pendiente");

  const baseLabel = target ? pickLocale(target.labelI18n, locale) : t("fallbackName");
  const documentName = target?.partyName
    ? `${baseLabel} · ${target.partyName}`
    : baseLabel;

  return (
    <UploadScreen
      caseId={caseId}
      requirementId={target?.requirementId ?? req ?? null}
      partyId={target?.partyId ?? party ?? null}
      documentName={documentName}
      previousProgress={matrix.progress}
      labels={{
        eyebrow: t("eyebrow"),
        documentTitle: documentName,
        captureTitle: t("captureTitle"),
        captureSub: t("captureSub"),
        takePhoto: t("takePhoto"),
        uploadPdf: t("uploadPdf"),
        okTitle: t("okTitle"),
        okSub: t("okSub"),
        badTitle: t("badTitle"),
        badSub: t("badSub"),
        acceptNote: t("acceptNote"),
        uploadingTitle: t("uploadingTitle"),
        uploadingSub: t("uploadingSub"),
        errPdfOnly: t("errPdfOnly"),
        errTooBig: t("errTooBig"),
        errNetwork: t("errNetwork"),
        back: t("back"),
      }}
      startUpload={startUploadAction}
      confirmUpload={confirmUploadAction}
    />
  );
}
