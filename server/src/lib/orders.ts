import path from "path";
import { v4 as uuid } from "uuid";
import { readDoc, writeDoc } from "./persist";
import { Sku, vatBreakdown, vatRate } from "./billing";

const FILE = path.join(__dirname, "..", "..", "data", "orders.json");

/** One purchase: the price is frozen at the moment the customer confirms, so what they saw is what is recorded. */
export interface Order {
  id: string;
  sku: string;
  label: string;
  netIls: number;
  vatIls: number;
  grossIls: number;
  vatRate: number;
  cycle?: string;
  commitmentMonths: number;
  status: "pending" | "paid" | "cancelled";
  method: "web" | "manual"; // web = hosted checkout + payment webhook; manual = activated by the operator (deal closed in the field)
  ref?: string;
  paymentRef?: string;
  note?: string;
  termsAcceptedAt?: string;
  createdAt: string;
  paidAt?: string;
}

const read = (): Order[] => {
  try {
    return JSON.parse(readDoc(FILE) || "[]");
  } catch {
    return [];
  }
};
const write = (l: Order[]) => writeDoc(FILE, JSON.stringify(l.slice(0, 1000), null, 2));

export const listOrders = (): Order[] => read();

export function createOrder(sku: Sku, ref: string, termsAcceptedAt: string): Order {
  const b = vatBreakdown(sku.priceIls);
  const o: Order = { id: uuid(), sku: sku.id, label: sku.label, ...b, vatRate: vatRate(), cycle: sku.cycle, commitmentMonths: sku.commitmentMonths ?? 0, status: "pending", method: "web", ref, termsAcceptedAt, createdAt: new Date().toISOString() };
  const all = read();
  all.unshift(o);
  write(all);
  return o;
}

export const findOrderByRef = (ref: string): Order | undefined => (ref ? read().find((o) => o.ref === ref) : undefined);

/** Marks an order paid (web: the pending order for this ref; manual: a fresh record). Never changes an order twice. */
export function recordPaid(sku: Sku, paymentRef: string, opts: { ref?: string; method: "web" | "manual"; note?: string }): Order {
  const all = read();
  let o = opts.ref ? all.find((x) => x.ref === opts.ref) : undefined;
  if (o && o.status === "paid") return o;
  if (!o) {
    const b = vatBreakdown(sku.priceIls);
    o = { id: uuid(), sku: sku.id, label: sku.label, ...b, vatRate: vatRate(), cycle: sku.cycle, commitmentMonths: sku.commitmentMonths ?? 0, status: "pending", method: opts.method, createdAt: new Date().toISOString() };
    all.unshift(o);
  }
  o.status = "paid";
  o.paymentRef = paymentRef;
  o.paidAt = new Date().toISOString();
  if (opts.note) o.note = opts.note.slice(0, 300);
  write(all);
  return o;
}
