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
  type ExecutionIndex,
} from "./execution-index.js";
import { bound, compareNumeric, type IndexWork } from "./ordered-index.js";
import {
  hasMatches, joinPlans, matchingNodes, numericPlan, postingPlan, subtractPlans, type PostingPlan,
} from "./posting-plan.js";
import {
  NormalizationProfile, type AnyModel, type NormalizedScalar, type PreparedStoreData,
} from "./types.js";

interface OrderedCondition<T extends object> {
  readonly condition: Condition<T>;
  readonly order: number;
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

function compareOrdered(left: NormalizedScalar, right: NormalizedScalar): number {
  if (left === null && right === null) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  const leftText = typeof left === "boolean" ? String(left) : String(left);
  const rightText = typeof right === "boolean" ? String(right) : String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
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

function orderedConditions<T extends object>(
  data: PreparedStoreData<T>,
  conditions: readonly Condition<T>[],
): OrderedCondition<T>[] {
  const fieldOrder = new Map(data.schema.fields.map((field, index) => [field.name, index]));
  const ordered: OrderedCondition<T>[] = [];
  for (let i = 0; i < conditions.length; i++) {
    const condition = conditions[i]!;
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
    const order = fieldOrder.get(condition.field);
    if (order === undefined) {
      throw new QueryValidationError(`Unknown field "${condition.field}" in condition.`,
        "QUERY_INVALID_CONDITION", { field: condition.field });
    }
    ordered.push({ condition, order });
  }
  return ordered.sort((left, right) => left.order - right.order);
}

function buildSearchPlan<T extends object>(
  data: PreparedStoreData<T>,
  index: ExecutionIndex,
  conditions: readonly Condition<T>[],
  work?: IndexWork,
): PostingPlan | undefined {
  const sorted = orderedConditions(data, conditions);
  let plan: PostingPlan | undefined;
  for (let i = 0; i < sorted.length;) {
    const current = sorted[i]!;
    let groupPlan = select(data, index, current.condition, work);
    i += 1;
    while (i < sorted.length && sorted[i]!.order === current.order) {
      const next = select(data, index, sorted[i]!.condition, work);
      groupPlan = joinPlans(index, groupPlan, next, work);
      i += 1;
    }
    if (!hasMatches(groupPlan, work)) return undefined;
    plan = plan ? joinPlans(index, plan, groupPlan, work) : groupPlan;
    if (!hasMatches(plan, work)) return undefined;
  }
  return plan;
}

function select<T extends object>(
  data: PreparedStoreData<T>, execution: ExecutionIndex, condition: Condition<T>, work?: IndexWork,
): PostingPlan {
  const schemaField = data.schema.fieldMap.get(condition.field)!;
  const field = schemaField as SchemaField<AnyModel, string>;
  validateOperatorCompatibility(field, condition.operator);
  const index = execution.fields.get(condition.field)!;
  const result = (groups: readonly (readonly number[])[], matches?: (id: number) => boolean) =>
    postingPlan(execution, index, groups, work, matches);
  const exclude = (selected: PostingPlan, ranges = false) => {
    const universe = ranges ? index.rangeNodes : index.nodes;
    return subtractPlans(execution, result([universe], (id) =>
      !ranges || !!execution.nodes[id]!.value?.rangeValues?.length), selected, work);
  };
  const normalize = (value: unknown) => normalizeConditionValue(field, value, data.normalizationProfile);
  const lookup = (values: readonly NormalizedScalar[]) => {
    const keys = new Set(values);
    return result([...keys].map((key) => index.equality.get(scalarKey(key)) ?? []), (id) => {
      const value = execution.nodes[id]!.value!;
      return value.isCollection
        ? (value.collectionValues ?? []).some((token) => keys.has(token))
        : keys.has(value.scalar ?? null);
    });
  };
  const type = field.secondaryType;

  if (isRange(type) && (condition.operator === Operator.CONTAINS_EITHER
    || condition.operator === Operator.CONTAINS_ALL || condition.operator === Operator.NOT_CONTAINS)) {
    const points = (condition.values ?? []).map((value) => {
      const { prefix, point } = rangePoint(field, value, data.normalizationProfile);
      const groups = index.intervals.get(prefix)?.containingGroups(point, work) ?? [];
      return result(groups, (id) => (execution.nodes[id]!.value?.rangeValues ?? []).some((range) =>
        range.prefix === prefix && range.lower <= point && point <= range.upper));
    });
    if (condition.operator === Operator.CONTAINS_ALL) {
      return points.length ? points.reduce((left, right) => joinPlans(execution, left, right, work)) : result([]);
    }
    const groups = (condition.values ?? []).length === 1 ? points[0]
      : result(points.flatMap((plan) => [...plan.groups].map((group) => group.ids)),
        (id) => points.some((plan) => plan.matches(id)));
    const matches = groups ?? result([]);
    if (condition.operator === Operator.NOT_CONTAINS) {
      return exclude(matches, true);
    }
    return matches;
  }

  if (condition.operator === Operator.BETWEEN
    || condition.operator === Operator.LESS_THAN || condition.operator === Operator.LESS_THAN_EQUAL
    || condition.operator === Operator.GREATER_THAN || condition.operator === Operator.GREATER_THAN_EQUAL) {
    const between = condition.operator === Operator.BETWEEN;
    const first = normalize(between ? condition.lowerValue : condition.values?.[0]);
    const second = between ? normalize(condition.upperValue) : first;
    const numericBounds = (typeof first === "number" || typeof first === "bigint")
      && (typeof second === "number" || typeof second === "bigint");
    if (numericBounds && !isCollection(type)) {
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
      return numericPlan(execution, index, start, end, work);
    }
    const compare = numericBounds
      ? (left: NormalizedScalar, right: NormalizedScalar) => {
        if ((typeof left !== "number" && typeof left !== "bigint")
          || (typeof right !== "number" && typeof right !== "bigint")) {
          return Number.NaN;
        }
        return compareNumeric(left, right);
      }
      : compareOrdered;
    const include = (value: NormalizedScalar) => {
      const lower = compare(value, first);
      const upper = compare(value, second);
      if (Number.isNaN(lower) || Number.isNaN(upper)) return false;
      if (between) return lower >= 0 && upper <= 0;
      if (condition.operator === Operator.LESS_THAN) return lower < 0;
      if (condition.operator === Operator.LESS_THAN_EQUAL) return lower <= 0;
      if (condition.operator === Operator.GREATER_THAN) return lower > 0;
      return lower >= 0;
    };
    const matches = (id: number) => {
      const node = execution.nodes[id]!.value;
      if (!node) return false;
      const values = node.isCollection ? node.collectionValues ?? [] : [node.scalar ?? null];
      return values.some((value) => include(value));
    };
    const selected = index.nodes.filter((id) => matches(id));
    return result([selected], matches);
  }

  const values = (condition.values ?? []).map(normalize);
  switch (condition.operator) {
    case Operator.EQUAL:
      return lookup(values);
    case Operator.NOT_EQUAL: {
      if (!isCollection(type)) return exclude(lookup(values));
      const groups: (readonly number[])[] = [];
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
      return exclude(result(groups));
    }
    case Operator.CONTAINS_EITHER:
    case Operator.CONTAINS_EITHER_INCLUDING_NULL:
    case Operator.CONTAINS_ALL:
    case Operator.NOT_CONTAINS: {
      if (condition.operator === Operator.NOT_CONTAINS && !isCollection(type)) {
        throw new QueryValidationError(
          `${condition.operator} is supported only for collection fields. Field "${condition.field}" is not one.`,
          "QUERY_INVALID_CONDITION",
        );
      }
      if (condition.operator === Operator.CONTAINS_ALL) {
        const groups = values.map((value) => lookup([value]));
        return groups.length ? groups.reduce((left, right) => joinPlans(execution, left, right, work)) : result([]);
      }
      const selected = lookup(values);
      if (condition.operator === Operator.CONTAINS_EITHER_INCLUDING_NULL && values.includes(null)) {
        return result([
          ...values.map((value) => index.equality.get(scalarKey(value)) ?? []), index.missing,
        ], (id) => selected.matches(id) || execution.nodes[id]!.value!.collectionValues === undefined);
      }
      return condition.operator === Operator.NOT_CONTAINS ? exclude(selected) : selected;
    }
    default:
      return result([]);
  }
}

export function executeSearchIds<T extends object>(
  data: PreparedStoreData<T>, conditions: readonly Condition<T>[], work?: IndexWork, limit?: number,
): number[] {
  validateConditions(conditions);
  const index = getExecutionIndex(data);
  const plan = buildSearchPlan(data, index, conditions, work);
  if (!plan) return [];
  const collapseDuplicateRows = data.normalizationProfile === NormalizationProfile.JAVA;
  if (limit !== undefined && Number.isFinite(limit) && limit > 0 && plan.estimate > 0
    && Math.ceil(limit) * plan.field.nodes.length < plan.estimate * plan.estimate) {
    // Source-order limits are a TS contract. Bound the adaptive cursor so skewed
    // data falls back to posting joins instead of forcing a whole-field scan.
    const selected = plan;
    const budget = Math.max(Math.ceil(limit), Math.ceil(plan.estimate));
    let exhaustedBudget = false;
    const roots = {
      *[Symbol.iterator]() {
        let visited = 0;
        for (const id of selected.field.sourceNodes) {
          if (visited++ >= budget) { exhaustedBudget = true; return; }
          if (work) { work.sourceOrderNodesVisited += 1; work.predicateChecks += 1; }
          if (selected.matches(id)) yield id;
        }
      },
    };
    const ids = terminalRows(index, roots, work, limit, true, collapseDuplicateRows);
    if (!exhaustedBudget) return ids;
  }
  return terminalRows(index, matchingNodes(plan, work), work, limit, false, collapseDuplicateRows);
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

function normalizeLegacyLimit(limit?: number): number | undefined {
  if (limit === undefined || !Number.isFinite(limit)) return undefined;
  if (limit <= 0) return 0;
  return Math.ceil(limit);
}

function javaNumericString(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  const formatted = numeric.toFixed(2);
  return formatted.endsWith(".00") ? formatted.slice(0, -3) : formatted;
}

function legacyFieldValue<T extends object>(
  data: PreparedStoreData<T>,
  rowId: number,
  position: number,
): string | null {
  const field = data.schema.fields[position]!;
  const value = (data.rows[rowId] as Record<string, unknown>)[field.name];
  if (value === null || value === undefined) return null;
  if (field.kind === "number" || field.kind === "long") return javaNumericString(value);
  return String(value);
}

export function executeLegacyProjection<T extends object>(
  data: PreparedStoreData<T>,
  conditions: readonly Condition<T>[],
  selectedFields: readonly FieldName<T>[],
  limit?: number,
): readonly Record<string, string | null>[] {
  validateConditions(conditions);
  const maxResults = normalizeLegacyLimit(limit);
  if (maxResults === 0) return [];
  const index = getExecutionIndex(data);
  const plan = buildSearchPlan(data, index, conditions);
  if (!plan) return [];

  const selectedPositions = [...new Set(selectedFields
    .map((field) => data.schema.fields.findIndex((candidate) => candidate.name === field)))]
    .filter((position) => position >= 0)
    .sort((left, right) => left - right);
  if (!selectedPositions.length) return [];
  const selected = new Set(selectedPositions);
  const firstSelected = selectedPositions[0]!;
  const lastSelected = selectedPositions[selectedPositions.length - 1]!;
  const roots = new Set<number>();
  const results: Record<string, string | null>[] = [];

  const pushResult = (entry: Record<string, string | null>) => {
    results.push(entry);
    return maxResults !== undefined && results.length >= maxResults;
  };

  const writeField = (target: Record<string, string | null>, nodeId: number, position: number) => {
    const key = String(data.schema.fields[position]!.name).toUpperCase();
    target[key] = legacyFieldValue(data, index.nodes[nodeId]!.firstRow, position);
  };

  const appendPostfix = (
    nodeId: number,
    nextPosition: number,
    current: Record<string, string | null>,
  ): boolean => {
    if (maxResults !== undefined && results.length >= maxResults) return true;
    if (nextPosition > lastSelected) return pushResult({ ...current });
    for (const childId of index.nodes[nodeId]!.children.values()) {
      let snapshot = current;
      if (selected.has(nextPosition)) {
        snapshot = { ...current };
        writeField(snapshot, childId, nextPosition);
      }
      if (appendPostfix(childId, nextPosition + 1, snapshot)) return true;
    }
    return false;
  };

  for (const rootId of matchingNodes(plan)) {
    if (roots.has(rootId)) continue;
    roots.add(rootId);
    const root = index.nodes[rootId]!;
    const rootPosition = root.level - 1;
    const projection: Record<string, string | null> = {};
    if (firstSelected <= rootPosition) {
      let node = root;
      while (node.fieldName !== null) {
        const position = node.level - 1;
        if (selected.has(position)) writeField(projection, node.id, position);
        if (node.parentId === null) break;
        node = index.nodes[node.parentId]!;
      }
    }
    if (appendPostfix(rootId, rootPosition + 1, projection)) break;
  }

  return results;
}

export { buildPreparedStoreData } from "./index-builder.js";
