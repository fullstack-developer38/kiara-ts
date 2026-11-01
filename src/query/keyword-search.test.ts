import { describe, expect, it } from "vitest";
import { QueryValidationError } from "../errors.js";
import { defineSchema } from "../schema/define-schema.js";
import { numberField, textField } from "../schema/field-factories.js";
import { Store } from "../store/store.js";
import { NormalizationProfile } from "../store/types.js";
import { createCondition } from "./condition.js";
import { KeywordSearch } from "./keyword-search.js";

interface MovieRow {
  title: string;
  plot: string;
  year: number;
}

const movieSchema = defineSchema<MovieRow>([
  textField("title", { caseInsensitive: true, oneEditAway: true }),
  textField("plot", { caseInsensitive: true, oneEditAway: true }),
  numberField("year"),
]);

function createStore(): Store<MovieRow> {
  const store = new Store(movieSchema, { normalizationProfile: NormalizationProfile.JAVA });
  store.loadRow({
    title: "Cast Away",
    plot: "A man stranded on an island returns home.",
    year: 2000,
  });
  store.loadRow({
    title: "Apollo 13",
    plot: "Astronauts struggle to return safely.",
    year: 1995,
  });
  store.loadRow({
    title: "Big",
    plot: "A young boy wakes up as an adult.",
    year: 1988,
  });
  store.prepare();
  return store;
}

interface StemmedRow {
  title: string;
  plot: string;
}

const stemmedSchema = defineSchema<StemmedRow>([
  textField("title", { caseInsensitive: true }),
  textField("plot", { caseInsensitive: true, stemmedIndex: true }),
]);

const nonStemmedSchema = defineSchema<StemmedRow>([
  textField("title", { caseInsensitive: true }),
  textField("plot", { caseInsensitive: true }),
]);

function createStemmedStore(schema = stemmedSchema): Store<StemmedRow> {
  const store = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  store.loadRow({
    title: "Run Story",
    plot: "He runs to survive.",
  });
  store.loadRow({
    title: "Walk Story",
    plot: "She walks home.",
  });
  store.prepare();
  return store;
}

interface IgnoreKeywordRow {
  title: string;
  summary: string;
  privateNotes: string;
}

const ignoreKeywordSchema = defineSchema<IgnoreKeywordRow>([
  textField("title", { caseInsensitive: true }),
  textField("summary", { caseInsensitive: true }),
  textField("privateNotes", { caseInsensitive: true, ignoreIndex: true }),
]);

function createIgnoreKeywordStore(): Store<IgnoreKeywordRow> {
  const store = new Store(ignoreKeywordSchema, { normalizationProfile: NormalizationProfile.JAVA });
  store.loadRow({
    title: "Visible Story",
    summary: "Public details for everyone.",
    privateNotes: "hidden blue token",
  });
  store.loadRow({
    title: "Another Story",
    summary: "More public facts.",
    privateNotes: "hidden red token",
  });
  store.prepare();
  return store;
}

describe("KeywordSearch", () => {
  it("returns best matches and typo corrections", () => {
    const search = new KeywordSearch(createStore(), 10);
    const result = search.bestMatch("cast stranded islannd");

    expect(result.results.map((row) => row.title)).toEqual(["Cast Away"]);
    expect(result.correctedKeywords).toEqual({ islannd: "island" });
    expect(result.matchedKeywords).toContain("island");
  });

  it("applies structured preconditions", () => {
    const search = new KeywordSearch(createStore(), 10);
    const result = search.bestMatch("astronauts return", {
      conditions: [createCondition<MovieRow, "year">({ field: "year", values: [1995] })],
    });

    expect(result.results.map((row) => row.title)).toEqual(["Apollo 13"]);
  });

  it("truncates keywords when max keyword budget is exceeded", () => {
    const search = new KeywordSearch(createStore(), 2);
    const result = search.bestMatch("cast stranded island home");

    expect(result.truncated).toBe(true);
    expect(result.usedKeywords.length).toBe(2);
  });

  it("applies Java minimum-match postfilter over nonnumeric field cardinality", () => {
    const search = new KeywordSearch(createStore(), 10);
    const result = search.minimumMatch("return stranded");

    expect(result.results.map((row) => row.title)).toEqual([]);
    expect(result.matchedKeywords).toEqual([]);
  });

  it("matches stem variants when a field is configured with stemmedIndex", () => {
    const search = new KeywordSearch(createStemmedStore(), 10);
    const result = search.bestMatch("running");

    expect(result.results.map((row) => row.title)).toEqual(["Run Story"]);
    expect(result.matchedKeywords).toContain("running");
  });

  it("does not apply stemming when fields are not stem-enabled", () => {
    const search = new KeywordSearch(createStemmedStore(nonStemmedSchema), 10);
    const result = search.bestMatch("running");

    expect(result.results).toEqual([]);
  });

  it("excludes ignoreIndex fields from default keyword search scope", () => {
    const search = new KeywordSearch(createIgnoreKeywordStore(), 10);
    const result = search.bestMatch("hidden");

    expect(result.results).toEqual([]);
  });

  it("rejects explicit keyword-search fields that are ignoreIndex", () => {
    const search = new KeywordSearch(createIgnoreKeywordStore(), 10);

    expect(() =>
      search.bestMatch("hidden", {
        fields: ["privateNotes"],
      }),
    ).toThrowError(QueryValidationError);
  });
});
