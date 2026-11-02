# Contributing

Bug reports, questions and pull requests are welcome. For bigger changes, open an
issue first so we can agree on the approach.

Issues labeled `good first issue` are a good place to start.

## Setup

Node 22 or newer.

```sh
npm ci
npm run build
npm test
```

`npm run typecheck` checks the sources and tests. `npm run test:watch` keeps
vitest running while you edit.

## Before you open a pull request

CI runs these two on every pull request:

```sh
npm run test:parity:gate
npm run test:interpreter:coverage
```

The gate builds, type-checks, runs the Java oracle fixtures and the 10k/50k
differential suites, and checks benchmark thresholds. See
[docs/ci-required-checks.md](./docs/ci-required-checks.md) for the details.

A few things to keep in mind:

- Kiara TS is a port of the [Java library](https://github.com/kapoorlabs/kiara),
  so results should match it. If you change search behavior, add a test with
  the expected result and say why in the pull request.
- The query interpreter is held at 100% coverage. New interpreter code needs
  tests for every branch.
- The package has no runtime dependencies. Please keep it that way.

## Docs and examples

README and `docs/` fixes are welcome too, typos included. Larger, runnable
examples live in [kiara-ts-examples](https://github.com/kapoor-labs/kiara-ts-examples).
