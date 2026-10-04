import { test } from "node:test";
import assert from "node:assert/strict";
import { BLOCKLIST, PREFIXES, SIGN_CELLS, TRADES, isBlocked, shopName, signAtlasNames } from "./shopNames.ts";
import { mulberry32 } from "../utils/random.ts";

const TAMIL = /[஀-௿]/;

test("shop names are deterministic for a seed", () => {
  const a = signAtlasNames(42).map((n) => n.en);
  const b = signAtlasNames(42).map((n) => n.en);
  assert.deepEqual(a, b);
  assert.equal(a.length, SIGN_CELLS);
  assert.equal(new Set(a).size, SIGN_CELLS, "atlas names are unique");
});

test("no real chain or brand ever appears (100k samples)", () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 100_000; i++) {
    const n = shopName(rng);
    assert.ok(!isBlocked(n.en), n.en);
  }
  // The blocklist really does catch brand names.
  for (const b of BLOCKLIST) assert.ok(isBlocked(`Sri ${b} Stores`));
});

test("every name has English and Tamil from the curated tables", () => {
  for (const w of [...PREFIXES, ...TRADES]) {
    assert.ok(w.en.trim().length > 0);
    assert.ok(TAMIL.test(w.ta), `${w.en} has no Tamil`);
    assert.ok(!/[A-Za-z]/.test(w.ta), `${w.en}: Tamil text contains Latin letters`);
  }
  for (const n of signAtlasNames()) {
    assert.ok(TAMIL.test(n.ta));
    assert.ok(/^#[0-9a-f]{6}$/i.test(n.trade.bg) && /^#[0-9a-f]{6}$/i.test(n.trade.fg));
  }
});
