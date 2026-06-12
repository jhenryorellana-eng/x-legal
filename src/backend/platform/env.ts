import { z } from "zod";

/**
 * Typed environment access — DOC-27 §7.2.
 *
 * Single source of env reads for the whole backend; `process.env.X` scattered
 * across the codebase is forbidden. Two validation tiers:
 *
 * 1. Core vars (Supabase, app URL, PII encryption): parsed eagerly at module
 *    load — the app refuses to boot without them (fail fast).
 * 2. Provider vars (Stripe, LiveKit, …): each platform client validates its
 *    own group on first use. Providers are wired phase by phase (DOC-80), so
 *    booting must not require secrets of integrations not yet configured —
 *    but using an unconfigured integration still fails fast and loud.
 *
 * Twilio Verify (SMS OTP) credentials live inside Supabase Auth configuration,
 * not here (DOC-27 §7.1). The TWILIO_* vars below are Twilio Messaging only
 * (transactional SMS: signing link, welcome, signature reminder — DOC-20 §2).
 */

const base64Key = (bytes: number) =>
  z
    .string()
    .refine(
      (value) => {
        try {
          return Buffer.from(value, "base64").length === bytes;
        } catch {
          return false;
        }
      },
      { message: `Expected base64-encoded ${bytes}-byte key` },
    );

const coreSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  /** AES-256-GCM master key, 32 bytes base64 (DOC-27 §2.1). */
  ENCRYPTION_KEY: base64Key(32),
  /** Only present during key rotation (DOC-27 §2.5). */
  ENCRYPTION_KEY_PREVIOUS: base64Key(32).optional(),
});

const providerSchemas = {
  stripe: z.object({
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
  }),
  twilio: z.object({
    TWILIO_ACCOUNT_SID: z.string().min(1),
    TWILIO_AUTH_TOKEN: z.string().min(1),
    TWILIO_MESSAGING_SERVICE_SID: z.string().min(1),
  }),
  qstash: z.object({
    QSTASH_TOKEN: z.string().min(1),
    QSTASH_CURRENT_SIGNING_KEY: z.string().min(1),
    QSTASH_NEXT_SIGNING_KEY: z.string().min(1),
    /** Regional endpoint (e.g. https://qstash-us-east-1.upstash.io). SDK default if absent. */
    QSTASH_URL: z.string().url().optional(),
  }),
  upstashRedis: z.object({
    UPSTASH_REDIS_REST_URL: z.string().url(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  }),
  livekit: z.object({
    LIVEKIT_API_KEY: z.string().min(1),
    LIVEKIT_API_SECRET: z.string().min(1),
    NEXT_PUBLIC_LIVEKIT_URL: z.string().url(),
  }),
  resend: z.object({
    RESEND_API_KEY: z.string().min(1),
    RESEND_WEBHOOK_SECRET: z.string().min(1),
  }),
  anthropic: z.object({
    ANTHROPIC_API_KEY: z.string().min(1),
  }),
  gemini: z.object({
    GEMINI_API_KEY: z.string().min(1),
  }),
  abogados: z.object({
    ABOGADOS_API_KEY: z.string().min(1),
    ABOGADOS_WEBHOOK_SECRET: z.string().min(1),
  }),
  webpush: z.object({
    NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1),
    VAPID_PRIVATE_KEY: z.string().min(1),
  }),
} as const;

type ProviderKey = keyof typeof providerSchemas;
type ProviderEnv<K extends ProviderKey> = z.infer<(typeof providerSchemas)[K]>;

/** Core env — validated at boot. Importing this module fails fast if missing. */
export const env = coreSchema.parse(process.env);

const providerCache = new Map<ProviderKey, unknown>();

/**
 * Provider env — validated on first access by the owning platform client.
 * Throws a descriptive error if the provider is not configured.
 */
export function providerEnv<K extends ProviderKey>(provider: K): ProviderEnv<K> {
  const cached = providerCache.get(provider);
  if (cached) return cached as ProviderEnv<K>;

  const result = providerSchemas[provider].safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");
    throw new Error(
      `Provider "${provider}" is not configured. Missing/invalid env vars: ${missing}. ` +
        `See DOC-82 for the environment inventory.`,
    );
  }
  providerCache.set(provider, result.data);
  return result.data as ProviderEnv<K>;
}
