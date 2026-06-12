// CI gate — key parity between es.json and en.json (DOC-23, DOC-20 §2).
// Fails if any key exists in one locale and not the other. ES is the
// reference locale; EN must mirror its full key tree.
import { readFileSync } from "node:fs";

const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === "object"
      ? flatten(value, path)
      : [path];
  });

const es = JSON.parse(readFileSync("src/frontend/i18n/messages/es.json", "utf8"));
const en = JSON.parse(readFileSync("src/frontend/i18n/messages/en.json", "utf8"));

const esKeys = new Set(flatten(es));
const enKeys = new Set(flatten(en));

const missingInEn = [...esKeys].filter((k) => !enKeys.has(k));
const missingInEs = [...enKeys].filter((k) => !esKeys.has(k));

if (missingInEn.length || missingInEs.length) {
  if (missingInEn.length) {
    console.error(`Claves en es.json sin traducción en en.json (${missingInEn.length}):`);
    for (const k of missingInEn) console.error(`  - ${k}`);
  }
  if (missingInEs.length) {
    console.error(`Claves en en.json que no existen en es.json (${missingInEs.length}):`);
    for (const k of missingInEs) console.error(`  - ${k}`);
  }
  process.exit(1);
}
console.log(`check-i18n-keys: OK (${esKeys.size} claves, paridad es/en)`);
