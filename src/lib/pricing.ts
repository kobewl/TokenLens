import { useCallback, useMemo, useState } from "react";
import { readJson, writeJson } from "./prefs";
import type { NamedTotal } from "./types";

/**
 * User-entered prices per 1,000,000 tokens. TokenLens ships NO built-in price
 * list: prices change and a stale built-in table would produce confident but
 * wrong money numbers (decision R4: unpriced models stay "未定价").
 */
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };
export type PriceBook = { currency: "$" | "¥"; models: Record<string, Price> };

const KEY = "tokenlens-prices";
const EMPTY: PriceBook = { currency: "$", models: {} };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

function sanitize(raw: PriceBook): PriceBook {
  const models: Record<string, Price> = {};
  for (const [name, p] of Object.entries(raw?.models ?? {}))
    models[name] = { input: num(p?.input), output: num(p?.output), cacheRead: num(p?.cacheRead), cacheWrite: num(p?.cacheWrite) };
  return { currency: raw?.currency === "¥" ? "¥" : "$", models };
}

export function usePriceBook() {
  const [book, setBook] = useState<PriceBook>(() => sanitize(readJson(KEY, EMPTY)));
  const save = useCallback((next: PriceBook) => {
    const clean = sanitize(next);
    setBook(clean);
    writeJson(KEY, clean);
  }, []);
  return useMemo(() => ({ book, save }), [book, save]);
}

export const isPriced = (book: PriceBook, model: string) => model in book.models;

export function modelCost(book: PriceBook, row: NamedTotal): number | null {
  const p = book.models[row.name];
  if (!p) return null;
  return (
    (row.freshInput * p.input + row.outputTokens * p.output + row.cacheReadTokens * p.cacheRead + row.cacheWriteTokens * p.cacheWrite) /
    1_000_000
  );
}

/** Sum over models that have a price; `unpriced` counts models skipped so the UI can say so. */
export function totalCost(book: PriceBook, rows: NamedTotal[]) {
  let cost = 0;
  let priced = 0;
  let unpriced = 0;
  for (const row of rows) {
    const c = modelCost(book, row);
    if (c === null) {
      if (row.totalTokens > 0) unpriced++;
    } else {
      cost += c;
      priced++;
    }
  }
  return { cost, priced, unpriced };
}

export const money = (book: PriceBook, n: number) =>
  `${book.currency}${n >= 100 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3)}`;
