import { QueryValidationError } from "../errors.js";
import { Operator, type Operator as OperatorType } from "./operator.js";
import type { SchemaField } from "../schema/types.js";

const COMPARISON_OPERATORS = new Set<OperatorType>([
  Operator.LESS_THAN,
  Operator.LESS_THAN_EQUAL,
  Operator.GREATER_THAN,
  Operator.GREATER_THAN_EQUAL,
  Operator.BETWEEN,
]);

const CONTAINS_OPERATORS = new Set<OperatorType>([
  Operator.CONTAINS_EITHER,
  Operator.CONTAINS_ALL,
  Operator.CONTAINS_EITHER_INCLUDING_NULL,
  Operator.NOT_CONTAINS,
]);

function isCollectionSecondaryType(secondaryType: string | undefined): boolean {
  return (
    secondaryType === "commaSeparatedStrings" ||
    secondaryType === "commaSeparatedNumbers" ||
    secondaryType === "commaSeparatedDates" ||
    secondaryType === "commaSeparatedDateTimes"
  );
}

function isRangeSecondaryType(secondaryType: string | undefined): boolean {
  return (
    secondaryType === "numericRange" ||
    secondaryType === "dateRange" ||
    secondaryType === "dateTimeRange" ||
    secondaryType === "commaSeparatedNumericRanges" ||
    secondaryType === "commaSeparatedDateRanges" ||
    secondaryType === "commaSeparatedDateTimeRanges"
  );
}

function throwUnsupported<T extends object, TName extends Extract<keyof T, string>>(
  field: SchemaField<T, TName>,
  operator: OperatorType,
): never {
  throw new QueryValidationError(
    `Operator "${operator}" is not supported for field "${field.name}" (kind=${field.kind}, secondaryType=${field.secondaryType ?? "none"}).`,
    "QUERY_INVALID_CONDITION",
    { field: field.name, kind: field.kind, secondaryType: field.secondaryType, operator },
  );
}

export function validateOperatorCompatibility<
  T extends object,
  TName extends Extract<keyof T, string>,
>(
  field: SchemaField<T, TName>,
  operator: OperatorType,
): void {
  if (isRangeSecondaryType(field.secondaryType)) {
    if (COMPARISON_OPERATORS.has(operator)) {
      throw new QueryValidationError(
        `Range secondary type "${field.secondaryType}" does not support comparison operators.`,
        "QUERY_INVALID_CONDITION",
        { field: field.name, operator, secondaryType: field.secondaryType },
      );
    }
    if (
      operator === Operator.EQUAL
      || operator === Operator.NOT_EQUAL
      || operator === Operator.CONTAINS_EITHER
      || operator === Operator.CONTAINS_ALL
      || operator === Operator.CONTAINS_EITHER_INCLUDING_NULL
      || operator === Operator.NOT_CONTAINS
    ) {
      return;
    }
    throw new QueryValidationError(
      `Range secondary type "${field.secondaryType}" supports EQUAL, NOT_EQUAL, CONTAINS_EITHER, CONTAINS_ALL, CONTAINS_EITHER_INCLUDING_NULL and NOT_CONTAINS.`,
      "QUERY_INVALID_CONDITION",
      { field: field.name, operator, secondaryType: field.secondaryType },
    );
  }

  if (isCollectionSecondaryType(field.secondaryType)) {
    return;
  }

  if (field.kind === "text" || field.kind === "enum" || field.kind === "boolean") {
    if (operator === Operator.NOT_CONTAINS) throwUnsupported(field, operator);
    return;
  }

  if ((field.kind === "number" || field.kind === "long") && operator === Operator.NOT_CONTAINS) {
    throwUnsupported(field, operator);
  }

  if (
    (field.secondaryType === "dateFormat" || field.secondaryType === "dateTimeFormat")
    && operator === Operator.NOT_CONTAINS
  ) {
    throwUnsupported(field, operator);
  }

  if (CONTAINS_OPERATORS.has(operator) || COMPARISON_OPERATORS.has(operator)
    || operator === Operator.EQUAL || operator === Operator.NOT_EQUAL) {
    return;
  }

  throwUnsupported(field, operator);
}
