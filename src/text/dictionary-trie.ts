import { extractKeywordTokens } from "./keyword-utils.js";

interface TrieNode {
  readonly children: Map<string, TrieNode>;
  terminal: boolean;
  orderedChildren?: readonly [string, TrieNode][];
}

interface DictionaryTrieOptions {
  readonly normalizeCase?: boolean;
}

function createNode(): TrieNode {
  return {
    children: new Map<string, TrieNode>(),
    terminal: false,
  };
}

export class DictionaryTrie {
  private readonly root: TrieNode;
  private readonly words: Set<string>;
  private readonly normalizeCase: boolean;

  public constructor(options: DictionaryTrieOptions = {}) {
    this.root = createNode();
    this.words = new Set<string>();
    this.normalizeCase = options.normalizeCase ?? true;
  }

  private normalize(word: string): string {
    return this.normalizeCase ? word.toLocaleLowerCase("en-US") : word;
  }

  public addWord(word: string): void {
    const normalized = this.normalize(word.trim());
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
    this.addWords(extractKeywordTokens(input, this.normalizeCase));
  }

  public hasWord(word: string): boolean {
    return this.words.has(this.normalize(word.trim()));
  }

  private getOrderedChildren(node: TrieNode): readonly [string, TrieNode][] {
    node.orderedChildren ??= [...node.children.entries()]
      .sort((left, right) => left[0].localeCompare(right[0], "en-US"));
    return node.orderedChildren;
  }

  public predict(prefix: string, limit = 10): string[] {
    if (limit <= 0) {
      return [];
    }

    const normalizedPrefix = this.normalize(prefix.trim());
    let node = this.root;
    for (const char of normalizedPrefix) {
      const child = node.children.get(char);
      if (child === undefined) {
        return [];
      }
      node = child;
    }

    const predictions: string[] = [];
    const queue: Array<{ node: TrieNode; word: string }> = [{ node, word: normalizedPrefix }];

    while (queue.length > 0 && predictions.length < limit) {
      const current = queue.shift()!;
      if (current.node.terminal) {
        predictions.push(current.word);
        if (predictions.length >= limit) {
          return predictions;
        }
      }
      for (const [char, child] of this.getOrderedChildren(current.node)) {
        queue.push({ node: child, word: current.word + char });
      }
    }

    return predictions;
  }

  public getOneEditCandidate(input: string, accepts: (word: string) => boolean = () => true): string | null {
    const normalized = this.normalize(input.trim());
    if (normalized.length <= 3) {
      return null;
    }
    let editDistance = 0;
    let charPos = 0;
    let currentNode = this.root;
    let built = "";

    while (charPos < normalized.length) {
      if (editDistance > 1) {
        return null;
      }

      const currentChar = normalized[charPos]!;
      const direct = currentNode.children.get(currentChar);
      if (direct !== undefined) {
        currentNode = direct;
        built += currentChar;
        charPos += 1;
        continue;
      }

      const nextChar = charPos < normalized.length - 1 ? normalized[charPos + 1]! : undefined;
      if (nextChar !== undefined) {
        const deletion = currentNode.children.get(nextChar);
        if (deletion !== undefined) {
          editDistance += 1;
          currentNode = deletion;
          built += nextChar;
          charPos += 2;
          continue;
        }
      }

      const nextLevel = new Map<string, { readonly node: TrieNode; readonly prefix: string }>();
      for (const [firstChar, firstNode] of this.getOrderedChildren(currentNode)) {
        if (firstNode.terminal) {
          nextLevel.set("*", { node: firstNode, prefix: firstChar });
        }
        for (const [secondChar, secondNode] of this.getOrderedChildren(firstNode)) {
          nextLevel.set(secondChar, { node: secondNode, prefix: `${firstChar}${secondChar}` });
        }
      }

      const insertion = nextLevel.get(currentChar);
      if (insertion !== undefined) {
        editDistance += 1;
        currentNode = insertion.node;
        built += insertion.prefix;
        charPos += 1;
        continue;
      }

      if (nextChar !== undefined) {
        const update = nextLevel.get(nextChar);
        if (update !== undefined) {
          editDistance += 1;
          currentNode = update.node;
          built += update.prefix;
          charPos += 2;
          continue;
        }
      }

      if (charPos === normalized.length - 1) {
        editDistance += 1;
        const terminal = nextLevel.get("*");
        if (terminal !== undefined) {
          currentNode = terminal.node;
          built += terminal.prefix;
        }
        break;
      }

      return null;
    }

    if (!currentNode.terminal) {
      const next = this.getOrderedChildren(currentNode)[0];
      if (next === undefined) {
        return null;
      }
      editDistance += 1;
      currentNode = next[1];
      built += next[0];
    }

    if (editDistance > 1) {
      return null;
    }

    if (!accepts(built)) {
      return null;
    }
    return built;
  }
}
