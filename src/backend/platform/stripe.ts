/**
 * Stripe client — DOC-20 §2 (Stripe Checkout hosted, webhooks).
 *
 * Single Stripe instance with a pinned API version.
 * Stripe Checkout is the ONLY payment surface (no Elements / Payment Links).
 * Webhook verification is handled by `stripe.webhooks.constructEvent()` in
 * the webhook route handler (DOC-27 §3.1).
 *
 * Usage:
 *   import { stripe } from '@/backend/platform/stripe';
 *   const session = await stripe.checkout.sessions.create({ ... });
 */

import Stripe from "stripe";
import { providerEnv } from "./env";

// ---------------------------------------------------------------------------
// Client factory (lazy singleton)
// ---------------------------------------------------------------------------

let _stripe: Stripe | null = null;

/**
 * Returns the Stripe SDK instance, configured with the pinned API version.
 * Validates provider env on first access.
 */
export function getStripe(): Stripe {
  if (!_stripe) {
    const senv = providerEnv("stripe");
    _stripe = new Stripe(senv.STRIPE_SECRET_KEY, {
      // Pinned API version — update deliberately after reading Stripe changelog
      apiVersion: "2026-05-27.dahlia",
      typescript: true,
    });
  }
  return _stripe;
}

/**
 * Re-exported for convenience. Callers can import `stripe` directly.
 *
 * Note: this is a getter-backed export so the lazy init still applies.
 * Most callers will use it as: `import { stripe } from '@/backend/platform/stripe'`
 */
export const stripe = new Proxy({} as Stripe, {
  get(_target, prop: string) {
    return getStripe()[prop as keyof Stripe];
  },
});
