/**
 * Evidence (read-only): the END-TO-END admin→render loop with REAL stored data.
 * Reads the Asilo service's translation config from the DB, DOWNLOADS the signature
 * image the admin uploaded to catalog-assets (what getServiceTranslationConfig does),
 * and renders the cached translation with that signer name + stamped signature.
 * No prod writes.
 *
 * Usage: node docs/_evidence/etapa-firma/verify-stored-config.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import MarkdownIt from "markdown-it";
import * as mupdf from "mupdf";
import { createClient } from "@supabase/supabase-js";

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const OUT = `${ROOT}/docs/_evidence/etapa-firma`;
const M = mupdf;
const env = (k) => (readFileSync(`${ROOT}/.env.local`, "utf8").match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const SERVICE_ID = "344b44c9-0800-456d-87f7-d5c29e537d1b"; // asilo-politico

// 1. read the per-service config (what getServiceTranslationConfig reads)
const { data: svc } = await sb.from("services").select("translation_signer_name, translation_signature_path").eq("id", SERVICE_ID).maybeSingle();
console.log("config:", JSON.stringify(svc));
if (!svc?.translation_signature_path) throw new Error("no signature configured");

// 2. download the signature image from catalog-assets (what the job does)
const dl = await sb.storage.from("catalog-assets").download(svc.translation_signature_path);
if (dl.error || !dl.data) throw new Error("signature download failed: " + (dl.error?.message || "no data"));
const sigBytes = new Uint8Array(await dl.data.arrayBuffer());
console.log("downloaded signature:", sigBytes.length, "bytes");

// ===== verbatim render (pdf.ts F section) =====
const SIGNATURE_ANCHOR = "XULPSIGNATUREANCHORX";
const TRANSLATION_STYLE = `<style>
  body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5;margin:64pt 72pt;color:#111}
  .xt-global-title{font-size:18pt;text-align:center;font-weight:bold;letter-spacing:1pt;text-transform:uppercase;margin:0 0 6pt;line-height:1.25}
  .xt-global-rule{width:44%;margin:0 auto 18pt;border:none;border-top:1.4pt solid #111}
  h1{font-size:14pt;text-align:center;font-weight:bold;margin:0 0 14pt;line-height:1.3}
  h2{font-size:12.5pt;font-weight:bold;letter-spacing:.3pt;margin:15pt 0 6pt}
  p{margin:0 0 9pt;text-align:justify}
  table{border-collapse:collapse;width:100%;margin:7pt 0 13pt;table-layout:fixed}
  th,td{border:0.5pt solid #bbb;padding:4pt 8pt;text-align:left;vertical-align:top;word-break:break-word}
  th{background:#eee;font-weight:bold}
  th:first-child,td:first-child{font-weight:bold;width:170pt}
  .xt-cert-heading{font-size:12.5pt;font-weight:bold;letter-spacing:.3pt;margin:26pt 0 0;border-top:1pt solid #999;padding-top:12pt}
  .xt-cert-stmt{text-align:justify;margin:8pt 0 16pt}
  .xt-sig-label{font-weight:bold}.xt-sig-anchor{color:#fff;font-size:1pt}.xt-sig-line{margin:16pt 0 0}.xt-sig-space{height:52pt}.xt-sig-date{margin:0;font-size:11pt}
</style>`;
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
function buildHtml(bodyHtml, name, date) {
  const stmt = `I, ${esc(name)}, hereby certify that I translated the attached document from Spanish into English and that, to the best of my ability, it is a true and correct translation. I further certify that I am competent in both Spanish and English to render and certify such translation.`;
  return `<!DOCTYPE html><html><head>${TRANSLATION_STYLE}</head><body><div class="xt-global-title">CERTIFIED TRANSLATION FROM SPANISH TO ENGLISH</div><hr class="xt-global-rule"/>${bodyHtml}<div class="xt-cert-heading">TRANSLATION CERTIFICATION</div><p class="xt-cert-stmt">${stmt}</p><p class="xt-sig-line"><span class="xt-sig-label">Signature:</span> <span class="xt-sig-anchor">${SIGNATURE_ANCHOR}</span></p><div class="xt-sig-space"></div><p class="xt-sig-date">Date: ${esc(date)}</p></body></html>`;
}
function htmlToPdf(html){const d=M.Document.openDocument(new TextEncoder().encode(html),"text/html");d.layout(612,792,11);if(typeof d.toPDFDocument==="function")return d.toPDFDocument().saveToBuffer("").asUint8Array();const b=new M.Buffer();const w=new M.DocumentWriter(b,"pdf","");for(let i=0;i<d.countPages();i++){const p=d.loadPage(i);const dv=w.beginPage(p.getBounds());p.run(dv,M.Matrix.identity);w.endPage();}w.close();return b.asUint8Array();}
function quadToRect(q){if(Array.isArray(q)&&typeof q[0]==="number"){if(q.length>=8)return{x0:Math.min(q[0],q[4]),y0:Math.min(q[1],q[3]),x1:Math.max(q[2],q[6]),y1:Math.max(q[5],q[7])};}return null;}
function stamp(pdfBytes,imgBytes){const src=M.Document.openDocument(pdfBytes,"application/pdf");const image=new M.Image(imgBytes);const iw=image.getWidth(),ih=image.getHeight();let dw=165,dh=165*ih/iw;if(dh>48){dh=48;dw=48*iw/ih;}let tgt=null;const n=src.countPages();for(let i=0;i<n&&!tgt;i++){const st=src.loadPage(i).toStructuredText("preserve-whitespace");let h;try{h=st.search(SIGNATURE_ANCHOR);}catch{h=null;}if(Array.isArray(h)&&h.length){let q=h[0];while(Array.isArray(q)&&Array.isArray(q[0]))q=q[0];const r=quadToRect(q);if(r)tgt={page:i,x:r.x1+4,y:r.y0-2};}}if(!tgt)return pdfBytes;const buf=new M.Buffer();const w=new M.DocumentWriter(buf,"pdf","");for(let i=0;i<n;i++){const p=src.loadPage(i);const dv=w.beginPage(p.getBounds());p.run(dv,M.Matrix.identity);if(i===tgt.page)dv.fillImage(image,[dw,0,0,dh,tgt.x,tgt.y],1);w.endPage();}w.close();return buf.asUint8Array();}
// ===== end verbatim =====

const md = readFileSync(`${OUT}/_cache.md`, "utf8");
const mdi = new MarkdownIt({ html: false, linkify: false, breaks: true });
let pdf = htmlToPdf(buildHtml(mdi.render(md), svc.translation_signer_name, "29 June 2026"));
pdf = stamp(pdf, sigBytes);
writeFileSync(`${OUT}/stored-config-result.pdf`, Buffer.from(pdf));
const rdoc = M.Document.openDocument(pdf, "application/pdf");
for (let i = 0; i < rdoc.countPages(); i++) writeFileSync(`${OUT}/stored-config-p${i + 1}.png`, Buffer.from(rdoc.loadPage(i).toPixmap(M.Matrix.scale(2, 2), M.ColorSpace.DeviceRGB, false).asPNG()));
console.log("rendered stored-config-result.pdf —", rdoc.countPages(), "pages | signer:", svc.translation_signer_name);
