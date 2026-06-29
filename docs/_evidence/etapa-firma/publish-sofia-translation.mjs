/**
 * AUTHORIZED prod write (Henry, this session): regenerates the "Acta Nacimiento Sofia"
 * translation (Asilo case 35023394) with the NEW format + the service's configured
 * signature stamped, overwrites the existing translated PDF in `generated`, and
 * updates the document_translations row's text so the staff "Ver PDF de traducción"
 * shows the signed document. Faithful to executeTranslationJob + pdf.ts.
 *
 * Usage: node docs/_evidence/etapa-firma/publish-sofia-translation.mjs
 */
import { readFileSync } from "node:fs";
import MarkdownIt from "markdown-it";
import * as mupdf from "mupdf";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const ROOT = "C:/Users/mauri/Documents/Trabajos/usalatino-v2";
const M = mupdf;
const env = (k) => (readFileSync(`${ROOT}/.env.local`, "utf8").match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const SERVICE_ID = "344b44c9-0800-456d-87f7-d5c29e537d1b"; // asilo-politico (has the signature)
const TRANSLATION_ID = "bb292e58-4df7-41e3-abeb-d3781ab22663";
const PDF_PATH = "case/35023394-b5b7-43cc-9111-5fcf865a9e6f/translations/sofia-acta-en.pdf";

// 1. service translation config + signature image (what getServiceTranslationConfig does)
const { data: svc } = await sb.from("services").select("translation_signer_name, translation_signature_path").eq("id", SERVICE_ID).maybeSingle();
const dl = await sb.storage.from("catalog-assets").download(svc.translation_signature_path);
const sigBytes = new Uint8Array(await dl.data.arrayBuffer());
console.log("signer:", svc.translation_signer_name, "| signature bytes:", sigBytes.length);

// 2. realistic Spanish source for Sofía + real Gemini translate (new prompt)
const source = `REGISTRO CIVIL DE QUITO — REPÚBLICA DEL ECUADOR
ACTA DE INSCRIPCIÓN DE NACIMIENTO

Número de inscripción: N-060-000112-18
Número de cédula: 1750488890

En Quito, Provincia de Pichincha, el 21 de septiembre de 2010, el suscrito Jefe del Registro Civil expide la presente inscripción de nacimiento para:

Nombres: Sofía Crystel
Apellidos: Defaz González
Sexo: Femenino
Lugar y fecha de nacimiento: Quito, Provincia de Pichincha, Ecuador, el 18 de julio de 2010.
Padre: Diego Iván Defaz Arteaga, cédula 1716384415, nacionalidad ecuatoriana, estado civil soltero.
Madre: Diana Carolina González Barrera, cédula 1720905957, nacionalidad ecuatoriana, estado civil soltera.

OBSERVACIONES
Los padres comparecen y solicitan la inscripción. Padres solteros. Hospital G.O.I.A., Dr. Michael Veintimilla; Código: 9855.`;
const formatGuidance = " Format the result as clean Markdown that mirrors the source so it reads clearly: use a level-1 heading (#) for the document's own title and level-2 headings (##) for sections; write a 2-column Markdown table (| Field | Detail |) for blocks of label-value data (registry fields such as 'Given names', 'Date of birth', 'Father', 'Registration number'), and prose paragraphs for narrative text; keep line breaks and lists. Preserve names, numbers and dates exactly. Do not add notes or commentary, and do not wrap the answer in a code fence.";
const prompt = "Translate the following document from Spanish to English. Be faithful and do not summarize. Preserve names, numbers and dates exactly. Mark illegible text as [illegible]." + formatGuidance;
const genai = new GoogleGenAI({ apiKey: env("GEMINI_API_KEY") });
const resp = await genai.models.generateContent({ model: env("AI_GEMINI_MODEL") || "gemini-2.5-flash", contents: [{ role: "user", parts: [{ text: `${prompt}\n\n---\n${source}` }] }], config: { temperature: 0.2, maxOutputTokens: 65536 } });
function strip(t){const x=t.trim();const m=/^```[a-zA-Z0-9]*\n([\s\S]*?)\n?```$/.exec(x);return m?m[1].trim():x;}
const translatedText = strip(resp.candidates?.[0]?.content?.parts?.[0]?.text ?? "");

// 3. render (verbatim pdf.ts) + stamp
const ANCHOR = "XULPSIGNATUREANCHORX";
const STYLE = `<style>body{font-family:'Times New Roman',serif;font-size:12pt;line-height:1.5;margin:64pt 72pt;color:#111}.xt-global-title{font-size:18pt;text-align:center;font-weight:bold;letter-spacing:1pt;text-transform:uppercase;margin:0 0 6pt;line-height:1.25}.xt-global-rule{width:44%;margin:0 auto 18pt;border:none;border-top:1.4pt solid #111}h1{font-size:14pt;text-align:center;font-weight:bold;margin:0 0 14pt}h2{font-size:12.5pt;font-weight:bold;letter-spacing:.3pt;margin:15pt 0 6pt}p{margin:0 0 9pt;text-align:justify}table{border-collapse:collapse;width:100%;margin:7pt 0 13pt;table-layout:fixed}th,td{border:0.5pt solid #bbb;padding:4pt 8pt;text-align:left;vertical-align:top;word-break:break-word}th{background:#eee;font-weight:bold}th:first-child,td:first-child{font-weight:bold;width:170pt}.xt-cert-heading{font-size:12.5pt;font-weight:bold;letter-spacing:.3pt;margin:26pt 0 0;border-top:1pt solid #999;padding-top:12pt}.xt-cert-stmt{text-align:justify;margin:8pt 0 16pt}.xt-sig-label{font-weight:bold}.xt-sig-anchor{color:#fff;font-size:1pt}.xt-sig-line{margin:16pt 0 0}.xt-sig-space{height:52pt}.xt-sig-date{margin:0;font-size:11pt}</style>`;
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const name = svc.translation_signer_name;
const stmt = `I, ${esc(name)}, hereby certify that I translated the attached document from Spanish into English and that, to the best of my ability, it is a true and correct translation. I further certify that I am competent in both Spanish and English to render and certify such translation.`;
const mdi = new MarkdownIt({ html: false, linkify: false, breaks: true });
const html = `<!DOCTYPE html><html><head>${STYLE}</head><body><div class="xt-global-title">CERTIFIED TRANSLATION FROM SPANISH TO ENGLISH</div><hr class="xt-global-rule"/>${mdi.render(translatedText)}<div class="xt-cert-heading">TRANSLATION CERTIFICATION</div><p class="xt-cert-stmt">${stmt}</p><p class="xt-sig-line"><span class="xt-sig-label">Signature:</span> <span class="xt-sig-anchor">${ANCHOR}</span></p><div class="xt-sig-space"></div><p class="xt-sig-date">Date: 29 June 2026</p></body></html>`;
function htmlToPdf(h){const d=M.Document.openDocument(new TextEncoder().encode(h),"text/html");d.layout(612,792,11);if(typeof d.toPDFDocument==="function")return d.toPDFDocument().saveToBuffer("").asUint8Array();const b=new M.Buffer();const w=new M.DocumentWriter(b,"pdf","");for(let i=0;i<d.countPages();i++){const p=d.loadPage(i);const dv=w.beginPage(p.getBounds());p.run(dv,M.Matrix.identity);w.endPage();}w.close();return b.asUint8Array();}
function qr(q){if(Array.isArray(q)&&typeof q[0]==="number"&&q.length>=8)return{x1:Math.max(q[2],q[6]),y0:Math.min(q[1],q[3])};return null;}
function stamp(pdf,img){const src=M.Document.openDocument(pdf,"application/pdf");const image=new M.Image(img);const iw=image.getWidth(),ih=image.getHeight();let dw=165,dh=165*ih/iw;if(dh>48){dh=48;dw=48*iw/ih;}let tg=null;const n=src.countPages();for(let i=0;i<n&&!tg;i++){const st=src.loadPage(i).toStructuredText("preserve-whitespace");let h;try{h=st.search(ANCHOR);}catch{h=null;}if(Array.isArray(h)&&h.length){let q=h[0];while(Array.isArray(q)&&Array.isArray(q[0]))q=q[0];const r=qr(q);if(r)tg={page:i,x:r.x1+4,y:r.y0-2};}}if(!tg)return pdf;const buf=new M.Buffer();const w=new M.DocumentWriter(buf,"pdf","");for(let i=0;i<n;i++){const p=src.loadPage(i);const dv=w.beginPage(p.getBounds());p.run(dv,M.Matrix.identity);if(i===tg.page)dv.fillImage(image,[dw,0,0,dh,tg.x,tg.y],1);w.endPage();}w.close();return buf.asUint8Array();}
const pdf = stamp(htmlToPdf(html), sigBytes);
console.log("rendered signed PDF:", pdf.length, "bytes");

// 4. AUTHORIZED prod writes: overwrite the generated PDF + sync the row text
const up = await sb.storage.from("generated").upload(PDF_PATH, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
if (up.error) throw new Error("upload failed: " + up.error.message);
const { error: uerr } = await sb.from("document_translations").update({ translated_text: translatedText, updated_at: new Date().toISOString() }).eq("id", TRANSLATION_ID);
if (uerr) throw new Error("row update failed: " + uerr.message);
console.log("DONE — overwrote", PDF_PATH, "and synced translated_text. View it via the staff translate modal.");
