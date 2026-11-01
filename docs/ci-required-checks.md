# CI required checks for parity safety

Use GitHub branch protection on `main` and require this check:

- **`parity-gate / parity-gate`**

This check is produced by:

- [`.github/workflows/parity-gate.yml`](../.github/workflows/parity-gate.yml)

Gate command:

- `npm run test:parity:gate`

The gate currently enforces:

1. Build + typecheck.
2. Designated imported-oracle corpus + keyword + expectation fixtures.
3. High-volume 10k/50k differential suites.
4. Operator compatibility matrix parity tests.
5. Java declaration-accounting drift checks with threshold enforcement (`npm run accounting:java:check:ci`).
6. Benchmark threshold regression checks (`npm run bench:check:ci`).

`bench:check:ci` is intentionally non-mutating: it validates against CI
baselines without writing benchmark history files. Use
`npm run bench:record-history` only for intentional local history updates.

Current accounting thresholds in CI are:

- `missing <= 0`
- `covered >= 448`

## Local-only Java comparison checks

These need a sibling `../kiara` checkout built with Maven, so CI does not run them:

- `npm run test:oracle:live`: live Java-vs-TS behavior probe.
- `npm run bench:java-ts:equivalent:ci`: Java-vs-TS equivalent-workload benchmark.

Set `JAVA_SUREFIRE_REPORT` to use a Java build in a different location.
