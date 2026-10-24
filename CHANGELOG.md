# Changelog

All notable changes to this project will be documented in this file.

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
