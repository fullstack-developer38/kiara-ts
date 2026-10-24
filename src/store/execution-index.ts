import { StoreStateError } from "../errors.js";
import type { FieldName } from "../schema/types.js";
import type {
  NormalizedFieldValue, NormalizedRow, NormalizedScalar, PreparedStoreData, TrieSnapshot,
} from "./types.js";
import { compareNumeric, IntervalIndex, type IntervalEntry, type IndexWork } from "./ordered-index.js";

export interface ExecutionNode {
  readonly id: number;
  readonly fieldName: string | null;
  readonly level: number;
  readonly parentId: number | null;
  readonly children: Map<string, number>;
  readonly value: NormalizedFieldValue | undefined;
  readonly terminalRows: number[];
  readonly firstRow: number;
  start: number;
  end: number;
}

export interface ExecutionField {
  readonly nodes: readonly number[];
  readonly equality: ReadonlyMap<string, readonly number[]>;
  readonly fullKeys: ReadonlyMap<string, readonly number[]>;
  readonly numeric: readonly { key: number | bigint; nodeIds: readonly number[] }[];
  readonly intervals: ReadonlyMap<string, IntervalIndex>;
  readonly missing: readonly number[];
  readonly rangeNodes: readonly number[];
}

export interface ExecutionIndex {
  readonly nodes: readonly ExecutionNode[];
  readonly fields: ReadonlyMap<string, ExecutionField>;
}

const indexes = new WeakMap<object, ExecutionIndex>();

export function registerExecutionIndex(data: object, index: ExecutionIndex): void {
  indexes.set(data, index);
}

export function getExecutionIndex(data: object): ExecutionIndex {
  const index = indexes.get(data);
  if (!index) throw new StoreStateError("Prepared execution indexes are unavailable.");
  return index;
}

export function scalarKey(value: NormalizedScalar): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string": return `s:${value}`;
    case "boolean": return `b:${value ? "1" : "0"}`;
    case "number": return `n:${value}`;
    case "bigint": return `i:${value.toString()}`;
  }
}

export function collectionKey(values: readonly NormalizedScalar[]): string {
  return JSON.stringify(values.map(scalarKey));
}

function append(map: Map<string, number[]>, key: string, nodeId: number): void {
  const ids = map.get(key);
  if (ids) {
    if (ids[ids.length - 1] !== nodeId) ids.push(nodeId);
  } else map.set(key, [nodeId]);
}

export function buildExecutionIndex<T extends object>(
  data: Pick<PreparedStoreData<T>, "schema">,
  rows: readonly NormalizedRow<T>[],
): ExecutionIndex {
  const nodes: ExecutionNode[] = [{
    id: 0, fieldName: null, level: 0, parentId: null, children: new Map(),
    value: undefined, terminalRows: [], firstRow: rows[0]?.id ?? Infinity, start: 0, end: 0,
  }];
  for (const row of rows) {
    let parent = nodes[0]!;
    for (const field of data.schema.fields) {
      const value = row.values.get(field.name)!;
      const identity = value.isCollection
        ? `collection:${value.collectionValues === undefined ? "missing" : collectionKey(value.collectionValues)}`
        : scalarKey(value.scalar ?? null);
      let id = parent.children.get(identity);
      if (id === undefined) {
        id = nodes.length;
        parent.children.set(identity, id);
        nodes.push({
          id, fieldName: field.name, level: parent.level + 1, parentId: parent.id,
          children: new Map(), value, terminalRows: [], firstRow: row.id, start: 0, end: 0,
        });
      }
      parent = nodes[id]!;
    }
    parent.terminalRows.push(row.id);
  }

  let clock = 0;
  const traversal: { node: ExecutionNode; exit: boolean }[] = [{ node: nodes[0]!, exit: false }];
  const fieldNodes = new Map<string, number[]>();
  while (traversal.length) {
    const { node, exit } = traversal.pop()!;
    if (exit) {
      node.end = clock++;
      continue;
    }
    node.start = clock++;
    if (node.fieldName !== null) append(fieldNodes, node.fieldName, node.id);
    traversal.push({ node, exit: true });
    for (const id of [...node.children.values()].reverse()) traversal.push({ node: nodes[id]!, exit: false });
  }

  const fields = new Map<string, ExecutionField>();
  for (const field of data.schema.fields) {
    if (field.ignoreIndex) continue;
    const ids = fieldNodes.get(field.name) ?? [];
    const equality = new Map<string, number[]>();
    const fullKeys = new Map<string, number[]>();
    const numericKeys = new Map<string, number | bigint>();
    const buckets = new Map<string, IntervalEntry[]>();
    const missing: number[] = [];
    const rangeNodes: number[] = [];
    for (const id of ids) {
      const value = nodes[id]!.value!;
      const tokens = value.isCollection ? value.collectionValues ?? [] : [value.scalar ?? null];
      for (const token of new Set(tokens)) {
        const key = scalarKey(token);
        append(equality, key, id);
        if (!value.isCollection && (typeof token === "number" || typeof token === "bigint")) {
          numericKeys.set(key, token);
        }
      }
      if (value.collectionValues !== undefined) append(fullKeys, collectionKey(value.collectionValues), id);
      else missing.push(id);
      if (value.rangeValues?.length) rangeNodes.push(id);
      for (const range of value.rangeValues ?? []) {
        const entry = { lower: range.lower, upper: range.upper, nodeId: id };
        const bucket = buckets.get(range.prefix);
        if (bucket) bucket.push(entry);
        else buckets.set(range.prefix, [entry]);
      }
    }
    fields.set(field.name, {
      nodes: ids, equality, fullKeys, missing, rangeNodes,
      numeric: [...numericKeys].map(([key, value]) => ({ key: value, nodeIds: equality.get(key)! }))
        .sort((a, b) => compareNumeric(a.key, b.key)),
      intervals: new Map([...buckets].map(([prefix, entries]) => [prefix, new IntervalIndex(entries)])),
    });
  }
  return { nodes, fields };
}

export function terminalRows(
  index: ExecutionIndex, roots: Iterable<number>, work?: IndexWork, limit?: number,
): number[] {
  if (limit !== undefined && limit <= 0) return [];
  if (limit !== undefined && Number.isFinite(limit)) return limitedTerminalRows(index, roots, limit, work);
  const result: number[] = [];
  const stack = [...roots];
  while (stack.length) {
    const node = index.nodes[stack.pop()!]!;
    if (work) work.trieNodesVisited += 1;
    for (const rowId of node.terminalRows) result.push(rowId);
    for (const child of node.children.values()) stack.push(child);
  }
  return result.sort((a, b) => a - b);
}

function limitedTerminalRows(
  index: ExecutionIndex, roots: Iterable<number>, limit: number, work?: IndexWork,
): number[] {
  const heap = [...roots].map((id) => ({ id, position: -1, first: index.nodes[id]!.firstRow }));
  type Entry = typeof heap[number];
  const siftDown = (start: number) => {
    let parent = start;
    while (parent * 2 + 1 < heap.length) {
      let child = parent * 2 + 1;
      if (child + 1 < heap.length && heap[child + 1]!.first < heap[child]!.first) child += 1;
      if (heap[parent]!.first <= heap[child]!.first) break;
      [heap[parent], heap[child]] = [heap[child]!, heap[parent]!];
      parent = child;
    }
  };
  const push = (entry: Entry) => {
    heap.push(entry);
    let child = heap.length - 1;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (heap[parent]!.first <= entry.first) break;
      heap[child] = heap[parent]!;
      child = parent;
    }
    heap[child] = entry;
  };
  for (let i = Math.floor(heap.length / 2) - 1; i >= 0; i--) siftDown(i);
  const result: number[] = [];
  while (heap.length && result.length < limit) {
    const entry = heap[0]!;
    const tail = heap.pop()!;
    if (heap.length) {
      heap[0] = tail;
      siftDown(0);
    }
    const node = index.nodes[entry.id]!;
    if (entry.position >= 0) {
      result.push(entry.first);
      const next = node.terminalRows[entry.position + 1];
      if (next !== undefined) push({ id: node.id, position: entry.position + 1, first: next });
    } else {
      if (work) work.trieNodesVisited += 1;
      const first = node.terminalRows[0];
      if (first !== undefined) push({ id: node.id, position: 0, first });
      for (const id of node.children.values()) push({ id, position: -1, first: index.nodes[id]!.firstRow });
    }
  }
  return result;
}

export function diagnosticTrie(index: ExecutionIndex): TrieSnapshot {
  return {
    nodes: Object.freeze(index.nodes.map((node) => {
      const value = node.value;
      const key = value?.isCollection
        ? value.collectionValues?.join(",") ?? null
        : value?.scalar ?? null;
      let rowIds: readonly number[] | undefined;
      const children = new Map<string, number>();
      for (const childId of node.children.values()) {
        const child = index.nodes[childId]!;
        const value = child.value!;
        const encoded = value.isCollection
          ? value.collectionValues?.map(scalarKey).join("|") ?? "null"
          : scalarKey(value.scalar ?? null);
        const label = `${child.fieldName}:${encoded}`;
        children.set(children.has(label) ? `${label}#${childId}` : label, childId);
      }
      return {
        id: node.id, level: node.level, fieldName: node.fieldName, key,
        parentId: node.parentId, childIds: children,
        get rowIds() { return rowIds ??= Object.freeze(terminalRows(index, [node.id])); },
      };
    })),
  };
}

export function normalizedRowsFromTrie<T extends object>(
  index: ExecutionIndex,
  rows: readonly T[],
): readonly NormalizedRow<T>[] {
  const result: NormalizedRow<T>[] = [];
  for (const leaf of index.nodes) {
    if (!leaf.terminalRows.length) continue;
    const entries: [FieldName<T>, NormalizedFieldValue][] = [];
    let node = leaf;
    while (node.fieldName !== null && node.value !== undefined) {
      entries.push([node.fieldName as FieldName<T>, node.value]);
      node = index.nodes[node.parentId!]!;
    }
    entries.reverse();
    for (const id of leaf.terminalRows) result.push({ id, source: rows[id]!, values: new Map(entries) });
  }
  return Object.freeze(result.sort((a, b) => a.id - b.id));
}
