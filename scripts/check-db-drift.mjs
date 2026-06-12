// CI gate `db-types-drift` — DOC-33 §4.
// Regenerates database types against the target project and fails if the
// result differs from the committed src/shared/database.types.ts.
// Drift means: someone migrated without regenerating types, or someone touched
// the DB outside supabase/migrations/. Both are fixed in the PR, never forced.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PROJECT_ID = process.env.SUPABASE_PROJECT_ID ?? "uexxyokexcamyjcknxua";
const useLocal = process.argv.includes("--local");

const normalize = (s) => s.replace(/\r\n/g, "\n").trimEnd();

const committed = readFileSync("src/shared/database.types.ts", "utf8");
const cmd = useLocal
  ? "npx supabase gen types typescript --local --schema public"
  : `npx supabase gen types typescript --project-id ${PROJECT_ID} --schema public`;

const fresh = execSync(cmd, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

if (normalize(fresh) !== normalize(committed)) {
  console.error(
    "DB drift: database.types.ts no coincide con el esquema. Corre `npm run db:types` y commitea.",
  );
  process.exit(1);
}
console.log("db-types-drift: OK (sin drift)");
