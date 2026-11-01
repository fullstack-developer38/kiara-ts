import { describe, expect, it } from "vitest";
import { QueryValidationError } from "../errors.js";
import { createCondition } from "../query/condition.js";
import { Operator } from "../query/operator.js";
import { defineSchema } from "../schema/define-schema.js";
import { textField } from "../schema/field-factories.js";
import { Store } from "./store.js";
import { NormalizationProfile } from "./types.js";

interface SecondaryRow {
  id: string;
  releaseDate: string;
  releaseDateTime: string;
  travelDates: string;
}

const schema = defineSchema<SecondaryRow>([
  textField("id"),
  textField("releaseDate", { secondaryType: "dateFormat" }),
  textField("releaseDateTime", { secondaryType: "dateTimeFormat" }),
  textField("travelDates", { secondaryType: "commaSeparatedDates" }),
]);

function buildStore(): Store<SecondaryRow> {
  const store = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  store.loadRow({
    id: "a",
    releaseDate: "2000-01-01",
    releaseDateTime: "2000-01-01 10:00:00",
    travelDates: "2000-01-01,2000-01-03",
  });
  store.loadRow({
    id: "b",
    releaseDate: "2001-01-01",
    releaseDateTime: "2001-01-01 10:00:00",
    travelDates: "2001-01-01,2001-01-02",
  });
  store.prepare();
  return store;
}

describe("secondary-type indexing and search", () => {
  it("supports comparisons over dateFormat fields", () => {
    const store = buildStore();
    const results = store.search([
      createCondition<SecondaryRow, "releaseDate">({
        field: "releaseDate",
        operator: Operator.LESS_THAN,
        values: ["2000-06-01"],
      }),
    ]);
    expect(results.map((row) => row.id)).toEqual(["a"]);
  });

  it("supports comparisons over dateTimeFormat fields", () => {
    const store = buildStore();
    const results = store.search([
      createCondition<SecondaryRow, "releaseDateTime">({
        field: "releaseDateTime",
        operator: Operator.GREATER_THAN_EQUAL,
        values: ["2001-01-01 10:00:00"],
      }),
    ]);
    expect(results.map((row) => row.id)).toEqual(["b"]);
  });

  it("supports contains operators over commaSeparatedDates fields", () => {
    const store = buildStore();
    const results = store.search([
      createCondition<SecondaryRow, "travelDates">({
        field: "travelDates",
        operator: Operator.CONTAINS_EITHER,
        values: ["2001-01-02"],
      }),
    ]);
    expect(results.map((row) => row.id)).toEqual(["b"]);
  });

  it("rejects unsupported operator/field combinations", () => {
    const store = buildStore();
    expect(() =>
      store.search([
        createCondition<SecondaryRow, "releaseDate">({
          field: "releaseDate",
          operator: Operator.NOT_CONTAINS,
          values: ["2000-01-01"],
        }),
      ]),
    ).toThrowError(QueryValidationError);
  });
});
