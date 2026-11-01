import type { ExecutionField, ExecutionIndex } from "./execution-index.js";
import { bound, compareNumeric, type IndexWork } from "./ordered-index.js";

interface PostingGroup {
  readonly ids: readonly number[];
  readonly start: number;
  readonly end: number;
  readonly accepts?: (id: number) => boolean;
}

export interface PostingPlan {
  readonly field: ExecutionField;
  readonly level: number;
  readonly groups: Iterable<PostingGroup>;
  readonly candidates?: Iterable<PostingGroup> | undefined;
  readonly matches: (id: number) => boolean;
  readonly estimate: number;
  readonly groupCount: number;
  readonly singleGroup: boolean;
  readonly numeric?: { readonly start: number; readonly end: number };
}

function replay(source: Iterable<PostingGroup>): Iterable<PostingGroup> {
  const cached: PostingGroup[] = [];
  const iterator = source[Symbol.iterator]();
  let done = false;
  return {
    *[Symbol.iterator]() {
      let position = 0;
      while (true) {
        if (position < cached.length) yield cached[position++]!;
        else {
          if (done) return;
          const next = iterator.next();
          if (next.done) { done = true; return; }
          cached.push(next.value);
        }
      }
    },
  };
}

export function* matchingNodes(plan: PostingPlan, work?: IndexWork): Iterable<number> {
  const seen = new Set<number>();
  for (const group of plan.candidates ?? plan.groups) {
    for (let i = group.start; i < group.end; i++) {
      const id = group.ids[i]!;
      if (work) work.postingEntriesVisited += 1;
      if (seen.has(id)) continue;
      if (group.accepts) {
        if (work) work.predicateChecks += 1;
        if (!group.accepts(id)) continue;
      }
      seen.add(id);
      yield id;
    }
  }
}

export function hasMatches(plan: PostingPlan, work?: IndexWork): boolean {
  return !matchingNodes(plan, work)[Symbol.iterator]().next().done;
}

export function postingPlan(
  index: ExecutionIndex, field: ExecutionField, lists: readonly (readonly number[])[],
  work?: IndexWork, matches?: (id: number) => boolean,
): PostingPlan {
  const unique = [...new Set(lists)].filter((ids) => ids.length);
  const position = (id: number) => index.nodes[id]!.start;
  return {
    field, level: field.nodes.length ? index.nodes[field.nodes[0]!]!.level : 0,
    estimate: Math.min(field.nodes.length, unique.reduce((sum, ids) => sum + ids.length, 0)),
    groupCount: unique.length,
    singleGroup: unique.length === 1,
    groups: unique.map((ids) => ({ ids, start: 0, end: ids.length })),
    matches: matches ?? ((id) => unique.some((ids) => {
      const offset = bound(ids, position(id), position, false, work);
      return ids[offset] === id;
    })),
  };
}

export function numericPlan(
  index: ExecutionIndex, field: ExecutionField, start: number, end: number, work?: IndexWork,
): PostingPlan {
  end = Math.max(start, end);
  const entries = field.numeric;
  const lower = entries[start]?.key;
  const upper = entries[end - 1]?.key;
  return {
    field, level: field.nodes.length ? index.nodes[field.nodes[0]!]!.level : 0,
    numeric: { start, end }, groupCount: end - start,
    singleGroup: end - start === 1,
    estimate: field.numericCounts[end]! - field.numericCounts[start]!,
    groups: replay({
      *[Symbol.iterator]() {
        for (let i = start; i < end; i++) {
          if (work) work.keysVisited += 1;
          const ids = entries[i]!.nodeIds;
          yield { ids, start: 0, end: ids.length };
        }
      },
    }),
    matches(id) {
      const value = index.nodes[id]!.value?.scalar;
      return start < end && lower !== undefined && upper !== undefined
        && (typeof value === "number" || typeof value === "bigint")
        && compareNumeric(value, lower) >= 0 && compareNumeric(value, upper) <= 0;
    },
  };
}

export function filterPlan(
  base: PostingPlan, matches: (id: number) => boolean, estimate = base.estimate,
  accepts = matches,
): PostingPlan {
  return {
    ...base, matches, estimate, candidates: undefined,
    groups: replay({
      *[Symbol.iterator]() {
        for (const group of base.groups) yield {
          ...group, accepts: group.accepts
            ? (id) => group.accepts!(id) && accepts(id) : accepts,
        };
      },
    }),
  };
}

function* combineSingleGroups(
  index: ExecutionIndex, left: PostingPlan, right: PostingPlan, subtract: boolean, work?: IndexWork,
): Iterable<PostingGroup> {
  const firstGroup = left.groups[Symbol.iterator]().next();
  const secondGroup = right.groups[Symbol.iterator]().next();
  if (firstGroup.done || secondGroup.done) return;
  const a = firstGroup.value;
  const b = secondGroup.value;
  let j = b.start;
  for (let i = a.start; i < a.end; i++) {
    const id = a.ids[i]!;
    const position = index.nodes[id]!.start;
    if (work) work.postingEntriesVisited += 1;
    while (j < b.end) {
      if (work) work.postingEntriesVisited += 1;
      if (index.nodes[b.ids[j]!]!.start >= position) break;
      j++;
    }
    const shared = j < b.end && b.ids[j] === id;
    if (shared) {
      if (!subtract || b.accepts) yield {
        ids: a.ids, start: i, end: i + 1,
        accepts: (value) => (!a.accepts || a.accepts(value))
          && (subtract ? !!b.accepts && !b.accepts(value) : !b.accepts || b.accepts(value)),
      };
    } else if (subtract) yield { ...a, start: i, end: i + 1 };
    else if (j === b.end) return;
  }
}

export function subtractPlans(
  index: ExecutionIndex, base: PostingPlan, excluded: PostingPlan, work?: IndexWork,
): PostingPlan {
  const plan = filterPlan(base, (id) => base.matches(id) && !excluded.matches(id),
    Math.max(1, base.estimate - excluded.estimate));
  return base.singleGroup && excluded.singleGroup
    ? { ...plan, candidates: replay(combineSingleGroups(index, base, excluded, true, work)) } : plan;
}

export function joinPlans(
  index: ExecutionIndex, left: PostingPlan, right: PostingPlan, work?: IndexWork,
): PostingPlan {
  if (left.level === right.level) {
    const base = left.numeric && right.numeric
      ? numericPlan(index, left.field, Math.max(left.numeric.start, right.numeric.start),
        Math.min(left.numeric.end, right.numeric.end), work)
      : left.estimate <= right.estimate ? left : right;
    const matches = (id: number) => left.matches(id) && right.matches(id);
    const filtered = filterPlan(base, matches, Math.min(base.estimate, left.estimate, right.estimate),
      base === left ? right.matches : base === right ? left.matches : matches);
    const scanCost = left.estimate + right.estimate;
    const probeCost = Math.min(left.estimate, right.estimate) * Math.log2(2 + Math.max(left.estimate, right.estimate));
    return !(left.numeric && right.numeric) && left.singleGroup && right.singleGroup && scanCost < probeCost
      ? { ...filtered, candidates: replay(combineSingleGroups(index, left, right, false, work)) } : filtered;
  }
  const [parent, child] = left.level < right.level ? [left, right] : [right, left];
  const ancestorMatches = (id: number) => {
    let node = index.nodes[id]!;
    while (node.level > parent.level) {
      if (work) work.ancestryNodesVisited += 1;
      node = index.nodes[node.parentId!]!;
    }
    return parent.matches(node.id);
  };
  const matches = (id: number) => child.matches(id) && ancestorMatches(id);
  const estimate = Math.min(child.estimate,
    Math.max(1, child.estimate * parent.estimate / Math.max(1, parent.field.nodes.length)));
  const seekCost = parent.estimate * child.groupCount
    * Math.log2(2 + child.estimate / Math.max(1, child.groupCount));
  const ancestryCost = child.estimate * (child.level - parent.level + 1);
  if (seekCost >= ancestryCost) return filterPlan(child, matches, estimate, ancestorMatches);

  const position = (id: number) => index.nodes[id]!.start;
  return {
    ...child, matches, estimate, groupCount: parent.estimate * child.groupCount, singleGroup: false,
    candidates: undefined,
    groups: replay({
      *[Symbol.iterator]() {
        for (const id of matchingNodes(parent, work)) {
          const ancestor = index.nodes[id]!;
          for (const group of child.groups) {
            const start = Math.max(group.start, bound(group.ids, ancestor.start, position, false, work));
            const end = Math.min(group.end, bound(group.ids, ancestor.end, position, false, work));
            if (start < end) yield { ...group, start, end };
          }
        }
      },
    }),
  };
}
