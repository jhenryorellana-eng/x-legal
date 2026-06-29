import { writeFileSync } from "node:fs";
import * as mupdf from "mupdf";
const M = mupdf;
const OUT = "docs/_evidence/etapa-firma";

// 1. a recognizable test "signature" image (blue text "Firma TOP^") via html->pdf->pixmap->png
function makeSigPng() {
  const html = `<!DOCTYPE html><html><body style="margin:0"><div style="font:bold 30pt sans-serif;color:#1133cc">Firma TOP ^</div></body></html>`;
  const d = M.Document.openDocument(new TextEncoder().encode(html), "text/html");
  d.layout(300, 90, 11);
  const pix = d.loadPage(0).toPixmap(M.Matrix.scale(2,2), M.ColorSpace.DeviceRGB, false);
  return pix.asPNG();
}
const sigPng = makeSigPng();
writeFileSync(`${OUT}/test-signature.png`, Buffer.from(sigPng));

// 2. cert HTML with an invisible sentinel where the signature should stamp
const SENTINEL = "XLATSIGX";
const html = `<!DOCTYPE html><html><head><style>
 body{font-family:'Times New Roman',serif;font-size:12pt;margin:72pt;color:#111}
 .h{font-size:12.5pt;font-weight:bold;margin-top:18pt}
 .stmt{text-align:justify;margin:8pt 0 16pt}
 .lbl{font-weight:bold}
 .anchor{color:#fff;font-size:1pt}
 .rule{display:inline-block;border-bottom:1pt solid #111;width:55%}
</style></head><body>
 <p>Some translated body content here.</p>
 <div style="border-top:1pt solid #999;margin-top:24pt"></div>
 <div class="h">TRANSLATION CERTIFICATION</div>
 <p class="stmt">I, Andrew Sonny Navarro, hereby certify that I translated the attached document from Spanish into English and that, to the best of my ability, it is a true and correct translation.</p>
 <p style="margin:16pt 0 0"><span class="lbl">Signature:</span> <span class="anchor">${SENTINEL}</span></p>
 <div style="height:50pt"></div>
 <p style="margin:0">Date: 29 June 2026</p>
</body></html>`;

function htmlToPdf(h){const doc=M.Document.openDocument(new TextEncoder().encode(h),"text/html");doc.layout(612,792,11);if(typeof doc.toPDFDocument==="function")return doc.toPDFDocument().saveToBuffer("").asUint8Array();const b=new M.Buffer();const w=new M.DocumentWriter(b,"pdf","");const n=doc.countPages();for(let i=0;i<n;i++){const p=doc.loadPage(i);const dv=w.beginPage(p.getBounds());p.run(dv,M.Matrix.identity);w.endPage();}w.close();return b.asUint8Array();}
const basePdf = htmlToPdf(html);

// 3. search the sentinel + inspect the quad structure
const doc = M.Document.openDocument(basePdf, "application/pdf");
const page0 = doc.loadPage(0);
const bounds = page0.getBounds();
console.log("page bounds:", JSON.stringify(bounds));
const stext = page0.toStructuredText("preserve-whitespace");
const hits = stext.search(SENTINEL);
console.log("search result type:", Array.isArray(hits)?("array len "+hits.length):typeof hits);
console.log("hits raw:", JSON.stringify(hits));

// 4. derive a rect from the first hit (try common shapes)
let q = hits && hits.length ? hits[0] : null;
if (Array.isArray(q) && Array.isArray(q[0])) q = q[0]; // nested
console.log("first quad:", JSON.stringify(q));

// best-effort extract x (left) and y (top & bottom) from quad
function quadRect(quad){
  if (!quad) return null;
  if (Array.isArray(quad) && typeof quad[0]==="number"){ // [ulx,uly,urx,ury,llx,lly,lrx,lry] or [x0,y0,x1,y1]
    if (quad.length>=8) return {x0:Math.min(quad[0],quad[4]),y0:Math.min(quad[1],quad[3]),x1:Math.max(quad[2],quad[6]),y1:Math.max(quad[5],quad[7])};
    if (quad.length===4) return {x0:quad[0],y0:quad[1],x1:quad[2],y1:quad[3]};
  }
  if (quad.ul) return {x0:quad.ul.x,y0:quad.ul.y,x1:quad.lr.x,y1:quad.lr.y};
  return null;
}
const r = quadRect(q);
console.log("anchor rect:", JSON.stringify(r));

// 5. stamp the test sig near the anchor and render to PNG (try ctm orientation)
const image = new M.Image(sigPng);
const iw=image.getWidth(), ih=image.getHeight();
const maxW=150, maxH=46;
let drawW=maxW, drawH=drawW*ih/iw;
if(drawH>maxH){ drawH=maxH; drawW=drawH*iw/ih; }
const buf=new M.Buffer(); const writer=new M.DocumentWriter(buf,"pdf","");
const n=doc.countPages();
for(let i=0;i<n;i++){const p=doc.loadPage(i);const dv=writer.beginPage(p.getBounds());p.run(dv,M.Matrix.identity);
 if(i===0 && r){
   const x = r.x1 + 4;             // just right of "Signature:"
   const top = r.y0 - 2;           // image TOP at the signature line; extends DOWN into reserved space
   const ctm = [drawW,0,0,drawH, x, top]; // positive d = upright
   dv.fillImage(image, ctm, 1);
 }
 writer.endPage();}
writer.close();
const stamped=buf.asUint8Array();
writeFileSync(`${OUT}/stamped.pdf`, Buffer.from(stamped));
const sdoc=M.Document.openDocument(stamped,"application/pdf");
const spix=sdoc.loadPage(0).toPixmap(M.Matrix.scale(2,2),M.ColorSpace.DeviceRGB,false);
writeFileSync(`${OUT}/stamped.png`, Buffer.from(spix.asPNG()));
console.log("wrote stamped.png");
