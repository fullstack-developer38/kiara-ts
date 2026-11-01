import { describe, expect, it } from "vitest";
import { stemEnglishToken } from "./stemming.js";

const porterFixturePairs: ReadonlyArray<readonly [string, string]> = [
  ["caresses", "caress"],
  ["ponies", "poni"],
  ["cats", "cat"],
  ["feed", "feed"],
  ["agreed", "agre"],
  ["plastered", "plaster"],
  ["motoring", "motor"],
  ["conflated", "conflat"],
  ["hopping", "hop"],
  ["filing", "file"],
  ["happy", "happi"],
  ["sky", "sky"],
  ["relational", "relat"],
  ["conditional", "condit"],
  ["vietnamization", "vietnam"],
  ["decisiveness", "decis"],
  ["formaliti", "formal"],
  ["sensibiliti", "sensibl"],
  ["electricity", "electr"],
  ["allowance", "allow"],
  ["adjustment", "adjust"],
  ["adoption", "adopt"],
  ["effective", "effect"],
  ["bowdlerize", "bowdler"],
] as const;

describe("stemEnglishToken", () => {
  it("reduces common inflections to stable stems", () => {
    expect(stemEnglishToken("running")).toBe("run");
    expect(stemEnglishToken("happily")).toBe("happili");
    expect(stemEnglishToken("studies")).toBe("studi");
    expect(stemEnglishToken("relational")).toBe("relat");
  });

  it("preserves short tokens and lowercases input", () => {
    expect(stemEnglishToken("GO")).toBe("go");
    expect(stemEnglishToken("ax")).toBe("ax");
  });

  it("matches a baseline fixture set of porter examples", () => {
    for (const [input, expected] of porterFixturePairs) {
      expect(stemEnglishToken(input)).toBe(expected);
    }
  });

  it("keeps stable stems unchanged for common terminal forms", () => {
    const stableStems = ["cat", "run", "motor", "effect", "formal", "adjust"] as const;
    for (const token of stableStems) {
      expect(stemEnglishToken(token)).toBe(token);
    }
  });

  it("preserves Snowball English exception behavior used by Java", () => {
    expect(stemEnglishToken("skies")).toBe("sky");
    expect(stemEnglishToken("dying")).toBe("die");
    expect(stemEnglishToken("lying")).toBe("lie");
    expect(stemEnglishToken("news")).toBe("news");
    expect(stemEnglishToken("proceed")).toBe("proceed");
    expect(stemEnglishToken("succeed")).toBe("succeed");
  });
});
