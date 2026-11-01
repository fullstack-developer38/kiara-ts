import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist", "index.js");
const DEFAULT_REPORT = resolve(ROOT, "..", "kiara", "target", "surefire-reports",
  "TEST-com.kapoorlabs.kiara.test.util.SpellCheckUtilTest.xml");

const CASES = [
  {
    id: "collection-equal-token",
    description: "collection EQUAL token match",
    expectedJava: { kind: "rows", rows: [1] },
    expectedTs: { kind: "rows", rows: [1] },
  },
  {
    id: "text-less-than",
    description: "ordered text LESS_THAN support",
    expectedJava: { kind: "rows", rows: [1] },
    expectedTs: { kind: "rows", rows: [1] },
  },
  {
    id: "scalar-contains-all",
    description: "scalar CONTAINS_ALL support",
    expectedJava: { kind: "rows", rows: [1] },
    expectedTs: { kind: "rows", rows: [1] },
  },
  {
    id: "collection-contains-either-token",
    description: "collection CONTAINS_EITHER token match",
    expectedJava: { kind: "rows", rows: [1] },
    expectedTs: { kind: "rows", rows: [1] },
  },
  {
    id: "text-greater-than-equal",
    description: "ordered text GREATER_THAN_EQUAL support",
    expectedJava: { kind: "count", count: 2 },
    expectedTs: { kind: "count", count: 2 },
  },
  {
    id: "numeric-between-inclusive",
    description: "numeric BETWEEN uses inclusive bounds",
    expectedJava: { kind: "rows", rows: [2, 3] },
    expectedTs: { kind: "rows", rows: [2, 3] },
  },
  {
    id: "column-order-empty-suppresses-later-error",
    description: "column-order empty result suppresses later invalid scalar NOT_CONTAINS",
    expectedJava: { kind: "rows", rows: [] },
    expectedTs: { kind: "rows", rows: [] },
  },
  {
    id: "same-field-empty-does-not-suppress-invalid-operator",
    description: "same-field chain still evaluates later invalid scalar NOT_CONTAINS",
    expectedJava: { kind: "error", name: "NonSupportedOperationException" },
    expectedTs: { kind: "error", code: "QUERY_INVALID_CONDITION" },
  },
  {
    id: "legacy-projection-shared-prefix-collapse",
    description: "legacy projection collapses shared suffix paths like Java",
    expectedJava: { kind: "count", count: 1 },
    expectedTs: { kind: "count", count: 1 },
  },
  {
    id: "duplicate-full-row-collapse",
    description: "full-row search collapses exact duplicate source rows like Java",
    expectedJava: { kind: "rows", rows: [1] },
    expectedTs: { kind: "rows", rows: [1] },
  },
  {
    id: "keyword-best-combination-tie-order",
    description: "keyword bestMatch chooses Java combination stack order under ties",
    expectedJava: { kind: "rows", rows: [1] },
    expectedTs: { kind: "rows", rows: [1] },
  },
  {
    id: "keyword-minimum-postfilter-cardinality",
    description: "keyword minimumMatch filters by Java nonnumeric value cardinality",
    expectedJava: { kind: "rows", rows: [2] },
    expectedTs: { kind: "rows", rows: [2] },
  },
  {
    id: "stemming-skies-exception",
    description: "Snowball stemming keeps skies -> sky",
    expectedJava: { kind: "token", token: "sky" },
    expectedTs: { kind: "token", token: "sky" },
  },
  {
    id: "stemming-dying-exception",
    description: "Snowball stemming keeps dying -> die",
    expectedJava: { kind: "token", token: "die" },
    expectedTs: { kind: "token", token: "die" },
  },
  {
    id: "stemming-lying-exception",
    description: "Snowball stemming keeps lying -> lie",
    expectedJava: { kind: "token", token: "lie" },
    expectedTs: { kind: "token", token: "lie" },
  },
  {
    id: "stemming-news-invariant",
    description: "Snowball stemming keeps news unchanged",
    expectedJava: { kind: "token", token: "news" },
    expectedTs: { kind: "token", token: "news" },
  },
  {
    id: "stemming-proceed-invariant",
    description: "Snowball stemming keeps proceed unchanged",
    expectedJava: { kind: "token", token: "proceed" },
    expectedTs: { kind: "token", token: "proceed" },
  },
  {
    id: "stemming-succeed-invariant",
    description: "Snowball stemming keeps succeed unchanged",
    expectedJava: { kind: "token", token: "succeed" },
    expectedTs: { kind: "token", token: "succeed" },
  },
  {
    id: "correction-ambiguous-prefers-java-path",
    description: "one-edit correction follows Java greedy trie traversal",
    expectedJava: { kind: "token", token: "test" },
    expectedTs: { kind: "token", token: "test" },
  },
  {
    id: "prediction-bfs-order",
    description: "prefix prediction follows Java breadth-first ordering",
    expectedJava: { kind: "tokens", tokens: ["light", "lights", "lighter"] },
    expectedTs: { kind: "tokens", tokens: ["light", "lights", "lighter"] },
  },
  {
    id: "keyword-bracket-token-collapse",
    description: "keyword tokenization removes brackets without splitting terms",
    expectedJava: { kind: "rows", rows: [1] },
    expectedTs: { kind: "rows", rows: [1] },
  },
  {
    id: "correction-null-ambiguity",
    description: "correction stays null when no Java one-edit path exists",
    expectedJava: { kind: "rows", rows: [] },
    expectedTs: { kind: "rows", rows: [] },
  },
  {
    id: "keyword-case-normalization",
    description: "keyword search normalizes case like Java indexed text behavior",
    expectedJava: { kind: "rows", rows: [] },
    expectedTs: { kind: "rows", rows: [] },
  },
  {
    id: "legacy-projection-limit-order",
    description: "legacy projection preserves Java collapse and limit ordering",
    expectedJava: { kind: "tokens", tokens: ["alpha", "beta"] },
    expectedTs: { kind: "tokens", tokens: ["alpha", "beta"] },
  },
  {
    id: "full-row-limit-order-after-collapse",
    description: "full-row search applies duplicate collapse before Java limit/order output",
    expectedJava: { kind: "rows", rows: [1, 2] },
    expectedTs: { kind: "rows", rows: [1, 2] },
  },
  {
    id: "keyword-case-insensitive-field",
    description: "keyword search matches uppercase input when field is case-insensitive",
    expectedJava: { kind: "rows", rows: [1] },
    expectedTs: { kind: "rows", rows: [1] },
  },
  {
    id: "correction-with-precondition-no-result",
    description: "correction does not bypass Java preconditions when corrected rows are filtered out",
    expectedJava: { kind: "rows", rows: [] },
    expectedTs: { kind: "rows", rows: [] },
  },
  {
    id: "correction-disabled-without-one-edit",
    description: "typo correction stays disabled when field is not one-edit capable",
    expectedJava: { kind: "rows", rows: [] },
    expectedTs: { kind: "rows", rows: [] },
  },
  {
    id: "correction-enabled-with-one-edit",
    description: "typo correction works when field is explicitly one-edit capable",
    expectedJava: { kind: "rows", rows: [1] },
    expectedTs: { kind: "rows", rows: [1] },
  },
  {
    id: "ignore-index-keyword-exclusion",
    description: "ignoreIndex fields do not participate in Java keyword matching",
    expectedJava: { kind: "rows", rows: [] },
    expectedTs: { kind: "rows", rows: [] },
  },
];

function fail(message) {
  throw new Error(message);
}

function unescapeXml(value) {
  return value.replaceAll("&quot;", "\"").replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

function getProperty(xml, name) {
  const pattern = new RegExp(`<property\\s+name="${name}"\\s+value="([^"]*)"\\s*/>`);
  const match = pattern.exec(xml);
  if (!match) fail(`Missing "${name}" in surefire report.`);
  return unescapeXml(match[1]);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) fail(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} exited with ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compare(actual, expected) {
  if (expected.kind === "rows") {
    return actual.kind === "rows" && arraysEqual(actual.rows ?? [], expected.rows);
  }
  if (expected.kind === "count") {
    return actual.kind === "count" && actual.count === expected.count;
  }
  if (expected.kind === "token") {
    return actual.kind === "token" && actual.token === expected.token;
  }
  if (expected.kind === "tokens") {
    return actual.kind === "tokens" && arraysEqual(actual.tokens ?? [], expected.tokens);
  }
  if (actual.kind !== "error") return false;
  if ("code" in expected && expected.code !== undefined) return actual.code === expected.code;
  if ("name" in expected && expected.name !== undefined) return actual.name === expected.name;
  return true;
}

function formatOutcome(outcome) {
  if (outcome.kind === "rows") return `[${(outcome.rows ?? []).join(", ")}]`;
  if (outcome.kind === "count") return `count:${outcome.count}`;
  if (outcome.kind === "token") return `token:${outcome.token}`;
  if (outcome.kind === "tokens") return `[${(outcome.tokens ?? []).join(", ")}]`;
  return `${outcome.code ?? "error"}: ${outcome.message ?? ""}`.trim();
}

function parseJavaCases(text) {
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) fail("Java probe output is not an array.");
  return parsed;
}

function javaProbeSource() {
  return String.raw`
import java.util.ArrayList;
import java.util.LinkedList;
import java.util.List;
import com.kapoorlabs.kiara.domain.Condition;
import com.kapoorlabs.kiara.domain.Operator;
import com.kapoorlabs.kiara.domain.Store;
import com.kapoorlabs.kiara.domain.annotations.CaseInsensitive;
import com.kapoorlabs.kiara.domain.annotations.CommaSeperatedStrings;
import com.kapoorlabs.kiara.domain.annotations.IgnoreIndex;
import com.kapoorlabs.kiara.domain.annotations.OneEditAway;
import com.kapoorlabs.kiara.exception.LoadDataException;
import com.kapoorlabs.kiara.loader.StoreLoader;
import com.kapoorlabs.kiara.search.StoreSearch;
import com.kapoorlabs.kiara.search.KeywordSearch;
import com.kapoorlabs.kiara.domain.SpellCheckTrie;
import com.kapoorlabs.kiara.util.SpellCheckUtil;
import com.kapoorlabs.kiara.util.StemmerUtil;

public class LiveParityProbe {
  public static class ProbeRow {
    private Integer id;
    private String title;
    @CommaSeperatedStrings
    private String tags;

    public Integer getId() { return id; }
    public void setId(Integer id) { this.id = id; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getTags() { return tags; }
    public void setTags(String tags) { this.tags = tags; }
  }

  public static class ProbeRowIgnore {
    private Integer id;
    private String title;
    @IgnoreIndex
    private String privateNotes;

    public Integer getId() { return id; }
    public void setId(Integer id) { this.id = id; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getPrivateNotes() { return privateNotes; }
    public void setPrivateNotes(String privateNotes) { this.privateNotes = privateNotes; }
  }

  public static class ProbeRowOneEdit {
    private Integer id;
    @OneEditAway
    private String title;
    private String tags;

    public Integer getId() { return id; }
    public void setId(Integer id) { this.id = id; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getTags() { return tags; }
    public void setTags(String tags) { this.tags = tags; }
  }

  public static class ProbeRowCi {
    private Integer id;
    @CaseInsensitive
    private String title;
    @CommaSeperatedStrings
    private String tags;

    public Integer getId() { return id; }
    public void setId(Integer id) { this.id = id; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
    public String getTags() { return tags; }
    public void setTags(String tags) { this.tags = tags; }
  }

  private static ProbeRow row(int id, String title, String tags) {
    ProbeRow row = new ProbeRow();
    row.setId(id);
    row.setTitle(title);
    row.setTags(tags);
    return row;
  }

  private static ProbeRowOneEdit rowOneEdit(int id, String title, String tags) {
    ProbeRowOneEdit row = new ProbeRowOneEdit();
    row.setId(id);
    row.setTitle(title);
    row.setTags(tags);
    return row;
  }

  private static ProbeRowIgnore rowIgnore(int id, String title, String privateNotes) {
    ProbeRowIgnore row = new ProbeRowIgnore();
    row.setId(id);
    row.setTitle(title);
    row.setPrivateNotes(privateNotes);
    return row;
  }

  private static ProbeRowCi rowCi(int id, String title, String tags) {
    ProbeRowCi row = new ProbeRowCi();
    row.setId(id);
    row.setTitle(title);
    row.setTags(tags);
    return row;
  }

  private static Store<ProbeRow> store(List<ProbeRow> rows) throws Exception {
    Store<ProbeRow> store = new Store<>(ProbeRow.class);
    StoreLoader<ProbeRow> loader = new StoreLoader<>(store);
    for (ProbeRow row : rows) {
      try {
        loader.loadTable(row);
      } catch (LoadDataException error) {
        throw new RuntimeException(error);
      }
    }
    loader.prepareForSearch();
    return store;
  }

  private static Store<ProbeRowOneEdit> storeOneEdit(List<ProbeRowOneEdit> rows) throws Exception {
    Store<ProbeRowOneEdit> store = new Store<>(ProbeRowOneEdit.class);
    StoreLoader<ProbeRowOneEdit> loader = new StoreLoader<>(store);
    for (ProbeRowOneEdit row : rows) {
      try {
        loader.loadTable(row);
      } catch (LoadDataException error) {
        throw new RuntimeException(error);
      }
    }
    loader.prepareForSearch();
    return store;
  }

  private static Store<ProbeRowIgnore> storeIgnore(List<ProbeRowIgnore> rows) throws Exception {
    Store<ProbeRowIgnore> store = new Store<>(ProbeRowIgnore.class);
    StoreLoader<ProbeRowIgnore> loader = new StoreLoader<>(store);
    for (ProbeRowIgnore row : rows) {
      try {
        loader.loadTable(row);
      } catch (LoadDataException error) {
        throw new RuntimeException(error);
      }
    }
    loader.prepareForSearch();
    return store;
  }

  private static Store<ProbeRowCi> storeCi(List<ProbeRowCi> rows) throws Exception {
    Store<ProbeRowCi> store = new Store<>(ProbeRowCi.class);
    StoreLoader<ProbeRowCi> loader = new StoreLoader<>(store);
    for (ProbeRowCi row : rows) {
      try {
        loader.loadTable(row);
      } catch (LoadDataException error) {
        throw new RuntimeException(error);
      }
    }
    loader.prepareForSearch();
    return store;
  }

  private static String escape(String value) {
    if (value == null) return "";
    return value.replace("\\", "\\\\").replace("\"", "\\\"");
  }

  private static String outcome(String id, List<ProbeRow> rows, Exception error) {
    if (error != null) {
      return "{\"id\":\"" + id + "\",\"kind\":\"error\",\"name\":\"" + error.getClass().getSimpleName()
        + "\",\"message\":\"" + escape(error.getMessage()) + "\"}";
    }
    StringBuilder builder = new StringBuilder();
    builder.append("{\"id\":\"").append(id).append("\",\"kind\":\"rows\",\"rows\":[");
    for (int i = 0; i < rows.size(); i++) {
      if (i > 0) builder.append(",");
      builder.append(rows.get(i).getId());
    }
    builder.append("]}");
    return builder.toString();
  }

  private static String outcomeCount(String id, int count, Exception error) {
    if (error != null) {
      return "{\"id\":\"" + id + "\",\"kind\":\"error\",\"name\":\"" + error.getClass().getSimpleName()
        + "\",\"message\":\"" + escape(error.getMessage()) + "\"}";
    }
    return "{\"id\":\"" + id + "\",\"kind\":\"count\",\"count\":" + count + "}";
  }

  private static String outcomeToken(String id, String token, Exception error) {
    if (error != null) {
      return "{\"id\":\"" + id + "\",\"kind\":\"error\",\"name\":\"" + error.getClass().getSimpleName()
        + "\",\"message\":\"" + escape(error.getMessage()) + "\"}";
    }
    return "{\"id\":\"" + id + "\",\"kind\":\"token\",\"token\":\"" + escape(token) + "\"}";
  }

  private static String outcomeTokens(String id, List<String> tokens, Exception error) {
    if (error != null) {
      return "{\"id\":\"" + id + "\",\"kind\":\"error\",\"name\":\"" + error.getClass().getSimpleName()
        + "\",\"message\":\"" + escape(error.getMessage()) + "\"}";
    }
    StringBuilder builder = new StringBuilder();
    builder.append("{\"id\":\"").append(id).append("\",\"kind\":\"tokens\",\"tokens\":[");
    for (int i = 0; i < tokens.size(); i++) {
      if (i > 0) builder.append(",");
      builder.append("\"").append(escape(tokens.get(i))).append("\"");
    }
    builder.append("]}");
    return builder.toString();
  }

  private static String collectionEqualToken() {
    try {
      Store<ProbeRow> store = store(List.of(
        row(1, "alpha", "red,blue"),
        row(2, "beta", "green"),
        row(3, "gamma", null)
      ));
      List<Condition> conditions = new LinkedList<>();
      conditions.add(new Condition("tags", Operator.EQUAL, "red"));
      List<ProbeRow> result = new StoreSearch().query(store, conditions);
      return outcome("collection-equal-token", result, null);
    } catch (Exception error) {
      return outcome("collection-equal-token", null, error);
    }
  }

  private static String textLessThan() {
    try {
      Store<ProbeRow> store = store(List.of(
        row(1, "alpha", "red"),
        row(2, "beta", "blue")
      ));
      List<Condition> conditions = new LinkedList<>();
      conditions.add(new Condition("title", Operator.LESS_THAN, "beta"));
      List<ProbeRow> result = new StoreSearch().query(store, conditions);
      return outcome("text-less-than", result, null);
    } catch (Exception error) {
      return outcome("text-less-than", null, error);
    }
  }

  private static String scalarContainsAll() {
    try {
      Store<ProbeRow> store = store(List.of(
        row(1, "alpha", "red"),
        row(2, "beta", "blue")
      ));
      List<Condition> conditions = new LinkedList<>();
      conditions.add(new Condition("title", Operator.CONTAINS_ALL, "alpha"));
      List<ProbeRow> result = new StoreSearch().query(store, conditions);
      return outcome("scalar-contains-all", result, null);
    } catch (Exception error) {
      return outcome("scalar-contains-all", null, error);
    }
  }

  private static String collectionContainsEitherToken() {
    try {
      Store<ProbeRow> store = store(List.of(
        row(1, "alpha", "red,blue"),
        row(2, "beta", "green"),
        row(3, "gamma", null)
      ));
      List<Condition> conditions = new LinkedList<>();
      conditions.add(new Condition("tags", Operator.CONTAINS_EITHER, List.of("blue")));
      List<ProbeRow> result = new StoreSearch().query(store, conditions);
      return outcome("collection-contains-either-token", result, null);
    } catch (Exception error) {
      return outcome("collection-contains-either-token", null, error);
    }
  }

  private static String textGreaterThanEqual() {
    try {
      Store<ProbeRow> store = store(List.of(
        row(1, "alpha", "red"),
        row(2, "beta", "green"),
        row(3, "gamma", null)
      ));
      List<Condition> conditions = new LinkedList<>();
      conditions.add(new Condition("title", Operator.GREATER_THAN_EQUAL, "beta"));
      List<ProbeRow> result = new StoreSearch().query(store, conditions);
      return outcomeCount("text-greater-than-equal", result.size(), null);
    } catch (Exception error) {
      return outcomeCount("text-greater-than-equal", 0, error);
    }
  }

  private static String numericBetweenInclusive() {
    try {
      Store<ProbeRow> store = store(List.of(
        row(1, "alpha", "red"),
        row(2, "beta", "green"),
        row(3, "gamma", null)
      ));
      List<Condition> conditions = new LinkedList<>();
      conditions.add(new Condition("id", Operator.BETWEEN, "2", "3"));
      List<ProbeRow> result = new StoreSearch().query(store, conditions);
      return outcome("numeric-between-inclusive", result, null);
    } catch (Exception error) {
      return outcome("numeric-between-inclusive", null, error);
    }
  }

  private static String columnOrderEmptySuppressesLaterError() {
    try {
      Store<ProbeRow> store = store(List.of(
        row(1, "alpha", "red"),
        row(2, "beta", "blue")
      ));
      List<Condition> conditions = new LinkedList<>();
      conditions.add(new Condition("title", Operator.NOT_CONTAINS, "alpha"));
      conditions.add(new Condition("id", Operator.EQUAL, "999"));
      List<ProbeRow> result = new StoreSearch().query(store, conditions);
      return outcome("column-order-empty-suppresses-later-error", result, null);
    } catch (Exception error) {
      return outcome("column-order-empty-suppresses-later-error", null, error);
    }
  }

  private static String sameFieldEmptyDoesNotSuppressInvalidOperator() {
    try {
      Store<ProbeRow> store = store(List.of(
        row(1, "alpha", "red"),
        row(2, "beta", "blue")
      ));
      List<Condition> conditions = new LinkedList<>();
      conditions.add(new Condition("title", Operator.EQUAL, "missing"));
      conditions.add(new Condition("title", Operator.NOT_CONTAINS, "alpha"));
      List<ProbeRow> result = new StoreSearch().query(store, conditions);
      return outcome("same-field-empty-does-not-suppress-invalid-operator", result, null);
    } catch (Exception error) {
      return outcome("same-field-empty-does-not-suppress-invalid-operator", null, error);
    }
  }

  private static String legacyProjectionSharedPrefixCollapse() {
    try {
      Store<ProbeRow> store = store(List.of(
        row(1, "alpha", "red"),
        row(1, "alpha", "blue")
      ));
      List<Condition> conditions = new LinkedList<>();
      conditions.add(new Condition("id", Operator.EQUAL, "1"));
      java.util.Set<String> filterSet = new java.util.HashSet<>();
      filterSet.add("title");
      List<java.util.Map<String, String>> result = new StoreSearch().query(store, conditions, filterSet);
      return outcomeCount("legacy-projection-shared-prefix-collapse", result.size(), null);
    } catch (Exception error) {
      return outcomeCount("legacy-projection-shared-prefix-collapse", 0, error);
    }
  }

  private static String duplicateFullRowCollapse() {
    try {
      Store<ProbeRow> store = store(List.of(
        row(1, "alpha", "red"),
        row(1, "alpha", "red"),
        row(2, "beta", "blue")
      ));
      List<Condition> conditions = new LinkedList<>();
      conditions.add(new Condition("id", Operator.EQUAL, "1"));
      List<ProbeRow> result = new StoreSearch().query(store, conditions);
      return outcome("duplicate-full-row-collapse", result, null);
    } catch (Exception error) {
      return outcome("duplicate-full-row-collapse", null, error);
    }
  }

  private static String keywordBestCombinationTieOrder() {
    try {
      Store<ProbeRow> store = store(List.of(
        row(1, "alpha", "beta"),
        row(2, "beta", "alpha")
      ));
      java.util.Set<String> keywords = new java.util.LinkedHashSet<>();
      keywords.add("alpha");
      keywords.add("beta");
      List<ProbeRow> result = new KeywordSearch(10).getBestMatch(keywords, store, 1).getResult();
      return outcome("keyword-best-combination-tie-order", result, null);
    } catch (Exception error) {
      return outcome("keyword-best-combination-tie-order", null, error);
    }
  }

  private static String keywordMinimumPostfilterCardinality() {
    try {
      Store<ProbeRow> store = store(List.of(
        row(1, "alpha", "x"),
        row(2, "alpha", null)
      ));
      List<ProbeRow> result = new KeywordSearch(10).getMinimumMatch("alpha", store).getResult();
      return outcome("keyword-minimum-postfilter-cardinality", result, null);
    } catch (Exception error) {
      return outcome("keyword-minimum-postfilter-cardinality", null, error);
    }
  }

  private static String stemmingSkiesException() {
      try {
        return outcomeToken("stemming-skies-exception", StemmerUtil.stemEnglish("skies"), null);
      } catch (Exception error) {
        return outcomeToken("stemming-skies-exception", null, error);
      }
    }

    private static String stemmingDyingException() {
      try {
        return outcomeToken("stemming-dying-exception", StemmerUtil.stemEnglish("dying"), null);
      } catch (Exception error) {
        return outcomeToken("stemming-dying-exception", null, error);
      }
    }

    private static String stemmingLyingException() {
      try {
        return outcomeToken("stemming-lying-exception", StemmerUtil.stemEnglish("lying"), null);
      } catch (Exception error) {
        return outcomeToken("stemming-lying-exception", null, error);
      }
    }

    private static String stemmingNewsInvariant() {
      try {
        return outcomeToken("stemming-news-invariant", StemmerUtil.stemEnglish("news"), null);
      } catch (Exception error) {
        return outcomeToken("stemming-news-invariant", null, error);
      }
    }

    private static String stemmingProceedInvariant() {
      try {
        return outcomeToken("stemming-proceed-invariant", StemmerUtil.stemEnglish("proceed"), null);
      } catch (Exception error) {
        return outcomeToken("stemming-proceed-invariant", null, error);
      }
    }

    private static String stemmingSucceedInvariant() {
      try {
        return outcomeToken("stemming-succeed-invariant", StemmerUtil.stemEnglish("succeed"), null);
      } catch (Exception error) {
        return outcomeToken("stemming-succeed-invariant", null, error);
      }
    }

    private static String correctionAmbiguousPrefersJavaPath() {
      try {
        SpellCheckTrie trie = new SpellCheckTrie();
        trie.insert("test");
        trie.insert("best");
        return outcomeToken(
          "correction-ambiguous-prefers-java-path",
          SpellCheckUtil.getOneEditKeyword("cest", trie),
          null
        );
      } catch (Exception error) {
        return outcomeToken("correction-ambiguous-prefers-java-path", null, error);
      }
    }

    private static String predictionBfsOrder() {
      try {
        SpellCheckTrie trie = new SpellCheckTrie();
        trie.insert("light");
        trie.insert("lights");
        trie.insert("lighter");
        return outcomeTokens("prediction-bfs-order", SpellCheckUtil.getTextPredictions("lig", trie, 10), null);
      } catch (Exception error) {
        return outcomeTokens("prediction-bfs-order", null, error);
      }
    }

    private static String keywordBracketTokenCollapse() {
      try {
        Store<ProbeRow> store = store(List.of(
          row(1, "abc", "x"),
          row(2, "beta", "y")
        ));
        List<ProbeRow> result = new KeywordSearch(10).getBestMatch("a(b)c", store, 10).getResult();
        return outcome("keyword-bracket-token-collapse", result, null);
      } catch (Exception error) {
        return outcome("keyword-bracket-token-collapse", null, error);
      }
    }

    private static String correctionNullAmbiguity() {
      try {
        Store<ProbeRow> store = store(List.of(
          row(1, "test", "x"),
          row(2, "bests", "y")
        ));
        List<ProbeRow> result = new KeywordSearch(10).getBestMatch("cests", store, 10).getResult();
        return outcome("correction-null-ambiguity", result, null);
      } catch (Exception error) {
        return outcome("correction-null-ambiguity", null, error);
      }
    }

    private static String keywordCaseNormalization() {
      try {
        Store<ProbeRow> store = store(List.of(
          row(1, "alpha", "x"),
          row(2, "beta", "y")
        ));
        List<ProbeRow> result = new KeywordSearch(10).getBestMatch("ALPHA", store, 10).getResult();
        return outcome("keyword-case-normalization", result, null);
      } catch (Exception error) {
        return outcome("keyword-case-normalization", null, error);
      }
    }

    private static String legacyProjectionLimitOrder() {
      try {
        Store<ProbeRow> store = store(List.of(
          row(1, "alpha", "red"),
          row(1, "alpha", "blue"),
          row(1, "beta", "green")
        ));
        List<Condition> conditions = new LinkedList<>();
        conditions.add(new Condition("id", Operator.EQUAL, "1"));
        java.util.Set<String> filterSet = new java.util.HashSet<>();
        filterSet.add("title");
        List<java.util.Map<String, String>> result = new StoreSearch().query(store, conditions, filterSet, 2);
        List<String> titles = new ArrayList<>();
        for (java.util.Map<String, String> row : result) {
          titles.add(row.get("TITLE"));
        }
        return outcomeTokens("legacy-projection-limit-order", titles, null);
      } catch (Exception error) {
        return outcomeTokens("legacy-projection-limit-order", null, error);
      }
    }

    private static String fullRowLimitOrderAfterCollapse() {
      try {
        Store<ProbeRow> store = store(List.of(
          row(1, "alpha", "red"),
          row(1, "alpha", "red"),
          row(2, "beta", "blue"),
          row(3, "gamma", "green")
        ));
        List<Condition> conditions = new LinkedList<>();
        conditions.add(new Condition("title", Operator.CONTAINS_EITHER, List.of("alpha", "beta", "gamma")));
        List<ProbeRow> result = new StoreSearch().query(store, conditions, 2);
        return outcome("full-row-limit-order-after-collapse", result, null);
      } catch (Exception error) {
        return outcome("full-row-limit-order-after-collapse", null, error);
      }
    }

    private static String keywordCaseInsensitiveField() {
      try {
        Store<ProbeRowCi> store = storeCi(List.of(
          rowCi(1, "alpha", "x"),
          rowCi(2, "beta", "y")
        ));
        List<ProbeRowCi> result = new KeywordSearch(10).getBestMatch("ALPHA", store, 10).getResult();
        List<ProbeRow> mapped = new ArrayList<>();
        for (ProbeRowCi row : result) {
          mapped.add(row(row.getId(), row.getTitle(), row.getTags()));
        }
        return outcome("keyword-case-insensitive-field", mapped, null);
      } catch (Exception error) {
        return outcome("keyword-case-insensitive-field", null, error);
      }
    }

    private static String correctionWithPreconditionNoResult() {
      try {
        Store<ProbeRow> store = store(List.of(
          row(1, "Philips Blight", "archived"),
          row(2, "Philips Light", "active"),
          row(3, "Other Lamp", "active")
        ));
        List<Condition> conditions = new LinkedList<>();
        conditions.add(new Condition("tags", Operator.EQUAL, "active"));
        List<ProbeRow> result = new KeywordSearch(10).getBestMatch("bligt", store, conditions, 10).getResult();
        return outcome("correction-with-precondition-no-result", result, null);
      } catch (Exception error) {
        return outcome("correction-with-precondition-no-result", null, error);
      }
    }

    private static String correctionDisabledWithoutOneEdit() {
      try {
        Store<ProbeRow> store = store(List.of(
          row(1, "apollo", "x"),
          row(2, "beta", "y")
        ));
        List<ProbeRow> result = new KeywordSearch(10).getBestMatch("apolo", store, 10).getResult();
        return outcome("correction-disabled-without-one-edit", result, null);
      } catch (Exception error) {
        return outcome("correction-disabled-without-one-edit", null, error);
      }
    }

    private static String correctionEnabledWithOneEdit() {
      try {
        Store<ProbeRowOneEdit> store = storeOneEdit(List.of(
          rowOneEdit(1, "apollo", "x"),
          rowOneEdit(2, "beta", "y")
        ));
        List<ProbeRowOneEdit> result = new KeywordSearch(10).getBestMatch("apolo", store, 10).getResult();
        List<ProbeRow> mapped = new ArrayList<>();
        for (ProbeRowOneEdit row : result) {
          mapped.add(row(row.getId(), row.getTitle(), row.getTags()));
        }
        return outcome("correction-enabled-with-one-edit", mapped, null);
      } catch (Exception error) {
        return outcome("correction-enabled-with-one-edit", null, error);
      }
    }

    private static String ignoreIndexKeywordExclusion() {
      try {
        Store<ProbeRowIgnore> store = storeIgnore(List.of(
          rowIgnore(1, "Visible Story", "hidden blue token"),
          rowIgnore(2, "Another Story", "hidden red token")
        ));
        List<ProbeRowIgnore> result = new KeywordSearch(10).getBestMatch("hidden", store, 10).getResult();
        List<ProbeRow> mapped = new ArrayList<>();
        for (ProbeRowIgnore row : result) {
          mapped.add(row(row.getId(), row.getTitle(), row.getPrivateNotes()));
        }
        return outcome("ignore-index-keyword-exclusion", mapped, null);
      } catch (Exception error) {
        return outcome("ignore-index-keyword-exclusion", null, error);
      }
    }

  public static void main(String[] args) {
    List<String> outcomes = new ArrayList<>();
    outcomes.add(collectionEqualToken());
    outcomes.add(textLessThan());
    outcomes.add(scalarContainsAll());
    outcomes.add(collectionContainsEitherToken());
    outcomes.add(textGreaterThanEqual());
    outcomes.add(numericBetweenInclusive());
    outcomes.add(columnOrderEmptySuppressesLaterError());
    outcomes.add(sameFieldEmptyDoesNotSuppressInvalidOperator());
    outcomes.add(legacyProjectionSharedPrefixCollapse());
    outcomes.add(duplicateFullRowCollapse());
    outcomes.add(keywordBestCombinationTieOrder());
    outcomes.add(keywordMinimumPostfilterCardinality());
    outcomes.add(stemmingSkiesException());
    outcomes.add(stemmingDyingException());
    outcomes.add(stemmingLyingException());
    outcomes.add(stemmingNewsInvariant());
    outcomes.add(stemmingProceedInvariant());
    outcomes.add(stemmingSucceedInvariant());
    outcomes.add(correctionAmbiguousPrefersJavaPath());
    outcomes.add(predictionBfsOrder());
    outcomes.add(keywordBracketTokenCollapse());
    outcomes.add(correctionNullAmbiguity());
    outcomes.add(keywordCaseNormalization());
    outcomes.add(legacyProjectionLimitOrder());
    outcomes.add(fullRowLimitOrderAfterCollapse());
    outcomes.add(keywordCaseInsensitiveField());
    outcomes.add(correctionWithPreconditionNoResult());
    outcomes.add(correctionDisabledWithoutOneEdit());
    outcomes.add(correctionEnabledWithOneEdit());
    outcomes.add(ignoreIndexKeywordExclusion());
    System.out.println("[" + String.join(",", outcomes) + "]");
  }
}
`;
}

async function runTsCases() {
  const mod = await import(pathToFileURL(DIST).href);
  const {
    Store, KeywordSearch, defineSchema, numberField, textField, createCondition, Operator, NormalizationProfile,
    stemEnglishToken, DictionaryTrie,
  } = mod;
  const schema = defineSchema([
    numberField("id"),
    textField("title"),
    textField("tags", { secondaryType: "commaSeparatedStrings", nullable: true }),
  ]);
  const rows = [
    { id: 1, title: "alpha", tags: "red,blue" },
    { id: 2, title: "beta", tags: "green" },
    { id: 3, title: "gamma", tags: null },
  ];
  const store = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  store.loadRows(rows);
  store.prepare();
  const runCount = (id, build) => {
    try {
      return { id, kind: "count", count: build() };
    } catch (error) {
      const typed = error;
      return {
        id,
        kind: "error",
        name: typed?.name ?? "Error",
        code: typed?.code,
        message: typed?.message ?? String(error),
      };
    }
  };
  const run = (id, conditions) => {
    try {
      const result = store.search(conditions).map((row) => row.id);
      return { id, kind: "rows", rows: result };
    } catch (error) {
      const typed = error;
      return {
        id,
        kind: "error",
        name: typed?.name ?? "Error",
        code: typed?.code,
        message: typed?.message ?? String(error),
      };
    }
  };
  const runFromStore = (id, targetStore, conditions) => {
    try {
      const result = targetStore.search(conditions).map((row) => row.id);
      return { id, kind: "rows", rows: result };
    } catch (error) {
      const typed = error;
      return {
        id,
        kind: "error",
        name: typed?.name ?? "Error",
        code: typed?.code,
        message: typed?.message ?? String(error),
      };
    }
  };
  const runFromStoreWithLimit = (id, targetStore, conditions, limit) => {
    try {
      const result = targetStore.search(conditions, limit).map((row) => row.id);
      return { id, kind: "rows", rows: result };
    } catch (error) {
      const typed = error;
      return {
        id,
        kind: "error",
        name: typed?.name ?? "Error",
        code: typed?.code,
        message: typed?.message ?? String(error),
      };
    }
  };
  const runToken = (id, input) => {
    try {
      return { id, kind: "token", token: stemEnglishToken(input) };
    } catch (error) {
      const typed = error;
      return {
        id,
        kind: "error",
        name: typed?.name ?? "Error",
        code: typed?.code,
        message: typed?.message ?? String(error),
      };
    }
  };
  const runTokens = (id, build) => {
    try {
      return { id, kind: "tokens", tokens: build() };
    } catch (error) {
      const typed = error;
      return {
        id,
        kind: "error",
        name: typed?.name ?? "Error",
        code: typed?.code,
        message: typed?.message ?? String(error),
      };
    }
  };
  const duplicateStore = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  duplicateStore.loadRows([
    { id: 1, title: "alpha", tags: "red" },
    { id: 1, title: "alpha", tags: "red" },
    { id: 2, title: "beta", tags: "blue" },
  ]);
  duplicateStore.prepare();
  const keywordTieStore = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  keywordTieStore.loadRows([
    { id: 1, title: "alpha", tags: "beta" },
    { id: 2, title: "beta", tags: "alpha" },
  ]);
  keywordTieStore.prepare();
  const keywordMinimumStore = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  keywordMinimumStore.loadRows([
    { id: 1, title: "alpha", tags: "x" },
    { id: 2, title: "alpha", tags: null },
  ]);
  keywordMinimumStore.prepare();
  const keywordBracketStore = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  keywordBracketStore.loadRows([
    { id: 1, title: "abc", tags: "x" },
    { id: 2, title: "beta", tags: "y" },
  ]);
  keywordBracketStore.prepare();
  const correctionNullStore = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  correctionNullStore.loadRows([
    { id: 1, title: "test", tags: "x" },
    { id: 2, title: "bests", tags: "y" },
  ]);
  correctionNullStore.prepare();
  const caseNormalizationStore = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  caseNormalizationStore.loadRows([
    { id: 1, title: "alpha", tags: "x" },
    { id: 2, title: "beta", tags: "y" },
  ]);
  caseNormalizationStore.prepare();
  const caseInsensitiveSchema = defineSchema([
    numberField("id"),
    textField("title", { caseInsensitive: true }),
    textField("tags", { secondaryType: "commaSeparatedStrings", nullable: true }),
  ]);
  const caseInsensitiveStore = new Store(caseInsensitiveSchema, { normalizationProfile: NormalizationProfile.JAVA });
  caseInsensitiveStore.loadRows([
    { id: 1, title: "alpha", tags: "x" },
    { id: 2, title: "beta", tags: "y" },
  ]);
  caseInsensitiveStore.prepare();
  const correctionPreconditionStore = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  correctionPreconditionStore.loadRows([
    { id: 1, title: "Philips Blight", tags: "archived" },
    { id: 2, title: "Philips Light", tags: "active" },
    { id: 3, title: "Other Lamp", tags: "active" },
  ]);
  correctionPreconditionStore.prepare();
  const ignoreIndexSchema = defineSchema([
    numberField("id"),
    textField("title"),
    textField("privateNotes", { ignoreIndex: true }),
  ]);
  const ignoreIndexStore = new Store(ignoreIndexSchema, { normalizationProfile: NormalizationProfile.JAVA });
  ignoreIndexStore.loadRows([
    { id: 1, title: "Visible Story", privateNotes: "hidden blue token" },
    { id: 2, title: "Another Story", privateNotes: "hidden red token" },
  ]);
  ignoreIndexStore.prepare();
  const correctionDisabledStore = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  correctionDisabledStore.loadRows([
    { id: 1, title: "apollo", tags: "x" },
    { id: 2, title: "beta", tags: "y" },
  ]);
  correctionDisabledStore.prepare();
  const correctionEnabledSchema = defineSchema([
    numberField("id"),
    textField("title", { oneEditAway: true }),
    textField("tags"),
  ]);
  const correctionEnabledStore = new Store(correctionEnabledSchema, { normalizationProfile: NormalizationProfile.JAVA });
  correctionEnabledStore.loadRows([
    { id: 1, title: "apollo", tags: "x" },
    { id: 2, title: "beta", tags: "y" },
  ]);
  correctionEnabledStore.prepare();
  const fullRowLimitStore = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  fullRowLimitStore.loadRows([
    { id: 1, title: "alpha", tags: "red" },
    { id: 1, title: "alpha", tags: "red" },
    { id: 2, title: "beta", tags: "blue" },
    { id: 3, title: "gamma", tags: "green" },
  ]);
  fullRowLimitStore.prepare();
  return [
    run("collection-equal-token", [createCondition({ field: "tags", operator: Operator.EQUAL, values: ["red"] })]),
    run("text-less-than", [createCondition({ field: "title", operator: Operator.LESS_THAN, values: ["beta"] })]),
    run("scalar-contains-all", [createCondition({ field: "title", operator: Operator.CONTAINS_ALL, values: ["alpha"] })]),
    run("collection-contains-either-token", [createCondition({ field: "tags", operator: Operator.CONTAINS_EITHER, values: ["blue"] })]),
    runCount("text-greater-than-equal", () => store.search([
      createCondition({ field: "title", operator: Operator.GREATER_THAN_EQUAL, values: ["beta"] }),
    ]).length),
    run("numeric-between-inclusive", [createCondition({ field: "id", operator: Operator.BETWEEN, lowerValue: 2, upperValue: 3 })]),
    run("column-order-empty-suppresses-later-error", [
      createCondition({ field: "title", operator: Operator.NOT_CONTAINS, values: ["alpha"] }),
      createCondition({ field: "id", operator: Operator.EQUAL, values: [999] }),
    ]),
    run("same-field-empty-does-not-suppress-invalid-operator", [
      createCondition({ field: "title", operator: Operator.EQUAL, values: ["missing"] }),
      createCondition({ field: "title", operator: Operator.NOT_CONTAINS, values: ["alpha"] }),
    ]),
    runCount("legacy-projection-shared-prefix-collapse", () => {
      const projectionStore = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
      projectionStore.loadRows([
        { id: 1, title: "alpha", tags: "red" },
        { id: 1, title: "alpha", tags: "blue" },
      ]);
      projectionStore.prepare();
      return projectionStore.searchLegacyProjection(
        [createCondition({ field: "id", operator: Operator.EQUAL, values: [1] })],
        ["title"],
      ).length;
    }),
    runFromStore("duplicate-full-row-collapse", duplicateStore, [
      createCondition({ field: "id", operator: Operator.EQUAL, values: [1] }),
    ]),
    (() => {
      try {
        const idsForBest = new KeywordSearch(keywordTieStore, 10)
          .bestMatch(["alpha", "beta"], { limit: 1 }).results.map((row) => row.id);
        return { id: "keyword-best-combination-tie-order", kind: "rows", rows: idsForBest };
      } catch (error) {
        const typed = error;
        return {
          id: "keyword-best-combination-tie-order",
          kind: "error",
          name: typed?.name ?? "Error",
          code: typed?.code,
          message: typed?.message ?? String(error),
        };
      }
    })(),
    (() => {
      try {
        const idsForMinimum = new KeywordSearch(keywordMinimumStore, 10)
          .minimumMatch("alpha").results.map((row) => row.id);
        return { id: "keyword-minimum-postfilter-cardinality", kind: "rows", rows: idsForMinimum };
      } catch (error) {
        const typed = error;
        return {
          id: "keyword-minimum-postfilter-cardinality",
          kind: "error",
          name: typed?.name ?? "Error",
          code: typed?.code,
          message: typed?.message ?? String(error),
        };
      }
    })(),
    runToken("stemming-skies-exception", "skies"),
    runToken("stemming-dying-exception", "dying"),
    runToken("stemming-lying-exception", "lying"),
    runToken("stemming-news-invariant", "news"),
    runToken("stemming-proceed-invariant", "proceed"),
    runToken("stemming-succeed-invariant", "succeed"),
    (() => {
      try {
        const dictionary = new DictionaryTrie();
        dictionary.addWords(["test", "best"]);
        return {
          id: "correction-ambiguous-prefers-java-path",
          kind: "token",
          token: dictionary.getOneEditCandidate("cest"),
        };
      } catch (error) {
        const typed = error;
        return {
          id: "correction-ambiguous-prefers-java-path",
          kind: "error",
          name: typed?.name ?? "Error",
          code: typed?.code,
          message: typed?.message ?? String(error),
        };
      }
    })(),
    runTokens("prediction-bfs-order", () => {
      const dictionary = new DictionaryTrie();
      dictionary.addWords(["light", "lights", "lighter"]);
      return dictionary.predict("lig", 10);
    }),
    (() => {
      try {
        const idsForBracket = new KeywordSearch(keywordBracketStore, 10)
          .bestMatch("a(b)c", { limit: 10 }).results.map((row) => row.id);
        return { id: "keyword-bracket-token-collapse", kind: "rows", rows: idsForBracket };
      } catch (error) {
        const typed = error;
        return {
          id: "keyword-bracket-token-collapse",
          kind: "error",
          name: typed?.name ?? "Error",
          code: typed?.code,
          message: typed?.message ?? String(error),
        };
      }
    })(),
    (() => {
      try {
        const idsForCorrectionNull = new KeywordSearch(correctionNullStore, 10)
          .bestMatch("cests", { limit: 10 }).results.map((row) => row.id);
        return { id: "correction-null-ambiguity", kind: "rows", rows: idsForCorrectionNull };
      } catch (error) {
        const typed = error;
        return {
          id: "correction-null-ambiguity",
          kind: "error",
          name: typed?.name ?? "Error",
          code: typed?.code,
          message: typed?.message ?? String(error),
        };
      }
    })(),
    (() => {
      try {
        const idsForCaseNormalization = new KeywordSearch(caseNormalizationStore, 10)
          .bestMatch("ALPHA", { limit: 10 }).results.map((row) => row.id);
        return { id: "keyword-case-normalization", kind: "rows", rows: idsForCaseNormalization };
      } catch (error) {
        const typed = error;
        return {
          id: "keyword-case-normalization",
          kind: "error",
          name: typed?.name ?? "Error",
          code: typed?.code,
          message: typed?.message ?? String(error),
        };
      }
    })(),
    runTokens("legacy-projection-limit-order", () => {
      const projectionStore = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
      projectionStore.loadRows([
        { id: 1, title: "alpha", tags: "red" },
        { id: 1, title: "alpha", tags: "blue" },
        { id: 1, title: "beta", tags: "green" },
      ]);
      projectionStore.prepare();
      return projectionStore.searchLegacyProjection(
        [createCondition({ field: "id", operator: Operator.EQUAL, values: [1] })],
        ["title"],
        2,
      ).map((row) => row.TITLE ?? "");
    }),
    runFromStoreWithLimit("full-row-limit-order-after-collapse", fullRowLimitStore, [
      createCondition({ field: "title", operator: Operator.CONTAINS_EITHER, values: ["alpha", "beta", "gamma"] }),
    ], 2),
    (() => {
      try {
        const idsForCaseInsensitive = new KeywordSearch(caseInsensitiveStore, 10)
          .bestMatch("ALPHA", { limit: 10 }).results.map((row) => row.id);
        return { id: "keyword-case-insensitive-field", kind: "rows", rows: idsForCaseInsensitive };
      } catch (error) {
        const typed = error;
        return {
          id: "keyword-case-insensitive-field",
          kind: "error",
          name: typed?.name ?? "Error",
          code: typed?.code,
          message: typed?.message ?? String(error),
        };
      }
    })(),
    (() => {
      try {
        const idsForCorrectionPrecondition = new KeywordSearch(correctionPreconditionStore, 10)
          .bestMatch("bligt", {
            conditions: [createCondition({ field: "tags", operator: Operator.EQUAL, values: ["active"] })],
            limit: 10,
          }).results.map((row) => row.id);
        return { id: "correction-with-precondition-no-result", kind: "rows", rows: idsForCorrectionPrecondition };
      } catch (error) {
        const typed = error;
        return {
          id: "correction-with-precondition-no-result",
          kind: "error",
          name: typed?.name ?? "Error",
          code: typed?.code,
          message: typed?.message ?? String(error),
        };
      }
    })(),
    (() => {
      try {
        const idsForIgnore = new KeywordSearch(ignoreIndexStore, 10)
          .bestMatch("hidden", { limit: 10 }).results.map((row) => row.id);
        return { id: "ignore-index-keyword-exclusion", kind: "rows", rows: idsForIgnore };
      } catch (error) {
        const typed = error;
        return {
          id: "ignore-index-keyword-exclusion",
          kind: "error",
          name: typed?.name ?? "Error",
          code: typed?.code,
          message: typed?.message ?? String(error),
        };
      }
    })(),
    (() => {
      try {
        const idsForCorrectionDisabled = new KeywordSearch(correctionDisabledStore, 10)
          .bestMatch("apolo", { limit: 10 }).results.map((row) => row.id);
        return { id: "correction-disabled-without-one-edit", kind: "rows", rows: idsForCorrectionDisabled };
      } catch (error) {
        const typed = error;
        return {
          id: "correction-disabled-without-one-edit",
          kind: "error",
          name: typed?.name ?? "Error",
          code: typed?.code,
          message: typed?.message ?? String(error),
        };
      }
    })(),
    (() => {
      try {
        const idsForCorrectionEnabled = new KeywordSearch(correctionEnabledStore, 10)
          .bestMatch("apolo", { limit: 10 }).results.map((row) => row.id);
        return { id: "correction-enabled-with-one-edit", kind: "rows", rows: idsForCorrectionEnabled };
      } catch (error) {
        const typed = error;
        return {
          id: "correction-enabled-with-one-edit",
          kind: "error",
          name: typed?.name ?? "Error",
          code: typed?.code,
          message: typed?.message ?? String(error),
        };
      }
    })(),
  ];
}

async function main() {
  const reportPath = resolve(process.env.JAVA_SUREFIRE_REPORT ?? DEFAULT_REPORT);
  const reportXml = readFileSync(reportPath, "utf8");
  const javaClassPath = getProperty(reportXml, "java.class.path");
  const javaHome = process.env.JAVA_HOME ?? getProperty(reportXml, "java.home");
  const javac = resolve(javaHome, "bin", process.platform === "win32" ? "javac.exe" : "javac");
  const java = resolve(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
  const temp = mkdtempSync(resolve(tmpdir(), "kiara-live-contract-"));

  try {
    writeFileSync(resolve(temp, "LiveParityProbe.java"), javaProbeSource(), "utf8");
    run(javac, ["-cp", javaClassPath, "LiveParityProbe.java"], temp);
    const javaOut = run(java, ["-cp", `${javaClassPath}${process.platform === "win32" ? ";" : ":"}${temp}`, "LiveParityProbe"], temp).trim();
    const javaCases = parseJavaCases(javaOut);
    const tsCases = await runTsCases();
    const byId = new Map(CASES.map((item) => [item.id, item]));
    const rows = [];
    let mismatches = 0;
    for (const javaCase of javaCases) {
      const expected = byId.get(javaCase.id);
      if (!expected) fail(`Unexpected case from Java probe: ${javaCase.id}`);
      const tsCase = tsCases.find((item) => item.id === javaCase.id);
      if (!tsCase) fail(`Missing TS result for case: ${javaCase.id}`);
      const javaOk = compare(javaCase, expected.expectedJava);
      const tsOk = compare(tsCase, expected.expectedTs);
      if (!javaOk || !tsOk) mismatches += 1;
      rows.push({
        case: javaCase.id,
        description: expected.description,
        java: formatOutcome(javaCase),
        ts: formatOutcome(tsCase),
        expected: `${formatOutcome(expected.expectedJava)} vs ${formatOutcome(expected.expectedTs)}`,
        status: javaOk && tsOk ? "reproduced" : "unexpected",
      });
    }

    console.table(rows);
    if (mismatches) {
      fail(`Live Java parity probe found ${mismatches} unexpected outcomes.`);
    }
    console.log(`Live Java parity probe verified ${rows.length} parity expectations.`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
