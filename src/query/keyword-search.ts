import type { Condition } from "./condition.js";
import { Store } from "../store/store.js";
import type { FieldName } from "../schema/types.js";
import { DictionaryTrie } from "../text/dictionary-trie.js";
import { extractKeywordTokens } from "../text/keyword-utils.js";
import { stemEnglishToken } from "../text/stemming.js";
import { QueryValidationError } from "../errors.js";
import type { PreparedStoreData } from "../store/types.js";
import { executeSearchIds } from "../store/search-engine.js";
import { bound } from "../store/ordered-index.js";

export interface KeywordSearchOptions<T extends object> {
  readonly conditions?: readonly Condition<T>[];
  readonly fields?: readonly FieldName<T>[];
  readonly limit?: number;
}

export interface KeywordSearchResult<T extends object> {
  readonly results: readonly T[];
  readonly matchedKeywords: readonly string[];
  readonly correctedKeywords: Readonly<Record<string, string>>;
  readonly usedKeywords: readonly string[];
  readonly truncated: boolean;
}

interface KeywordField {
  readonly dictionary: DictionaryTrie;
  readonly raw: ReadonlyMap<string, readonly number[]>;
  readonly tokens: ReadonlyMap<string, readonly number[]>;
}

interface FieldKeywordMatch {
  readonly fieldIndex: number;
  readonly postings: readonly number[];
}

interface KeywordMatch {
  readonly keyword: string;
  readonly fieldMatches: readonly FieldKeywordMatch[];
}

interface KeywordQueryCandidate {
  readonly keywords: readonly string[];
  readonly fieldLists: ReadonlyMap<number, readonly (readonly number[])[]>;
}

const MAX_COMBINATION_KEYWORDS = 20;

const preparedFields = new WeakMap<object, Map<string, KeywordField>>();

export function getKeywordField<T extends object>(data: PreparedStoreData<T>, name: FieldName<T>): KeywordField {
  let fields = preparedFields.get(data);
  if (!fields) {
    fields = new Map();
    preparedFields.set(data, fields);
  }
  const cached = fields.get(name);
  if (cached) return cached;

  const raw = new Map<string, number[]>();
  const tokens = new Map<string, number[]>();
  const schemaField = data.schema.fieldMap.get(name);
  const caseInsensitive = schemaField?.caseInsensitive === true;
  const correctionCapable = schemaField?.oneEditAway === true || schemaField?.predictable === true;
  const dictionary = new DictionaryTrie({ normalizeCase: caseInsensitive });
  const stemmed = schemaField?.stemmedIndex;
  const append = (map: Map<string, number[]>, token: string, id: number) => {
    const ids = map.get(token);
    if (ids) ids.push(id);
    else map.set(token, [id]);
  };

  for (let id = 0; id < data.rows.length; id++) {
    const value = data.rows[id]?.[name];
    if (typeof value !== "string") continue;
    const words = new Set(extractKeywordTokens(value, caseInsensitive));
    for (const word of words) {
      append(raw, word, id);
      if (correctionCapable) {
        dictionary.addWord(stemmed ? stemEnglishToken(word) : word);
      }
    }
    const indexed = new Set(words);
    if (stemmed) for (const word of words) indexed.add(stemEnglishToken(word));
    for (const token of indexed) append(tokens, token, id);
  }

  const field = { raw, tokens, dictionary };
  fields.set(name, field);
  return field;
}

function hasRow(ids: readonly number[] | undefined, id: number): boolean {
  return ids !== undefined && ids[bound(ids, id, (value) => value, false)] === id;
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined || !Number.isFinite(limit)) return undefined;
  if (limit <= 0) return 0;
  return Math.ceil(limit);
}

function intersectSortedLists(lists: readonly (readonly number[])[]): number[] {
  if (lists.length === 0) return [];
  let anchor = lists[0]!;
  for (let i = 1; i < lists.length; i++) {
    if (lists[i]!.length < anchor.length) anchor = lists[i]!;
  }
  const result: number[] = [];
  for (const id of anchor) {
    if (lists.every((list) => list === anchor || hasRow(list, id))) result.push(id);
  }
  return result;
}

function isMinimumNumericField(secondaryType: string | undefined): boolean {
  return secondaryType === "dateFormat" || secondaryType === "dateTimeFormat"
    || secondaryType === "numericRange" || secondaryType === "dateRange"
    || secondaryType === "dateTimeRange" || secondaryType === "commaSeparatedNumbers"
    || secondaryType === "commaSeparatedDates" || secondaryType === "commaSeparatedDateTimes"
    || secondaryType === "commaSeparatedNumericRanges" || secondaryType === "commaSeparatedDateRanges"
    || secondaryType === "commaSeparatedDateTimeRanges";
}

export class KeywordSearch<T extends object> {
  public constructor(private readonly store: Store<T>, private readonly maxKeywords = 10) {}

  private resolveFields(fields: readonly FieldName<T>[] | undefined): FieldName<T>[] {
    if (fields === undefined) {
      return this.store.schema.fields
        .filter((field) => (field.kind === "text" || field.kind === "enum") && !field.ignoreIndex)
        .map((field) => field.name);
    }
    for (const field of fields) {
      const schemaField = this.store.schema.fieldMap.get(field);
      if (!schemaField) {
        throw new QueryValidationError(
          `Unknown keyword-search field "${field}".`,
          "QUERY_INVALID_CONDITION",
          { field },
        );
      }
      if (schemaField.ignoreIndex) {
        throw new QueryValidationError(
          `Field "${field}" is marked ignoreIndex and cannot participate in keyword search.`,
          "QUERY_INVALID_CONDITION",
          { field },
        );
      }
    }
    return [...fields];
  }

  private search(
    input: string | readonly string[], options: KeywordSearchOptions<T>, minimum: boolean,
  ): KeywordSearchResult<T> {
    this.store.queryAll(0);
    const data = this.store.getPreparedData();
    const ids = options.conditions?.length ? executeSearchIds(data, options.conditions) : undefined;
    const names = this.resolveFields(options.fields);
    const fields = names.map((name) => getKeywordField(data, name));
    const stemmedFields = names.map((name) => this.store.schema.fieldMap.get(name)?.stemmedIndex === true);
    const caseInsensitiveFields = names
      .map((name) => this.store.schema.fieldMap.get(name)?.caseInsensitive === true);
    const limit = normalizeLimit(options.limit);

    const eligible = ids === undefined ? undefined : new Set(ids);
    const allowed = (postings: readonly number[] | undefined) =>
      postings !== undefined && (eligible === undefined ? postings.length > 0 : postings.some((id) => eligible.has(id)));

    const rawTokens = [...new Set(
      typeof input === "string"
        ? extractKeywordTokens(input, false)
        : input.flatMap((token) => extractKeywordTokens(token, false)),
    )];
    const truncated = rawTokens.length > this.maxKeywords;
    const selected = rawTokens.slice(0, this.maxKeywords);
    const correctedKeywords: Record<string, string> = {};

    const fieldMatches = (token: string): FieldKeywordMatch[] => {
      const matches: FieldKeywordMatch[] = [];
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i]!;
        const normalizedToken = caseInsensitiveFields[i] ? token.toLocaleLowerCase("en-US") : token;
        const direct = field.raw.get(normalizedToken);
        if (allowed(direct)) {
          matches.push({ fieldIndex: i, postings: direct! });
          continue;
        }
        if (!stemmedFields[i]) continue;
        const stemmedToken = stemEnglishToken(normalizedToken);
        const stemmed = field.tokens.get(stemmedToken);
        if (allowed(stemmed)) matches.push({ fieldIndex: i, postings: stemmed! });
      }
      return matches;
    };

    const usedKeywords: string[] = [];
    const keywordMatches: KeywordMatch[] = [];
    for (const token of selected) {
      let keyword = token;
      let matches = fieldMatches(keyword);
      if (!matches.length) {
        const corrections = fields.map((field) =>
          field.dictionary.getOneEditCandidate(token))
          .filter((word): word is string => word !== null)
          .sort((a, b) => a.localeCompare(b, "en-US"));
        const correction = corrections[0];
        if (correction !== undefined) {
          keyword = correction;
          correctedKeywords[token] = correction;
          matches = fieldMatches(correction);
        }
      }
      if (!matches.length) continue;
      usedKeywords.push(keyword);
      keywordMatches.push({ keyword, fieldMatches: matches });
    }

    if (!keywordMatches.length || limit === 0) {
      return { results: [], matchedKeywords: [], correctedKeywords, usedKeywords, truncated };
    }

    if (keywordMatches.length > MAX_COMBINATION_KEYWORDS) {
      const scores = new Map<number, number>();
      for (const match of keywordMatches) {
        const keywordRows = new Set<number>();
        for (const fieldMatch of match.fieldMatches) {
          for (const rowId of fieldMatch.postings) keywordRows.add(rowId);
        }
        for (const rowId of keywordRows) scores.set(rowId, (scores.get(rowId) ?? 0) + 1);
      }
      let maxScore = 0;
      for (const score of scores.values()) maxScore = Math.max(maxScore, score);
      let resultIds = [...scores]
        .filter(([, score]) => score === maxScore)
        .map(([rowId]) => rowId)
        .sort((left, right) => left - right);
      if (limit !== undefined) resultIds = resultIds.slice(0, limit);
      const matchedKeywords = resultIds.length === 0 ? [] : [...new Set(keywordMatches.map((match) => match.keyword))];
      if (minimum) {
        const target = matchedKeywords.length;
        resultIds = resultIds.filter((id) => {
          const row = data.rows[id]!;
          const distinct = new Set<string>();
          for (const field of data.schema.fields) {
            if (field.kind === "number" || field.kind === "long" || isMinimumNumericField(field.secondaryType)) {
              continue;
            }
            const value = (row as Record<string, unknown>)[field.name];
            if (value !== null && value !== undefined) distinct.add(String(value));
          }
          return distinct.size === target;
        });
      }
      return {
        results: resultIds.map((id) => data.rows[id]!),
        matchedKeywords: resultIds.length ? matchedKeywords : [],
        correctedKeywords,
        usedKeywords,
        truncated,
      };
    }

    const evaluate = (candidate: KeywordQueryCandidate): number[] => {
      const perField: number[][] = [];
      for (const lists of candidate.fieldLists.values()) {
        const idsForField = intersectSortedLists(lists);
        if (!idsForField.length) return [];
        perField.push(idsForField);
      }
      let resultIds = intersectSortedLists(perField);
      if (eligible) resultIds = resultIds.filter((id) => eligible.has(id));
      if (limit !== undefined) resultIds = resultIds.slice(0, limit);
      return resultIds;
    };

    let chosen: { readonly keywords: readonly string[]; readonly ids: readonly number[] } | undefined;
    const stacks: KeywordQueryCandidate[][] = Array.from({ length: keywordMatches.length }, () => []);
    const collect = (
      index: number,
      fieldLists: Map<number, (readonly number[])[]>,
      fieldIntersections: Map<number, readonly number[]>,
      keywords: string[],
    ): boolean => {
      if (index >= keywordMatches.length) {
        if (!keywords.length) return false;
        const snapshot = new Map<number, readonly (readonly number[])[]>();
        for (const [field, lists] of fieldLists) snapshot.set(field, [...lists]);
        const candidate = { keywords: [...keywords], fieldLists: snapshot };
        if (keywords.length === keywordMatches.length) {
          const idsForCandidate = evaluate(candidate);
          if (idsForCandidate.length) {
            chosen = { keywords: [...new Set(candidate.keywords)], ids: idsForCandidate };
            return true;
          }
        }
        stacks[keywords.length - 1]!.push(candidate);
        return false;
      }
      const match = keywordMatches[index]!;
      for (const fieldMatch of match.fieldMatches) {
        const fieldIndex = fieldMatch.fieldIndex;
        const lists = fieldLists.get(fieldIndex);
        if (lists) lists.push(fieldMatch.postings);
        else fieldLists.set(fieldIndex, [fieldMatch.postings]);

        const previousIntersection = fieldIntersections.get(fieldIndex);
        const nextIntersection = previousIntersection === undefined
          ? fieldMatch.postings
          : intersectSortedLists([previousIntersection, fieldMatch.postings]);

        if (nextIntersection.length === 0) {
          if (lists) lists.pop();
          else fieldLists.delete(fieldIndex);
          continue;
        }
        fieldIntersections.set(fieldIndex, nextIntersection);

        keywords.push(match.keyword);
        if (collect(index + 1, fieldLists, fieldIntersections, keywords)) return true;
        keywords.pop();
        const after = fieldLists.get(fieldIndex)!;
        after.pop();
        if (!after.length) fieldLists.delete(fieldIndex);
        if (previousIntersection === undefined) fieldIntersections.delete(fieldIndex);
        else fieldIntersections.set(fieldIndex, previousIntersection);
      }
      return collect(index + 1, fieldLists, fieldIntersections, keywords);
    };
    collect(0, new Map(), new Map(), []);
    for (let bucket = stacks.length - 1; bucket >= 0 && chosen === undefined; bucket--) {
      const candidates = stacks[bucket]!;
      for (let i = 0; i < candidates.length; i++) {
        const idsForCandidate = evaluate(candidates[i]!);
        if (!idsForCandidate.length) continue;
        chosen = { keywords: [...new Set(candidates[i]!.keywords)], ids: idsForCandidate };
        break;
      }
    }

    if (!chosen) {
      return { results: [], matchedKeywords: [], correctedKeywords, usedKeywords, truncated };
    }

    let resultIds = [...chosen.ids];
    let matchedKeywords = [...chosen.keywords];
    if (minimum) {
      const target = matchedKeywords.length;
      resultIds = resultIds.filter((id) => {
        const row = data.rows[id]!;
        const distinct = new Set<string>();
        for (const field of data.schema.fields) {
          if (field.kind === "number" || field.kind === "long" || isMinimumNumericField(field.secondaryType)) {
            continue;
          }
          const value = (row as Record<string, unknown>)[field.name];
          if (value !== null && value !== undefined) distinct.add(String(value));
        }
        return distinct.size === target;
      });
      if (!resultIds.length) matchedKeywords = [];
    }

    return {
      results: resultIds.map((id) => data.rows[id]!),
      matchedKeywords,
      correctedKeywords,
      usedKeywords,
      truncated,
    };
  }

  public bestMatch(input: string | readonly string[], options: KeywordSearchOptions<T> = {}): KeywordSearchResult<T> {
    return this.search(input, options, false);
  }

  public minimumMatch(input: string | readonly string[], options: KeywordSearchOptions<T> = {}): KeywordSearchResult<T> {
    return this.search(input, options, true);
  }
}
