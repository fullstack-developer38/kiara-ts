# Java behavior parity implementation plan

Status: in progress; behavior slices B1, B2, S2, K1, K2, T1, T2, T3, T4, V1, and V2 are implemented locally, while examples/docs/demo rollout (I1, D2-D7) remains open before release approval.
See the [gap tracker](./java-search-parity-plan.md) for completed, compatible
execution optimizations and the [documentation/demo migration plan](./java-parity-docs-demo-migration-plan.md)
for the subsequent rollout.

## Contract and compatibility boundary

Pin Java 2.0.16 at `9bbcdc209fed6f4818644501d4bb604b8cf4921d`,
the reference JDK, locale, and timezone. Do not substitute mutable Java HEAD.
The existing JAVA normalization profile is **not** a Java search-behavior mode.
Do not change its meaning in a patch release.

Before implementation, decide between:

1. An explicit Java-compatible search mode, retaining current TS defaults.
2. A major release that changes the defaults, with a documented migration path.

Recommendation: first build the explicit mode to permit side-by-side testing;
decide separately whether a major release should make it the default. This is
a proposal, not a decision already made. Define the supported profile/mode
combinations, output casing/types, and whether legacy behavior remains available.
Record intentional TypeScript API differences separately from semantic parity.

## Work packages and dependencies

| ID | Scope / implementation surfaces | Depends on | Acceptance |
|---|---|---|---|
| P0 | Approve compatibility, reference runtime, output/error mapping, and performance targets | None | Written contract; no ambiguous use of "JAVA" |
| P1 | Live Java/TS contract runner, expanding the existing oracle infrastructure | None; final mappings need P0 | Reproduces each audited mismatch before fixes; captures raw results and pinned provenance |
| P2 | Structured operators and column-ordered validation/planning: search engine, operator compatibility, condition validation | P0, P1 | Complete operator/type matrix; permutation, null, error, and short-circuit cases |
| P3 | Tokenization, Snowball stemming, correction and BFS prediction | P0, P1 | Shared vocabulary and dictionary fixtures match; legacy cases remain unchanged if supported |
| P4 | Java best/minimum keyword selection and metadata | P2, P3 | Assignments, ties, limits and hard filters match live Java; bounded stress suite |
| P5 | Projection traversal, result identity/order/cardinality, duplicate and limit rules | P0, P1; integrate with P2/P4 | Full rows and projections independently match; no post-hoc deduplication workaround |
| P6 | JVM/Node performance gate and profiling | P2-P5 | Exact equivalent outputs first; agreed per-query latency budgets pass |
| P7 | Release readiness of the versioned package and examples | P6 and D1-D6 from the documentation/demo plan | Package, declarations, workers and demo use one validated version and behavior; D7 handles approved publication |

P1 can start before the compatibility decision. P3 and P5 can proceed
independently after the contract is approved. Do not serialize all work merely
because the table lists it sequentially.

## P1: make the reference executable

- Extend the existing `src/testing` oracle runner rather than creating another
  TS-only suite named "Java parity." Add a small pinned Java adapter and a
  subprocess-based Node driver, usable locally and in CI.
- Initial bridge is in place: [`scripts/java-live-contract-check.mjs`](../scripts/java-live-contract-check.mjs)
  (`npm run test:oracle:live`) compiles/runs a temporary Java probe and compares
  outputs against built TypeScript behavior for thirty audited parity cases
  (B1/S2/B2/K1/K2/T1/T2/T3/T4 slices). Expand this bridge into the full contract corpus
  below.
- Use one versioned case format: schema/annotation order, source rows, profile,
  conditions, keyword options, projection, limit and expected operation.
  Preserve duplicate source-row identities and input order.
- Encode bigint, decimal, null/missing, dates and errors explicitly. Store
  raw Java and TS responses alongside any approved API-shape mapping. Never
  sort result arrays to hide ordering mismatches or coerce all values to text.
- Seed the corpus with the reproduced gaps: collection EQUAL, scalar CONTAINS,
  text ordering, best-match ties, minimum-match filtering, shared-prefix
  projections, `cart` exact correction, `car` predictions and Snowball exceptions.
- Add generated small cases for all operator/type pairs, condition permutations,
  ignored/unknown fields, empty datasets/conditions, invalid values, inclusive
  bounds, overlapping/prefixed ranges, duplicate tokens/rows and unusual limits.
- Run tied-result cases in fresh Java processes. If Java order is unspecified
  or runtime-dependent, document that explicitly; do not invent a stable order
  and label it parity.
- Replace unqualified parity claims in CI documentation. Keep a reviewed
  expected-mismatch ledger while migrating, with case IDs and removal tasks.
  The release gate must have zero unexplained mismatches.

## P2: structured behavior

Implement Java's field-order condition grouping and validation before execution,
including the case where an empty earlier predicate currently suppresses a later
error in TS. Preserve the new lazy postings/joins behind that contract.

Cover scalar text/enum/numeric/date/boolean fields and every collection/range
secondary type. Resolve collection EQUAL, ordered text comparisons, scalar
CONTAINS operators, empty/null lists, range exclusions and NOT_EQUAL using live
cases, not assumptions about conventional SQL or JavaScript behavior.

Acceptance includes both argument orders for contradictory conditions and
empty-result/error combinations. Validate decorators and schema builders produce
equivalent behavior. Do not reorder the schema itself for compression.

## P3-P4: text and keyword behavior

- **Stemming:** use Snowball English semantics, including exceptions such as
  `skies`, `dying`, `lying`, `news`, `proceed`, and `succeed`. Review license and
  provenance before incorporating an implementation; preserve browser support
  and the zero-runtime-dependency promise or explicitly approve a change.
- **Dictionary/correction:** match Java's dictionary eligibility and greedy
  one-edit traversal, exact-word handling, ambiguous edits, and scope under
  hard filters. Keep insertion/order effects visible in tests.
- **Prediction:** BFS rather than lexical DFS; test unequal word lengths,
  prefixes that are complete words, limits, punctuation and case normalization.
- **Tokenization:** pin punctuation, whitespace, Unicode, numeric words, casing,
  stemmed/nonstemmed fields, ignored indexes and dictionary construction.
- **Best match:** port keyword-to-field assignments and first successful
  best-scoring combination, rather than adapting the current row-score rule.
  Reuse prepared postings and structured joins; pruning must preserve Java's
  tie selection, not merely its maximum score.
- **Minimum match:** apply Java's best-result postfilter based on distinct
  nonnumeric values. It is not the lowest positive token score.
- Define TS-only metadata (`matchedKeywords`, `usedKeywords`, corrections and
  truncation) explicitly; do not claim a Java API equivalent where none exists.
- Stress repeated terms, correction collisions, raw/stem collisions, zero
  eligible rows, default/explicit fields, many indexed fields, and maximum
  keyword count. Detect combinatorial blowups before adopting an optimization.

## P5: result and integration contract

Implement Java's projection-depth traversal directly. A shared prefix may
produce one projected result where legacy TS produces two; deduplicating
materialized objects is not an equivalent algorithm.

Pin column casing and value representation, source duplicates, full-row versus
projection order, and when limits apply. Test negative, fractional, zero and
unbounded limits explicitly instead of inheriting accidental coercions.
Document any deliberate JS API restrictions in the approved mapping.

Wire the chosen behavior through store construction, replacement snapshots,
StoreLoader, schema/decorator examples, keyword search, QueryInterpreter,
in-memory and browser worker adapters, and worker request/response types.
Mixed-mode snapshots must not share incompatible cached indexes/dictionaries.
Keep application-specific configuration precedence separate from library search.

## P6: measure actual Java parity

Reuse the dataset definitions and Java benchmark infrastructure in
[`kiara-demo/benchmarks`](../../kiara-demo/benchmarks) and the TS examples'
benchmark harness. Their existing reports use different competitors and are
not an interchangeable Java/TS comparison.

1. Share serialized input rows, seed, schema order, query parameters and
   operation/output shape. Verify complete outputs outside the timed region.
2. Run separate JVM and Node processes on the same machine, alternating at
   least five paired trials. Record runtime versions, commit/tree/package
   hashes, heap settings, locale, GC policy and environment.
3. Warm both runtimes to stable measurements, not just three calls. Measure
   preparation, optional keyword indexing, retained heap/RSS, warm p50/p95 and
   throughput separately. Exclude process startup and protocol serialization
   from query timings; report them separately if relevant.
4. Include 10k and 100k cases with fixed result counts, fixed match fractions,
   first-N limits, empty matches, distinct/repeated/overlapping ranges,
   skewed source order, wide schemas, projections and keyword ties.
5. Proposed starting budgets, **not yet approved**: TS p50 within 10% and p95
   within 20% of Java for each stable, equivalent workload, with no unexplained
   >10% regression against the compatible TS baseline. Calibrate timing noise
   and tiny-operation batching before adopting these as gates. Report memory
   and preparation tradeoffs explicitly; agree their budgets separately.
6. Investigate every failing workload with whole-query counters/profiles.
   Aggregate geometric means cannot waive a per-query failure. Neither
   array-filter wins nor TS-to-TS speedups count as Java latency parity.

## Completion and rollback

Release requires a zero-unexplained-difference live contract gate, accepted
performance budgets, legacy-mode regression coverage if retained, passing
browser/worker tests, and the linked documentation/demo migration checklist.
Maintain an exact previous package and deployable demo artifact for rollback.
No publishing, production deployment or irreversible default change is
authorized by this plan.
