export interface IndexWork {
  boundaryComparisons: number;
  keysVisited: number;
  intervalNodesVisited: number;
  postingEntriesVisited: number;
  trieNodesVisited: number;
  sourceRowsVisited: number;
  predicateChecks: number;
  ancestryNodesVisited: number;
  sourceOrderNodesVisited: number;
  heapEntriesQueued: number;
}

export function createIndexWork(): IndexWork {
  return {
    boundaryComparisons: 0, keysVisited: 0, intervalNodesVisited: 0,
    postingEntriesVisited: 0, trieNodesVisited: 0, sourceRowsVisited: 0,
    predicateChecks: 0, ancestryNodesVisited: 0, sourceOrderNodesVisited: 0, heapEntriesQueued: 0,
  };
}

export function compareNumeric(left: number | bigint, right: number | bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function bound<T>(
  entries: readonly T[],
  value: number | bigint,
  key: (entry: T) => number | bigint,
  upper: boolean,
  work?: IndexWork,
): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    const entry = entries[mid]!;
    if (work) work.boundaryComparisons += 1;
    const comparison = compareNumeric(key(entry), value);
    if (comparison < 0 || (upper && comparison === 0)) low = mid + 1;
    else high = mid;
  }
  return low;
}

export interface IntervalEntry {
  readonly lower: number | bigint;
  readonly upper: number | bigint;
  readonly nodeIds: number[];
}

interface IntervalNode {
  readonly entry: IntervalEntry;
  readonly maximum: number | bigint;
  readonly left: IntervalNode | undefined;
  readonly right: IntervalNode | undefined;
}

export class IntervalIndex {
  private readonly root: IntervalNode | undefined;

  public constructor(entries: readonly IntervalEntry[]) {
    const ordered = [...entries].sort((a, b) => compareNumeric(a.lower, b.lower));
    const build = (start: number, end: number): IntervalNode | undefined => {
      if (start >= end) return undefined;
      const mid = start + Math.floor((end - start) / 2);
      const entry = ordered[mid]!;
      const left = build(start, mid);
      const right = build(mid + 1, end);
      let maximum = entry.upper;
      if (left && compareNumeric(left.maximum, maximum) > 0) maximum = left.maximum;
      if (right && compareNumeric(right.maximum, maximum) > 0) maximum = right.maximum;
      return { entry, maximum, left, right };
    };
    this.root = build(0, ordered.length);
  }

  public containing(point: number | bigint, work?: IndexWork): Set<number> {
    const result = new Set<number>();
    for (const ids of this.containingGroups(point, work)) {
      for (const id of ids) {
        if (work) work.postingEntriesVisited += 1;
        result.add(id);
      }
    }
    return result;
  }

  public containingGroups(point: number | bigint, work?: IndexWork): readonly (readonly number[])[] {
    const result: (readonly number[])[] = [];
    const stack: IntervalNode[] = this.root ? [this.root] : [];
    while (stack.length) {
      const node = stack.pop()!;
      if (work) work.intervalNodesVisited += 1;
      if (compareNumeric(node.maximum, point) < 0) continue;
      if (node.left) stack.push(node.left);
      if (compareNumeric(node.entry.lower, point) > 0) continue;
      if (compareNumeric(node.entry.upper, point) >= 0) result.push(node.entry.nodeIds);
      if (node.right) stack.push(node.right);
    }
    return result;
  }
}
