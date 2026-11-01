import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCondition } from "../query/condition.js";
import { KeywordSearch } from "../query/keyword-search.js";
import { defineSchema } from "../schema/define-schema.js";
import { numberField, textField } from "../schema/field-factories.js";
import { Store } from "../store/store.js";
import { NormalizationProfile } from "../store/types.js";
import { JAVA_KEYWORD_FIXTURE_FILES } from "./java-fixture-catalog.js";

interface KeywordRow {
  title: string;
  plot: string;
  year: number;
}

interface RawCondition {
  readonly field: "year";
  readonly values: readonly number[];
}

interface KeywordCase {
  readonly id: string;
  readonly method: "best" | "minimum";
  readonly input: string;
  readonly maxKeywords?: number;
  readonly options?: {
    readonly conditions?: readonly RawCondition[];
  };
  readonly expectedTitles: readonly string[];
  readonly expectedTruncated?: boolean;
}

interface KeywordDocument {
  readonly metadata?: {
    readonly sourceSha?: string;
  };
  readonly rows: readonly KeywordRow[];
  readonly cases: readonly KeywordCase[];
}

const schema = defineSchema<KeywordRow>([
  textField("title", { caseInsensitive: true, oneEditAway: true }),
  textField("plot", { caseInsensitive: true, oneEditAway: true }),
  numberField("year"),
]);

function readFixture(filename: string): string {
  return readFileSync(new URL(`./fixtures/${filename}`, import.meta.url), "utf-8");
}

describe("java-derived keyword corpus smoke", () => {
  it("executes designated keyword fixture sets with expected result sets", () => {
    let totalCases = 0;

    for (const fixtureFile of JAVA_KEYWORD_FIXTURE_FILES) {
      const document = JSON.parse(readFixture(fixtureFile)) as KeywordDocument;
      if (document.metadata?.sourceSha !== undefined) {
        expect(document.metadata.sourceSha).toBe("568d1addd15e237a5fa2dfaf7538b193d5564773");
      }

      for (const testCase of document.cases) {
        totalCases += 1;
        const store = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
        for (const row of document.rows) {
          store.loadRow(row);
        }
        store.prepare();

        const search = new KeywordSearch(store, testCase.maxKeywords ?? 10);
        const options = testCase.options?.conditions === undefined
          ? undefined
          : {
              conditions: testCase.options.conditions.map((condition) =>
                createCondition<KeywordRow, "year">({
                  field: condition.field,
                  values: condition.values,
                })),
            };

        const result = testCase.method === "best"
          ? search.bestMatch(testCase.input, options)
          : search.minimumMatch(testCase.input, options);

        expect(result.results.map((row) => row.title), testCase.id).toEqual(testCase.expectedTitles);
        if (testCase.expectedTruncated !== undefined) {
          expect(result.truncated, `${testCase.id}:truncated`).toBe(testCase.expectedTruncated);
        }
      }
    }

    expect(totalCases).toBeGreaterThanOrEqual(7);
  });
});
