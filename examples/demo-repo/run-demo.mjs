import {
  createCondition,
  defineSchema,
  DictionaryTrie,
  KeywordSearch,
  NormalizationProfile,
  numberField,
  Operator,
  QueryValidationError,
  Store,
  textField,
} from "../../dist/index.js";

const movieSchema = defineSchema([
  textField("title", { caseInsensitive: true, oneEditAway: true }),
  numberField("year"),
  textField("actors", {
    caseInsensitive: true,
    secondaryType: "commaSeparatedStrings",
  }),
  numberField("rating"),
  textField("plotKeywords", {
    caseInsensitive: true,
    secondaryType: "commaSeparatedStrings",
    stemmedIndex: true,
  }),
]);

const movieRows = [
  {
    title: "Cast Away",
    year: 2000,
    actors: "Tom Hanks, Helen Hunt",
    rating: 8.1,
    plotKeywords: "island,survival,package",
  },
  {
    title: "Apollo 13",
    year: 1995,
    actors: "Tom Hanks, Bill Paxton",
    rating: 7.6,
    plotKeywords: "nasa,mission,survival",
  },
  {
    title: "Big",
    year: 1988,
    actors: "Tom Hanks",
    rating: 7.3,
    plotKeywords: "wish,body-swap,family",
  },
];

const store = new Store(movieSchema, { normalizationProfile: NormalizationProfile.JAVA });
store.loadRows(movieRows);
store.prepare();

const structuredResults = store.search([
  createCondition({
    field: "year",
    operator: Operator.BETWEEN,
    lowerValue: 1990,
    upperValue: 2001,
  }),
  createCondition({
    field: "actors",
    operator: Operator.CONTAINS_EITHER,
    values: ["tom hanks"],
  }),
]);

const keywordSearch = new KeywordSearch(store);
const keywordResults = keywordSearch.bestMatch("apolo mission", { limit: 5 });
const limitedStructuredResults = store.search(
  [
    createCondition({
      field: "actors",
      operator: Operator.CONTAINS_EITHER,
      values: ["tom hanks"],
    }),
  ],
  1,
);
const projectionResults = store.searchProjection(
  [createCondition({ field: "actors", operator: Operator.CONTAINS_EITHER, values: ["tom hanks"] })],
  ["title", "rating"],
  2,
);
const legacyProjectionResults = store.searchLegacyProjection(
  [createCondition({ field: "actors", operator: Operator.CONTAINS_EITHER, values: ["tom hanks"] })],
  ["title", "year"],
  2,
);

const nullSchema = defineSchema([
  textField("title", { caseInsensitive: true }),
  textField("tags", {
    caseInsensitive: true,
    secondaryType: "commaSeparatedStrings",
    nullable: true,
  }),
  numberField("score", { nullable: true }),
]);

const nullStore = new Store(nullSchema, { normalizationProfile: NormalizationProfile.JAVA });
nullStore.loadRows([
  { title: "Known", tags: "alpha,beta", score: 10 },
  { title: "Unknown", tags: null, score: null },
  { title: "Partial", tags: "gamma", score: null },
]);
nullStore.prepare();

const nullSemanticsResults = {
  scoreNull: nullStore.search([
    createCondition({
      field: "score",
      values: [null],
    }),
  ]).map((row) => row.title),
  tagsEitherIncludingNull: nullStore.search([
    createCondition({
      field: "tags",
      operator: Operator.CONTAINS_EITHER_INCLUDING_NULL,
      values: [null, "alpha"],
    }),
  ]).map((row) => row.title),
};

const dateRangeSchema = defineSchema([
  textField("event", { caseInsensitive: true }),
  textField("validDate", { secondaryType: "dateRange" }),
  textField("timeWindows", { secondaryType: "commaSeparatedDateTimeRanges" }),
]);

const dateRangeStore = new Store(dateRangeSchema, { normalizationProfile: NormalizationProfile.JAVA });
dateRangeStore.loadRows([
  {
    event: "Launch Window",
    validDate: "2020-01-01->2020-01-10",
    timeWindows: "2020-01-01 00:00:00->2020-01-01 12:00:00,2020-01-02 00:00:00->2020-01-02 12:00:00",
  },
  {
    event: "Landing Window",
    validDate: "2020-01-11->2020-01-20",
    timeWindows: "2020-01-03 00:00:00->2020-01-03 12:00:00",
  },
]);
dateRangeStore.prepare();

const rangeAndDateTimeResults = {
  validDateContains: dateRangeStore.search([
    createCondition({
      field: "validDate",
      operator: Operator.CONTAINS_EITHER,
      values: ["2020-01-05"],
    }),
  ]).map((row) => row.event),
  timeWindowsNotContains: dateRangeStore.search([
    createCondition({
      field: "timeWindows",
      operator: Operator.NOT_CONTAINS,
      values: ["2020-01-03 06:00:00"],
    }),
  ]).map((row) => row.event),
};

const ignoreIndexSchema = defineSchema([
  textField("title", { caseInsensitive: true }),
  textField("privateNotes", { caseInsensitive: true, ignoreIndex: true }),
]);
const ignoreIndexStore = new Store(ignoreIndexSchema, { normalizationProfile: NormalizationProfile.JAVA });
ignoreIndexStore.loadRow({ title: "Visible Story", privateNotes: "hidden blue token" });
ignoreIndexStore.prepare();

let ignoreIndexErrorCode = "none";
try {
  ignoreIndexStore.search([
    createCondition({
      field: "privateNotes",
      values: ["hidden blue token"],
    }),
  ]);
} catch (error) {
  if (error instanceof QueryValidationError) {
    ignoreIndexErrorCode = error.code;
  } else {
    throw error;
  }
}

const airports = [
  { airportName: "John F Kennedy International", countryName: "united states", airportCode: "jfk" },
  { airportName: "Los Angeles International", countryName: "united states", airportCode: "lax" },
  { airportName: "Indira Gandhi International", countryName: "india", airportCode: "del" },
  { airportName: "Dubai International", countryName: "united arab emirates", airportCode: "dxb" },
];

const airportTrie = new DictionaryTrie();
for (const airport of airports) {
  airportTrie.addText(airport.airportName);
  airportTrie.addText(airport.countryName);
  airportTrie.addText(airport.airportCode);
}

function suggestAirportTokens(input) {
  const normalized = input.trim().toLowerCase();
  if (normalized.length === 0) {
    return [];
  }

  const byPrefix = airportTrie.predict(normalized, 10);
  if (byPrefix.length > 0) {
    return byPrefix;
  }

  const corrected = airportTrie.getOneEditCandidate(normalized);
  return corrected === null ? [] : [corrected];
}

const airportSuggestions = {
  prefix: suggestAirportTokens("int"),
  typoFallback: suggestAirportTokens("interntional"),
};

console.log("=== Kiara TypeScript Demo Repo: in action ===");
console.log("");
console.log("Structured search (year between 1990-2001, actor contains Tom Hanks):");
console.log(structuredResults.map((row) => ({ title: row.title, year: row.year, rating: row.rating })));
console.log("");
console.log("Keyword bestMatch (input: 'apolo mission'):");
console.log({
  matchedKeywords: keywordResults.matchedKeywords,
  correctedKeywords: keywordResults.correctedKeywords,
  results: keywordResults.results.map((row) => row.title),
});
console.log("");
console.log("Projection and limit behavior:");
console.log({
  limitedStructuredResults: limitedStructuredResults.map((row) => row.title),
  projectionResults,
  legacyProjectionResults,
});
console.log("");
console.log("Null-aware search behavior:");
console.log(nullSemanticsResults);
console.log("");
console.log("Range/date-time edge behavior:");
console.log(rangeAndDateTimeResults);
console.log("");
console.log("ignoreIndex safety guard error code:");
console.log(ignoreIndexErrorCode);
console.log("");
console.log("Airport suggestion tokens:");
console.log(airportSuggestions);
