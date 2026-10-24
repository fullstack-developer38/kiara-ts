# Parity ledger (Java baseline -> TypeScript)

Baseline source of truth remains:

- Kiara Java `develop` @ `568d1addd15e237a5fa2dfaf7538b193d5564773`
- Kiara demo `master` @ `37b36c4031c8163a27293d044ca57fc84f53b8d7`

Status labels:

- **verified**: implemented and covered by current automated tests/fixtures.
- **partial**: implemented but still missing breadth/edge-case evidence.
- **blocked**: explicitly constrained by known compatibility limits.

## A. Java annotation parity (A01-A17)

| ID | Status | Evidence | Remaining gap |
|---|---|---|---|
| A01 `CaseInsensitive` | verified | [entity.test.ts](../src/decorators/entity.test.ts), [search.test.ts](../src/store/search.test.ts) | Locale breadth beyond `en_US` tracked in blocker gates. |
| A02 `CommaSeperatedStrings` | verified | [search.test.ts](../src/store/search.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Add higher-volume row-count differential suites. |
| A03 `CommaSeperatedNumbers` | verified | [operator-parity-matrix.test.ts](../src/query/operator-parity-matrix.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts), [java-corpus-number-collection-null.json](../src/testing/fixtures/java-corpus-number-collection-null.json) | Keep numeric collection fixtures aligned with Java-mode normalization changes. |
| A04 `CommaSeperatedDates` | verified | [secondary-types.test.ts](../src/store/secondary-types.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Expand malformed-date and boundary fixtures. |
| A05 `CommaSeperatedDateTimes` | verified | [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Expand timezone-sensitive fixtures once locale/date gate is closed. |
| A06 `CommaSeperatedNumericRanges` | verified | [numeric-range.test.ts](../src/store/numeric-range.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Add negative/offset prefix edge corpus cases. |
| A07 `CommaSeperatedDateRanges` | verified | [date-range.test.ts](../src/store/date-range.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Add malformed/range-order negative corpus cases. |
| A08 `CommaSeperatedDateTimeRanges` | verified | [date-range.test.ts](../src/store/date-range.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Add larger mixed-range suites. |
| A09 `DateFormat` | verified | [secondary-types.test.ts](../src/store/secondary-types.test.ts), [date.test.ts](../src/normalization/date.test.ts) | Non-default Java pattern parity remains open. |
| A10 `DateTimeFormat` | verified | [secondary-types.test.ts](../src/store/secondary-types.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Pattern/locale breadth remains open. |
| A11 `DateRange` | verified | [date-range.test.ts](../src/store/date-range.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Add malformed endpoint fixtures. |
| A12 `DateTimeRange` | verified | [date-range.test.ts](../src/store/date-range.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Add broader invalid-format fixtures. |
| A13 `NumericRange` | verified | [numeric-range.test.ts](../src/store/numeric-range.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Add signed and large-bound fixtures. |
| A14 `IgnoreIndex` | verified | [search.test.ts](../src/store/search.test.ts), [keyword-search.test.ts](../src/query/keyword-search.test.ts) | Add worker-bridge rejection fixture coverage. |
| A15 `OneEditAway` | verified | [keyword-search.test.ts](../src/query/keyword-search.test.ts), [dictionary-trie.test.ts](../src/text/dictionary-trie.test.ts), [entity.test.ts](../src/decorators/entity.test.ts) | Keep decorator metadata mapping and keyword correction behavior in lockstep. |
| A16 `Predictable` | verified | [dictionary-trie.test.ts](../src/text/dictionary-trie.test.ts), [oracle-java-keyword-smoke.test.ts](../src/testing/oracle-java-keyword-smoke.test.ts), [entity.test.ts](../src/decorators/entity.test.ts) | Keep decorator metadata mapping aligned with keyword prediction behavior. |
| A17 `StemmedIndex` | verified | [keyword-search.test.ts](../src/query/keyword-search.test.ts), [stemming.test.ts](../src/text/stemming.test.ts), [java-expectation-fixtures.test.ts](../src/testing/java-expectation-fixtures.test.ts) | Keep expanding corpus vocabulary breadth. |

## B. Java operator parity (Q01-Q11)

| ID | Status | Evidence | Remaining gap |
|---|---|---|---|
| Q01 `EQUAL` | verified | [search.test.ts](../src/store/search.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Add larger fuzz differential runs. |
| Q02 `NOT_EQUAL` | verified | [search-engine.ts](../src/store/search-engine.ts), [search.test.ts](../src/store/search.test.ts), [java-corpus-collection-contrast.json](../src/testing/fixtures/java-corpus-collection-contrast.json), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Preserve `NOT_EQUAL` full-collection semantics separate from token-based `NOT_CONTAINS`. |
| Q03 `LESS_THAN` | verified | [search.test.ts](../src/store/search.test.ts), [secondary-types.test.ts](../src/store/secondary-types.test.ts) | Extend null ordering coverage. |
| Q04 `LESS_THAN_EQUAL` | verified | [operator-parity-matrix.test.ts](../src/query/operator-parity-matrix.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Expand scalar edge corpus. |
| Q05 `GREATER_THAN` | verified | [secondary-types.test.ts](../src/store/secondary-types.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Expand date-time boundary corpus. |
| Q06 `GREATER_THAN_EQUAL` | verified | [search.test.ts](../src/store/search.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Expand duplicate-key ordering corpus. |
| Q07 `BETWEEN` | verified | [condition.test.ts](../src/query/condition.test.ts), [search.test.ts](../src/store/search.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Add inverted-bound negative fixtures. |
| Q08 `CONTAINS_EITHER` | verified | [search.test.ts](../src/store/search.test.ts), [numeric-range.test.ts](../src/store/numeric-range.test.ts), [date-range.test.ts](../src/store/date-range.test.ts) | Add larger multi-value corpus. |
| Q09 `CONTAINS_ALL` | verified | [search.test.ts](../src/store/search.test.ts), [numeric-range.test.ts](../src/store/numeric-range.test.ts), [date-range.test.ts](../src/store/date-range.test.ts) | Add duplicate-value corpus cases. |
| Q10 `CONTAINS_EITHER_INCLUDING_NULL` | verified | [search-engine.ts](../src/store/search-engine.ts), [search.test.ts](../src/store/search.test.ts), [java-corpus-number-collection-null.json](../src/testing/fixtures/java-corpus-number-collection-null.json), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Keep mixed-null collection fixtures expanded when secondary-type parsing rules evolve. |
| Q11 `NOT_CONTAINS` | verified | [search.test.ts](../src/store/search.test.ts), [numeric-range.test.ts](../src/store/numeric-range.test.ts), [date-range.test.ts](../src/store/date-range.test.ts) | Add mixed-null collection corpus cases. |

## C. Capability parity (F01-F24)

| ID | Status | Evidence | Remaining gap |
|---|---|---|---|
| F01 POJO-backed generic Store | verified | [entity.test.ts](../src/decorators/entity.test.ts), [define-schema.test.ts](../src/schema/define-schema.test.ts) | Keep class/object-path suites in lockstep. |
| F02 Simple data types | verified | [index.ts](../src/index.ts), [operator-parity-matrix.test.ts](../src/query/operator-parity-matrix.test.ts), [search.test.ts](../src/store/search.test.ts), [java-corpus-long-precision.json](../src/testing/fixtures/java-corpus-long-precision.json) | Keep primitive-equivalent mapping fixtures expanded when new scalar coercions are introduced. |
| F03 Field discovery and validation | verified | [entity.test.ts](../src/decorators/entity.test.ts), [define-schema.test.ts](../src/schema/define-schema.test.ts) | Keep schema-validation diagnostics explicit (error code + details) for future validation rules. |
| F04 Row loading | verified | [store.test.ts](../src/store/store.test.ts), [index-builder.ts](../src/store/index-builder.ts) | Preserve row/field normalization diagnostics as loader/normalizer paths evolve. |
| F05 Preparation and commit state | verified | [store.test.ts](../src/store/store.test.ts), [store-loader.ts](../src/store/store-loader.ts) | Add stress cycles in larger differential runs. |
| F06 Deduplicated trie storage | verified | [trie-diagnostics.test.ts](../src/store/trie-diagnostics.test.ts), [search.test.ts](../src/store/search.test.ts) | Add larger shared-prefix corpora. |
| F07 Inverted string/numeric indexes | verified | [index-builder.ts](../src/store/index-builder.ts), [search.test.ts](../src/store/search.test.ts) | Add high-volume differential evidence. |
| F08 Collection full-key index | verified | [search-engine.ts](../src/store/search-engine.ts), [search.test.ts](../src/store/search.test.ts), [java-corpus-collection-contrast.json](../src/testing/fixtures/java-corpus-collection-contrast.json) | Keep collection full-key lookup semantics locked to Java-mode behavior when tokenization changes. |
| F09 Interval/range indexes | verified | [numeric-range.test.ts](../src/store/numeric-range.test.ts), [date-range.test.ts](../src/store/date-range.test.ts) | Add invalid-order negative corpora. |
| F10 Condition input forms | verified | [condition.test.ts](../src/query/condition.test.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Add more constructor-overload parity cases. |
| F11 Full model results | verified | [search.test.ts](../src/store/search.test.ts), [store.ts](../src/store/store.ts) | Add broader type-mapping fixtures. |
| F12 Selected-field results | verified | [projection.test.ts](../src/store/projection.test.ts) | Add parity fixtures for null and enum projections. |
| F13 Query result limits | verified | [store.ts](../src/store/store.ts), [oracle-java-corpus-smoke.test.ts](../src/testing/oracle-java-corpus-smoke.test.ts) | Add more multi-condition limit fixtures. |
| F14 Keyword best match | verified | [keyword-search.test.ts](../src/query/keyword-search.test.ts), [oracle-java-keyword-smoke.test.ts](../src/testing/oracle-java-keyword-smoke.test.ts) | Add larger phrase corpus. |
| F15 Keyword capacity | verified | [keyword-search.test.ts](../src/query/keyword-search.test.ts), [keyword-search.ts](../src/query/keyword-search.ts) | Add overflow matrix fixtures beyond smoke scale. |
| F16 Keyword minimum match | verified | [keyword-search.test.ts](../src/query/keyword-search.test.ts), [oracle-java-keyword-smoke.test.ts](../src/testing/oracle-java-keyword-smoke.test.ts) | Add config-hierarchy corpus when imported. |
| F17 Punctuation cleanup | verified | [keyword-utils.ts](../src/text/keyword-utils.ts), [keyword-search.test.ts](../src/query/keyword-search.test.ts), [keyword-capacity-stress.test.ts](../src/testing/keyword-capacity-stress.test.ts), [java-keyword-extended.json](../src/testing/fixtures/java-keyword-extended.json) | Keep punctuation-heavy corpus cases synchronized with tokenizer updates. |
| F18 One-edit correction | verified | [dictionary-trie.test.ts](../src/text/dictionary-trie.test.ts), [keyword-search.test.ts](../src/query/keyword-search.test.ts) | Add Java fixture breadth for edge lengths. |
| F19 Text predictions | verified | [dictionary-trie.test.ts](../src/text/dictionary-trie.test.ts) | Add rank/tie fixtures from Java outputs. |
| F20 English stemming | verified | [stemming.test.ts](../src/text/stemming.test.ts), [java-expectation-fixtures.test.ts](../src/testing/java-expectation-fixtures.test.ts) | Continue corpus expansion. |
| F21 Diagnostic trie serialization | verified | [trie-diagnostics.test.ts](../src/store/trie-diagnostics.test.ts), [java-expectation-fixtures.test.ts](../src/testing/java-expectation-fixtures.test.ts) | No reload API by design; keep documented. |
| F22 Error taxonomy | verified | [errors.ts](../src/errors.ts), [exception-parity-map.md](./exception-parity-map.md), [in-memory-worker-adapter.test.ts](../src/worker/in-memory-worker-adapter.test.ts), [browser-worker-adapter.test.ts](../src/worker/browser-worker-adapter.test.ts) | Keep mapping synchronized with future error-code additions. |
| F23 Public helpers/diagnostics | verified | [index.ts](../src/index.ts), [index.test.ts](../src/index.test.ts), [oracle-differential-runner.ts](../src/testing/oracle-differential-runner.ts), [oracle-differential-runner.test.ts](../src/testing/oracle-differential-runner.test.ts) | Keep compatibility helper exports and diagnostics format stable unless explicitly versioned. |
| F24 Exposed domain/index types | verified | [store/types.ts](../src/store/types.ts), [schema/types.ts](../src/schema/types.ts), [store.test.ts](../src/store/store.test.ts), [feature-parity.md](./feature-parity.md) | Maintain readonly inspection boundaries; document any newly introduced mutable/nonportable surfaces before release claims. |

## Blocker gate tracking

### Optimized execution evidence (2026-10-24)

Behavioral fixture status above must not be confused with proof of an
algorithm or a cross-language speed claim. Version 1.2.0 adds separate evidence
captured from the 1.1.1-search.0 development candidate:

| Surface | Behavioral compatibility | Algorithm implementation | Performance evidence |
|---|---|---|---|
| F06/F07 trie and inverted indexes | Existing tests plus duplicate/order/inspection tests pass | DFS node postings drive production queries; legacy row views are lazy | Selective equality/combined-query comparison and work counts |
| Q03-Q07 numeric bounds | JAVA/NATIVE and existing operator fixtures pass | Binary-search bound slices, no complete distinct-key scan | 100k-key comparison-count gate and isolated timing pairs |
| F09 ranges | Numeric/date/date-time and collection fixtures pass | Prefix-partitioned balanced interval trees | 100k disjoint-interval pruning gate and isolated timing pairs |
| F14-F20 keyword/dictionary | Existing TS behavior and Java fixture corpus pass; universal Java semantic parity is not claimed | Cached token postings and trie-based one-edit lookup; TS scoring retained | Warm keyword old/new timings and snapshot reuse tests |

See [search execution](./search-execution.md) for source revisions, limitations,
the Java `minimumMatch` distinction, and complete measurements. No Java-versus-TS
or Redis performance conclusion follows from these TS-version comparisons.

Compatibility blockers and closure criteria are tracked in
[blocker-gates.md](./blocker-gates.md).
