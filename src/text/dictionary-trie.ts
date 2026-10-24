import { extractKeywordTokens } from "./keyword-utils.js";

interface TrieNode {
  readonly children: Map<string, TrieNode>;
  terminal: boolean;
  orderedChildren?: readonly [string, TrieNode][];
}

function createNode(): TrieNode {
  return {
    children: new Map<string, TrieNode>(),
    terminal: false,
  };
}

function isOneEditAway(left: string, right: string): boolean {
  const lengthDiff = Math.abs(left.length - right.length);
  if (lengthDiff > 1 || left === right) {
    return false;
  }

  let i = 0;
  let j = 0;
  let edits = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      i += 1;
      j += 1;
      continue;
    }

    edits += 1;
    if (edits > 1) {
      return false;
    }

    if (left.length > right.length) {
      i += 1;
    } else if (left.length < right.length) {
      j += 1;
    } else {
      i += 1;
      j += 1;
    }
  }

  if (i < left.length || j < right.length) {
    edits += 1;
  }
  return edits === 1;
}

export class DictionaryTrie {
  private readonly root: TrieNode;
  private readonly words: Set<string>;

  public constructor() {
    this.root = createNode();
    this.words = new Set<string>();
  }

  public addWord(word: string): void {
    const normalized = word.trim().toLocaleLowerCase("en-US");
    if (normalized.length === 0) {
      return;
    }
    if (this.words.has(normalized)) {
      return;
    }

    this.words.add(normalized);
    let node = this.root;
    for (const char of normalized) {
      let child = node.children.get(char);
      if (child === undefined) {
        child = createNode();
        node.children.set(char, child);
        delete node.orderedChildren;
      }
      node = child;
    }
    node.terminal = true;
  }

  public addWords(words: Iterable<string>): void {
    for (const word of words) {
      this.addWord(word);
    }
  }

  public addText(input: string): void {
    this.addWords(extractKeywordTokens(input));
  }

  public hasWord(word: string): boolean {
    return this.words.has(word.trim().toLocaleLowerCase("en-US"));
  }

  public predict(prefix: string, limit = 10): string[] {
    if (limit <= 0) {
      return [];
    }

    const normalizedPrefix = prefix.trim().toLocaleLowerCase("en-US");
    let node = this.root;
    for (const char of normalizedPrefix) {
      const child = node.children.get(char);
      if (child === undefined) {
        return [];
      }
      node = child;
    }

    const predictions: string[] = [];
    const stack: Array<{ node: TrieNode; word: string }> = [{ node, word: normalizedPrefix }];

    while (stack.length > 0 && predictions.length < limit) {
      const current = stack.pop();
      if (current === undefined) {
        continue;
      }

      if (current.node.terminal) {
        predictions.push(current.word);
      }

      const children = current.node.orderedChildren ??= [...current.node.children.entries()]
        .sort((left, right) => right[0].localeCompare(left[0], "en-US"));
      for (const [char, child] of children) {
        stack.push({ node: child, word: current.word + char });
      }
    }

    return predictions;
  }

  public getOneEditCandidate(input: string, accepts: (word: string) => boolean = () => true): string | null {
    const normalized = input.trim().toLocaleLowerCase("en-US");
    if (normalized.length <= 3) {
      return null;
    }

    const candidates: string[] = [];
    const stack = [{ node: this.root, word: "", distances: Array.from({ length: normalized.length + 1 }, (_, i) => i) }];
    while (stack.length) {
      const current = stack.pop()!;
      if (current.node.terminal && current.distances[normalized.length] === 1
        && isOneEditAway(normalized, current.word) && accepts(current.word)) {
        candidates.push(current.word);
      }
      for (const [char, node] of current.node.children) {
        let distances = current.distances;
        // Match the existing UTF-16 edit contract even when a trie edge is a code point.
        for (const unit of char.split("")) {
          const next = [distances[0]! + 1];
          for (let i = 1; i <= normalized.length; i++) {
            next.push(Math.min(next[i - 1]! + 1, distances[i]! + 1,
              distances[i - 1]! + (normalized[i - 1] === unit ? 0 : 1)));
          }
          distances = next;
        }
        if (distances.some((distance) => distance <= 1)) stack.push({ node, word: current.word + char, distances });
      }
    }
    candidates.sort((a, b) => a.localeCompare(b, "en-US"));
    return candidates[0] ?? null;
  }
}
