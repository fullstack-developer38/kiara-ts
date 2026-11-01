export function sanitizeKeywordText(input: string): string {
  return input
    .replace(/[,.:;?+=\-*&^%$#@!~'"`"|\\/]/g, " ")
    .replace(/[\[\]{}()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractKeywordTokens(input: string, caseInsensitive = true): string[] {
  const sanitized = sanitizeKeywordText(input);
  const normalized = caseInsensitive ? sanitized.toLocaleLowerCase("en-US") : sanitized;
  if (normalized.length === 0) {
    return [];
  }
  return normalized.split(" ").filter((token) => token.length > 0);
}
