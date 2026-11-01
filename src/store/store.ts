import { QueryValidationError, StoreStateError } from "../errors.js";
import type { Condition } from "../query/condition.js";
import type { CompiledSchema, FieldName } from "../schema/types.js";
import { buildPreparedStoreData } from "./index-builder.js";
import { executeLegacyProjection, executeSearch } from "./search-engine.js";
import { StoreState, type StoreState as StoreStateType } from "./store-state.js";
import { serializeTrieSnapshot } from "./trie-diagnostics.js";
import {
  NormalizationProfile,
  type NormalizationProfile as NormalizationProfileType,
  type PreparedStoreData,
  type StoreOptions,
  type TrieSnapshot,
} from "./types.js";

export class Store<T extends object> {
  public readonly schema: CompiledSchema<T>;
  public readonly normalizationProfile: NormalizationProfileType;
  private state: StoreStateType = StoreState.LOADING;
  private rows: T[] = [];
  private preparedRows: readonly T[] = [];
  private preparedData: PreparedStoreData<T> | undefined;

  public constructor(schema: CompiledSchema<T>, options: StoreOptions = {}) {
    this.schema = schema;
    this.normalizationProfile = options.normalizationProfile ?? NormalizationProfile.JAVA;
  }

  public getState(): StoreStateType {
    return this.state;
  }

  public getLoadedRowCount(): number {
    return this.rows.length;
  }

  public beginLoading(): void {
    if (this.state === StoreState.PREPARING) {
      throw new StoreStateError("Cannot start loading while store preparation is in progress.", {
        state: this.state,
      });
    }
    this.state = StoreState.LOADING;
    this.rows = [];
    this.preparedRows = [];
    this.preparedData = undefined;
  }

  public loadRow(row: T): void {
    if (this.state !== StoreState.LOADING) {
      throw new StoreStateError("Rows can be loaded only while the store is in loading state.", {
        state: this.state,
      });
    }
    this.rows.push(row);
  }

  public loadRows(rows: Iterable<T>): void {
    if (this.state !== StoreState.LOADING) {
      throw new StoreStateError("Rows can be loaded only while the store is in loading state.", {
        state: this.state,
      });
    }
    for (const row of rows) {
      this.rows.push(row);
    }
  }

  public prepare(): void {
    if (this.state !== StoreState.LOADING) {
      throw new StoreStateError("Store can only be prepared from loading state.", {
        state: this.state,
      });
    }
    this.state = StoreState.PREPARING;
    try {
      this.preparedData = buildPreparedStoreData(
        this.schema,
        this.rows,
        this.normalizationProfile,
      );
      this.preparedRows = Object.freeze([...this.rows]);
      this.state = StoreState.READY;
    } catch (error) {
      this.state = StoreState.FAILED;
      throw error;
    }
  }

  public queryAll(limit?: number): readonly T[] {
    if (this.state !== StoreState.READY) {
      throw new StoreStateError("Store query is allowed only after preparation is complete.", {
        state: this.state,
      });
    }

    if (limit === undefined) {
      return this.preparedRows;
    }
    if (limit <= 0) {
      return [];
    }
    return this.preparedRows.slice(0, limit);
  }

  public search(conditions: readonly Condition<T>[], limit?: number): readonly T[] {
    if (this.state !== StoreState.READY) {
      throw new StoreStateError("Store query is allowed only after preparation is complete.", {
        state: this.state,
      });
    }
    if (this.preparedData === undefined) {
      throw new StoreStateError("Store is ready but prepared indexes are unavailable.", {
        state: this.state,
      });
    }
    return executeSearch(this.preparedData, conditions, limit);
  }

  public searchProjection<K extends FieldName<T>>(
    conditions: readonly Condition<T>[],
    fields: readonly K[],
    limit?: number,
  ): readonly Pick<T, K>[] {
    if (fields.length === 0) {
      throw new QueryValidationError(
        "Typed projection requires at least one selected field.",
        "QUERY_INVALID_CONDITION",
      );
    }

    for (const field of fields) {
      if (!this.schema.fieldMap.has(field)) {
        throw new QueryValidationError(
          `Unknown projection field "${field}".`,
          "QUERY_INVALID_CONDITION",
          { field },
        );
      }
    }

    const rows = this.search(conditions, limit);
    return rows.map((row) => {
      const projected = {} as Pick<T, K>;
      for (const field of fields) {
        projected[field] = row[field];
      }
      return projected;
    });
  }

  public searchLegacyProjection(
    conditions: readonly Condition<T>[],
    fields?: readonly FieldName<T>[],
    limit?: number,
  ): readonly Record<string, string | null>[] {
    const selectedFields = fields === undefined || fields.length === 0
      ? this.schema.fields.map((field) => field.name)
      : fields;

    for (const field of selectedFields) {
      if (!this.schema.fieldMap.has(field)) {
        throw new QueryValidationError(
          `Unknown projection field "${field}".`,
          "QUERY_INVALID_CONDITION",
          { field },
        );
      }
    }

    if (this.state !== StoreState.READY) {
      throw new StoreStateError("Store query is allowed only after preparation is complete.", {
        state: this.state,
      });
    }
    if (this.preparedData === undefined) {
      throw new StoreStateError("Store is ready but prepared indexes are unavailable.", {
        state: this.state,
      });
    }
    return executeLegacyProjection(this.preparedData, conditions, selectedFields, limit);
  }

  public getPreparedTrieSnapshot(): TrieSnapshot {
    if (this.state !== StoreState.READY || this.preparedData === undefined) {
      throw new StoreStateError("Trie snapshot is available only after preparation.", {
        state: this.state,
      });
    }
    return this.preparedData.trie;
  }

  public getPreparedData(): PreparedStoreData<T> {
    if (this.state !== StoreState.READY || this.preparedData === undefined) {
      throw new StoreStateError("Prepared store data is available only after preparation.", {
        state: this.state,
      });
    }
    return this.preparedData;
  }

  public getDiagnosticTrieSerialization(): string {
    if (this.state !== StoreState.READY || this.preparedData === undefined) {
      throw new StoreStateError("Trie snapshot is available only after preparation.", {
        state: this.state,
      });
    }
    return serializeTrieSnapshot(this.preparedData.trie);
  }
}
