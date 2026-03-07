import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

function getStripe(): Stripe | null {
  if (stripeInstance) return stripeInstance;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeInstance = new Stripe(key, { typescript: true });
  return stripeInstance;
}

/** Stripe client; null if STRIPE_SECRET_KEY is not set (e.g. production without Stripe). */
export const stripe = getStripe();

/** Use in API routes: returns stripe client or throws with 503-friendly message. */
export function requireStripe(): Stripe {
  const client = getStripe();
  if (!client) throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY to enable payment links.");
  return client;
}
