# Optimized search execution

Included in **1.2.0** on 2026-10-24. The measurements below were captured from
the **1.1.1-search.0** development candidate; the raw evidence retains that
version label. See the [GitHub release](https://github.com/kapoorlabs/kiara-ts/releases/tag/v1.2.0)
for distribution and validation status.

## Unreleased compatible follow-up

The current working tree additionally implements:

- One interval entry per distinct normalized range/prefix, with ordered postings.
- Lazy posting-group views instead of flattened candidate sets and a global
  candidate sort; ordered intersections and bound-sliced ancestry joins.
- Lazy exclusions and compatible same-field numeric bound fusion.
- Bounded source-order cursors for suitable limited queries, with indexed
  fallback on skewed data; lazy heap roots/siblings and single-leaf jumps.
- Terminal spans for full output, avoiding traversal of every suffix field.
- A cost-guarded rare-token fast path for existing TS best-match scoring.

See the [posting planner](../src/store/posting-plan.ts) and
[gap tracker](./java-search-parity-plan.md). Typecheck/build, 176 unit tests,
nine browser-worker tests and 41,344 old/new differential checks pass.
Current TS result/error/keyword semantics are preserved. Java behavior changes
and actual JVM/Node performance comparison remain future gated phases.

These changes add index metadata and heuristic planning; they do not make every
query constant-time. Full output still materializes returned rows and sorts
their IDs into source order. Overlap, low selectivity, prefix emptiness checks
and source-order skew can require substantial candidate work.

The [new native-filter measurements](../../kiara-ts-examples/docs/native-filter-optimized.md)
are separate working-tree evidence. **All release timings and verification
counts below are historical and have not been regenerated.**

## Released 1.2.0 architecture

The production structured-search path now uses:

- A shared field-value trie, parent/child links, and DFS entry/exit bounds.
- Per-field inverted postings that reference trie nodes, not copied records.
- Binary-search bounds for numeric comparisons and BETWEEN.
- Prefix-partitioned balanced interval trees with subtree maximum endpoints.
- Same-field node intersection and cross-field ancestry matching. When one
  side is smaller, matching chooses the corresponding bound-search direction.
- Terminal-path materialization. Selective queries do not initialize a
  whole-row universe Set or sweep source rows.
- Source-order result limits using a priority queue of matching branches.
  This prevents a small limit from forcing full result expansion/sorting.
- Snapshot-scoped, lazily built token/stem postings and dictionaries for
  keyword search; repeated queries do not retokenize all source text.
- Trie-pruned one-edit candidates and cached prefix-child ordering.

See the [execution index](../src/store/execution-index.ts),
[ordered/interval primitives](../src/store/ordered-index.ts),
[query engine](../src/store/search-engine.ts), and
[keyword integration](../src/query/keyword-search.ts).

Field order remains part of the schema; it is not automatically rearranged for
compression. Source records are retained for source identity and typed output.
Shared trie paths retain terminal row identities rather than copying descendant
row IDs into every execution node.

## Compatibility boundaries

The Java algorithm reference is `5f61c4761bd5ca391fa89dc98897a18f0d81e83f`.
The previous TS source baseline was
`c410514edd2441ccca887ddaeaa4cda27a2bfb80`, packaged as 1.1.0.

This is **Java-style structured execution**, not a claim that every Java and
TypeScript API or algorithm is identical:

- Conditions are resolved in caller order to preserve existing validation and
  empty-result precedence; their matches use same-level intersection and DFS
  ancestry joins.
- JAVA and NATIVE normalization remain distinct. Ordered numeric comparisons
  avoid coercing bigints to imprecise Numbers.
- Existing scalar-versus-collection operator behavior is preserved, including
  collection membership through CONTAINS operators and rejection of missing
  ranges by the existing range NOT_CONTAINS contract.
- TypeScript `bestMatch` and `minimumMatch` retain their existing positive
  token-score semantics. Java's keyword-to-field search and minimum-match
  postfilter are not silently substituted. Cached postings optimize the TS
  behavior without introducing Java's combinatorial keyword enumeration.
- Corrections remain scoped to records allowed by hard conditions. An exact
  word or correction found only in excluded rows must not affect the query.
- Source row ordering, duplicates, projection types, and result-limit behavior
  remain covered. Configuration precedence still belongs to the application.
- Records are read-only after preparation, as before. Replace a snapshot to
  refresh searchable data; do not mutate records behind prepared indexes.

The public prepared-data and diagnostic shapes remain available. Legacy row
indexes, normalized-row maps, and diagnostic descendant lists are materialized
**lazily when requested**, not duplicated eagerly for production execution.
Inspection therefore has its own memory cost. A derived snapshot does not
constitute a supported writable index API.

Trie edge identities now distinguish delimiter-bearing collection values from
multi-token collections. Legacy diagnostic child labels are retained, with a
node-ID suffix only if two distinct values would otherwise collide. Full-key
collection comparison uses unambiguous identities as well.

## Verification

- **453 live Java tests passed** on the pinned Java revision, using a
  session-local Temurin JDK 17.0.20.1 and the repository's Maven wrapper.
- **165 TypeScript tests passed**, including eight new optimized-search tests.
- The existing Java fixture, scale, operator-matrix, and test-accounting gates
  passed. The historical accounting corpus covers 448 declarations; this is
  separate from the 453 tests executed in the current Java checkout.
- **2,202 old/new differential checks** against the unchanged installed 1.1.0
  package passed for structured output/errors, JAVA/NATIVE profiles, limits,
  keyword variants, and best/minimum matching.
- **Nine Playwright checks passed** across Chromium, Firefox, and WebKit,
  including worker lifecycle, 50k-row stress, concurrency, and cancellation.

The [algorithm tests](../src/store/optimized-search.test.ts) verify actual work:

- At most 38 boundary comparisons for a 20-key slice of 100,000 numeric keys.
- At most 128 interval-node visits for a point in 100,000 disjoint intervals.
- Only 20 source rows materialized for 20 results, with no reads of the legacy
  row-universe/index views.
- A broad query limited to five results visits at most ten trie nodes in its
  controlled fixture.
- Dictionary reuse, source-order limits, duplicates, shared paths, partial
  keyword matching, candidate-scoped correction, and replacement isolation.

These bounds describe the specified fixtures, not all possible workloads.
Overlapping intervals and queries returning most records can require work
proportional to their candidates/results.

## Measured comparison with TypeScript 1.1.0

[Raw results](../benchmarks/search-optimization-comparison.json) include all
five isolated process pairs at each size, alternating execution order.
Each case used ten warmups and 50 measurements per process under Node 24.22.1
on Windows x64. The following values are the **median per-run p95** in
milliseconds, not a universal latency guarantee.

| Case | 10k baseline | 10k optimized | 100k baseline | 100k optimized |
|---|---:|---:|---:|---:|
| Equality, one result | 1.592 | 0.015 | 16.613 | 0.014 |
| Numeric band, 20 results | 1.621 | 0.045 | 18.892 | 0.045 |
| Interval containment, one result | 3.858 | 0.010 | 34.882 | 0.011 |
| Combined filters, two results | 1.496 | 0.027 | 21.323 | 0.032 |
| Broad numeric query, limit 100 | 4.454 | 2.769 | 45.017 | 21.212 |
| Full numeric result set | 6.236 | 2.916 | 90.258 | 38.996 |
| Exclusion, limit 100 | 2.572 | 0.536 | 36.566 | 8.782 |
| Warm keyword search, one result | 44.915 | 3.542 | 490.541 | 27.340 |

Retained prepared-store heap was about **13% lower at 10k** and **14% lower at
100k** before lazy text/diagnostic caches. Keyword caches deliberately retain additional memory. At 100k rows, retained
heap after warming text queries was 258.4 MB baseline versus 277.3 MB optimized.
With old and replacement snapshots coexisting, it was 517.7 MB versus 500.7 MB.
Preparation median was 1,310 ms versus 870 ms; replacement preparation was
1,170 ms versus 835 ms.

The raw runs record process RSS high-water marks immediately after preparation
and replacement. These include earlier process allocations and are not isolated
heap peaks for a single operation. At 100k, the median high-water after
replacement was 1,630,508 KiB baseline versus 770,988 KiB optimized.

This is a synthetic, deterministic workload comparison against the previous TS
implementation, **not against Java or Redis**. Very small optimized timings
approach the measurement floor; operation counts are stronger algorithmic
evidence than huge speedup ratios. Peak preparation memory, production-tail
latency, and a Java-versus-TS performance comparison are not established here.

All eight measured query cases met the proposed 10% p95 regression budget;
prepared heap met the 15% budget; selective numeric and interval cases exceeded
the 2x improvement target. The original smoke benchmark gate also passed.

## Reproduce

```powershell
npm run test:algorithm
npm run typecheck
npm test
npm run test:parity:gate
npm run test:playwright
```

For the isolated old/new comparison, retain an unmodified installation of
1.1.0, set its absolute entry point, and run:

```powershell
$env:BENCH_BASELINE_MODULE = 'C:\path\to\baseline\node_modules\@kapoorlabs\kiara-ts\dist\index.js'
npm run bench:search:compare
```

The comparison runs serially, writes its evidence, and fails if its budgets
are exceeded. It does not automatically replace performance thresholds.

## Downstream validation

Build and pack the release; do not patch a consumer's installed package.
The examples repository can consume a local tarball under its own vendor
directory so its installation is reproducible without publishing a prerelease.
Run the examples' complete tests/build against that package before release.
