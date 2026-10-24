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
      lower: nodeId * 10, upper: nodeId * 10 + 4, nodeId,
    }));
    const index = new IntervalIndex(entries);
    const work = createIndexWork();
    expect([...index.containing(700_004, work)]).toEqual([70_000]);
    expect(work.intervalNodesVisited).toBeLessThanOrEqual(128);
    expect(index.containing(-1).size).toBe(0);
    const overlapping = new IntervalIndex([
      { lower: -10, upper: 10, nodeId: 1 }, { lower: 0, upper: 20, nodeId: 2 },
      { lower: 10, upper: 10, nodeId: 3 }, { lower: 11, upper: 12, nodeId: 4 },
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
    expect(universe).not.toHaveBeenCalled();
    expect(legacyIndexes).not.toHaveBeenCalled();
    universe.mockRestore();
    legacyIndexes.mockRestore();
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

  it("retains field error and empty-result precedence and snapshot isolation", () => {
    const store = new Store(schema);
    store.loadRows([{ group: "g0", score: 3, tags: null, windows: null, id: "old" }]);
    store.prepare();
    const empty = createCondition({ field: "group", values: ["missing"] });
    const ignored = createCondition({ field: "id", values: ["old"] });
    expect(store.search([empty, ignored])).toEqual([]);
    expect(() => store.search([ignored, empty])).toThrow(/ignoreIndex/);
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
  it("reuses tokenization and keeps corrections within hard-filter scope", () => {
    const schema = defineSchema([textField("title", { stemmedIndex: true }), textField("status")]);
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
    expect(search.bestMatch("bligt", options).correctedKeywords).toEqual({});
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
    expect(dictionary.getOneEditCandidate("abdd")).toBe("abcd");
    expect(dictionary.getOneEditCandidate("caf\u00e8")).toBe("cafe");
    expect(dictionary.getOneEditCandidate("lig")).toBeNull();
    expect(dictionary.getOneEditCandidate("lgiht")).toBeNull();
    expect(dictionary.predict("lig")).toEqual(["light", "lights"]);
    dictionary.addWord("lighter");
    expect(dictionary.predict("lig")).toEqual(["light", "lighter", "lights"]);
  });
});
