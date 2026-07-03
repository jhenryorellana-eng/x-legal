/**
 * demo-assets — public border (module-pub).
 *
 * Real PDFs backing the admin live-demo. Server Components read the signed
 * URLs through here; mutations go through `actions.ts`.
 *
 * @module demo-assets
 */

export { getDemoAssetUrls, type DemoAssetSlotStatus } from "./service";
