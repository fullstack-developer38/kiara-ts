import { describe, expect, it } from "vitest";
import { createCondition } from "../query/condition.js";
import { Operator } from "../query/operator.js";
import { defineSchema } from "../schema/define-schema.js";
import { numberField, textField } from "../schema/field-factories.js";
import { Store } from "../store/store.js";
import { NormalizationProfile } from "../store/types.js";
import { InMemoryWorkerAdapter } from "./in-memory-worker-adapter.js";
import { WorkerOperation } from "./protocol.js";

interface MovieRow {
  title: string;
  year: number;
}

const movieSchema = defineSchema<MovieRow>([
  textField("title", { caseInsensitive: true }),
  numberField("year"),
]);

function createStore(): Store<MovieRow> {
  const store = new Store(movieSchema, { normalizationProfile: NormalizationProfile.JAVA });
  store.loadRow({ title: "Cast Away", year: 2000 });
  store.loadRow({ title: "Big", year: 1988 });
  store.prepare();
  return store;
}

describe("InMemoryWorkerAdapter", () => {
  it("executes search requests and returns results", async () => {
    const adapter = new InMemoryWorkerAdapter<MovieRow>();
    adapter.registerStore("movies", createStore());

    const response = await adapter.execute({
      requestId: "r1",
      storeId: "movies",
      operation: WorkerOperation.SEARCH,
      payload: {
        conditions: [createCondition<MovieRow, "title">({ field: "title", values: ["cast away"] })],
      },
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect((response.result as MovieRow[]).map((row) => row.title)).toEqual(["Cast Away"]);
    }
  });

  it("emits progress events", async () => {
    const adapter = new InMemoryWorkerAdapter<MovieRow>();
    adapter.registerStore("movies", createStore());
    const phases: string[] = [];

    await adapter.execute(
      {
        requestId: "r2",
        storeId: "movies",
        operation: WorkerOperation.SEARCH,
        payload: {
          conditions: [createCondition<MovieRow, "title">({ field: "title", values: ["big"] })],
        },
      },
      {
        onProgress: (event) => phases.push(event.phase),
      },
    );

    expect(phases).toEqual(["accepted", "running", "completed"]);
  });

  it("supports cancellation", async () => {
    const adapter = new InMemoryWorkerAdapter<MovieRow>();
    adapter.registerStore("movies", createStore());

    const response = await adapter.execute(
      {
        requestId: "r3",
        storeId: "movies",
        operation: WorkerOperation.SEARCH,
        payload: {
          conditions: [createCondition<MovieRow, "title">({ field: "title", values: ["big"] })],
        },
      },
      {
        isCancelled: () => true,
      },
    );

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.errorCode).toBe("CANCELLED");
    }
  });

  it("executes keyword search requests", async () => {
    const adapter = new InMemoryWorkerAdapter<MovieRow>();
    adapter.registerStore("movies", createStore());

    const response = await adapter.execute({
      requestId: "r4",
      storeId: "movies",
      operation: WorkerOperation.KEYWORD_BEST_MATCH,
      payload: {
        input: "cast",
      },
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      if ("results" in response.result) {
        expect(response.result.results.map((row) => row.title)).toEqual(["Cast Away"]);
      } else {
        throw new Error("Expected keyword response payload.");
      }
    }
  });

  it("returns store-not-found for missing stores", async () => {
    const adapter = new InMemoryWorkerAdapter<MovieRow>();
    const response = await adapter.execute({
      requestId: "r5",
      storeId: "missing",
      operation: WorkerOperation.SEARCH,
      payload: {
        conditions: [createCondition<MovieRow, "title">({ field: "title", values: ["big"] })],
      },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.errorCode).toBe("STORE_NOT_FOUND");
    }
  });

  it("propagates Kiara error code/details for validation failures", async () => {
    const adapter = new InMemoryWorkerAdapter<MovieRow>();
    adapter.registerStore("movies", createStore());

    const response = await adapter.execute({
      requestId: "r5b",
      storeId: "movies",
      operation: WorkerOperation.SEARCH,
      payload: {
        conditions: [
          createCondition<MovieRow, "title">({
            field: "title",
            operator: Operator.NOT_CONTAINS,
            values: ["cast away"],
          }),
        ],
      },
    });

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.errorCode).toBe("QUERY_INVALID_CONDITION");
      expect(response.details).toMatchObject({ field: "title" });
    }
  });

  it("returns unknown-operation for unexpected runtime input", async () => {
    const adapter = new InMemoryWorkerAdapter<MovieRow>();
    adapter.registerStore("movies", createStore());

    const response = await adapter.execute({
      requestId: "r6",
      storeId: "movies",
      operation: "unsupportedOperation",
      payload: {},
    } as never);

    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.errorCode).toBe("UNKNOWN_OPERATION");
    }
  });
});
