import { describe, expect, it } from "vitest";
import { DictionaryTrie } from "./dictionary-trie.js";
import { extractKeywordTokens, sanitizeKeywordText } from "./keyword-utils.js";

describe("DictionaryTrie", () => {
  it("predicts words by prefix with deterministic ordering", () => {
    const trie = new DictionaryTrie();
    trie.addWords(["airport", "airline", "airway", "apollo"]);

    expect(trie.predict("air", 3)).toEqual(["airway", "airline", "airport"]);
  });

  it("returns one-edit candidate for typo input", () => {
    const trie = new DictionaryTrie();
    trie.addWords(["airport", "airline", "apollo"]);

    expect(trie.getOneEditCandidate("airpor")).toBe("airport");
  });

  it("returns null for one-edit inputs of length <= 3", () => {
    const trie = new DictionaryTrie();
    trie.addWords(["cat", "car", "cart"]);

    expect(trie.getOneEditCandidate("ca")).toBeNull();
  });
});

describe("keyword text utilities", () => {
  it("sanitizes punctuation without stop-word removal", () => {
    expect(sanitizeKeywordText("The, quick-brown! fox?")).toBe("The quick brown fox");
    expect(sanitizeKeywordText("a(b)c")).toBe("abc");
  });

  it("extracts lower-cased tokens", () => {
    expect(extractKeywordTokens("Tom Hanks, Cast Away")).toEqual(["tom", "hanks", "cast", "away"]);
    expect(extractKeywordTokens("a(b)c")).toEqual(["abc"]);
  });
});
