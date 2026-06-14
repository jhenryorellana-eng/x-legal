/**
 * Ambient declaration for Turbopack/webpack `?url` asset imports.
 * Used to resolve the pdfjs-dist worker URL in the PDF viewer.
 */
declare module "*?url" {
  const url: string;
  export default url;
}
