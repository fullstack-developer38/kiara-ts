import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const moduleUrl = process.env.BENCH_MODULE
  ? pathToFileURL(process.env.BENCH_MODULE).href : new URL("../dist/index.js", import.meta.url).href;
const { Store, StoreLoader, KeywordSearch, NormalizationProfile, defineSchema, textField, numberField } = await import(moduleUrl);
const size = Number(process.env.BENCH_ROWS ?? 10000);
const iterations = Number(process.env.BENCH_QUERY_ITERATIONS ?? 50);
assert.ok(Number.isSafeInteger(size) && size >= 100 && size <= 1000000);
assert.ok(Number.isSafeInteger(iterations) && iterations >= 10);
const rows = Array.from({ length: size }, (_, id) => ({
  group: `g${id % 10}`, score: id,
  window: `${id * 10}->${id * 10 + 4}`, title: `Item ${id} searchable`,
}));
const schema = defineSchema([
  textField("group"), numberField("score"),
  textField("window", { secondaryType: "numericRange" }), textField("title", { stemmedIndex: true }),
]);
global.gc?.();
const initialHeap = process.memoryUsage().heapUsed;
const store = new Store(schema, { normalizationProfile: NormalizationProfile.NATIVE });
store.loadRows(rows);
const prepareStart = performance.now();
store.prepare();
const prepareMs = performance.now() - prepareStart;
const prepareMaxRssKiB = process.resourceUsage().maxRSS;
global.gc?.();
const preparedHeap = process.memoryUsage().heapUsed - initialHeap;
const search = new KeywordSearch(store);
const cases = {
  equality: { run: () => store.search([{ field: "score", operator: "EQUAL", values: [size - 1] }]), count: 1 },
  numeric: { run: () => store.search([{ field: "score", operator: "BETWEEN", lowerValue: size - 20, upperValue: size - 1 }]), count: 20 },
  interval: { run: () => store.search([{ field: "window", operator: "CONTAINS_EITHER", values: [(size - 1) * 10 + 2] }]), count: 1 },
  combined: { run: () => store.search([
    { field: "group", operator: "EQUAL", values: ["g9"] },
    { field: "score", operator: "BETWEEN", lowerValue: size - 20, upperValue: size - 1 },
  ]), count: 2 },
  broad: { run: () => store.search([{ field: "score", operator: "GREATER_THAN_EQUAL", values: [0] }], 100), count: 100 },
  full: { run: () => store.search([{ field: "score", operator: "GREATER_THAN_EQUAL", values: [0] }]), count: size },
  excluded: { run: () => store.search([{ field: "group", operator: "NOT_EQUAL", values: ["g0"] }], 100), count: 100 },
  keyword: { run: () => search.bestMatch(`item ${size - 1}`, { fields: ["title"] }).results, count: 1 },
};
const timings = {};
for (const [name, { run, count }] of Object.entries(cases)) {
  for (let i = 0; i < 10; i++) assert.equal(run().length, count);
  const durations = [];
  let result;
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    result = run();
    durations.push(performance.now() - start);
  }
  assert.equal(result.length, count);
  if (name !== "broad" && name !== "excluded") assert.ok(result.some((row) => row.score === size - 1));
  if (name === "full") assert.deepEqual(result.map((row) => row.score), rows.map((row) => row.score));
  if (name === "excluded") {
    assert.deepEqual(result.map((row) => row.score), rows.filter((row) => row.group !== "g0").slice(0, 100).map((row) => row.score));
  }
  durations.sort((a, b) => a - b);
  const percentile = (p) => durations[Math.ceil(durations.length * p) - 1];
  timings[name] = { count, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) };
}
global.gc?.();
const afterKeywordHeapBytes = process.memoryUsage().heapUsed - initialHeap;
const replacementStart = performance.now();
const replacement = new StoreLoader(store).replaceAll(rows);
const replacementPrepareMs = performance.now() - replacementStart;
const replacementMaxRssKiB = process.resourceUsage().maxRSS;
global.gc?.();
const coexistHeapBytes = process.memoryUsage().heapUsed - initialHeap;
assert.equal(replacement.queryAll().length, store.queryAll().length);
const result = {
  runtime: process.version, rows: size, iterations, moduleUrl, prepareMs, preparedHeapBytes: preparedHeap,
  afterKeywordHeapBytes, prepareMaxRssKiB, replacementPrepareMs, replacementMaxRssKiB, coexistHeapBytes, timings,
};
console.log(JSON.stringify(result, null, 2));
if (process.env.BENCH_OUTPUT_JSON) await writeFile(process.env.BENCH_OUTPUT_JSON, `${JSON.stringify(result, null, 2)}\n`);
