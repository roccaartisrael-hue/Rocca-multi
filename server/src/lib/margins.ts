import { TIERS } from "./plans";

/** Minimum gross margin every paid plan must keep, even if the customer burns the whole monthly cost cap. */
export const TARGET_GROSS_MARGIN = Number(process.env.TARGET_MARGIN) || 0.8;

const PAY_PCT = Number(process.env.PAY_PCT) || 0.029; // card fee %
const PAY_FX = Number(process.env.PAY_FX) || 0.01; // currency conversion %
const PAY_FIXED_USD = Number(process.env.PAY_FIXED_USD) || 0.3;

/**
 * Worst-case gross margin per paid tier: (price net of VAT − payment fees − full cost cap) / net price.
 * priceIls in TIERS includes VAT. Exposed to the operator at /api/admin/margins.
 */
export function tierMargins(vat = Number(process.env.VAT_RATE) || 0.18, usdIls = Number(process.env.USD_ILS) || 3.1) {
  return Object.values(TIERS)
    .filter((t) => t.priceIls > 0)
    .map((t) => {
      const net = t.priceIls / (1 + vat);
      const fee = t.priceIls * (PAY_PCT + PAY_FX) + PAY_FIXED_USD * usdIls;
      const margin = (net - fee - t.costCapIls) / net;
      return { tier: t.name, priceIls: t.priceIls, costCapIls: t.costCapIls, worstCaseMargin: Math.round(margin * 1000) / 1000, ok: margin >= TARGET_GROSS_MARGIN };
    });
}
