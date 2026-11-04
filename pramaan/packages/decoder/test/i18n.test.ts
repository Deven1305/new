import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CATALOGS, riskKey, type RiskCode } from "../src/index.js";

const SRC = resolve(__dirname, "../src");
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const DEVANAGARI = /[ऀ-ॿ]/;
/** Templates that are only placeholders and punctuation (no words to translate). */
const languageNeutral = (s: string) => s.replace(/\{\w+\}/g, "").replace(/[\s:.#×,"“”()-]/g, "") === "";

describe("en / hi / mr catalogs", () => {
  const en = Object.keys(CATALOGS.en).sort();

  it("every key exists in every language (fails on any missing translation)", () => {
    for (const lang of ["hi", "mr"] as const) {
      const keys = Object.keys(CATALOGS[lang]).sort();
      expect(keys.filter((k) => !CATALOGS.en[k]), `${lang} has keys English lacks`).toEqual([]);
      expect(en.filter((k) => !CATALOGS[lang][k]), `${lang} is missing translations`).toEqual([]);
    }
  });

  it("translations keep exactly the same placeholders and are written in Devanagari", () => {
    for (const key of en) {
      const source = CATALOGS.en[key]!;
      for (const lang of ["hi", "mr"] as const) {
        const text = CATALOGS[lang][key]!;
        expect(text.trim().length, `${lang}:${key} is empty`).toBeGreaterThan(0);
        expect(placeholders(text), `${lang}:${key} placeholders`).toEqual(placeholders(source));
        if (!languageNeutral(source)) expect(DEVANAGARI.test(text), `${lang}:${key} is not translated`).toBe(true);
      }
    }
  });

  it("every risk code and every reason/fact key the decoder emits has a template", () => {
    const types = readFileSync(join(SRC, "types.ts"), "utf8");
    const codes = [...types.slice(types.indexOf("export type RiskCode")).split(";")[0]!.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1] as RiskCode);
    expect(codes.length).toBeGreaterThan(20);
    for (const code of codes) expect(CATALOGS.en[riskKey(code)], code).toBeDefined();
    const sources = readdirSync(SRC).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(join(SRC, f), "utf8")).join("\n");
    const used = new Set([...sources.matchAll(/"((?:reason|fact|detail|word|action)\.[a-z0-9.-]+)"/g)].map((m) => m[1]!));
    for (const key of used) expect(CATALOGS.en[key], key).toBeDefined();
  });

  it("covers every verification row key verifier-core can produce", () => {
    const verdict = readFileSync(resolve(__dirname, "../../verifier-core/src/verdict.ts"), "utf8");
    const keys = new Set([...verdict.matchAll(/"(verify\.[a-z0-9.-]+)"/g)].map((m) => m[1]!));
    expect(keys.size).toBeGreaterThan(5);
    for (const key of keys) for (const lang of ["en", "hi", "mr"] as const) expect(CATALOGS[lang][key], `${lang}:${key}`).toBeDefined();
  });
});
