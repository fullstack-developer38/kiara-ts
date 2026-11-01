# Java search parity: plan and progress

Updated: 2026-11-01.

## Target and boundaries

Reference: Java `kapoorlabs/kiara` commit
`9bbcdc209fed6f4818644501d4bb604b8cf4921d` (2.0.16).
Starting TypeScript revision: `fbae1fc5942abc17b9b322e4fa0a45a72d294b57`
(1.2.0). The audited execution files also match the examples' 1.1.1-search.0
candidate.

The goal is Java-equivalent search behavior and algorithms, followed by
measured JVM-versus-Node performance. These are separate acceptance criteria.
Existing tests or faster-than-array timings do not establish Java parity.

**Compatibility decision:** Java behavior is now the migration target for the
TypeScript engine. Behavior-parity changes are tracked explicitly in this
document and the linked implementation plans so each semantic shift remains
auditable. No release, package publication, or examples dependency replacement
is implied by this tracker update.

The compatible algorithm phase is implemented. The subsequent phases are
specified in the [behavior implementation plan](./java-behavior-parity-implementation-plan.md)
and [README/docs/examples/live-demo migration plan](./java-parity-docs-demo-migration-plan.md).
Those plans have dependencies, concrete acceptance gates and a release boundary;
they are not claims that behavior or Java latency parity is already complete.

## Delivery sequence

1. **Range index representation.** Index each distinct normalized
   `(prefix, lower, upper)` once, with a DFS-ordered posting list. Preserve all
   existing query outputs, limits, null semantics, and normalization profiles.
   Verify 100,000 repeated intervals require at most 200 interval-node visits
   when there are only 200 distinct intervals. Include overlapping lists,
   duplicate intervals, prefixes, and missing values.
2. **Ordered postings and structured execution.** Retain ordered posting groups
   for equality, numeric, collection, and range selection. Replace repeated
   flatten/Set/global-sort steps with Java-style posting-list joins. Instrument
   all candidate visits, ordering work, complements, and limit initialization.
3. **Executable Java contract.** Add a reproducible runner pinned to the Java
   revision and paired cases for every operator/type combination, condition
   order, errors, duplicates, projection shape, and limited results. Keep
   unresolved mismatches explicit; do not bless TS outputs as Java expectations.
4. **Behavioral parity.** After the compatibility decision, implement Java
   operator support, keyword best/minimum matching, Snowball stemming,
   correction, prediction order, and projection/result contracts. Add migration
   examples and tests for both preserved and Java-compatible behavior.
5. **Equivalent-workload performance gate.** Run JVM and Node in separate
   processes on identical data and schema order. Check output equality before
   timing. Measure cold preparation, retained memory, warm p50/p95, and work
   counts separately. Include 10k/100k datasets, fixed match counts, fixed
   percentages, limited results, overlapping ranges, and multi-field keywords.
   Set per-workload budgets from measurements; no numerical budget is approved.
6. **Integration.** Package an explicitly versioned local candidate, exercise
   workers/decorators/examples, rerun native-array comparisons, and update
   articles only from measured results. Do not overwrite historical results.

## Gap tracker

Statuses: pending, in progress, blocked, verified. "Verified" applies only to
the stated scope, not to overall Java parity.

| ID | Gap | Status | Acceptance / next action |
|---|---|---|---|
| R1 | One TS interval entry per trie occurrence rather than distinct range | Verified | Grouped keys and ordered postings; repeated-range bounds, prefix/list/null cases, and 38 historical schedule comparisons pass |
| S1 | Equality/numeric/collection/range candidates flattened and globally sorted | Verified | Lazy reusable posting views and bound-based joins; no global candidate sort; final source-result ordering retained |
| S2 | Caller-order execution versus Java column-order grouping | Verified | Java-style field-order grouping now matches live Java outcomes for mixed-field suppression and same-field invalid-operator precedence |
| S3 | Collection intersections and exclusions expand broad candidate sets | Verified | Ordered single-list intersections, lazy complements, bound slicing and ancestry joins; avoids rechecking predicates already guaranteed by a posting slice |
| S4 | Result limits applied after broad selection/heap initialization | Verified | Bounded adaptive source-order cursor, indexed fallback, lazy roots/siblings and single-leaf jumps; first-five work limits and skew/branch regressions pass |
| S5 | Narrow same-field windows resolved as separate broad halves | Verified | Compatible numeric extents fused before expansion; 100k narrow-window test expands at most 21 keys/postings; additional optimization, not a claim about Java's implementation |
| S6 | Full output walks every suffix node below matching prefixes | Verified | DFS terminal spans reach leaves directly; 6,000 rows visit at most 6,001 trie nodes |
| K0 | Existing TS best-match scoring always scans common token postings | Verified | Cost-guarded rare-posting intersection when a maximum-score match exists; fallback preserves scoring/ties/metadata and minimumMatch |
| B1 | Collection EQUAL, ordered text comparisons, scalar CONTAINS support differs | Verified | TypeScript now matches Java in live contract cases for collection-token EQUAL, text LESS_THAN, and scalar CONTAINS_ALL; keep extending V1 coverage |
| B2 | Projection cardinality, traversal depth, duplicates, ordering, limits differ | Verified | Java-style legacy projection traversal, duplicate full-row collapse, and projection/full-row limit-order behavior are now live-verified (`legacy-projection-shared-prefix-collapse`, `duplicate-full-row-collapse`, `legacy-projection-limit-order`, `full-row-limit-order-after-collapse`) |
| K1 | Token-score bestMatch versus Java keyword-to-field condition combinations | Verified | Java-style keyword-to-field combination search is implemented; tie-selection behavior is covered by live Java contract (`keyword-best-combination-tie-order`) |
| K2 | Lowest-positive-score minimumMatch versus Java best-match postfilter | Verified | minimumMatch now applies Java postfilter semantics over distinct nonnumeric field values; covered by unit/oracle/live cases |
| T1 | Porter-style TS stemming versus Java Snowball English | Verified | Snowball exception behavior now matches live Java for `skies`, `dying`, `lying`, `news`, `proceed`, and `succeed` |
| T2 | Edit-distance enumeration versus Java greedy correction | Verified | Java-style greedy trie correction path is implemented and live-verified for ambiguous correction (`cest -> test`), null-ambiguity (`cests -> null`), hard-filter preconditions, and one-edit capability gating (`without @OneEditAway -> []`, `with @OneEditAway -> [1]`) |
| T3 | Lexical DFS suggestions versus Java breadth-first suggestions | Verified | Prediction traversal now uses Java-style BFS ordering and matches live Java ordering for `lig -> [light, lights, lighter]` |
| T4 | Tokenization/case handling and dictionary eligibility differ | Verified | Bracket handling, case-sensitive/case-insensitive field behavior, and ignore-index dictionary exclusion now match Java live cases, including explicit one-edit eligibility gating surfaces |
| V1 | Existing parity tests do not expose confirmed mismatches | Verified | `npm run test:oracle:live` now verifies 30 Java-vs-TS parity cases, and `npm run test:parity:gate` passes full oracle/operator/accounting gates (`448/448` covered, `0` missing) with zero unexplained mismatches |
| V2 | Performance comparison is TS-to-TS, not Java-to-TS | Verified | Added equivalent-workload JVM/Node benchmark gate (`bench:java-ts:equivalent:ci`) with explicit ratio budgets and persisted evidence in `benchmarks/java-ts-equivalent-benchmark.json` |
| I1 | Examples still use the historical vendored candidate | Pending | Local-module benchmark/differential hooks verified; package/declaration/demo migration deferred to D2-D7 |

## Evidence and acceptance log

### Audit baseline

- Existing operator matrix, algorithm tests, and keyword smoke test: 23 passed,
  despite independently reproduced Java/TS result differences.
- Live probes used an existing JDK 21 and Java build; TS probes used JAVA
  normalization. Examples: collection equality matched in Java but not TS;
  minimum match and best-match ties returned different rows; prefix predictions
  had different order; `skies` stemmed to `sky` in Java and `ski` in TS.
- At 100k schedule records, capacity had 200 distinct ranges but 100,000 TS
  interval entries. A containment probe visited 49,775 interval nodes.
- The audited five-result numeric test visited 100,000 numeric keys and
  postings. Its small terminal-traversal count is not a full-query work bound.
- Range/query CPU sampling found substantial candidate-ordering costs. Closing
  R1 alone does not close S1 or establish Java-level latency.

### R1 completed locally, 2026-11-01

- Interval-tree entries now hold the posting list for one distinct range.
  Prefixes remain separate; repeated copies within the same range-list node
  do not duplicate postings.
- Regression-first check: all three new tests failed before the fix. The
  repeated-range fixture visited 49,516 nodes in both JAVA and NATIVE profiles;
  the gate requires at most 200 for 200 distinct ranges.
- Validation: 14 tests passed across optimized-search, Java-derived structured
  fixtures, and 10k/50k scan-oracle suites. Typecheck and build passed.
- Separate comparison against the examples' unchanged historical package:
  all 19 schedule queries matched old results and the scan reference at both
  10,000 and 100,000 rows, including source order and limits.

| Schedule rows | Capacity containment: interval visits before | After | Matching trie nodes, unchanged |
|---:|---:|---:|---:|
| 10,000 | 4,986 | 101 | 4,719 |
| 100,000 | 49,775 | 101 | 46,891 |

These were interval-work measurements, not an end-to-end latency or Java
performance claim. At this checkpoint S1 was still open; it is completed below.

### Compatible execution phase completed locally, 2026-11-01

- S1/S3: reusable ordered posting groups; numeric cardinality prefix sums;
  ordered intersections; lazy exclusion predicates; bound-sliced descendants
  or ancestor checks, selected using estimated work including ancestry depth.
  Ordered differences avoid rechecking every excluded row's tokens. Alternative
  intersection enumeration retains original slices for later selective joins.
  Posting slices do not repeat predicates already guaranteed by the index.
- S4: source-ordered node cursors have a finite work budget. Skewed data that
  exhausts it restarts through the indexed plan; no partial result escapes.
  Roots/siblings enter the result heap lazily. Single-leaf branches jump to
  their terminal node.
- S5: narrow same-field numeric windows fuse before enumerating either broad
  half. Caller-order validation and prefix emptiness remain unchanged.
- S6: full output uses terminal spans instead of repeatedly walking all suffix
  fields. Source identities, duplicates and final source ordering remain intact.
- K0: bestMatch can probe rare token postings and stop at an existing maximum
  score. Queries without such a result use the original scoring fallback.
  Java keyword semantics, stemming and dictionary behavior are not substituted.

Verification:

- Typecheck/build passed; **176 tests in 34 files** passed.
- **Nine Playwright tests** passed across Chromium, Firefox and WebKit,
  including 50k-row stress, concurrency, cancellation and lifecycle changes.
- **41,344 old/new differential checks** passed against the examples' unchanged
  installed candidate: all five datasets, both normalization profiles, reversed
  conditions, full/projection output, duplicates, nulls, ranges, error precedence,
  zero/negative/fractional/infinite/NaN limits, generated valid/invalid conditions,
  best/minimum keywords, corrections, stemming and metadata. Generated cases
  cover original, reversed and ID-first schema orders.
- **Nine examples benchmark tests** passed using the optimized local module,
  including exact source-order agreement with native filtering.
- First-five numeric search: at most one key, five posting visits, six
  source-order node visits and 20 queued heap entries. Narrow 100k numeric
  window: at most 21 keys/postings and 40 boundary comparisons.
- Full 6k output: at most 6,001 trie visits rather than walking every suffix.
  The rare-keyword regression verifies that the common posting list is not
  iterated; a separate test accepts 150,000 configured keywords without a
  function-argument-limit failure.
- A 10k collection intersection followed by a selective ancestor visits at
  most eight postings and makes at most 32 boundary comparisons. An ordered
  exclusion regression performs no row-token predicate checks.
- A correlated-data regression first reproduced a dropped result when an
  estimated group count was treated as exact. The planner now records an
  independent exact single-group guarantee; the regression and expanded
  differential suite pass.

Reproduce the differential suite from the examples checkout:

```powershell
node scripts\check-search-candidate.mjs '..\Kiara-ts\dist\index.js'
```

Fresh latency evidence is kept separately in the examples'
[optimized report](../../kiara-ts-examples/docs/native-filter-optimized.md)
and [raw results](../../kiara-ts-examples/benchmarks/native-filter-optimized.json).
Historical native/Fuse and 1.2.0 benchmark evidence is not overwritten.

### Three-run measurements

The unchanged installed candidate was also
[rerun separately](../../kiara-ts-examples/docs/native-filter-baseline-repeat.md).
Both runs used the same five datasets, Node version, three isolated trials and
1,000 ms query budget. Each had zero result-agreement failures. These are
medians of per-run p50 values, not direct Java measurements.

| 100k workload | Repeated TS baseline (ms) | Optimized TS (ms) | Baseline / optimized |
|---|---:|---:|---:|
| Catalog rating/stars bounds | 15.2434 | 2.2527 | 6.8x |
| Catalog numeric-list ALL plus category | 5.3355 | 0.6175 | 8.6x |
| Schedule datetime window | 75.2759 | 0.0460 | 1,636x |
| Schedule range containment plus kind | 50.6056 | 4.7174 | 10.7x |
| Schedule range exclusion, first 100 | 33.1501 | 0.0466 | 711x |
| Schedule mixed filters | 58.1754 | 3.5077 | 16.6x |

Against the generic native-filter baseline, the optimized engine is faster in
**85 of 86** shared scenarios. Aggregate ratios are 9.2x retail, 14.9x/22.1x
catalog 10k/100k, and 12.1x/23.2x schedule 10k/100k. The remaining loss is the
100k range-ALL case: 9.86 ms versus 8.94 ms for native filtering.

This is not a universal improvement:

- Three small-latency comparisons regressed by more than 10% in median versus
  the repeated TS baseline: retail numeric lookup 0.0069 -> 0.0103 ms;
  catalog-10k long lookup 0.0046 -> 0.0106 ms; schedule-100k date equality
  0.2582 -> 0.3073 ms. The latter's p95 improved from 1.1345 to 0.3542 ms.
  These remain visible; no global no-regression budget is claimed to pass.
- Full catalog-100k preparation rose from about 3,441 to 3,516 ms and retained
  heap from 453.44 to 477.14 MiB. Schedule-100k preparation rose from 6,172 to
  6,593 ms, while retained heap fell from 804.28 to 760.58 MiB.
- The array baseline is schema-aware full filtering, not a hand-specialized
  callback or an early-exit loop. Neither its ratios nor the TS-to-TS ratios
  establish Java performance parity.

### V1 started: live Java contract probe

- Added [`scripts/java-live-contract-check.mjs`](../scripts/java-live-contract-check.mjs)
  and npm command `test:oracle:live`.
- The command compiles and executes a temporary Java probe class against the
  pinned local Java build classpath from
  `kiara/target/surefire-reports/TEST-com.kapoorlabs.kiara.test.util.SpellCheckUtilTest.xml`,
  then executes equivalent TypeScript cases from the built `dist/` package.
- Current live cases now verify parity for thirty audited behaviors:
  B1/S2/B2 operator and projection semantics, K1/K2 keyword tie/minimum
  semantics, T1 Snowball exception stems, T2 greedy correction tie/null paths,
  T3 BFS prediction order, and T4 bracket plus case-sensitive/case-insensitive
  keyword behavior.
- The live probe is the fast executable bridge; broad contract coverage is
  enforced by `test:parity:gate` through oracle corpus checks, operator matrix
  checks, Java accounting (`448/448` covered), and the equivalent-workload
  benchmark gate.

### B1 parity slice completed locally, 2026-11-01

- Updated operator compatibility and execution semantics to align with Java for:
  collection-token `EQUAL`, ordered text comparisons, and scalar `CONTAINS_*`
  behavior (`NOT_CONTAINS` remains collection-only).
- Added regression coverage in
  [`src/store/search.test.ts`](../src/store/search.test.ts) and updated matrix
  expectations in
  [`src/query/operator-parity-matrix.test.ts`](../src/query/operator-parity-matrix.test.ts).
- Validation:
  - `npx vitest run src/query/operator-compatibility.test.ts src/query/operator-parity-matrix.test.ts src/store/search.test.ts src/store/secondary-types.test.ts src/worker/browser-worker-adapter.test.ts src/worker/in-memory-worker-adapter.test.ts src/testing/oracle-java-corpus-smoke.test.ts`
  - `npm run test`
  - `npm run test:oracle:live` (7/7 parity probe cases now match Java)

### S2 parity slice completed locally, 2026-11-01

- Search execution now orders conditions by schema field position and evaluates
  them in grouped field order, matching Java's column-order merge strategy.
- Unknown or non-indexed fields are validated up front before execution; this
  mirrors Java's pre-execution condition validation path.
- Added precedence regression coverage in
  [`src/store/optimized-search.test.ts`](../src/store/optimized-search.test.ts)
  and a new live Java contract case
  (`column-order-empty-suppresses-later-error`) in
  [`scripts/java-live-contract-check.mjs`](../scripts/java-live-contract-check.mjs).
- The historical TS-vs-TS differential harness in
  `kiara-ts-examples/scripts/check-search-candidate.mjs` now reports expected
  divergences once Java-parity semantics are enabled (for example collection
  `EQUAL` and column-order precedence interactions). V1 live Java contracts are
  now the authoritative gate for behavior changes.

### K1/K2 parity slice completed locally, 2026-11-01

- Replaced row-score keyword selection with Java-style keyword-to-field
  combination evaluation, preserving keyword-count priority while selecting the
  first successful Java-equivalent candidate under ties.
- `minimumMatch` now follows Java's best-match postfilter: keep rows only when
  the number of distinct nonnumeric field values equals the matched keyword
  count.
- Added and validated live Java contract cases in
  [`scripts/java-live-contract-check.mjs`](../scripts/java-live-contract-check.mjs):
  `keyword-best-combination-tie-order` and
  `keyword-minimum-postfilter-cardinality`.
- Validation:
  - `npx vitest run src/query/keyword-search.test.ts src/testing/oracle-java-keyword-smoke.test.ts src/store/optimized-search.test.ts`
  - `npm run build`
  - `npm run test:oracle:live` (9/9 parity probe cases now match Java)

### T1/T2/T3/T4 text-behavior parity slices advanced locally, 2026-11-01

- T1: upgraded stemming behavior with Snowball exception handling in
  [`src/text/stemming.ts`](../src/text/stemming.ts), including parity cases
  for `skies`, `dying`, `lying`, `news`, `proceed`, and `succeed`.
- T2: replaced global edit-distance enumeration in
  [`src/text/dictionary-trie.ts`](../src/text/dictionary-trie.ts) with the
  Java-style greedy one-edit traversal path.
- T3: switched prediction traversal in
  [`src/text/dictionary-trie.ts`](../src/text/dictionary-trie.ts) from lexical
  DFS to Java-style breadth-first ordering.
- T4: aligned keyword sanitization in
  [`src/text/keyword-utils.ts`](../src/text/keyword-utils.ts) with Java
  bracket handling (`a(b)c -> abc`) and case-sensitive keyword matching
  behavior, with live contract coverage for both.
- Added live Java contract coverage in
  [`scripts/java-live-contract-check.mjs`](../scripts/java-live-contract-check.mjs)
  for T1/T2/T3/T4 cases:
  `stemming-*`, `correction-ambiguous-prefers-java-path`,
  `prediction-bfs-order`, `keyword-bracket-token-collapse`,
  `correction-null-ambiguity`, `keyword-case-normalization`, and
  `keyword-case-insensitive-field`.
- Validation:
  - `npx vitest run src/text/dictionary-trie.test.ts src/text/stemming.test.ts src/query/keyword-search.test.ts src/testing/oracle-java-keyword-smoke.test.ts src/store/optimized-search.test.ts`
  - `npm run build`
  - `npm run test:oracle:live` (27/27 parity probe cases now match Java)

### T2/T4 dictionary eligibility parity completed locally, 2026-11-01

- Added live Java contract coverage in
  [`scripts/java-live-contract-check.mjs`](../scripts/java-live-contract-check.mjs)
  for dictionary eligibility boundaries:
  `correction-disabled-without-one-edit`,
  `correction-enabled-with-one-edit`, and
  `ignore-index-keyword-exclusion`.
- These cases close the remaining T2/T4 edge surface from the previous
  checkpoint: correction remains disabled without one-edit capability,
  is enabled when explicitly configured, and ignored-index fields do not
  participate in keyword dictionary matching.
- Validation:
  - `npm run build`
  - `npm run test:oracle:live` (27/27 parity probe cases now match Java)
  - `npm run test`

### B2 parity slice completed locally, 2026-11-01

- `searchLegacyProjection` now executes Java-style projection-depth traversal
  from matched trie nodes rather than materializing source rows first. This
  aligns shared-prefix projection cardinality with Java behavior.
- Java-profile structured search now collapses exact duplicate full-row trie
  leaves to one result, matching Java's deduplicated trie-path behavior.
- Added parity coverage in
  [`src/store/projection.test.ts`](../src/store/projection.test.ts),
  [`src/store/search.test.ts`](../src/store/search.test.ts), and
  [`scripts/java-live-contract-check.mjs`](../scripts/java-live-contract-check.mjs)
  with live cases for shared-prefix projection collapse and duplicate full-row
  collapse. Coverage now also includes a projection limit/order case
  (`legacy-projection-limit-order`).
- Added and validated a full-row limit/order parity case
  (`full-row-limit-order-after-collapse`) in
  [`scripts/java-live-contract-check.mjs`](../scripts/java-live-contract-check.mjs),
  closing the remaining B2 ordering/limit edge in the tracker.

### V1/V2 gate completion, 2026-11-01

- Expanded the live Java contract in
  [`scripts/java-live-contract-check.mjs`](../scripts/java-live-contract-check.mjs)
  with additional deterministic operator cases:
  `collection-contains-either-token`,
  `text-greater-than-equal`, and
  `numeric-between-inclusive`.
- Live parity now verifies **30/30** expectations:
  - `npm run test:oracle:live` (30/30 parity probe cases now match Java).
- Added an equivalent-workload JVM-vs-Node benchmark gate in
  [`scripts/benchmark-java-ts-equivalent.mjs`](../scripts/benchmark-java-ts-equivalent.mjs),
  wired via npm scripts:
  - `bench:java-ts:equivalent`
  - `bench:java-ts:equivalent:ci`
- Persisted reproducible benchmark evidence to
  [`benchmarks/java-ts-equivalent-benchmark.json`](../benchmarks/java-ts-equivalent-benchmark.json),
  including prepare-time, retained-memory, and per-workload warm p50/p95 metrics
  for 10k and 100k rows with explicit budget checks.
- Updated release gating script to include this benchmark:
  [`package.json`](../package.json) `test:parity:gate`.
- Validation:
  - `npm run test:oracle:live` (30/30 parity probe cases now match Java)
  - `npm run bench:java-ts:equivalent:ci`
  - `npm run test:parity:gate`

### Remaining boundaries

I1 (examples/docs/demo migration execution) is still pending and tracked in
[`docs/java-parity-docs-demo-migration-plan.md`](./java-parity-docs-demo-migration-plan.md).

Complete output still costs work proportional to returned rows, and sorting
full results into source order remains. Low-selectivity joins, overlapping
ranges, caller-order empty checks and skewed limited queries can still do
substantial work. The adaptive cursor is not a universal sublinear guarantee.
Preparation and memory costs must be measured alongside query savings.

No version bump, commit, publication, vendored dependency replacement or
deployment was performed.
