# Documentation, examples and live-demo migration plan

Status: in progress. Library README, usage guide, CHANGELOG, execution docs,
demo script, examples README, guided examples, business labs, type-ahead text
and example tests are updated for 1.2.1 (D1-D4). Articles and article snippet
tests (D5), npm-registry dependency switch, and hosted-demo deployment (D6-D7)
remain.

## Source of truth

Use the live Java fixture corpus and approved compatibility decision for every
operator table, expected result and before/after example. Track one candidate
version and package integrity hash across the library, vendored examples,
declarations, workers and built browser assets.

The examples currently document a local Vite URL, not a verified hosted
deployment. **Hosting URL, deployment owner, pipeline, base path and rollback
procedure must be confirmed before the live-demo step.** Do not invent a URL
or treat a successful local build as a production deployment.

## File and surface inventory

| Surface | Files / locations | Required changes and verification |
|---|---|---|
| Library entry points | [README](../README.md), [usage](./usage.md), CHANGELOG | Version/default/mode terminology; operator support; normalization versus behavior; breaking changes, limits, projection examples and migration snippets |
| Parity claims and gates | [feature parity](./feature-parity.md), [parity ledger](./parity-ledger.md), [migration plan](./migration-plan.md), [exception map](./exception-parity-map.md), [Java test accounting](./java-test-accounting.md), [blocker gates](./blocker-gates.md), [CI checks](./ci-required-checks.md), [gap tracker](./java-search-parity-plan.md) | Replace inferred parity with linked live cases; separate coverage counts from semantic/performance equivalence; update required checks and exclusions |
| Execution/performance | [search execution](./search-execution.md), historical benchmark JSON/docs | Explain new algorithms and remaining costs; add versioned Java/TS evidence without rewriting historical timings |
| Library runnable examples | [demo README](../examples/demo-repo/README.md), [demo script](../examples/demo-repo/run-demo.mjs), decorator/schema snippets in README/usage, [old demo plan](./demo-plan.md) | Execute both construction styles; update output cardinality/order and mode configuration; distinguish the old design plan from the shipped playground |
| Playground setup/API guide | [examples README](../../kiara-ts-examples/README.md), package.json, package-lock.json, vendor tarball | Install the exact candidate only after contract gates; update all setup instructions, operator tables, semantic notes and version references |
| Guided queries | [examples](../../kiara-ts-examples/src/examples.ts), [query](../../kiara-ts-examples/src/query.ts), [datasets](../../kiara-ts-examples/src/datasets.ts), [main](../../kiara-ts-examples/src/main.ts) | Re-evaluate all 44 existing examples; revise explanations and expected rows/counts, not just tests; show selected behavior clearly |
| Editor and type help | [editor](../../kiara-ts-examples/src/editor.ts) | Synchronize bundled declarations, API allow-list/signatures, operator/field suggestions, hover text and starter snippets; no stale legacy signatures |
| Airport typeahead | [typeahead](../../kiara-ts-examples/src/typeahead.ts), [application examples](../../kiara-ts-examples/src/application-examples.ts) | Explain BFS suggestion order and changed correction rules; test keyboard selection and displayed limits against actual output |
| Runtime configuration | [runtime config](../../kiara-ts-examples/src/runtime-config.ts), application views | Revalidate minimum-match rules, tie selection and fallbacks; keep application-owned precedence explicit; never silently select a different effective configuration |
| Parts/range finder | [parts engine](../../kiara-ts-examples/src/parts-finder.ts), [view](../../kiara-ts-examples/src/parts-finder-view.ts) | Check endpoint/null/range operator behavior and projection totals; retain missing values rather than inventing specifications |
| Business labs | [engines](../../kiara-ts-examples/src/business-demos.ts), [views](../../kiara-ts-examples/src/business-demo-view.ts) | Recheck product ranking/counts, correction/stemming metadata, compatibility sets, stored ranges, refresh, CSV mapping/export and first-N display rules |
| Browser worker | [retail worker](../../kiara-ts-examples/src/retail.worker.ts), library worker adapters/protocol | Carry behavior configuration across worker preparation/replacement; main-thread/worker output parity, stale response handling, progress and cancellation |
| Articles and campaigns | [articles](../../kiara-ts-examples/articles), [array-filter article](../../kiara-ts-examples/docs/kiara-ts-vs-array-filter.md), benchmark reports | Search every code sample, expected result, stemming/keyword claim and latency headline; annotate historical versions; regenerate current evidence under new names |
| Data READMEs | [retail provenance](../../kiara-ts-examples/public/data/README-retail.md), [capacitor provenance](../../kiara-ts-examples/public/data/README-capacitors.md), [library provenance](./data-provenance.md) | Update only affected interpretation/schema instructions; preserve attribution, source hashes, real row counts, units and transformation history |
| Java demo reference | [Java demo README](../../kiara-demo/README.md), Movie/Airport/Config models, stores, services, controllers and static pages | Verify annotation fidelity, movie selected-attribute payloads, airport suggestions and ConfigStore minimum-match examples; only update shared comparison links/claims that actually change, not unrelated Lucene/SQLite/VoltDB results |

Before editing, repeat a tracked-file README/Markdown and package-version
inventory across both TS repositories. Include newly added files and external
published copies; this table is not permission to ignore future documentation.

## Delivery checklist and dependencies

| ID | Task | Depends on | Done when |
|---|---|---|---|
| D0 | Confirm behavior decision, candidate version, hosting target and publication inventory | P0 from behavior plan | Named owner/target; approved mode/default wording and release classification |
| D1 | Draft a before/after migration guide and update API/README tables | P1-P5, D0 | Every changed statement links to a tested contract case |
| D2 | Integrate the exact package and editor declarations | Candidate build, D0 | No mixed-version tarball, lockfile, declaration or worker assets |
| D3 | Update runnable examples, application logic and explanations | D1, D2 | All existing examples either pass unchanged or have an explained, tested migration |
| D4 | Re-run examples, coverage and browser acceptance | D3 | Full acceptance matrix below passes |
| D5 | Refresh articles, screenshots and benchmark claims | D4, P6 performance gate | Reproducible current evidence; historical reports retained and labeled |
| D6 | Stage and inspect the real hosted demo | D4, D5, confirmed hosting | Correct built version/mode, assets, CSP/base path, workers, no console errors |
| D7 | Publish/release/deploy with approval, then smoke-test | D6 and P7 release gate | Public package/docs/demo agree; tested rollback artifact available |

### Required migration examples

Include concise before/after pairs for:

- Collection EQUAL versus CONTAINS; new text ordering/scalar CONTAINS support.
- A preceding empty condition followed by an invalid condition.
- Best-match ties and minimum-match rows with extra nonnumeric values.
- Snowball exception stems, exact correction and unequal-length BFS suggestions.
- Shared-prefix projections changing cardinality, column casing/value types,
  duplicate rows, source versus traversal order and limited output.
- Store construction, replacement snapshots and worker setup under the chosen
  compatibility policy. Do not imply normalization alone selects search behavior.

Give consumers a migration checklist and the opt-in/legacy fallback, if the
approved policy provides one. Clearly label genuinely breaking changes.

## Acceptance matrix

1. **Library:** typecheck/build; structured, keyword, dictionary/stemmer,
   projection, decorators, interpreter and worker unit tests; live pinned-Java
   differential gate; approved JVM/Node benchmark budgets.
2. **Runnable library example:** `npm run demo:repo` and decorator examples;
   verify printed results, not merely successful process exit.
3. **Examples:** `npm test`, `npm run build`,
   `npm run test:parts:coverage`, `npm run test:business:coverage`.
   Existing engine coverage requirements remain 100%; do not lower thresholds
   to accommodate changed expectations.
4. **Focused example contracts:** query/guided examples, typeahead, runtime
   configuration, parts finder, business labs, CSV, article snippets and
   benchmark tests. Validate actual order, cardinality, values and metadata.
5. **Browser checks:** local production build, then staging; movie and airport
   datasets, editor diagnostics/completion, every application, shared-prefix
   projection totals, import/export, errors, refresh and real worker parity.
   Check Chromium, Firefox and WebKit where supported; preserve responsiveness
   and cancellation tests. Unit coverage is not DOM coverage.
6. **Data integrity:** retain 5,043 movies, 7,698 airports, 3,788 retail product
   codes and 16,802 component rows unless a separate documented data update is
   authorized. Verify source hashes and missing-value counts.
7. **Publication:** link checks, code examples, install-from-packed-artifact
   test, version/hash consistency, no unpublished package URLs masquerading as
   releases, and no unsupported "Java performance parity" claims.

## Staging, release and rollback

Keep the previous vendored package, lockfile and built demo artifact available.
Stage the new library and docs together; verify the displayed/runtime version
and behavior, including after refresh and in workers. Account for cached chunks,
worker URLs and any hosting/CDN caching actually in use.

Publish only after explicit release/deployment approval. Smoke-test the real
URL after publication. If behavioral or asset mismatches occur, restore the
previous coherent package-and-demo artifact, not an arbitrary mix of old JS
and new declarations. Record the rollback and failed acceptance case.
