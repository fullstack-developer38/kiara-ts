# Kiara TS usage guide

Start with either the [decorator quick start](../README.md#decorator-quick-start)
or the [schema quick start](../README.md#schema-quick-start).
The sections below describe the main API choices without requiring knowledge of
the implementation or its development history.

## Schemas and decorators

Use `defineSchema<T>(fields)` with `textField`, `numberField`, `longField`,
`booleanField`, and `enumField`. Field names are checked against your record type.
For enums, supply the allowed values: `enumField("tier", ["silver", "gold"])`.

Common field options:

| Option | Purpose |
|---|---|
| `caseInsensitive` | Lower-case text for structured and keyword matching; without it, keyword search is case-sensitive |
| `ignoreIndex` | Exclude a field from search; attempts to query it throw |
| `stemmedIndex` | Enable English (Snowball) stemming in keyword search |
| `oneEditAway`, `predictable` | Enable keyword spelling correction for the field (decorators: `@OneEditAway()`, `@Predictable()`) |
| `secondaryType` | Interpret serialized collections, dates, or ranges |
| `format` | Set a supported date/date-time format |

Choose your numeric profile when constructing a store:

- `NormalizationProfile.NATIVE`: preserves fractional number keys; rejects
  non-finite numeric inputs.
- `NormalizationProfile.JAVA` (default): uses long-key conversion, including
  truncation of fractional numbers and saturation at long boundaries. Like Java
  Kiara, it returns identical source rows only once.
  Use native mode when decimal comparisons must preserve fractions or when
  duplicate source rows must be returned.

For class decorators, use TypeScript standard decorators, not legacy
`experimentalDecorators`. Call `initializeDecoratorMetadata()` **before**
declaring decorated classes. Give each field a type decorator such as `@Text()`
or `@NumberField()`, then add options such as `@CaseInsensitive()`.
Pass `getEntitySchema(YourClass)` to `Store`.

## Store lifecycle

1. Create a `Store` with a schema.
2. Call `loadRows(records)` (or `loadRow(record)` for one record at a time).
3. Call `prepare()` before querying. It builds the internal indexes.
4. Use `search(conditions)` or `queryAll()` to retrieve records.

Loading after preparation throws. For an atomic replacement, use
`new StoreLoader(store).replaceAll(newRows)`, which returns a new prepared store
and leaves the original intact. `beginLoading()` instead clears the current
store so you can load and prepare again.

Treat loaded records and inspection results as read-only. Data and indexes live
in memory; this is not a persistent database.

## Schema-aware query interpreter

`QueryInterpreter<T>` is an optional, deterministic interpretation layer over a
prepared store. It uses the existing schema and a cached whole-value dictionary,
plus explicitly configured aliases and units. It does not change `Store.search`
or keyword-search semantics, and works with schemas built through either schema
builders or decorators.

### Complete example

```typescript
import {
  QueryInterpreter, editQueryFragment, defineSchema, textField, numberField,
  Store, NormalizationProfile,
} from "@kapoorlabs/kiara-ts";

interface Component {
  type: string;
  capacitance: number;
  voltage: number;
  testVoltage: number;
  package: string;
}

const schema = defineSchema<Component>([
  textField("type", { caseInsensitive: true }),
  numberField("capacitance"),
  numberField("voltage"),
  numberField("testVoltage"),
  textField("package"),
]);
const store = new Store(schema, {
  normalizationProfile: NormalizationProfile.NATIVE,
});
// Illustrative records: capacitance is stored in farads, voltages in volts.
store.loadRows([
  { type: "Ceramic", capacitance: 0.00001, voltage: 25, testVoltage: 50, package: "0603" },
  { type: "Film", capacitance: 0.00002, voltage: 50, testVoltage: 100, package: "0805" },
]);
store.prepare();

const interpreter = new QueryInterpreter(store, {
  fields: {
    capacitance: {
      aliases: ["cap"],
      canonicalUnit: "F",
      units: { F: 1, uF: 1e-6, nF: 1e-9 },
    },
    voltage: {
      aliases: ["rated voltage"],
      canonicalUnit: "V",
      units: { V: 1, mV: 0.001 },
    },
    testVoltage: {
      canonicalUnit: "V",
      units: { V: 1 },
    },
    type: { valueAliases: { mlcc: "Ceramic" } },
  },
});

const input = "ceramic cap:10000nF voltage>=25V 0603";
const interpretation = interpreter.interpret(input);
console.log(interpretation.issues); // []
console.log(interpreter.search(input)); // First component

const ambiguous = interpreter.interpret("25V");
console.log(ambiguous.issues[0]?.kind); // "ambiguous"
// Both voltage and testVoltage are plausible fields, regardless of current hits.
console.log(interpreter.search("25V", { "0:3": "voltage" })); // First component

console.log(editQueryFragment(ambiguous, "0:3", "voltage>=25V"));
// voltage>=25V
console.log(editQueryFragment(ambiguous, "0:3", ""));
// Empty input: all filters removed
```

### Syntax and matching

| Input | Meaning |
|---|---|
| `ceramic` | Discover the complete value across searchable fields |
| `mlcc` | Discover a configured value alias |
| `cap:10uF` or `cap=10000nF` | Equality after conversion to the field's canonical unit |
| `voltage>=25V` | An explicit lower bound |
| `stock<1000` | An explicit upper bound |
| `type!=Ceramic` | Inequality |
| `cap:10uF..20uF` | Inclusive range; each bound is independently converted |
| `manufacturer:"Texas Instruments"` | A quoted value containing spaces |
| `"rated voltage">=25V` | A quoted multiword field alias |
| `available:true` | Exact boolean literal; also supports `false` |

Separate expressions with whitespace. Keep the field, operator, and quantity
contiguous: write `voltage>=25V`, not `voltage >= 25 V`. Double-quoted strings use
JSON escaping. Unrestricted prose, implicit OR, grouping, date expressions, and
unit inheritance between range bounds are not part of this grammar.
For example, `cap:10..20uF` means 10 farads through 20 microfarads, not 10 through
20 microfarads, and is rejected as reversed.

Bare values mean equality, never an assumed minimum specification. A quantity
with units can suggest fields even if it currently has no matching rows.
Unqualified comparisons and ranges can likewise have several candidate fields.
Bare unitless numbers are discovered from observed values rather than assigned
to every numeric field. Leading-zero text such as `0603` is preserved.

Discovery matches whole values, not individual words from multiword scalar
values. Field case-sensitivity follows its schema. For
`commaSeparatedStrings`, discovery uses individual trimmed members;
equality/inequality compile to `CONTAINS_EITHER`/`NOT_CONTAINS`. Repeated
expressions are ANDed, allowing several required collection members.

### Units and metadata

- Metadata is keyed by typed schema field names. Field aliases are
  case-insensitive; value aliases follow their field's case-sensitivity.
- Alias collisions are preserved as ambiguity, not resolved by field order.
- Value aliases are supported on text/enum fields.
- Units are opt-in on scalar number fields and require `NATIVE` normalization.
  The canonical unit must be present with factor 1; every other factor is a
  finite positive multiplier into that unit.
- Stored records must already use the canonical unit. The interpreter does not
  convert your source records or discover measurement dimensions from column
  names.
- Unit symbols are case-sensitive. Both micro symbols normalize to `u`;
  otherwise aliases must be declared explicitly. No universal unit registry is
  bundled.
- Decimal quantity/factor multiplication is performed before a single conversion
  to JavaScript `number`, avoiding intermediate multiplication noise for exact
  equality such as `10uF` versus `10000nF`. Final precision is still IEEE-754,
  not arbitrary-precision decimal arithmetic.
- Overflow, underflow to zero, and magnitudes above `Number.MAX_SAFE_INTEGER`
  are rejected. Fractional input is rejected in the default JAVA profile to
  prevent silent integer truncation.

### Results, confirmation, and UI integration

`interpret(input, selections?)` returns:

- `input`: the original input.
- `filters`: resolved `{ id, text, start, end, condition }` fragments.
- `issues`: unresolved fragments with `kind`, `message`, and candidate conditions.
  Kinds are `ambiguous`, `unrecognized`, and `invalid`.

Source offsets are JavaScript UTF-16 offsets with an exclusive `end`. IDs use
`start:end`. Render the conditions as chips and candidates as confirmation
choices. Pass the chosen field in a `Record<fragmentId, fieldName>` on the next
interpretation or search. Invalid confirmations remain explicit issues.

Use `editQueryFragment(interpretation, id, replacement)` to edit or remove a chip
in the original input. Reinterpret the returned string and reset confirmations
after input changes; offsets and IDs belong to that interpretation, not to future
edits. Results are JSON-serializable and can be stored as application state.
Rendering, keyboard interaction, and confirmation dialogs remain the UI's
responsibility; there is no DOM dependency.

`search(input, selections?, limit?)` refuses to run if any issue remains and
throws `QueryValidationError` with the interpretation in `error.details`.
It never silently applies a subset of requested filters. A valid empty query
intentionally calls `queryAll(limit)`; a valid query with no hits returns `[]`.

The initial interpreter supports scalar text, enum, number, boolean, and
comma-separated string fields. Ignored indexes, long fields, dates, numeric
collections, and stored range types are excluded and cannot be configured as
interpreter fields; their existing structured-query APIs remain available.
Input is bounded to 4,096 characters.

The value dictionary is built once from the prepared store. After replacing or
reloading data, construct a new interpreter. Attempts to reuse one after its
store snapshot changes fail explicitly. Treat records as read-only, as with
ordinary prepared-store queries.

### Coverage gate

```bash
npm run test:interpreter:coverage
```

This enforces 100% statements, branches, functions, and lines for
`src/query/query-interpreter.ts`, including the chip-editing helper. It does not
claim that the entire pre-existing library has 100% coverage. The same command
runs in CI.

## Structured queries

Build conditions with `createCondition({ field, operator, values })`.
The default operator is `EQUAL`. Conditions in a search are combined with AND.
`BETWEEN` takes `lowerValue` and `upperValue` instead of `values`.

| Field family | Operators |
|---|---|
| Text, enum, boolean, number and date scalars | Equality, `LESS_THAN`, `LESS_THAN_EQUAL`, `GREATER_THAN`, `GREATER_THAN_EQUAL`, `BETWEEN`, `CONTAINS_EITHER`, `CONTAINS_ALL`, `CONTAINS_EITHER_INCLUDING_NULL` |
| Collections | All scalar operators, plus `NOT_CONTAINS` |
| Ranges and range collections | Equality, `CONTAINS_EITHER`, `CONTAINS_ALL`, `NOT_CONTAINS` |

On a scalar, `CONTAINS_EITHER` means "equals any value" and `CONTAINS_ALL`
means "equals every value". Text comparisons such as `LESS_THAN` compare stored
strings, so they are case-sensitive unless the field is `caseInsensitive`.

On a collection, `EQUAL` and the comparison operators match when **any member**
satisfies them: `tags EQUAL "red"` matches `"red,blue"`. `NOT_EQUAL` compares
the whole serialized collection, while `NOT_CONTAINS` excludes rows containing
a matching member.

Conditions run in **schema field order**, not the order you pass them. When an
earlier field matches nothing, later conditions are skipped, so an invalid
condition on a later field returns `[]` instead of throwing.

Secondary types are configured on fields and stored as serialized strings:

- Collections: `commaSeparatedStrings`, `commaSeparatedNumbers`,
  `commaSeparatedDates`, `commaSeparatedDateTimes`.
- Scalar dates: `dateFormat`, `dateTimeFormat`.
- Ranges: `numericRange`, `dateRange`, `dateTimeRange`.
- Range collections: `commaSeparatedNumericRanges`, `commaSeparatedDateRanges`,
  `commaSeparatedDateTimeRanges`.

Example values include `"red,blue"`, `"2026-10-18"`,
`"2026-10-18 09:30:00"`, and `"10->20"`.
Range containment tests points against stored intervals. Do not assume arbitrary
Java date-format patterns are supported; unsupported formats throw.

For a null scalar, use `values: [null]`. On collections,
`CONTAINS_EITHER_INCLUDING_NULL` with `values: [null, "blue"]` matches null
collections or a matching member. Range fields accept that operator only for
Java compatibility: it reads its values as range strings, not points, so use
`CONTAINS_EITHER` to test points.

## Projections and limits

- `store.search(conditions, limit)` returns full records.
- `store.searchProjection(conditions, fields, limit)` returns selected
  properties with their original types.
- `store.searchLegacyProjection(conditions, fields, limit)` returns uppercase
  field names and stored string/null values (for example, `"7.70"` for 7.7).
  Like Java Kiara, rows sharing the selected values are returned once.

Omit `limit` for all matches. A non-positive limit returns no rows.
Typed projections require at least one field. Legacy projections select all
fields when the selection is omitted or empty.

## Keyword search

Construct `new KeywordSearch(store, maxKeywords)`; the default keyword cap is 10.
Call `bestMatch(input, options)` or `minimumMatch(input, options)`.
Input can be a sentence or an array of phrases. Options include:

- `fields`: restrict the searchable text fields.
- `conditions`: apply structured filters alongside keyword matching.
- `limit`: cap returned records. Without it, every match is returned.

Results include `results`, `matchedKeywords`, `correctedKeywords`,
`usedKeywords`, and `truncated`. Check `truncated` when accepting long input.

- **`bestMatch`** returns the rows matching the most keywords, assigning each
  keyword to a field the way Java Kiara does. Among equal scores it keeps
  Java's combination order.
- **`minimumMatch`** keeps best-match rows whose populated non-numeric values
  are exactly the matched keywords: rows with "the keywords entered and nothing
  more". It suits rule or configuration rows where blank fields are wildcards;
  on wide records it usually returns nothing.
- **Case:** keywords match exactly unless the field is `caseInsensitive`.
- **Stemming:** `stemmedIndex` fields use Snowball English stemming, including
  its exceptions (`skies → sky`, `news` unchanged).
- **Spelling correction** runs only on `oneEditAway` or `predictable` fields,
  and only for words longer than three characters. Like Java, it follows a
  single greedy path through the field's dictionary: a typo near the start of a
  word (`latern`) may not be corrected, and a correction can be an incomplete
  word. Inspect `correctedKeywords` before showing a correction to users.
- **Tokenization** replaces Java's punctuation set with spaces and removes
  brackets without splitting words (`a(b)c` becomes `abc`).

## Dictionary and autocomplete

```ts
import { DictionaryTrie } from "@kapoorlabs/kiara-ts";

const dictionary = new DictionaryTrie();
dictionary.addText("apollo airport");
console.log(dictionary.predict("apo", 5)); // ["apollo"]
console.log(dictionary.getOneEditCandidate("apolo")); // "apollo"
```

Predictions return dictionary words, not matching records, breadth-first:
shorter completions come before longer ones (`apo`, `apollo`, `apostle`,
`apocalypse`). One-edit correction supports insertion, deletion, or
substitution along one greedy trie path and returns a candidate or `null`.

## Workers

`InMemoryWorkerAdapter` provides the request/response protocol on the current
thread. Register stores with `registerStore(id, store)` before `execute(request)`.
Requests carry `requestId`, `storeId`, `operation`, and `payload`.

Supported operations are search, typed/legacy projections, and keyword
best/minimum matching. Check the returned `ok` flag before using the result.

For actual background execution, create a browser module Web Worker, construct
and register the store inside it, and connect `attachBrowserWorkerHost` to a
`BrowserWorkerClient` on the main thread. Pass serializable messages, not Store
instances or schema functions. The bridge supports progress and cancellation;
cancellation is not a guarantee of interrupting synchronous work immediately.

## Errors and diagnostics

Catch `KiaraError` to inspect a library error's `code`, `message`, and `details`.
More specific classes include `SchemaValidationError`, `DecoratorError`,
`NormalizationError`, `QueryValidationError`, and `StoreStateError`.
Worker requests instead return an error response with `ok: false`.

Inspect a prepared store with `getPreparedTrieSnapshot()` or
`getPreparedData()`. Use `getDiagnosticTrieSerialization()` for diagnostic text.
These are inspection tools, not persistence or reload APIs; do not mutate
returned index structures.
