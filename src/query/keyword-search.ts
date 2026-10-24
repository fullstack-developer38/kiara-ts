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
  const dictionary = new DictionaryTrie();
  const stemmed = data.schema.fieldMap.get(name)?.stemmedIndex;
  const append = (map: Map<string, number[]>, token: string, id: number) => {
    const ids = map.get(token);
    if (ids) ids.push(id);
    else map.set(token, [id]);
  };
  for (let id = 0; id < data.rows.length; id++) {
    const value = data.rows[id]?.[name];
    if (typeof value !== "string") continue;
    const words = new Set(extractKeywordTokens(value));
    for (const word of words) {
      append(raw, word, id);
      dictionary.addWord(word);
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
        throw new QueryValidationError(`Unknown keyword-search field "${field}".`,
          "QUERY_INVALID_CONDITION", { field });
      }
      if (schemaField.ignoreIndex) {
        throw new QueryValidationError(
          `Field "${field}" is marked ignoreIndex and cannot participate in keyword search.`,
          "QUERY_INVALID_CONDITION", { field },
        );
      }
    }
    return [...fields];
  }

  private search(
    input: string | readonly string[], options: KeywordSearchOptions<T>, minimum: boolean,
  ): KeywordSearchResult<T> {
    // Preserve readiness and precondition validation before checking field scope.
    this.store.queryAll(0);
    const ids = options.conditions?.length ? executeSearchIds(this.store.getPreparedData(), options.conditions) : undefined;
    const data = this.store.getPreparedData();
    const names = this.resolveFields(options.fields);
    const fields = names.map((name) => getKeywordField(data, name));
    const eligible = ids === undefined ? undefined : new Set(ids);
    const allowed = (postings: readonly number[] | undefined) =>
      postings !== undefined && (eligible === undefined ? postings.length > 0 : postings.some((id) => eligible.has(id)));
    const rawTokens = [...new Set(typeof input === "string" ? extractKeywordTokens(input)
      : input.flatMap(extractKeywordTokens))];
    const truncated = rawTokens.length > this.maxKeywords;
    const selected = rawTokens.slice(0, this.maxKeywords);
    const correctedKeywords: Record<string, string> = {};
    const usedKeywords = selected.map((token) => {
      if (fields.some((field) => allowed(field.raw.get(token)))) return token;
      const corrections = fields.map((field) =>
        field.dictionary.getOneEditCandidate(token, (word) => allowed(field.raw.get(word))))
        .filter((word): word is string => word !== null)
        .sort((a, b) => a.localeCompare(b, "en-US"));
      const correction = corrections[0];
      if (correction === undefined) return token;
      correctedKeywords[token] = correction;
      return correction;
    });
    const stemmed = names.some((name) => this.store.schema.fieldMap.get(name)?.stemmedIndex);
    const scoringTokens = stemmed
      ? [...new Set(usedKeywords.flatMap((token) => [token, stemEnglishToken(token)]))] : usedKeywords;
    const scores = new Map<number, number>();
    for (const token of scoringTokens) {
      const matching = new Set<number>();
      for (const field of fields) {
        for (const id of field.tokens.get(token) ?? []) {
          if (eligible === undefined || eligible.has(id)) matching.add(id);
        }
      }
      for (const id of matching) scores.set(id, (scores.get(id) ?? 0) + 1);
    }
    let target = minimum ? Infinity : 0;
    for (const score of scores.values()) target = minimum ? Math.min(target, score) : Math.max(target, score);
    const resultIds = [...scores].filter(([, score]) => score === target)
      .map(([id]) => id).sort((a, b) => a - b).slice(0, options.limit ?? 100);
    const matched = new Set<string>();
    for (const id of resultIds) {
      for (const keyword of usedKeywords) {
        if (fields.some((field) => hasRow(field.tokens.get(keyword), id)
          || (stemmed && hasRow(field.tokens.get(stemEnglishToken(keyword)), id)))) {
          matched.add(keyword);
        }
      }
    }
    return {
      results: resultIds.map((id) => data.rows[id]!),
      matchedKeywords: [...matched], correctedKeywords, usedKeywords, truncated,
    };
  }

  public bestMatch(input: string | readonly string[], options: KeywordSearchOptions<T> = {}): KeywordSearchResult<T> {
    return this.search(input, options, false);
  }

  public minimumMatch(input: string | readonly string[], options: KeywordSearchOptions<T> = {}): KeywordSearchResult<T> {
    return this.search(input, options, true);
  }
}
