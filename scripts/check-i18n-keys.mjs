// CI gate — key parity + non-empty values between es.json and en.json
// (DOC-23, DOC-20 §2). Fails if any key exists in one locale and not the other,
// OR if any string value is empty/whitespace in either locale (an empty value
// renders as a blank label in the UI — caught here, not in production).
import { readFileSync } from "node:fs";

const flattenEntries = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === "object"
      ? flattenEntries(value, path)
      : [[path, value]];
  });

const es = JSON.parse(readFileSync("src/frontend/i18n/messages/es.json", "utf8"));
const en = JSON.parse(readFileSync("src/frontend/i18n/messages/en.json", "utf8"));

const esEntries = flattenEntries(es);
const enEntries = flattenEntries(en);
const esKeys = new Set(esEntries.map(([k]) => k));
const enKeys = new Set(enEntries.map(([k]) => k));

const missingInEn = [...esKeys].filter((k) => !enKeys.has(k));
const missingInEs = [...enKeys].filter((k) => !esKeys.has(k));

// Keys that are intentionally empty in BOTH locales: name fallbacks consumed as
// `displayName || t("fallbackName")`, where an empty value degrades gracefully
// to no name. Listed here so the guard still catches NEW accidental empties.
const INTENTIONALLY_EMPTY = new Set([
  "cliente.home.fallbackName",
  "cliente.exito.fallbackName",
  "cliente.proceso.fallbackName",
]);

const isEmpty = (v) => typeof v === "string" && v.trim() === "";
const emptyEs = esEntries.filter(([k, v]) => isEmpty(v) && !INTENTIONALLY_EMPTY.has(k)).map(([k]) => k);
const emptyEn = enEntries.filter(([k, v]) => isEmpty(v) && !INTENTIONALLY_EMPTY.has(k)).map(([k]) => k);

let failed = false;

if (missingInEn.length || missingInEs.length) {
  failed = true;
  if (missingInEn.length) {
    console.error(`Claves en es.json sin traducción en en.json (${missingInEn.length}):`);
    for (const k of missingInEn) console.error(`  - ${k}`);
  }
  if (missingInEs.length) {
    console.error(`Claves en en.json que no existen en es.json (${missingInEs.length}):`);
    for (const k of missingInEs) console.error(`  - ${k}`);
  }
}

if (emptyEs.length || emptyEn.length) {
  failed = true;
  if (emptyEs.length) {
    console.error(`Claves con valor vacío en es.json (${emptyEs.length}):`);
    for (const k of emptyEs) console.error(`  - ${k}`);
  }
  if (emptyEn.length) {
    console.error(`Claves con valor vacío en en.json (${emptyEn.length}):`);
    for (const k of emptyEn) console.error(`  - ${k}`);
  }
}

if (failed) process.exit(1);
console.log(`check-i18n-keys: OK (${esKeys.size} claves, paridad es/en, sin valores vacíos)`);
