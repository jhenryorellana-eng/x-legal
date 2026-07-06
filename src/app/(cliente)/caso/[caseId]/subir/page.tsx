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
import { startUploadAction, confirmUploadAction, getExtractionStatusAction } from "./actions";

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
  const td = await getTranslations("cliente.documentos");

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
    ? `${baseLabel} ${td("partyConnector")} ${target.partyName}`
    : baseLabel;

  // Admin-configured upload format for this document (pdf | png). Drives the
  // file picker `accept`, client validation, and the format-aware copy.
  const acceptedFormat = target?.acceptedFormat ?? "pdf";
  const fmt = acceptedFormat.toUpperCase();

  return (
    <UploadScreen
      caseId={caseId}
      requirementId={target?.requirementId ?? req ?? null}
      partyId={target?.partyId ?? party ?? null}
      documentName={documentName}
      acceptedFormat={acceptedFormat}
      aiExtract={target?.aiExtract ?? false}
      allowMultiple={target?.allowMultiple ?? false}
      previousProgress={matrix.progress}
      labels={{
        eyebrow: t("eyebrow"),
        documentTitle: documentName,
        captureTitle: t("captureTitle"),
        captureSub: t("captureSub"),
        uploadDoc: t("uploadDoc"),
        okTitle: t("okTitle"),
        okSub: t("okSub"),
        badTitle: t("badTitle"),
        badSub: t("badSub"),
        acceptNote: t("acceptNote", { format: fmt }),
        uploadingTitle: t("uploadingTitle"),
        uploadingSub: t("uploadingSub"),
        checkingQuality: t("checkingQuality"),
        errFormat: t("errFormat", { format: fmt }),
        errTooBig: t("errTooBig"),
        errNetwork: t("errNetwork"),
        blurMsg: t("blurMsg"),
        back: t("back"),
        analyzingTitle: t("analyzingTitle"),
        analyzingSub: t("analyzingSub"),
        reviewTitle: t("reviewTitle"),
        reviewSub: t("reviewSub"),
        reviewBadge: t("reviewBadge"),
        reviewContinue: t("reviewContinue"),
        reviewEmpty: t("reviewEmpty"),
        reviewFailedTitle: t("reviewFailedTitle"),
        reviewFailedSub: t("reviewFailedSub"),
        nameLabel: t("nameLabel"),
        namePlaceholder: t("namePlaceholder"),
        nameRequired: t("nameRequired"),
      }}
      startUpload={startUploadAction}
      confirmUpload={confirmUploadAction}
      getExtractionStatus={getExtractionStatusAction}
    />
  );
}
