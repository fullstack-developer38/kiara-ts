import { describe, expect, it } from "vitest";
import { MessageChannel, type MessagePort } from "node:worker_threads";
import { createCondition } from "../query/condition.js";
import { Operator } from "../query/operator.js";
import { defineSchema } from "../schema/define-schema.js";
import { numberField, textField } from "../schema/field-factories.js";
import { Store } from "../store/store.js";
import { NormalizationProfile } from "../store/types.js";
import {
  attachBrowserWorkerHost,
  BrowserWorkerClient,
  type WorkerMessagePort,
} from "./browser-worker-adapter.js";
import { InMemoryWorkerAdapter } from "./in-memory-worker-adapter.js";
import type { WorkerExecutionControl, WorkerRequest, WorkerResponse } from "./protocol.js";
import { WorkerOperation } from "./protocol.js";

interface MovieRow {
  title: string;
  year: number;
}

const schema = defineSchema<MovieRow>([
  textField("title", { caseInsensitive: true }),
  numberField("year"),
]);

function createStore(): Store<MovieRow> {
  const store = new Store(schema, { normalizationProfile: NormalizationProfile.JAVA });
  store.loadRow({ title: "Cast Away", year: 2000 });
  store.loadRow({ title: "Big", year: 1988 });
  store.prepare();
  return store;
}

class MockPort implements WorkerMessagePort {
  private readonly listeners = new Set<(event: { readonly data: unknown }) => void>();
  private peer: MockPort | undefined;

  public connect(peer: MockPort): void {
    this.peer = peer;
  }

  public postMessage(message: unknown): void {
    const target = this.peer;
    if (target === undefined) {
      return;
    }
    queueMicrotask(() => {
      target.emit(message);
    });
  }

  public addEventListener(
    _type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ): void {
    this.listeners.add(listener);
  }

  public removeEventListener(
    _type: "message",
    listener: (event: { readonly data: unknown }) => void,
  ): void {
    this.listeners.delete(listener);
  }

  private emit(data: unknown): void {
    for (const listener of this.listeners) {
      listener({ data });
    }
  }
}

class DelayedInMemoryWorkerAdapter<T extends object> extends InMemoryWorkerAdapter<T> {
  public override async execute(
    request: WorkerRequest<T>,
    control: WorkerExecutionControl = {},
  ): Promise<WorkerResponse<T>> {
    await Promise.resolve();
    return super.execute(request, control);
  }
}

function createConnectedPorts(): { readonly clientPort: MockPort; readonly hostPort: MockPort } {
  const clientPort = new MockPort();
  const hostPort = new MockPort();
  clientPort.connect(hostPort);
  hostPort.connect(clientPort);
  return { clientPort, hostPort };
}

function wrapMessagePort(port: MessagePort): WorkerMessagePort {
  const listeners = new Map<
    (event: { readonly data: unknown }) => void,
    (message: unknown) => void
  >();

  port.start();

  return {
    postMessage(message: unknown): void {
      port.postMessage(message);
    },
    addEventListener(
      _type: "message",
      listener: (event: { readonly data: unknown }) => void,
    ): void {
      const handler = (message: unknown): void => listener({ data: message });
      listeners.set(listener, handler);
      port.on("message", handler);
    },
    removeEventListener(
      _type: "message",
      listener: (event: { readonly data: unknown }) => void,
    ): void {
      const handler = listeners.get(listener);
      if (handler === undefined) {
        return;
      }
      port.off("message", handler);
      listeners.delete(listener);
    },
  };
}

describe("Browser worker smoke adapter", () => {
  it("round-trips requests through message ports and emits progress", async () => {
    const adapter = new InMemoryWorkerAdapter<MovieRow>();
    adapter.registerStore("movies", createStore());

    const { clientPort, hostPort } = createConnectedPorts();
    const detach = attachBrowserWorkerHost(hostPort, adapter);
    const client = new BrowserWorkerClient<MovieRow>(clientPort);
    const phases: string[] = [];

    const response = await client.execute(
      {
        requestId: "bw-1",
        storeId: "movies",
        operation: WorkerOperation.SEARCH,
        payload: {
          conditions: [createCondition<MovieRow, "title">({ field: "title", values: ["cast away"] })],
        },
      },
      {
        onProgress: (event) => phases.push(event.phase),
      },
    );

    expect(phases).toEqual(["accepted", "running", "completed"]);
    expect(response.ok).toBe(true);
    if (response.ok) {
      expect((response.result as MovieRow[]).map((row) => row.title)).toEqual(["Cast Away"]);
    }

    client.dispose();
    detach();
  });

  it("supports cancellation via abort signal over worker messages", async () => {
    const adapter = new DelayedInMemoryWorkerAdapter<MovieRow>();
    adapter.registerStore("movies", createStore());

    const { clientPort, hostPort } = createConnectedPorts();
    const detach = attachBrowserWorkerHost(hostPort, adapter);
    const client = new BrowserWorkerClient<MovieRow>(clientPort);
    const controller = new AbortController();

    const responsePromise = client.execute(
      {
        requestId: "bw-2",
        storeId: "movies",
        operation: WorkerOperation.SEARCH,
        payload: {
          conditions: [createCondition<MovieRow, "title">({ field: "title", values: ["big"] })],
        },
      },
      { signal: controller.signal },
    );
    controller.abort();

    const response = await responsePromise;
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.errorCode).toBe("CANCELLED");
    }

    client.dispose();
    detach();
  });

  it("works with real MessageChannel transport", async () => {
    const adapter = new InMemoryWorkerAdapter<MovieRow>();
    adapter.registerStore("movies", createStore());

    const channel = new MessageChannel();
    const clientPort = wrapMessagePort(channel.port1);
    const hostPort = wrapMessagePort(channel.port2);
    const detach = attachBrowserWorkerHost(hostPort, adapter);
    const client = new BrowserWorkerClient<MovieRow>(clientPort);

    const response = await client.execute({
      requestId: "bw-3",
      storeId: "movies",
      operation: WorkerOperation.SEARCH,
      payload: {
        conditions: [createCondition<MovieRow, "title">({ field: "title", values: ["big"] })],
      },
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect((response.result as MovieRow[]).map((row) => row.title)).toEqual(["Big"]);
    }

    client.dispose();
    detach();
    channel.port1.close();
    channel.port2.close();
  });

  it("propagates structured query validation error details across worker boundary", async () => {
    const adapter = new InMemoryWorkerAdapter<MovieRow>();
    adapter.registerStore("movies", createStore());

    const { clientPort, hostPort } = createConnectedPorts();
    const detach = attachBrowserWorkerHost(hostPort, adapter);
    const client = new BrowserWorkerClient<MovieRow>(clientPort);

    const response = await client.execute({
      requestId: "bw-4",
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

    client.dispose();
    detach();
  });
});
