const vowels = new Set(["a", "e", "i", "o", "u"]);

const snowballEarlyExceptions = new Map<string, string>([
  ["skis", "ski"],
  ["skies", "sky"],
  ["dying", "die"],
  ["lying", "lie"],
  ["tying", "tie"],
  ["idly", "idl"],
  ["gently", "gentl"],
  ["ugly", "ugli"],
  ["early", "earli"],
  ["only", "onli"],
  ["singly", "singl"],
]);

const snowballInvariantExceptions = new Set([
  "sky",
  "news",
  "howe",
  "atlas",
  "cosmos",
  "bias",
  "andes",
]);

const snowballStep1aStopWords = new Set([
  "inning",
  "outing",
  "canning",
  "herring",
  "earring",
  "proceed",
  "exceed",
  "succeed",
]);

function isConsonant(word: string, index: number): boolean {
  const char = word[index];
  if (char === undefined) {
    return false;
  }

  if (vowels.has(char)) {
    return false;
  }

  if (char === "y") {
    if (index === 0) {
      return true;
    }
    return !isConsonant(word, index - 1);
  }

  return true;
}

function containsVowel(word: string): boolean {
  for (let index = 0; index < word.length; index += 1) {
    if (!isConsonant(word, index)) {
      return true;
    }
  }
  return false;
}

function measure(word: string): number {
  let count = 0;
  let inVowelRun = false;

  for (let index = 0; index < word.length; index += 1) {
    const consonant = isConsonant(word, index);
    if (!consonant) {
      inVowelRun = true;
      continue;
    }
    if (inVowelRun) {
      count += 1;
      inVowelRun = false;
    }
  }

  return count;
}

function endsWithDoubleConsonant(word: string): boolean {
  if (word.length < 2) {
    return false;
  }
  const last = word[word.length - 1];
  const previous = word[word.length - 2];
  if (last !== previous) {
    return false;
  }
  return isConsonant(word, word.length - 1);
}

function endsWithCvc(word: string): boolean {
  if (word.length < 3) {
    return false;
  }
  const last = word[word.length - 1];
  if (last === "w" || last === "x" || last === "y") {
    return false;
  }
  return (
    isConsonant(word, word.length - 1) &&
    !isConsonant(word, word.length - 2) &&
    isConsonant(word, word.length - 3)
  );
}

function applySuffixStep(
  word: string,
  rules: readonly [string, string][],
  minimumMeasure: number,
): string {
  for (const [suffix, replacement] of rules) {
    if (!word.endsWith(suffix)) {
      continue;
    }
    const stem = word.slice(0, word.length - suffix.length);
    if (measure(stem) > minimumMeasure) {
      return `${stem}${replacement}`;
    }
  }
  return word;
}

export function stemEnglishToken(token: string): string {
  let word = token.toLocaleLowerCase("en-US");
  if (word.length <= 2) {
    return word;
  }

  const earlyException = snowballEarlyExceptions.get(word);
  if (earlyException !== undefined) {
    return earlyException;
  }

  if (snowballInvariantExceptions.has(word)) {
    return word;
  }

  // Step 1a
  if (word.endsWith("sses")) {
    word = `${word.slice(0, -4)}ss`;
  } else if (word.endsWith("ies")) {
    word = `${word.slice(0, -3)}i`;
  } else if (word.endsWith("ss")) {
    // keep as-is
  } else if (word.endsWith("s")) {
    word = word.slice(0, -1);
  }

  if (snowballStep1aStopWords.has(word)) {
    return word;
  }

  // Step 1b
  let applyStep1bAdjustments = false;
  if (word.endsWith("eed")) {
    const stem = word.slice(0, -3);
    if (measure(stem) > 0) {
      word = `${stem}ee`;
    }
  } else if (word.endsWith("ed")) {
    const stem = word.slice(0, -2);
    if (containsVowel(stem)) {
      word = stem;
      applyStep1bAdjustments = true;
    }
  } else if (word.endsWith("ing")) {
    const stem = word.slice(0, -3);
    if (containsVowel(stem)) {
      word = stem;
      applyStep1bAdjustments = true;
    }
  }

  if (applyStep1bAdjustments) {
    if (word.endsWith("at") || word.endsWith("bl") || word.endsWith("iz")) {
      word = `${word}e`;
    } else if (endsWithDoubleConsonant(word)) {
      const last = word[word.length - 1];
      if (last !== "l" && last !== "s" && last !== "z") {
        word = word.slice(0, -1);
      }
    } else if (measure(word) === 1 && endsWithCvc(word)) {
      word = `${word}e`;
    }
  }

  // Step 1c
  if (word.endsWith("y")) {
    const stem = word.slice(0, -1);
    if (containsVowel(stem)) {
      word = `${stem}i`;
    }
  }

  // Step 2
  word = applySuffixStep(
    word,
    [
      ["ational", "ate"],
      ["tional", "tion"],
      ["enci", "ence"],
      ["anci", "ance"],
      ["izer", "ize"],
      ["abli", "able"],
      ["alli", "al"],
      ["entli", "ent"],
      ["eli", "e"],
      ["ousli", "ous"],
      ["ization", "ize"],
      ["ation", "ate"],
      ["ator", "ate"],
      ["alism", "al"],
      ["iveness", "ive"],
      ["fulness", "ful"],
      ["ousness", "ous"],
      ["aliti", "al"],
      ["iviti", "ive"],
      ["biliti", "ble"],
      ["logi", "log"],
    ],
    0,
  );

  // Step 3
  word = applySuffixStep(
    word,
    [
      ["icate", "ic"],
      ["ative", ""],
      ["alize", "al"],
      ["iciti", "ic"],
      ["ical", "ic"],
      ["ful", ""],
      ["ness", ""],
    ],
    0,
  );

  // Step 4
  const step4Suffixes = [
    "al",
    "ance",
    "ence",
    "er",
    "ic",
    "able",
    "ible",
    "ant",
    "ement",
    "ment",
    "ent",
    "ion",
    "ou",
    "ism",
    "ate",
    "iti",
    "ous",
    "ive",
    "ize",
  ] as const;

  for (const suffix of step4Suffixes) {
    if (!word.endsWith(suffix)) {
      continue;
    }
    const stem = word.slice(0, word.length - suffix.length);
    if (suffix === "ion") {
      const last = stem[stem.length - 1];
      if (last !== "s" && last !== "t") {
        continue;
      }
    }
    if (measure(stem) > 1) {
      word = stem;
    }
    break;
  }

  // Step 5a
  if (word.endsWith("e")) {
    const stem = word.slice(0, -1);
    const stemMeasure = measure(stem);
    if (stemMeasure > 1 || (stemMeasure === 1 && !endsWithCvc(stem))) {
      word = stem;
    }
  }

  // Step 5b
  if (measure(word) > 1 && endsWithDoubleConsonant(word) && word.endsWith("l")) {
    word = word.slice(0, -1);
  }

  return word;
}
