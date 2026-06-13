/**
 * Minimal JPEG → single-page PDF builder (zero dependencies, server-only).
 *
 * The `contracts` storage bucket only accepts `.pdf` and contracts.signContract
 * validates the uploaded object's PDF magic bytes. The SignaturePad output is
 * re-encoded to JPEG on the client (`canvas.toDataURL("image/jpeg")`), so we can
 * embed the JPEG bytes verbatim as a `/DCTDecode` image XObject in a tiny
 * hand-written PDF — no PDF library (adding one is prohibited, DOC-50 §5 rule 3).
 *
 * The output starts with `%PDF-` so it passes the magic-byte check in
 * platform/storage.validateUploadedObject. The signature image is the legal
 * artifact stored at `contracts/signatures/{token}-{ts}.pdf`.
 */

/** Reads width/height from a JPEG buffer's SOF marker. */
function readJpegSize(jpg: Buffer): { width: number; height: number } {
  let i = 2; // skip SOI (FF D8)
  while (i < jpg.length - 1) {
    if (jpg[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = jpg[i + 1];
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 carry dimensions.
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const height = jpg.readUInt16BE(i + 5);
      const width = jpg.readUInt16BE(i + 7);
      return { width, height };
    }
    if (i + 3 >= jpg.length) break;
    const len = jpg.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return { width: 600, height: 200 };
}

/**
 * Assembles a single-page PDF embedding the given JPEG image, with a correct
 * cross-reference table.
 */
function assemble(
  objStrings: string[],
  imageObjectIndex: number,
  imageBytes: Buffer,
): Buffer {
  const header = Buffer.from("%PDF-1.4\n%\xff\xff\xff\xff\n", "latin1");
  const parts: Buffer[] = [header];
  const offsets: number[] = [];
  let pos = header.length;

  for (let n = 0; n < objStrings.length; n++) {
    const idx = n + 1;
    offsets[idx] = pos;
    if (idx === imageObjectIndex) {
      const open = Buffer.from(`${idx} 0 obj\n${objStrings[n]}\nstream\n`, "latin1");
      const close = Buffer.from("\nendstream\nendobj\n", "latin1");
      parts.push(open, imageBytes, close);
      pos += open.length + imageBytes.length + close.length;
    } else {
      const body = Buffer.from(`${idx} 0 obj\n${objStrings[n]}\nendobj\n`, "latin1");
      parts.push(body);
      pos += body.length;
    }
  }

  const xrefStart = pos;
  const count = objStrings.length + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let i = 1; i < count; i++) {
    xref += String(offsets[i] ?? 0).padStart(10, "0") + " 00000 n \n";
  }
  const trailer = `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  parts.push(Buffer.from(xref + trailer, "latin1"));

  return Buffer.concat(parts);
}

/**
 * Wraps a JPEG (as a data URL) into a minimal one-page PDF.
 *
 * @param jpegDataUrl - "data:image/jpeg;base64,...." (re-encoded SignaturePad output)
 * @returns the PDF file bytes (Buffer)
 */
export function jpegDataUrlToPdf(jpegDataUrl: string): Buffer {
  const comma = jpegDataUrl.indexOf(",");
  const base64 = comma >= 0 ? jpegDataUrl.slice(comma + 1) : jpegDataUrl;
  const jpg = Buffer.from(base64, "base64");
  const { width: imgW, height: imgH } = readJpegSize(jpg);

  const pageW = 595;
  const pageH = 842;
  const maxW = pageW - 120;
  const maxH = 300;
  const ratio = Math.min(maxW / imgW, maxH / imgH);
  const drawW = Math.max(1, Math.round(imgW * ratio));
  const drawH = Math.max(1, Math.round(imgH * ratio));
  const x = Math.round((pageW - drawW) / 2);
  const y = Math.round((pageH - drawH) / 2);

  const content = `q\n${drawW} 0 0 ${drawH} ${x} ${y} cm\n/Im0 Do\nQ\n`;
  const contentLen = Buffer.byteLength(content, "latin1");

  // Object 4 (content stream) needs its body inline; emit it as a stream obj.
  const objStrings = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${contentLen} >>\nstream\n${content}\nendstream`,
    `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>`,
  ];

  return assemble(objStrings, 5, jpg);
}
