import { describe, expect, it, vi } from "vitest";
import { Store } from "./store.js";
import { StoreLoader } from "./store-loader.js";
import { NormalizationProfile } from "./types.js";
import { defineSchema } from "../schema/define-schema.js";
import { numberField, textField } from "../schema/field-factories.js";
import { Operator } from "../query/operator.js";
import { createCondition, type Condition } from "../query/condition.js";
import { bound, compareNumeric, createIndexWork, IntervalIndex } from "./ordered-index.js";
import { executeSearch } from "./search-engine.js";
import { getExecutionIndex } from "./execution-index.js";
import { getKeywordField, KeywordSearch } from "../query/keyword-search.js";
import { DictionaryTrie } from "../text/dictionary-trie.js";

describe("optimized search work bounds", () => {
  it("keeps collection intersection slices available to a later selective ancestor", () => {
    const store = new Store(defineSchema([
      textField("category"), numberField("id"),
      textField("tags", { secondaryType: "commaSeparatedStrings" }),
    ]));
    store.loadRows(Array.from({ length: 10_000 }, (_, id) => ({
      category: id === 0 ? "rare" : "common", id, tags: "x,y",
    })));
    store.prepare();
    const work = createIndexWork();
    expect(executeSearch(store.getPreparedData(), [
      { field: "tags", operator: Operator.CONTAINS_ALL, values: ["x", "y"] },
      { field: "category", operator: Operator.EQUAL, values: ["rare"] },
    ], undefined, work).map((row) => row.id)).toEqual([0]);
    expect(work.postingEntriesVisited).toBeLessThanOrEqual(8);
    expect(work.boundaryComparisons).toBeLessThanOrEqual(32);
  });

  it("subtracts an ordered list posting without rechecking each row's tokens", () => {
    const store = new Store(defineSchema([
      numberField("id"), textField("tags", { secondaryType: "commaSeparatedStrings" }),
    ]));
    store.loadRows(Array.from({ length: 2000 }, (_, id) => ({ id, tags: id % 2 ? "x,y" : "x" })));
    store.prepare();
    const work = createIndexWork();
    expect(executeSearch(store.getPreparedData(), [
      { field: "tags", operator: Operator.NOT_CONTAINS, values: ["y"] },
    ], undefined, work).map((row) => row.id)).toEqual(Array.from({ length: 1000 }, (_, i) => i * 2));
    expect(work.predicateChecks).toBe(0);
    expect(work.postingEntriesVisited).toBeLessThanOrEqual(8000);
  });

  it("does not treat an estimated one-group join as an actual single posting list", () => {
    const store = new Store(defineSchema([
      numberField("id"), textField("a"), textField("b"), textField("c"),
    ]));
    store.loadRows(Array.from({ length: 100 }, (_, id) => ({
      id, a: id < 2 ? "keep" : "other", b: id < 2 ? "hit" : "miss", c: id < 2 ? "hit" : "miss",
    })));
    store.prepare();
    expect(store.search([
      { field: "a", operator: Operator.EQUAL, values: ["keep"] },
      { field: "b", operator: Operator.EQUAL, values: ["hit"] },
      { field: "c", operator: Operator.EQUAL, values: ["hit"] },
      { field: "c", operator: Operator.NOT_EQUAL, values: ["absent"] },
    ]).map((row) => row.id)).toEqual([0, 1]);
  });

  it("materializes full results through terminal spans instead of every suffix node", () => {
    const store = new Store(defineSchema([
      textField("category"), numberField("id"), textField("a"), textField("b"), textField("c"),
    ]));
    const rows = Array.from({ length: 6000 }, (_, id) => ({ category: "active", id, a: "a", b: "b", c: "c" }));
    store.loadRows(rows);
    store.prepare();
    const work = createIndexWork();
    expect(executeSearch(store.getPreparedData(), [
      { field: "category", operator: Operator.EQUAL, values: ["active"] },
    ], undefined, work)).toEqual(rows);
    expect(work.trieNodesVisited).toBeLessThanOrEqual(6001);
    expect(work.sourceRowsVisited).toBe(6000);
  });

  it("seeks numeric bounds without traversing 100,000 keys, including bigint precision", () => {
    const entries = Array.from({ length: 100_000 }, (_, key) => ({ key }));
    const work = createIndexWork();
    expect(bound(entries, 70_000, (entry) => entry.key, false, work)).toBe(70_000);
    expect(bound(entries, 70_019, (entry) => entry.key, true, work)).toBe(70_020);
    expect(work.boundaryComparisons).toBeLessThanOrEqual(38);
    expect(compareNumeric(9007199254740993n, 9007199254740992)).toBe(1);
    expect(compareNumeric(9007199254740992, 9007199254740993n)).toBe(-1);
  });

  it("prunes disjoint interval trees and keeps inclusive, nested and overlapping matches", () => {
    const entries = Array.from({ length: 100_000 }, (_, nodeId) => ({
      lower: nodeId * 10, upper: nodeId * 10 + 4, nodeIds: [nodeId],
    }));
    const index = new IntervalIndex(entries);
    const work = createIndexWork();
    expect([...index.containing(700_004, work)]).toEqual([70_000]);
    expect(work.intervalNodesVisited).toBeLessThanOrEqual(128);
    expect(index.containing(-1).size).toBe(0);
    const overlapping = new IntervalIndex([
      { lower: -10, upper: 10, nodeIds: [1] }, { lower: 0, upper: 20, nodeIds: [2] },
      { lower: 10, upper: 10, nodeIds: [3] }, { lower: 11, upper: 12, nodeIds: [4] },
    ]);
    expect([...overlapping.containing(10)].sort()).toEqual([1, 2, 3]);
  });

  it("uses node postings and materializes only matching source rows", () => {
    const store = new Store(defineSchema([
      numberField("key"), textField("payload", { ignoreIndex: true }),
    ]));
    store.loadRows(Array.from({ length: 100_000 }, (_, key) => ({ key, payload: `row-${key}` })));
    store.prepare();
    const data = store.getPreparedData();
    const universe = vi.spyOn(data, "rowIds", "get");
    const legacyIndexes = vi.spyOn(data, "indexes", "get");
    const work = createIndexWork();
    const result = executeSearch(data, [{
      field: "key", operator: Operator.BETWEEN, lowerValue: 99_980, upperValue: 99_999,
    }], undefined, work);
    expect(result.map((row) => row.key)).toEqual(Array.from({ length: 20 }, (_, i) => 99_980 + i));
    expect(work.keysVisited).toBe(20);
    expect(work.sourceRowsVisited).toBe(20);
    expect(work.trieNodesVisited).toBe(40);
    expect(work.boundaryComparisons).toBeLessThanOrEqual(38);
    const execution = getExecutionIndex(data);
    const lastNode = execution.nodes[execution.fields.get("key")!.nodes.at(-1)!]!;
    expect(lastNode.end).toBeGreaterThan(lastNode.start);
    expect(lastNode.terminalRows).toEqual([]);
    const limitedWork = createIndexWork();
    expect(executeSearch(data, [{ field: "key", operator: Operator.GREATER_THAN_EQUAL, values: [0] }],
      5, limitedWork).map((row) => row.key)).toEqual([0, 1, 2, 3, 4]);
    expect(limitedWork.sourceRowsVisited).toBe(5);
    expect(limitedWork.trieNodesVisited).toBeLessThanOrEqual(10);
    expect(limitedWork.keysVisited).toBeLessThanOrEqual(1);
    expect(limitedWork.postingEntriesVisited).toBeLessThanOrEqual(5);
    expect(limitedWork.sourceOrderNodesVisited).toBeLessThanOrEqual(6);
    expect(limitedWork.heapEntriesQueued).toBeLessThanOrEqual(20);
    expect(universe).not.toHaveBeenCalled();
    expect(legacyIndexes).not.toHaveBeenCalled();
    universe.mockRestore();
    legacyIndexes.mockRestore();
  });

  it.each([NormalizationProfile.JAVA, NormalizationProfile.NATIVE])(
    "indexes repeated ranges by distinct bounds under %s normalization", (normalizationProfile) => {
      const rows = Array.from({ length: 100_000 }, (_, id) => {
        const low = (id % 10 + 1) * 50;
        const high = low + (Math.floor(id / 10) % 20 + 1) * 50;
        return { id, span: `${low}->${high}` };
      });
      const store = new Store(defineSchema([
        numberField("id"), textField("span", { secondaryType: "numericRange" }),
      ]), { normalizationProfile });
      store.loadRows(rows);
      store.prepare();
      const conditions = [{ field: "span", operator: Operator.CONTAINS_EITHER, values: [250] }] as const;
      const expected = rows.filter((row) => {
        const [low, high] = row.span.split("->").map(Number);
        return low! <= 250 && high! >= 250;
      });
      const work = createIndexWork();
      expect(executeSearch(store.getPreparedData(), conditions, undefined, work)).toEqual(expected);
      expect(work.intervalNodesVisited).toBeLessThanOrEqual(200);
      expect(work.sourceRowsVisited).toBe(expected.length);
      expect(store.search(conditions, 17)).toEqual(expected.slice(0, 17));
    },
  );

  it("shares prefixed range postings without duplicating list members or including missing ranges", () => {
    const store = new Store(defineSchema([
      numberField("id"),
      textField("spans", { secondaryType: "commaSeparatedNumericRanges", numericStartPos: 1, nullable: true }),
    ]));
    store.loadRows([
      { id: 0, spans: "A0->10,A0->10,A20->30" },
      { id: 1, spans: "A0->10,B0->10" },
      { id: 2, spans: "B0->10" },
      { id: 3, spans: null },
    ]);
    store.prepare();
    const query = (operator: typeof Operator[keyof typeof Operator], values: string[]) =>
      store.search([{ field: "spans", operator, values }]).map((row) => row.id);
    expect(query(Operator.CONTAINS_EITHER, ["A5"])).toEqual([0, 1]);
    expect(query(Operator.CONTAINS_ALL, ["A5", "A25"])).toEqual([0]);
    expect(query(Operator.CONTAINS_EITHER, ["B5"])).toEqual([1, 2]);
    expect(query(Operator.NOT_CONTAINS, ["A5"])).toEqual([2]);
    const work = createIndexWork();
    const index = getExecutionIndex(store.getPreparedData()).fields.get("spans")!.intervals.get("A")!;
    expect(index.containing(5, work).size).toBe(2);
    expect(work.intervalNodesVisited).toBeLessThanOrEqual(2);
    expect(work.postingEntriesVisited).toBe(2);
  });

  it("fuses narrow bounds before expanding postings and applies indexed-field validation precedence", () => {
    const store = new Store(defineSchema([numberField("key"), textField("ignored", { ignoreIndex: true })]));
    store.loadRows(Array.from({ length: 100_000 }, (_, key) => ({ key, ignored: `${key}` })));
    store.prepare();
    const work = createIndexWork();
    expect(executeSearch(store.getPreparedData(), [
      { field: "key", operator: Operator.GREATER_THAN_EQUAL, values: [50_000] },
      { field: "key", operator: Operator.LESS_THAN, values: [50_020] },
    ], undefined, work).map((row) => row.key)).toEqual(Array.from({ length: 20 }, (_, i) => 50_000 + i));
    expect(work.keysVisited).toBeLessThanOrEqual(21);
    expect(work.postingEntriesVisited).toBeLessThanOrEqual(22);
    expect(work.boundaryComparisons).toBeLessThanOrEqual(40);
    expect(() => store.search([
      { field: "key", operator: Operator.GREATER_THAN, values: [100_000] },
      { field: "ignored", operator: Operator.EQUAL, values: ["invalid"] },
    ])).toThrow(/ignoreIndex/);
    expect(() => store.search([
      { field: "key", operator: Operator.GREATER_THAN, values: [50_000] },
      { field: "ignored", operator: Operator.EQUAL, values: ["invalid"] },
    ])).toThrow(/ignoreIndex/);
  });

  it("bounds the source-order probe on skewed matches and lazily queues wide branches", () => {
    const rows = Array.from({ length: 2000 }, (_, key) => ({ group: "shared", key }));
    const store = new Store(defineSchema([textField("group"), numberField("key")]));
    store.loadRows(rows);
    store.prepare();
    const skewed = createIndexWork();
    expect(executeSearch(store.getPreparedData(), [
      { field: "key", operator: Operator.GREATER_THAN_EQUAL, values: [1000] },
    ], 3, skewed)).toEqual(rows.slice(1000, 1003));
    expect(skewed.sourceOrderNodesVisited).toBeLessThanOrEqual(1000);
    const wide = createIndexWork();
    expect(executeSearch(store.getPreparedData(), [
      { field: "group", operator: Operator.EQUAL, values: ["shared"] },
    ], 3, wide)).toEqual(rows.slice(0, 3));
    expect(wide.heapEntriesQueued).toBeLessThanOrEqual(10);
  });
});

describe("trie semantics and independent scan oracle", () => {
  const schema = defineSchema([
    textField("group"), numberField("score"),
    textField("tags", { secondaryType: "commaSeparatedStrings", nullable: true }),
    textField("windows", { secondaryType: "commaSeparatedNumericRanges", nullable: true }),
    textField("id", { ignoreIndex: true }),
  ]);

  it("matches an independent scan across condition orders, duplicates, exclusions and disjoint windows", () => {
    const rows = Array.from({ length: 240 }, (_, i) => ({
      group: `g${i % 4}`, score: i % 35 + 0.5,
      tags: i % 11 === 0 ? null : i % 3 === 0 ? "a,b" : "b,c",
      windows: i % 13 === 0 ? null : "0->10,20->30", id: `${i}`,
    }));
    rows.push({ ...rows[0]! }, { ...rows[1]!, id: "duplicate-values" });
    const store = new Store(schema, { normalizationProfile: NormalizationProfile.NATIVE });
    store.loadRows(rows);
    store.prepare();
    type Row = typeof rows[number];
    for (const group of ["g0", "g1", "absent"]) {
      for (const lower of [-1, 5.5, 20, 50]) {
        const conditions: Condition<Row>[] = [
          { field: "group", operator: Operator.EQUAL, values: [group] },
          { field: "score", operator: Operator.BETWEEN, lowerValue: lower, upperValue: 24.5 },
          { field: "tags", operator: Operator.NOT_CONTAINS, values: ["a"] },
          { field: "windows", operator: Operator.CONTAINS_ALL, values: [5, 25] },
        ];
        const expected = rows.filter((row) => row.group === group && row.score >= lower
          && row.score <= 24.5 && !row.tags?.split(",").includes("a") && row.windows !== null);
        for (const order of [conditions, [...conditions].reverse(), [conditions[2]!, conditions[0]!, conditions[3]!, conditions[1]!]]) {
          expect(store.search(order)).toEqual(expected);
          expect(store.search(order, 2)).toEqual(expected.slice(0, 2));
        }
      }
    }
    expect(store.search([{ field: "windows", operator: Operator.CONTAINS_EITHER, values: [15] }])).toEqual([]);
    expect(store.search([{ field: "score", operator: Operator.GREATER_THAN_EQUAL, values: [0] }], 7))
      .toEqual(rows.slice(0, 7));
    const snapshot = store.getPreparedTrieSnapshot();
    expect(snapshot.nodes[0]!.rowIds).toEqual(rows.map((_, i) => i));
    expect([...store.getPreparedData().normalizedRows[0]!.values.keys()]).toEqual(schema.fields.map((field) => field.name));
  });

  it("does not confuse shared prefixes or delimiter-bearing collection identities", () => {
    const store = new Store(defineSchema([
      textField("tags", { secondaryType: "commaSeparatedStrings" }), textField("id"),
    ]));
    store.loadRows([{ tags: "a|s:b", id: "literal" }, { tags: "a,b", id: "two-tokens" }]);
    store.prepare();
    expect(store.search([{ field: "tags", operator: Operator.CONTAINS_ALL, values: ["a", "b"] }])
      .map((row) => row.id)).toEqual(["two-tokens"]);
    expect(store.search([{ field: "id", operator: Operator.EQUAL, values: ["literal"] },
      { field: "tags", operator: Operator.CONTAINS_EITHER, values: ["a|s:b"] }])
      .map((row) => row.id)).toEqual(["literal"]);
  });

  it("retains Java column-order precedence and snapshot isolation", () => {
    const store = new Store(schema);
    store.loadRows([{ group: "g0", score: 3, tags: null, windows: null, id: "old" }]);
    store.prepare();
    const empty = createCondition({ field: "group", values: ["missing"] });
    const ignored = createCondition({ field: "id", values: ["old"] });
    expect(() => store.search([empty, ignored])).toThrow(/ignoreIndex/);
    expect(() => store.search([ignored, empty])).toThrow(/ignoreIndex/);
    const invalidScore = createCondition({ field: "score", operator: Operator.NOT_CONTAINS, values: [3] });
    expect(store.search([empty, invalidScore])).toEqual([]);
    expect(store.search([invalidScore, empty])).toEqual([]);
    const next = new StoreLoader(store).replaceAll([
      { group: "g0", score: 4, tags: null, windows: null, id: "new" },
    ]);
    const query = [createCondition({ field: "group", values: ["g0"] })];
    expect(store.search(query)[0]!.id).toBe("old");
    expect(next.search(query)[0]!.id).toBe("new");
    expect(store.search([{ field: "windows", operator: Operator.NOT_CONTAINS, values: [5] }])).toEqual([]);
  });
});

describe("snapshot keyword postings", () => {
  it("handles configured keyword counts beyond the function argument limit", () => {
    const words = Array.from({ length: 150_000 }, (_, id) => `word${id}`);
    const store = new Store(defineSchema([textField("title")]));
    store.loadRows([{ title: words.join(" ") }]);
    store.prepare();
    const found = new KeywordSearch(store, words.length).bestMatch(words, { fields: ["title"] });
    expect(found.results.length).toBe(1);
    expect(found.matchedKeywords.length).toBe(words.length);
    expect(found.truncated).toBe(false);
  });

  it("probes rare complete keyword matches instead of scanning common postings", () => {
    const store = new Store(defineSchema([textField("title"), numberField("id")]));
    store.loadRows(Array.from({ length: 10_000 }, (_, id) => ({ title: `item ${id}`, id })));
    store.prepare();
    const field = getKeywordField(store.getPreparedData(), "title");
    const common = field.tokens.get("item")!;
    const iteration = vi.spyOn(common, Symbol.iterator);
    try {
      expect(new KeywordSearch(store).bestMatch("item 9999", { fields: ["title"] }).results.map((row) => row.id))
        .toEqual([9999]);
      expect(iteration).not.toHaveBeenCalled();
    } finally {
      iteration.mockRestore();
    }
  });

  it("reuses tokenization and keeps corrections within hard-filter scope", () => {
    const schema = defineSchema([textField("title", { stemmedIndex: true, oneEditAway: true }), textField("status")]);
    const store = new Store(schema);
    store.loadRows([
      { title: "Philips Light", status: "active" },
      { title: "Philips Bluetooth Light", status: "active" },
      { title: "Philips Blight", status: "archived" },
    ]);
    store.prepare();
    const field = getKeywordField(store.getPreparedData(), "title");
    const search = new KeywordSearch(store);
    const options = { fields: ["title"], conditions: [createCondition({ field: "status", values: ["active"] })] };
    expect(search.bestMatch("philips light", options).results.length).toBe(2);
    expect(search.bestMatch("philips ligt bluetooth", options).results.map((row) => row.title))
      .toEqual(["Philips Bluetooth Light"]);
    expect(search.bestMatch("philips lighting", options).correctedKeywords).toEqual({});
    expect(search.bestMatch("bligt", options).correctedKeywords).toEqual({ bligt: "blight" });
    expect(search.bestMatch("bligt", { fields: ["title"] }).correctedKeywords).toEqual({ bligt: "blight" });
    expect(getKeywordField(store.getPreparedData(), "title")).toBe(field);
    const replacement = new StoreLoader(store).replaceAll([{ title: "Other lamp", status: "active" }]);
    expect(new KeywordSearch(replacement).bestMatch("philips", options).results).toEqual([]);
    expect(new KeywordSearch(store).bestMatch("philips", options).results.length).toBe(2);
  });

  it("skips excluded correction candidates and retains lexical ties and Unicode edit rules", () => {
    const dictionary = new DictionaryTrie();
    dictionary.addWords(["blight", "flight", "light", "lights", "bright", "abcd", "abed", "cafe", "caf\u00e9"]);
    expect(dictionary.getOneEditCandidate("fllght")).toBe("flight");
    expect(dictionary.getOneEditCandidate("bligt", (word) => word !== "blight")).toBeNull();
    expect(dictionary.getOneEditCandidate("abdd")).toBeNull();
    expect(dictionary.getOneEditCandidate("caf\u00e8")).toBe("caf\u00e9");
    expect(dictionary.getOneEditCandidate("lig")).toBeNull();
    expect(dictionary.getOneEditCandidate("lgiht")).toBeNull();
    expect(dictionary.predict("lig")).toEqual(["light", "lights"]);
    dictionary.addWord("lighter");
    expect(dictionary.predict("lig")).toEqual(["light", "lights", "lighter"]);
  });
});
