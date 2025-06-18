/* tslint:disable */
/* eslint-disable */
export function init(): void;
export class Database {
  free(): void;
  constructor(path: string);
  exec(_sql: string): void;
  prepare(_sql: string): Statement;
}
export class RowIterator {
  private constructor();
  free(): void;
  next(): any;
}
export class Statement {
  private constructor();
  free(): void;
  raw(toggle?: boolean | null): Statement;
  get(): any;
  all(): Array<any>;
  iterate(): any;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_database_free: (a: number, b: number) => void;
  readonly database_new: (a: number, b: number) => number;
  readonly database_exec: (a: number, b: number, c: number) => void;
  readonly database_prepare: (a: number, b: number, c: number) => number;
  readonly __wbg_rowiterator_free: (a: number, b: number) => void;
  readonly rowiterator_next: (a: number) => any;
  readonly __wbg_statement_free: (a: number, b: number) => void;
  readonly statement_raw: (a: number, b: number) => number;
  readonly statement_get: (a: number) => any;
  readonly statement_all: (a: number) => any;
  readonly statement_iterate: (a: number) => any;
  readonly init: () => void;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_export_2: WebAssembly.Table;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
