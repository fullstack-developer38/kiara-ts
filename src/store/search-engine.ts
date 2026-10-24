import { QueryValidationError } from "../errors.js";
import { normalizeDateTimeToEpochSecond, normalizeDateToEpochDay } from "../normalization/date.js";
import { normalizeJavaLongKey, normalizeNativeNumber } from "../normalization/numeric.js";
import { parseDateRangeValue, parseDateTimeRangeValue, parseNumericRangeValue } from "../normalization/range.js";
import { validateConditions, type Condition } from "../query/condition.js";
import { validateOperatorCompatibility } from "../query/operator-compatibility.js";
import { Operator } from "../query/operator.js";
import type { FieldName, SchemaField } from "../schema/types.js";
import { normalizeConditionValue } from "./index-builder.js";
import {
  collectionKey, getExecutionIndex, scalarKey, terminalRows,
  type ExecutionField, type ExecutionIndex,
} from "./execution-index.js";
import { bound, type IndexWork } from "./ordered-index.js";
import {
  NormalizationProfile, type AnyModel, type NormalizedScalar, type PreparedStoreData,
} from "./types.js";

interface Selection {
  readonly ids: Set<number>;
  readonly excluded: boolean;
  readonly field: ExecutionField;
  readonly level: number;
}

function union(groups: Iterable<Iterable<number>>, work?: IndexWork): Set<number> {
  const result = new Set<number>();
  for (const group of groups) {
    for (const id of group) {
      if (work) work.postingEntriesVisited += 1;
      result.add(id);
    }
  }
  return result;
}

function intersection(left: Set<number>, right: Set<number>): Set<number> {
  if (left.size > right.size) return intersection(right, left);
  return new Set([...left].filter((id) => right.has(id)));
}

function isCollection(type: string | undefined): boolean {
  return type === "commaSeparatedStrings" || type === "commaSeparatedNumbers"
    || type === "commaSeparatedDates" || type === "commaSeparatedDateTimes";
}

function isRange(type: string | undefined): boolean {
  return type === "numericRange" || type === "commaSeparatedNumericRanges"
    || type === "dateRange" || type === "commaSeparatedDateRanges"
    || type === "dateTimeRange" || type === "commaSeparatedDateTimeRanges";
}

function rangePoint(
  field: SchemaField<AnyModel, string>,
  value: unknown,
  profile: NormalizationProfile,
): { prefix: string; point: number | bigint } {
  if (typeof value === "number" || typeof value === "bigint") return { prefix: "", point: value };
  if (typeof value !== "string") {
    throw new QueryValidationError(
      `Range query value for field "${field.name}" must be string/number/bigint.`,
      "QUERY_INVALID_CONDITION", { field: field.name, valueType: typeof value },
    );
  }
  const date = field.secondaryType === "dateRange" || field.secondaryType === "commaSeparatedDateRanges";
  const dateTime = field.secondaryType === "dateTimeRange" || field.secondaryType === "commaSeparatedDateTimeRanges";
  if (value.includes("->")) {
    if (date) return { prefix: "", point: parseDateRangeValue(value, field.format).lower };
    if (dateTime) return { prefix: "", point: parseDateTimeRangeValue(value, field.format).lower };
    const parsed = parseNumericRangeValue(value, profile, field.numericStartPos ?? 0);
    return { prefix: parsed.prefix, point: parsed.lower };
  }
  if (date) return { prefix: "", point: normalizeDateToEpochDay(value, field.format) };
  if (dateTime) return { prefix: "", point: normalizeDateTimeToEpochSecond(value, field.format) };
  const start = Math.max(0, field.numericStartPos ?? 0);
  const point = profile === NormalizationProfile.JAVA
    ? normalizeJavaLongKey(start ? value.slice(start) : value)
    : normalizeNativeNumber(start ? value.slice(start) : value);
  if (typeof point !== "number" && typeof point !== "bigint") {
    throw new QueryValidationError(
      `Range query value for field "${field.name}" must resolve to a numeric point.`,
      "QUERY_INVALID_CONDITION", { field: field.name, value },
    );
  }
  return { prefix: start ? value.slice(0, start) : "", point };
}

function select<T extends object>(
  data: PreparedStoreData<T>, execution: ExecutionIndex, condition: Condition<T>, work?: IndexWork,
): Selection {
  const schemaField = data.schema.fieldMap.get(condition.field);
  if (!schemaField) {
    throw new QueryValidationError(`Unknown field "${condition.field}" in condition.`,
      "QUERY_INVALID_CONDITION", { field: condition.field });
  }
  if (schemaField.ignoreIndex) {
    throw new QueryValidationError(
      `Field "${condition.field}" is marked ignoreIndex and cannot be used in search conditions.`,
      "QUERY_INVALID_CONDITION", { field: condition.field, operator: condition.operator },
    );
  }
  const field = schemaField as SchemaField<AnyModel, string>;
  validateOperatorCompatibility(field, condition.operator);
  const index = execution.fields.get(condition.field)!;
  const level = index.nodes.length ? execution.nodes[index.nodes[0]!]!.level : 0;
  const result = (ids: Set<number>, excluded = false): Selection => ({ ids, excluded, field: index, level });
  const normalize = (value: unknown) => normalizeConditionValue(field, value, data.normalizationProfile);
  const lookup = (values: readonly NormalizedScalar[]) =>
    union(values.map((value) => index.equality.get(scalarKey(value)) ?? []), work);
  const type = field.secondaryType;

  if (isRange(type) && (condition.operator === Operator.CONTAINS_EITHER
    || condition.operator === Operator.CONTAINS_ALL || condition.operator === Operator.NOT_CONTAINS)) {
    const groups = (condition.values ?? []).map((value) => {
      const { prefix, point } = rangePoint(field, value, data.normalizationProfile);
      return index.intervals.get(prefix)?.containing(point, work) ?? new Set<number>();
    });
    if (condition.operator === Operator.CONTAINS_ALL) {
      return result(groups.reduce(intersection, groups[0] ?? new Set<number>()));
    }
    const matches = union(groups, work);
    if (condition.operator === Operator.NOT_CONTAINS) {
      // Missing ranges were rejected by the former residual predicate.
      return result(new Set(index.rangeNodes.filter((id) => !matches.has(id))));
    }
    return result(matches);
  }

  if (condition.operator === Operator.BETWEEN
    || condition.operator === Operator.LESS_THAN || condition.operator === Operator.LESS_THAN_EQUAL
    || condition.operator === Operator.GREATER_THAN || condition.operator === Operator.GREATER_THAN_EQUAL) {
    const between = condition.operator === Operator.BETWEEN;
    const first = normalize(between ? condition.lowerValue : condition.values?.[0]);
    const second = between ? normalize(condition.upperValue) : first;
    if ((typeof first !== "number" && typeof first !== "bigint")
      || (typeof second !== "number" && typeof second !== "bigint")) {
      throw new QueryValidationError(between
        ? `BETWEEN on field "${condition.field}" requires numeric bounds.`
        : `Operator "${condition.operator}" on field "${condition.field}" requires one numeric value.`,
      "QUERY_INVALID_CONDITION");
    }
    const entries = index.numeric;
    const key = (entry: typeof entries[number]) => entry.key;
    let start = 0;
    let end = entries.length;
    if (between || condition.operator === Operator.GREATER_THAN || condition.operator === Operator.GREATER_THAN_EQUAL) {
      start = bound(entries, first, key, condition.operator === Operator.GREATER_THAN, work);
    }
    if (between || condition.operator === Operator.LESS_THAN || condition.operator === Operator.LESS_THAN_EQUAL) {
      end = bound(entries, second, key, between || condition.operator === Operator.LESS_THAN_EQUAL, work);
    }
    const ids = new Set<number>();
    for (let i = start; i < end; i++) {
      if (work) work.keysVisited += 1;
      for (const id of entries[i]!.nodeIds) {
        if (work) work.postingEntriesVisited += 1;
        ids.add(id);
      }
    }
    return result(ids);
  }

  const values = (condition.values ?? []).map(normalize);
  switch (condition.operator) {
    case Operator.EQUAL:
      // Preserve 1.x scalar equality semantics; collection membership has its own operators.
      return result(field.secondaryType?.startsWith("commaSeparated") ? new Set() : lookup(values));
    case Operator.NOT_EQUAL: {
      if (!isCollection(type)) return result(lookup(values), true);
      const groups: Iterable<number>[] = [];
      for (const value of condition.values ?? []) {
        if (value === null || value === undefined) {
          groups.push(index.missing);
        } else {
          const tokens = typeof value === "string"
            ? value.split(",").map((token) => token.trim()).filter(Boolean) : [value];
          const key = collectionKey((tokens.length ? tokens : [value]).map(normalize));
          groups.push(index.fullKeys.get(key) ?? []);
        }
      }
      return result(union(groups, work), true);
    }
    case Operator.CONTAINS_EITHER:
    case Operator.CONTAINS_EITHER_INCLUDING_NULL:
    case Operator.CONTAINS_ALL:
    case Operator.NOT_CONTAINS: {
      if (!isCollection(type)) {
        throw new QueryValidationError(
          `${condition.operator} is supported only for collection fields. Field "${condition.field}" is not one.`,
          "QUERY_INVALID_CONDITION",
        );
      }
      if (condition.operator === Operator.CONTAINS_ALL) {
        const groups = values.map((value) => new Set(index.equality.get(scalarKey(value)) ?? []));
        return result(groups.reduce(intersection, groups[0] ?? new Set<number>()));
      }
      const matches = lookup(values);
      if (condition.operator === Operator.CONTAINS_EITHER_INCLUDING_NULL && values.includes(null)) {
        for (const id of index.missing) matches.add(id);
      }
      return result(matches, condition.operator === Operator.NOT_CONTAINS);
    }
    default:
      return result(new Set());
  }
}

function ordered(index: ExecutionIndex, ids: Iterable<number>): number[] {
  return [...ids].sort((a, b) => index.nodes[a]!.start - index.nodes[b]!.start);
}

function descendants(
  index: ExecutionIndex, ancestors: readonly number[], candidates: readonly number[], work?: IndexWork,
): number[] {
  const result: number[] = [];
  const start = (id: number) => index.nodes[id]!.start;
  if (ancestors.length <= candidates.length) {
    for (const id of ancestors) {
      const ancestor = index.nodes[id]!;
      let cursor = bound(candidates, ancestor.start, start, false, work);
      while (cursor < candidates.length && start(candidates[cursor]!) < ancestor.end) {
        if (work) work.postingEntriesVisited += 1;
        result.push(candidates[cursor++]!);
      }
    }
  } else {
    for (const id of candidates) {
      const cursor = bound(ancestors, start(id), start, true, work) - 1;
      if (cursor >= 0 && index.nodes[ancestors[cursor]!]!.end > start(id)) result.push(id);
      if (work) work.postingEntriesVisited += 1;
    }
  }
  return result;
}

export function executeSearchIds<T extends object>(
  data: PreparedStoreData<T>, conditions: readonly Condition<T>[], work?: IndexWork, limit?: number,
): number[] {
  validateConditions(conditions);
  const index = getExecutionIndex(data);
  let candidates: number[] | undefined;
  let level = 0;
  // Resolve in caller order to retain validation/empty-result precedence.
  for (const condition of conditions) {
    const next = select(data, index, condition, work);
    if (candidates === undefined) {
      candidates = next.excluded
        ? next.field.nodes.filter((id) => !next.ids.has(id))
        : conditions.length === 1 ? [...next.ids] : ordered(index, next.ids);
      level = next.level;
    } else if (level === next.level) {
      candidates = candidates.filter((id) => next.ids.has(id) !== next.excluded);
    } else if (level < next.level) {
      const eligible = next.excluded ? next.field.nodes : ordered(index, next.ids);
      candidates = descendants(index, candidates, eligible, work);
      if (next.excluded) candidates = candidates.filter((id) => !next.ids.has(id));
      level = next.level;
    } else {
      const matches = descendants(index, ordered(index, next.ids), candidates, work);
      if (next.excluded) {
        const rejected = new Set(matches);
        candidates = candidates.filter((id) => !rejected.has(id));
      } else candidates = matches;
    }
    if (!candidates.length) return [];
  }
  return terminalRows(index, candidates ?? [], work, limit);
}

export function executeSearch<T extends object>(
  data: PreparedStoreData<T>, conditions: readonly Condition<T>[], limit?: number, work?: IndexWork,
): readonly T[] {
  const ids = executeSearchIds(data, conditions, work, limit);
  const selected = limit === undefined ? ids : limit <= 0 ? [] : ids.slice(0, Math.ceil(limit));
  return selected.map((id) => {
    if (work) work.sourceRowsVisited += 1;
    return data.rows[id]!;
  });
}

export { buildPreparedStoreData } from "./index-builder.js";
