/**
 * Demo tools — external tools embedded in the /admin/demo section, single
 * source of truth shared by frontend and middleware.
 *
 * Unlike scenarios (pure-UI walkthroughs authored in
 * `src/frontend/features/admin/demo/scenarios/`), a demo tool is a trusted
 * external app rendered inside an <iframe>. One entry here produces the index
 * card, the `/admin/demo/{slug}` route and the CSP `frame-src` origin — adding
 * a tool never touches the middleware or the pages.
 *
 * Labels are plain Spanish on purpose: like the scenario fixtures, demo
 * content is authored (already localized) data, not chrome (DOC-53 demo tab).
 *
 * NB: the embedded app must allow this site as an ancestor (its
 * `frame-ancestors` must include https://x-legal.usalatinoprime.com) — the
 * iframe renders only in production, never on localhost or Vercel previews.
 */

export interface DemoTool {
  /** Stable slug — becomes the route `/admin/demo/{slug}`. Must NOT collide with a scenario slug. */
  slug: string;
  /** Card + header title (authored Spanish content, not i18n chrome). */
  label: string;
  /** Brand IconName as a string (shared cannot import frontend); cast at the edge. */
  icon: string;
  /** Catalog color key (resolved with `serviceColorToken` in the frontend). */
  colorKey: string;
  /** Full https URL of the embedded tool. */
  url: string;
}

export const DEMO_TOOLS: Record<string, DemoTool> = {
  "evaluacion-asilo": {
    slug: "evaluacion-asilo",
    label: "Evaluación Asilo",
    icon: "scale",
    colorKey: "purple",
    url: "https://juez.vercel.app/",
  },
};

export function listDemoTools(): DemoTool[] {
  return Object.values(DEMO_TOOLS);
}

export function getDemoTool(slug: string): DemoTool | undefined {
  return DEMO_TOOLS[slug];
}

/**
 * Unique origins for the CSP `frame-src` directive — derived once at module
 * scope (the middleware interpolates them per request without recomputing).
 * Origins only, never paths: CSP source expressions with a path would silently
 * stop matching after a redirect.
 */
export const DEMO_TOOL_FRAME_ORIGINS: readonly string[] = [
  ...new Set(listDemoTools().map((tool) => new URL(tool.url).origin)),
];
