import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist", "index.js");
const OUTPUT = resolve(ROOT, "benchmarks", "java-ts-equivalent-benchmark.json");
const DEFAULT_REPORT = resolve(ROOT, "..", "kiara", "target", "surefire-reports",
  "TEST-com.kapoorlabs.kiara.test.util.SpellCheckUtilTest.xml");

const profileArg = process.argv.find((arg) => arg.startsWith("--profile="));
const profile = profileArg?.split("=")[1];
const defaultWarmup = profile === "ci" ? 8 : 12;
const defaultIterations = profile === "ci" ? 25 : 50;

const datasetSizes = (process.env.JAVA_TS_BENCH_ROWS ?? "10000,100000")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isSafeInteger(value) && value >= 100);

const warmupIterations = Number.parseInt(process.env.JAVA_TS_BENCH_WARMUP ?? String(defaultWarmup), 10);
const timedIterations = Number.parseInt(process.env.JAVA_TS_BENCH_ITERATIONS ?? String(defaultIterations), 10);

const WORKLOADS = ["numericEqual", "numericBetweenTail", "collectionEqualG9", "keywordExactTitle", "broadLimit"];
const BUDGETS = {
  prepareRatioMax: 30,
  retainedMemoryRatioMax: 6,
  workloadP95RatioMax: {
    numericEqual: 15,
    numericBetweenTail: 15,
    collectionEqualG9: 15,
    keywordExactTitle: 20,
    broadLimit: 15,
  },
};

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

function percentile(sortedValues, p) {
  const index = Math.max(0, Math.ceil(sortedValues.length * p) - 1);
  return sortedValues[index];
}

function resolveExpectedCount(name, size) {
  if (name === "numericEqual") return 1;
  if (name === "numericBetweenTail") return 20;
  if (name === "collectionEqualG9") return size / 10;
  if (name === "keywordExactTitle") return 1;
  if (name === "broadLimit") return 100;
  fail(`Unknown workload: ${name}`);
}

async function runTsBenchmark(size) {
  const mod = await import(pathToFileURL(DIST).href);
  const {
    Store,
    KeywordSearch,
    defineSchema,
    numberField,
    textField,
    createCondition,
    Operator,
    NormalizationProfile,
  } = mod;

  const schema = defineSchema([
    numberField("id"),
    numberField("score"),
    textField("tags", { secondaryType: "commaSeparatedStrings" }),
    textField("title"),
  ]);

  const rows = Array.from({ length: size }, (_, id) => ({
    id,
    score: id,
    tags: `g${id % 10},bucket${id % 4}`,
    title: `title${id}`,
  }));

  global.gc?.();
  const beforeHeap = process.memoryUsage().heapUsed;
  const store = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  store.loadRows(rows);
  const prepareStart = performance.now();
  store.prepare();
  const prepareMs = performance.now() - prepareStart;
  global.gc?.();
  const retainedBytes = Math.max(0, process.memoryUsage().heapUsed - beforeHeap);
  const keywordSearch = new KeywordSearch(store, 10);

  const workloads = {
    numericEqual: () => store.search([createCondition({
      field: "id", operator: Operator.EQUAL, values: [size - 1],
    })]),
    numericBetweenTail: () => store.search([createCondition({
      field: "score", operator: Operator.BETWEEN, lowerValue: size - 20, upperValue: size - 1,
    })]),
    collectionEqualG9: () => store.search([createCondition({
      field: "tags", operator: Operator.EQUAL, values: ["g9"],
    })]),
    keywordExactTitle: () => keywordSearch.bestMatch(`title${size - 1}`, { limit: 10 }).results,
    broadLimit: () => store.search([createCondition({
      field: "score", operator: Operator.GREATER_THAN_EQUAL, values: [0],
    })], 100),
  };

  const results = [];
  for (const name of WORKLOADS) {
    const runWorkload = workloads[name];
    const expectedCount = resolveExpectedCount(name, size);
    for (let i = 0; i < warmupIterations; i += 1) {
      assert.equal(runWorkload().length, expectedCount, `Warmup mismatch for TS ${name}/${size}`);
    }
    const durations = [];
    for (let i = 0; i < timedIterations; i += 1) {
      const started = performance.now();
      const result = runWorkload();
      const elapsed = performance.now() - started;
      assert.equal(result.length, expectedCount, `Result mismatch for TS ${name}/${size}`);
      durations.push(elapsed);
    }
    durations.sort((left, right) => left - right);
    results.push({
      name,
      expectedCount,
      count: expectedCount,
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
    });
  }

  return {
    runtime: process.version,
    prepareMs,
    retainedBytes,
    workloads: results,
  };
}

function javaBenchmarkSource() {
  return String.raw`
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedList;
import java.util.List;
import java.util.function.Supplier;
import com.kapoorlabs.kiara.domain.Condition;
import com.kapoorlabs.kiara.domain.Operator;
import com.kapoorlabs.kiara.domain.Store;
import com.kapoorlabs.kiara.domain.annotations.CommaSeperatedStrings;
import com.kapoorlabs.kiara.exception.LoadDataException;
import com.kapoorlabs.kiara.loader.StoreLoader;
import com.kapoorlabs.kiara.search.KeywordSearch;
import com.kapoorlabs.kiara.search.StoreSearch;

public class JavaTsEquivalentBenchmark {
  public static class BenchmarkRow {
    private Integer id;
    private Integer score;
    @CommaSeperatedStrings
    private String tags;
    private String title;

    public Integer getId() { return id; }
    public void setId(Integer id) { this.id = id; }
    public Integer getScore() { return score; }
    public void setScore(Integer score) { this.score = score; }
    public String getTags() { return tags; }
    public void setTags(String tags) { this.tags = tags; }
    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }
  }

  private static BenchmarkRow row(int id) {
    BenchmarkRow row = new BenchmarkRow();
    row.setId(id);
    row.setScore(id);
    row.setTags("g" + (id % 10) + ",bucket" + (id % 4));
    row.setTitle("title" + id);
    return row;
  }

  private static Store<BenchmarkRow> store(int size) throws Exception {
    Store<BenchmarkRow> store = new Store<>(BenchmarkRow.class);
    StoreLoader<BenchmarkRow> loader = new StoreLoader<>(store);
    for (int id = 0; id < size; id++) {
      try {
        loader.loadTable(row(id));
      } catch (LoadDataException error) {
        throw new RuntimeException(error);
      }
    }
    loader.prepareForSearch();
    return store;
  }

  private static long usedMemory() {
    Runtime runtime = Runtime.getRuntime();
    System.gc();
    return runtime.totalMemory() - runtime.freeMemory();
  }

  private static String escape(String value) {
    if (value == null) return "";
    return value.replace("\\\\", "\\\\\\\\").replace("\"", "\\\\\"");
  }

  private static String runCase(
    String name,
    int expectedCount,
    int warmupIterations,
    int timedIterations,
    Supplier<List<BenchmarkRow>> workload
  ) {
    for (int i = 0; i < warmupIterations; i++) {
      List<BenchmarkRow> result = workload.get();
      if (result.size() != expectedCount) {
        throw new RuntimeException("Warmup mismatch for " + name + ": " + result.size() + " vs " + expectedCount);
      }
    }

    double[] durationsMs = new double[timedIterations];
    for (int i = 0; i < timedIterations; i++) {
      long started = System.nanoTime();
      List<BenchmarkRow> result = workload.get();
      long elapsed = System.nanoTime() - started;
      if (result.size() != expectedCount) {
        throw new RuntimeException("Result mismatch for " + name + ": " + result.size() + " vs " + expectedCount);
      }
      durationsMs[i] = elapsed / 1_000_000d;
    }

    Arrays.sort(durationsMs);
    int p50Index = Math.max(0, (int) Math.ceil(durationsMs.length * 0.5) - 1);
    int p95Index = Math.max(0, (int) Math.ceil(durationsMs.length * 0.95) - 1);
    return "{\"name\":\"" + escape(name) + "\",\"expectedCount\":" + expectedCount
      + ",\"count\":" + expectedCount
      + ",\"p50Ms\":" + durationsMs[p50Index]
      + ",\"p95Ms\":" + durationsMs[p95Index]
      + "}";
  }

  public static void main(String[] args) throws Exception {
    int size = Integer.parseInt(args[0]);
    int warmupIterations = Integer.parseInt(args[1]);
    int timedIterations = Integer.parseInt(args[2]);
    int collectionExpected = size / 10;

    long beforeMemory = usedMemory();
    long prepareStarted = System.nanoTime();
    Store<BenchmarkRow> store = store(size);
    long prepareNanos = System.nanoTime() - prepareStarted;
    long afterMemory = usedMemory();
    long retainedBytes = Math.max(0, afterMemory - beforeMemory);

    StoreSearch search = new StoreSearch();
    KeywordSearch keywordSearch = new KeywordSearch(10);

    List<Condition> idEqual = new LinkedList<>();
    idEqual.add(new Condition("id", Operator.EQUAL, Integer.toString(size - 1)));
    List<Condition> scoreBetween = new LinkedList<>();
    scoreBetween.add(new Condition("score", Operator.BETWEEN, Integer.toString(size - 20), Integer.toString(size - 1)));
    List<Condition> tagsEqual = new LinkedList<>();
    tagsEqual.add(new Condition("tags", Operator.EQUAL, "g9"));
    List<Condition> broad = new LinkedList<>();
    broad.add(new Condition("score", Operator.GREATER_THAN_EQUAL, "0"));

    List<String> workloads = new ArrayList<>();
    workloads.add(runCase("numericEqual", 1, warmupIterations, timedIterations, () -> search.query(store, idEqual)));
    workloads.add(runCase("numericBetweenTail", 20, warmupIterations, timedIterations, () -> search.query(store, scoreBetween)));
    workloads.add(runCase("collectionEqualG9", collectionExpected, warmupIterations, timedIterations, () -> search.query(store, tagsEqual)));
    workloads.add(runCase("keywordExactTitle", 1, warmupIterations, timedIterations,
      () -> keywordSearch.getBestMatch("title" + (size - 1), store, 10).getResult()));
    workloads.add(runCase("broadLimit", 100, warmupIterations, timedIterations, () -> search.query(store, broad, 100)));

    StringBuilder output = new StringBuilder();
    output.append("{\"runtime\":\"").append(escape(System.getProperty("java.version"))).append("\"");
    output.append(",\"prepareMs\":").append(prepareNanos / 1_000_000d);
    output.append(",\"retainedBytes\":").append(retainedBytes);
    output.append(",\"workloads\":[");
    for (int i = 0; i < workloads.size(); i++) {
      if (i > 0) output.append(",");
      output.append(workloads.get(i));
    }
    output.append("]}");
    System.out.println(output.toString());
  }
}
`;
}

function validateBudgets(javaRun, tsRun, size) {
  const failures = [];
  const prepareRatio = tsRun.prepareMs / Math.max(javaRun.prepareMs, 0.0001);
  const retainedRatio = tsRun.retainedBytes / Math.max(javaRun.retainedBytes, 1);
  if (prepareRatio > BUDGETS.prepareRatioMax) {
    failures.push(`prepare ratio ${prepareRatio.toFixed(2)} exceeds ${BUDGETS.prepareRatioMax} for ${size}`);
  }
  if (retainedRatio > BUDGETS.retainedMemoryRatioMax) {
    failures.push(`retained-memory ratio ${retainedRatio.toFixed(2)} exceeds ${BUDGETS.retainedMemoryRatioMax} for ${size}`);
  }
  for (const name of WORKLOADS) {
    const javaWorkload = javaRun.workloads.find((item) => item.name === name);
    const tsWorkload = tsRun.workloads.find((item) => item.name === name);
    if (!javaWorkload || !tsWorkload) {
      failures.push(`missing workload ${name} for ${size}`);
      continue;
    }
    const ratio = tsWorkload.p95Ms / Math.max(javaWorkload.p95Ms, 0.0001);
    const maxRatio = BUDGETS.workloadP95RatioMax[name];
    if (ratio > maxRatio) {
      failures.push(`${size}/${name} p95 ratio ${ratio.toFixed(2)} exceeds ${maxRatio}`);
    }
  }
  return failures;
}

async function main() {
  assert.ok(datasetSizes.length > 0, "Provide at least one dataset size in JAVA_TS_BENCH_ROWS.");
  assert.ok(warmupIterations >= 3, "JAVA_TS_BENCH_WARMUP must be at least 3.");
  assert.ok(timedIterations >= 10, "JAVA_TS_BENCH_ITERATIONS must be at least 10.");

  const reportPath = resolve(process.env.JAVA_SUREFIRE_REPORT ?? DEFAULT_REPORT);
  const reportXml = readFileSync(reportPath, "utf8");
  const javaClassPath = getProperty(reportXml, "java.class.path");
  const javaHome = process.env.JAVA_HOME ?? getProperty(reportXml, "java.home");
  const javac = resolve(javaHome, "bin", process.platform === "win32" ? "javac.exe" : "javac");
  const java = resolve(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
  const temp = mkdtempSync(resolve(tmpdir(), "kiara-java-ts-bench-"));
  const separator = process.platform === "win32" ? ";" : ":";

  try {
    writeFileSync(resolve(temp, "JavaTsEquivalentBenchmark.java"), javaBenchmarkSource(), "utf8");
    run(javac, ["-cp", javaClassPath, "JavaTsEquivalentBenchmark.java"], temp);

    const runs = [];
    const budgetFailures = [];

    for (const size of datasetSizes) {
      const javaOut = run(
        java,
        ["-cp", `${javaClassPath}${separator}${temp}`, "JavaTsEquivalentBenchmark",
          String(size), String(warmupIterations), String(timedIterations)],
        temp,
      ).trim();
      const javaRun = JSON.parse(javaOut);
      const tsRun = await runTsBenchmark(size);

      for (const name of WORKLOADS) {
        const javaWorkload = javaRun.workloads.find((item) => item.name === name);
        const tsWorkload = tsRun.workloads.find((item) => item.name === name);
        if (!javaWorkload || !tsWorkload) {
          fail(`Missing workload ${name} in benchmark output for ${size}.`);
        }
        assert.equal(javaWorkload.count, tsWorkload.count, `Count mismatch ${size}/${name}`);
        assert.equal(javaWorkload.count, resolveExpectedCount(name, size), `Expected mismatch ${size}/${name}`);
      }

      budgetFailures.push(...validateBudgets(javaRun, tsRun, size));
      runs.push({ size, java: javaRun, ts: tsRun });
    }

    const output = {
      generatedAt: new Date().toISOString(),
      profile: profile ?? "default",
      warmupIterations,
      timedIterations,
      budgets: BUDGETS,
      rows: datasetSizes,
      runs,
    };

    writeFileSync(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");

    const summaryRows = [];
    for (const runResult of runs) {
      for (const workload of WORKLOADS) {
        const javaWorkload = runResult.java.workloads.find((item) => item.name === workload);
        const tsWorkload = runResult.ts.workloads.find((item) => item.name === workload);
        summaryRows.push({
          rows: runResult.size,
          workload,
          javaP95Ms: Number(javaWorkload.p95Ms.toFixed(3)),
          tsP95Ms: Number(tsWorkload.p95Ms.toFixed(3)),
          p95RatioTsToJava: Number((tsWorkload.p95Ms / Math.max(javaWorkload.p95Ms, 0.0001)).toFixed(2)),
        });
      }
    }
    console.table(summaryRows);
    console.log(`Wrote Java-vs-TS equivalent benchmark report to ${OUTPUT}`);

    if (budgetFailures.length > 0) {
      fail(`Java-vs-TS benchmark budget failures:\n- ${budgetFailures.join("\n- ")}`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
