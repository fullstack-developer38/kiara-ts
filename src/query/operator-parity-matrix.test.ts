import { describe, expect, it } from "vitest";
import { QueryValidationError } from "../errors.js";
import { defineSchema } from "../schema/define-schema.js";
import { booleanField, numberField, textField } from "../schema/field-factories.js";
import { Operator } from "./operator.js";
import { validateOperatorCompatibility } from "./operator-compatibility.js";

interface MatrixRow {
  textValue: string;
  boolValue: boolean;
  numberValue: number;
  dateValue: string;
  tags: string;
  numberTags: string;
  dateTags: string;
  dateTimeTags: string;
  numericRange: string;
  dateRange: string;
  dateTimeRange: string;
  numericRanges: string;
  dateRanges: string;
  dateTimeRanges: string;
}

const schema = defineSchema<MatrixRow>([
  textField("textValue"),
  booleanField("boolValue"),
  numberField("numberValue"),
  textField("dateValue", { secondaryType: "dateFormat" }),
  textField("tags", { secondaryType: "commaSeparatedStrings" }),
  textField("numberTags", { secondaryType: "commaSeparatedNumbers" }),
  textField("dateTags", { secondaryType: "commaSeparatedDates" }),
  textField("dateTimeTags", { secondaryType: "commaSeparatedDateTimes" }),
  textField("numericRange", { secondaryType: "numericRange", numericStartPos: 1 }),
  textField("dateRange", { secondaryType: "dateRange" }),
  textField("dateTimeRange", { secondaryType: "dateTimeRange" }),
  textField("numericRanges", { secondaryType: "commaSeparatedNumericRanges", numericStartPos: 1 }),
  textField("dateRanges", { secondaryType: "commaSeparatedDateRanges" }),
  textField("dateTimeRanges", { secondaryType: "commaSeparatedDateTimeRanges" }),
]);

const scalarOperatorsWithoutNotContains = new Set([
  Operator.EQUAL,
  Operator.NOT_EQUAL,
  Operator.LESS_THAN,
  Operator.LESS_THAN_EQUAL,
  Operator.GREATER_THAN,
  Operator.GREATER_THAN_EQUAL,
  Operator.BETWEEN,
  Operator.CONTAINS_EITHER,
  Operator.CONTAINS_ALL,
  Operator.CONTAINS_EITHER_INCLUDING_NULL,
]);
const collectionOperators = new Set([
  ...scalarOperatorsWithoutNotContains,
  Operator.NOT_CONTAINS,
]);
const scalarRangeOperators = new Set([
  Operator.EQUAL,
  Operator.NOT_EQUAL,
  Operator.CONTAINS_EITHER,
  Operator.CONTAINS_ALL,
  Operator.CONTAINS_EITHER_INCLUDING_NULL,
  Operator.NOT_CONTAINS,
]);

const scenarios: ReadonlyArray<{
  readonly field: keyof MatrixRow;
  readonly allowed: ReadonlySet<string>;
}> = [
  { field: "textValue", allowed: scalarOperatorsWithoutNotContains },
  { field: "boolValue", allowed: scalarOperatorsWithoutNotContains },
  { field: "numberValue", allowed: scalarOperatorsWithoutNotContains },
  { field: "dateValue", allowed: scalarOperatorsWithoutNotContains },
  { field: "tags", allowed: collectionOperators },
  { field: "numberTags", allowed: collectionOperators },
  { field: "dateTags", allowed: collectionOperators },
  { field: "dateTimeTags", allowed: collectionOperators },
  { field: "numericRange", allowed: scalarRangeOperators },
  { field: "dateRange", allowed: scalarRangeOperators },
  { field: "dateTimeRange", allowed: scalarRangeOperators },
  { field: "numericRanges", allowed: scalarRangeOperators },
  { field: "dateRanges", allowed: scalarRangeOperators },
  { field: "dateTimeRanges", allowed: scalarRangeOperators },
];

describe("operator parity matrix", () => {
  for (const scenario of scenarios) {
    it(`enforces operator compatibility for ${scenario.field}`, () => {
      const field = schema.fieldMap.get(scenario.field);
      if (field === undefined) {
        throw new Error(`Expected schema field "${scenario.field}"`);
      }

      for (const operator of Object.values(Operator)) {
        const shouldAllow = scenario.allowed.has(operator);
        if (shouldAllow) {
          expect(() => validateOperatorCompatibility(field, operator)).not.toThrow();
        } else {
          expect(() => validateOperatorCompatibility(field, operator)).toThrowError(
            QueryValidationError,
          );
        }
      }
    });
  }
});
