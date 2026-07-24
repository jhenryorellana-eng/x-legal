/**
 * platform/emails — branded react-email rendering (DOC-73 §3).
 *
 * Public surface for jobs (deliver-notification, send-campaign) and the
 * campaigns service (sendTest). Templates and theme are internal.
 */

export {
  renderTransactionalEmail,
  renderCampaignEmail,
} from "./render";
export {
  buildPaymentReceiptPdfHtml,
  renderPaymentReceiptPdf,
  receiptPdfFilename,
} from "./receipt-pdf";
export { pickLocale, emailSubject, type Locale } from "./i18n";
export {
  EmailDataSchema,
  type EmailData,
  type WelcomeEmailData,
  type ContractReadyEmailData,
  type PaymentReceiptEmailData,
} from "./data";
