import { describe, expect, it } from "vitest";
import { QueryValidationError } from "../errors.js";
import { createCondition } from "../query/condition.js";
import { Operator } from "../query/operator.js";
import { StoreSearch } from "../query/store-search.js";
import { defineSchema } from "../schema/define-schema.js";
import { booleanField, enumField, longField, numberField, textField } from "../schema/field-factories.js";
import { Store } from "./store.js";
import { NormalizationProfile } from "./types.js";

interface MovieRow {
  title: string;
  year: number;
  actors: string;
  rating: number;
}

interface HiddenMovieRow {
  title: string;
  privateNotes: string;
}

interface NumberCollectionRow {
  label: string;
  numbers: string | null;
}

interface PrimitiveParityRow {
  id: string;
  active: boolean;
  tier: "bronze" | "silver" | "gold";
  longScore: string | number;
}

interface DuplicateParityRow {
  id: number;
  title: string;
}

const movieSchema = defineSchema<MovieRow>([
  textField("title", { caseInsensitive: true }),
  numberField("year"),
  textField("actors", { secondaryType: "commaSeparatedStrings", caseInsensitive: true }),
  numberField("rating"),
]);

function preparedStore(): Store<MovieRow> {
  const store = new Store(movieSchema, { normalizationProfile: NormalizationProfile.JAVA });
  store.loadRow({ title: "Cast Away", year: 2000, actors: "Tom Hanks, Helen Hunt", rating: 8.1 });
  store.loadRow({ title: "Apollo 13", year: 1995, actors: "Tom Hanks, Bill Paxton", rating: 7.6 });
  store.loadRow({ title: "Big", year: 1988, actors: "Tom Hanks", rating: 7.3 });
  store.prepare();
  return store;
}

function preparedPrimitiveParityStore(): Store<PrimitiveParityRow> {
  const schema = defineSchema<PrimitiveParityRow>([
    textField("id", { caseInsensitive: true }),
    booleanField("active"),
    enumField("tier", ["bronze", "silver", "gold"]),
    longField("longScore"),
  ]);
  const store = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  store.loadRow({ id: "row-a", active: true, tier: "gold", longScore: "9007199254740993" });
  store.loadRow({ id: "row-b", active: false, tier: "silver", longScore: 42 });
  store.loadRow({ id: "row-c", active: true, tier: "bronze", longScore: "7" });
  store.prepare();
  return store;
}

function preparedIgnoreIndexStore(): Store<HiddenMovieRow> {
  const schema = defineSchema<HiddenMovieRow>([
    textField("title", { caseInsensitive: true }),
    textField("privateNotes", { caseInsensitive: true, ignoreIndex: true }),
  ]);
  const store = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  store.loadRow({ title: "Cast Away", privateNotes: "internal island marker" });
  store.loadRow({ title: "Apollo 13", privateNotes: "internal moon marker" });
  store.prepare();
  return store;
}

function preparedDuplicateJavaStore(): Store<DuplicateParityRow> {
  const schema = defineSchema<DuplicateParityRow>([
    numberField("id"),
    textField("title", { caseInsensitive: true }),
  ]);
  const store = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  store.loadRows([
    { id: 1, title: "alpha" },
    { id: 1, title: "alpha" },
    { id: 2, title: "beta" },
  ]);
  store.prepare();
  return store;
}

function preparedDuplicateNativeStore(): Store<DuplicateParityRow> {
  const schema = defineSchema<DuplicateParityRow>([
    numberField("id"),
    textField("title", { caseInsensitive: true }),
  ]);
  const store = new Store(schema, { normalizationProfile: NormalizationProfile.NATIVE });
  store.loadRows([
    { id: 1, title: "alpha" },
    { id: 1, title: "alpha" },
    { id: 2, title: "beta" },
  ]);
  store.prepare();
  return store;
}

function preparedNumberCollectionStore(): Store<NumberCollectionRow> {
  const schema = defineSchema<NumberCollectionRow>([
    textField("label", { caseInsensitive: true }),
    textField("numbers", {
      secondaryType: "commaSeparatedNumbers",
      nullable: true,
    }),
  ]);
  const store = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  store.loadRow({ label: "A", numbers: "1,5,7" });
  store.loadRow({ label: "B", numbers: "5" });
  store.loadRow({ label: "C", numbers: "9" });
  store.loadRow({ label: "D", numbers: null });
  store.prepare();
  return store;
}

describe("Store search", () => {
  it("supports case-insensitive EQUAL on text fields", () => {
    const store = preparedStore();
    const search = new StoreSearch(store);
    const results = search.query([
      createCondition<MovieRow, "title">({ field: "title", values: ["cast away"] }),
    ]);
    expect(results.map((row) => row.title)).toEqual(["Cast Away"]);
  });

  it("supports LESS_THAN with Java numeric key normalization", () => {
    const store = preparedStore();
    const results = store.search([
      createCondition<MovieRow, "rating">({
        field: "rating",
        operator: Operator.LESS_THAN,
        values: [7.9],
      }),
    ]);
    expect(results.map((row) => row.title)).toEqual([]);
  });

  it("supports LESS_THAN in native profile without Java truncation", () => {
    const store = new Store(movieSchema, { normalizationProfile: NormalizationProfile.NATIVE });
    store.loadRow({ title: "Cast Away", year: 2000, actors: "Tom Hanks, Helen Hunt", rating: 8.1 });
    store.loadRow({ title: "Apollo 13", year: 1995, actors: "Tom Hanks, Bill Paxton", rating: 7.6 });
    store.loadRow({ title: "Big", year: 1988, actors: "Tom Hanks", rating: 7.3 });
    store.prepare();

    const results = store.search([
      createCondition<MovieRow, "rating">({
        field: "rating",
        operator: Operator.LESS_THAN,
        values: [7.9],
      }),
    ]);
    expect(results.map((row) => row.title)).toEqual(["Apollo 13", "Big"]);
  });

  it("supports BETWEEN on numeric fields", () => {
    const store = preparedStore();
    const results = store.search([
      createCondition<MovieRow, "year">({
        field: "year",
        operator: Operator.BETWEEN,
        lowerValue: 1990,
        upperValue: 2000,
      }),
    ]);
    expect(results.map((row) => row.title)).toEqual(["Cast Away", "Apollo 13"]);
  });

  it("matches collection EQUAL against individual collection tokens", () => {
    const store = preparedStore();
    const results = store.search([
      createCondition<MovieRow, "actors">({
        field: "actors",
        operator: Operator.EQUAL,
        values: ["bill paxton"],
      }),
    ]);
    expect(results.map((row) => row.title)).toEqual(["Apollo 13"]);
  });

  it("supports ordered comparison operators on text fields", () => {
    const store = preparedStore();
    const results = store.search([
      createCondition<MovieRow, "title">({
        field: "title",
        operator: Operator.LESS_THAN,
        values: ["cast away"],
      }),
    ]);
    expect(results.map((row) => row.title)).toEqual(["Apollo 13", "Big"]);
  });

  it("supports CONTAINS_EITHER and CONTAINS_ALL on collection fields", () => {
    const store = preparedStore();
    const either = store.search([
      createCondition<MovieRow, "actors">({
        field: "actors",
        operator: Operator.CONTAINS_EITHER,
        values: ["helen hunt"],
      }),
    ]);
    expect(either.map((row) => row.title)).toEqual(["Cast Away"]);

    const all = store.search([
      createCondition<MovieRow, "actors">({
        field: "actors",
        operator: Operator.CONTAINS_ALL,
        values: ["tom hanks", "bill paxton"],
      }),
    ]);
    expect(all.map((row) => row.title)).toEqual(["Apollo 13"]);
  });

  it("supports scalar CONTAINS operators with Java-compatible semantics", () => {
    const store = preparedStore();
    const either = store.search([
      createCondition<MovieRow, "title">({
        field: "title",
        operator: Operator.CONTAINS_EITHER,
        values: ["cast away", "apollo 13"],
      }),
    ]);
    const all = store.search([
      createCondition<MovieRow, "title">({
        field: "title",
        operator: Operator.CONTAINS_ALL,
        values: ["cast away"],
      }),
    ]);
    expect(either.map((row) => row.title)).toEqual(["Cast Away", "Apollo 13"]);
    expect(all.map((row) => row.title)).toEqual(["Cast Away"]);
  });

  it("supports NOT_CONTAINS on collection fields", () => {
    const store = preparedStore();
    const results = store.search([
      createCondition<MovieRow, "actors">({
        field: "actors",
        operator: Operator.NOT_CONTAINS,
        values: ["bill paxton"],
      }),
    ]);
    expect(results.map((row) => row.title)).toEqual(["Cast Away", "Big"]);
  });

  it("differentiates collection NOT_EQUAL from NOT_CONTAINS token semantics", () => {
    const store = preparedStore();

    const notEqual = store.search([
      createCondition<MovieRow, "actors">({
        field: "actors",
        operator: Operator.NOT_EQUAL,
        values: ["bill paxton"],
      }),
    ]);

    const notContains = store.search([
      createCondition<MovieRow, "actors">({
        field: "actors",
        operator: Operator.NOT_CONTAINS,
        values: ["bill paxton"],
      }),
    ]);

    expect(notEqual.map((row) => row.title)).toEqual(["Cast Away", "Apollo 13", "Big"]);
    expect(notContains.map((row) => row.title)).toEqual(["Cast Away", "Big"]);
  });

  it("supports null-aware contains semantics for commaSeparatedNumbers", () => {
    const store = preparedNumberCollectionStore();
    const includesNullOrFive = store.search([
      createCondition<NumberCollectionRow, "numbers">({
        field: "numbers",
        operator: Operator.CONTAINS_EITHER_INCLUDING_NULL,
        values: [null, 5],
      }),
    ]);
    const notContainsFive = store.search([
      createCondition<NumberCollectionRow, "numbers">({
        field: "numbers",
        operator: Operator.NOT_CONTAINS,
        values: [5],
      }),
    ]);

    expect(includesNullOrFive.map((row) => row.label)).toEqual(["A", "B", "D"]);
    expect(notContainsFive.map((row) => row.label)).toEqual(["C", "D"]);
  });

  it("supports primitive parity behavior for boolean/enum/long scalar queries", () => {
    const store = preparedPrimitiveParityStore();

    const activeRows = store.search([
      createCondition<PrimitiveParityRow, "active">({
        field: "active",
        operator: Operator.EQUAL,
        values: [true],
      }),
    ]);
    const goldRows = store.search([
      createCondition<PrimitiveParityRow, "tier">({
        field: "tier",
        operator: Operator.EQUAL,
        values: ["gold"],
      }),
    ]);
    const highLongRows = store.search([
      createCondition<PrimitiveParityRow, "longScore">({
        field: "longScore",
        operator: Operator.GREATER_THAN,
        values: [1000],
      }),
    ]);

    expect(activeRows.map((row) => row.id)).toEqual(["row-a", "row-c"]);
    expect(goldRows.map((row) => row.id)).toEqual(["row-a"]);
    expect(highLongRows.map((row) => row.id)).toEqual(["row-a"]);
  });

  it("builds trie with deduplicated nodes for shared prefixes", () => {
    const store = new Store(movieSchema, { normalizationProfile: NormalizationProfile.JAVA });
    store.loadRow({ title: "Cast Away", year: 2000, actors: "Tom Hanks, Helen Hunt", rating: 8.1 });
    store.loadRow({ title: "Cast Away", year: 2000, actors: "Tom Hanks, Helen Hunt", rating: 8.1 });
    store.prepare();

    const trie = store.getPreparedTrieSnapshot();
    const root = trie.nodes.find((node) => node.id === 0);
    expect(root?.rowIds.length).toBe(2);
    expect(root?.childIds.size).toBe(1);
    expect(trie.nodes.length).toBe(5);
  });

  it("collapses exact duplicate source rows under java profile search", () => {
    const store = preparedDuplicateJavaStore();
    const results = store.search([
      createCondition<DuplicateParityRow, "id">({
        field: "id",
        operator: Operator.EQUAL,
        values: [1],
      }),
    ]);
    expect(results).toEqual([{ id: 1, title: "alpha" }]);
  });

  it("retains duplicate source rows under native profile search", () => {
    const store = preparedDuplicateNativeStore();
    const results = store.search([
      createCondition<DuplicateParityRow, "id">({
        field: "id",
        operator: Operator.EQUAL,
        values: [1],
      }),
    ]);
    expect(results).toEqual([{ id: 1, title: "alpha" }, { id: 1, title: "alpha" }]);
  });

  it("rejects structured queries on ignoreIndex fields", () => {
    const store = preparedIgnoreIndexStore();
    expect(() =>
      store.search([
        createCondition<HiddenMovieRow, "privateNotes">({
          field: "privateNotes",
          values: ["internal island marker"],
        }),
      ]),
    ).toThrowError(QueryValidationError);
  });
});
