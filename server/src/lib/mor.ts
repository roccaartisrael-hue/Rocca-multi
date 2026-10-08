import crypto from "crypto";

/**
 * Merchant-of-Record adapter (Lemon Squeezy). The MoR is the seller: it charges the customer, handles tax and issues the
 * receipt/invoice; we only learn "this order was paid" from its signed webhook and then activate the package.
 * Checkout link per product: CHECKOUT_LINK_<SKU>, with CHECKOUT_REF_PARAM="checkout[custom][ref]" so our signed ref
 * travels through checkout and comes back in meta.custom_data.ref.
 */

/** Lemon Squeezy signs the RAW body: X-Signature = hex(HMAC-SHA256(rawBody, signing secret)). */
export function verifyLemonSignature(raw: Buffer | undefined, header: string | undefined, secret: string): boolean {
  if (!raw || !header || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const given = String(header).trim().toLowerCase();
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export interface LemonPayment {
  event: string;
  ref: string;
  paymentRef: string; // unique per charge: idempotency key
  variantId: string; // the product variant that was actually bought ("" when the event does not carry it)
  renewal: boolean;
}

/** Turns a webhook body into "a charge to apply", or null for events that must not change anything. */
export function parseLemonEvent(body: any): LemonPayment | null {
  const event = String(body?.meta?.event_name || "");
  const ref = String(body?.meta?.custom_data?.ref || "");
  const a = body?.data?.attributes || {};
  const id = String(body?.data?.id || "");
  if (!id || !ref) return null;
  if (event === "order_created") {
    // also fires (together with subscription_created) for the FIRST payment of a subscription
    if (a.status !== "paid") return null;
    return { event, ref, paymentRef: `ls-order-${id}`, variantId: String(a.first_order_item?.variant_id ?? ""), renewal: false };
  }
  if (event === "subscription_payment_success") {
    // initial payments are already covered by order_created; only later charges count here
    if (a.billing_reason !== undefined && a.billing_reason !== "renewal") return null;
    return { event, ref, paymentRef: `ls-inv-${id}`, variantId: "", renewal: true };
  }
  return null;
}
