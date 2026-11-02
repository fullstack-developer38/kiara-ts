# Changelog

All notable changes to this project will be documented in this file.

## [1.2.1] - 2026-11-01

Search behavior now follows the Java Kiara reference implementation
(2.0.16). Several results change; review **Migration** before upgrading.

### Changed
- **Operators.** Scalar text, enum, boolean, number and date fields accept
  ordered comparisons (`LESS_THAN` … `BETWEEN`) and `CONTAINS_EITHER`,
  `CONTAINS_ALL` and `CONTAINS_EITHER_INCLUDING_NULL`. `NOT_CONTAINS` remains
  limited to collections and ranges. Collection `EQUAL` matches an individual
  member instead of the whole serialized value.
- **Evaluation order.** Conditions run in schema field order, not caller order.
  When an earlier field matches nothing, later conditions are not evaluated, so
  an invalid later condition may return `[]` instead of throwing.
- **Duplicates and projections (`JAVA` profile).** Identical source rows are
  returned once. `searchLegacyProjection` collapses rows that share the selected
  values, and returns stored values such as `"7.70"` rather than `"7.7"`
  (both profiles).
- **Keyword search.**
  - Spelling correction applies only to fields marked `oneEditAway` or
    `predictable`; previously every searchable text field was corrected.
  - Correction follows Java's single greedy trie path. Typos near the start of
    a word may not be corrected, and a correction can be an incomplete word.
  - Matching is case-sensitive unless the field is `caseInsensitive`.
  - `bestMatch` chooses among ties in Java's keyword-to-field combination order.
  - `minimumMatch` returns best-match rows whose populated non-numeric values
    are exactly the matched keywords. It was the lowest positive score.
  - Without a `limit` option, keyword search returns every match; 1.2.0 capped
    keyword results at 100.
- **Text processing.** English stemming keeps Snowball exceptions
  (`skies → sky`, `dying → die`, `news`). Brackets are removed without
  splitting words (`a(b)c → abc`); only Java's punctuation set is replaced.
- **Predictions.** `DictionaryTrie.predict` returns words breadth-first
  (shorter completions first), not alphabetically.

### Added
- Live Java-vs-TypeScript contract check (`npm run test:oracle:live`) and an
  equivalent-workload benchmark (`npm run bench:java-ts:equivalent`); both need
  a local Java Kiara build.

### Performance
- Narrower index joins and earlier limits; on the examples benchmark, median
  query latency versus `Array.filter` improved from 3.4–8.8× to 8.6–22×.

### Migration
- Add `oneEditAway: true` to fields that should be spell-corrected.
- Add `caseInsensitive: true` to fields searched with user-typed keywords.
- Replace `minimumMatch` calls that relied on "lowest positive score"; use
  `bestMatch` or filter `bestMatch` results yourself.
- Pass `limit: 100` to keyword searches that relied on the old default cap.
- If you need duplicate source rows, use `NormalizationProfile.NATIVE`.
- Do not rely on validation errors from conditions on later schema fields.
- Update assertions on prediction order and legacy projection values.

## [1.2.0] - 2026-10-24

### Changed
- Execute structured queries through DFS-bound trie-node postings, binary-search
  numeric bounds, and prefix-partitioned interval trees.
- Materialize qualifying records selectively; apply source-order limits without
  expanding every matching path.
- Reuse snapshot-scoped keyword postings/dictionaries and prune one-edit trie
  searches while preserving existing TypeScript best/minimum-match behavior.
- Materialize legacy prepared-data inspection views lazily.

### Fixed
- Distinguish collection identities that would collide when delimiter-joined.
- Avoid lossy Number coercion in mixed number/bigint ordering.

### Added
- Algorithmic work-count tests and reproducible old/new benchmark comparison.
- [Execution and compatibility documentation](./docs/search-execution.md).

## [1.1.0] - 2026-10-23

### Added
- Opt-in `QueryInterpreter` with schema-aware field/value aliases, cross-field
  whole-value discovery, explicit comparisons, inclusive numeric ranges,
  canonical-unit conversion, ambiguity confirmation, and strict execution.
- Serializable interpretation results and source-span-based chip editing through
  `editQueryFragment`; no UI framework or runtime dependency required.
- A CI-enforced 100% statement, branch, function, and line coverage gate for the
  interpreter module.

## [1.0.0] - 2026-10-18

### Added
- Typed schemas and decorators for defining searchable records.
- Structured filters, collection membership, and null-aware queries.
- Numeric, date, and date-time range searches.
- Keyword search, typo correction, stemming, and prefix predictions.
- Selected-field projections, result limits, and worker adapters.
- Runnable schema, decorator, and worker examples.

### Changed
- Package metadata hardened for public npm publication:
  - package renamed to `@kapoorlabs/kiara-ts`
  - `private` disabled
  - MIT license metadata
  - ESM entry points/exports and type declarations wired to `dist/`
  - explicit publish access and packed files list
