import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";

assert.ok(process.env.BENCH_BASELINE_MODULE, "Set BENCH_BASELINE_MODULE to the unchanged baseline dist/index.js.");
const script = fileURLToPath(new URL("./benchmark-search.mjs", import.meta.url));
const candidate = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const results = [];
for (const rows of [10000, 100000]) {
  const runs = { baseline: [], optimized: [] };
  for (let pair = 0; pair < 5; pair++) {
    for (const variant of pair % 2 ? ["optimized", "baseline"] : ["baseline", "optimized"]) {
      const env = { ...process.env, BENCH_ROWS: String(rows), BENCH_QUERY_ITERATIONS: "50",
        BENCH_MODULE: variant === "baseline" ? process.env.BENCH_BASELINE_MODULE : candidate };
      delete env.BENCH_OUTPUT_JSON;
      const run = spawnSync(process.execPath, ["--expose-gc", script], {
        env, encoding: "utf8", timeout: 180000,
      });
      assert.ifError(run.error);
      assert.equal(run.status, 0, run.stderr);
      const { moduleUrl: _moduleUrl, ...data } = JSON.parse(run.stdout);
      runs[variant].push(data);
      console.error(`${rows} rows: pair ${pair + 1}/5 ${variant} finished`);
    }
  }
  const timings = {};
  for (const name of Object.keys(runs.baseline[0].timings)) {
    const baselineP95Ms = median(runs.baseline.map((run) => run.timings[name].p95Ms));
    const optimizedP95Ms = median(runs.optimized.map((run) => run.timings[name].p95Ms));
    timings[name] = { baselineP95Ms, optimizedP95Ms, speedup: baselineP95Ms / optimizedP95Ms };
  }
  const memory = {
    baselineBytes: median(runs.baseline.map((run) => run.preparedHeapBytes)),
    optimizedBytes: median(runs.optimized.map((run) => run.preparedHeapBytes)),
  };
  results.push({ rows, timings, memory, runs });
}
const output = {
  generatedAt: new Date().toISOString(), runtime: process.version, platform: `${process.platform}-${process.arch}`,
  cpu: os.cpus()[0]?.model, pairs: 5, iterationsPerCase: 50, results,
};
await writeFile(new URL("../benchmarks/search-optimization-comparison.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
for (const result of results) {
  for (const [name, timing] of Object.entries(result.timings)) {
    assert.ok(timing.optimizedP95Ms <= Math.max(0.05, timing.baselineP95Ms * 1.10),
      `${result.rows}/${name}: p95 regression beyond budget`);
  }
  assert.ok(result.memory.optimizedBytes <= result.memory.baselineBytes * 1.15, "Prepared memory regression");
  for (const name of ["numeric", "interval"]) {
    assert.ok(result.timings[name].speedup >= 2, `${result.rows}/${name}: less than 2x improvement`);
  }
}
console.log(JSON.stringify(results.map(({ rows, timings, memory }) => ({ rows, timings, memory })), null, 2));
