// Fixed VFS with proper SQLite header initialization
/// <reference lib="deno.unstable" />
import {
  getAsBlob,
  set as kvSet,
  remove as kvRemove,
} from "jsr:@kitsonk/kv-toolbox/blob";

const files = new Map<number, Deno.FsFile>();
let nextFd = 3;
const PAGE_SIZE = 4096;

function nukeSidecar(dbPath: string) {
  for (const ext of ["-wal", "-shm"]) {
    const p = `${dbPath}${ext}`;
    try {
      const info = Deno.statSync(p);
      if (info.isFile && info.size > 0) {
        console.warn(`VFS: removing stale ${ext} file`);
        Deno.removeSync(p);
      }
    } catch (_e) {
      /* file doesn't exist → ignore */
    }
  }
}

function initHeader(): Uint8Array {
  // Create a minimal valid SQLite database that matches what `sqlite3 :memory: .backup test.db` would create
  const page = new Uint8Array(PAGE_SIZE);

  // SQLite format string (bytes 0-15)
  const header = [
    0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66,  // "SQLite f"
    0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00   // "ormat 3\0"
  ];
  page.set(header, 0);

  // Database header (bytes 16-99)
  page[16] = (PAGE_SIZE >> 8) & 0xff;  // Page size high byte
  page[17] = PAGE_SIZE & 0xff;         // Page size low byte
  page[18] = 1;    // File format write version
  page[19] = 1;    // File format read version  
  page[20] = 0;    // Reserved space at end of each page
  page[21] = 64;   // Maximum embedded payload fraction (must be 64)
  page[22] = 32;   // Minimum embedded payload fraction (must be 32)
  page[23] = 32;   // Minimum leaf payload fraction (must be 32)

  // File change counter (24-27)
  page[24] = 0; page[25] = 0; page[26] = 0; page[27] = 1;

  // Database size in pages (28-31) 
  page[28] = 0; page[29] = 0; page[30] = 0; page[31] = 1;

  // First freelist trunk page (32-35) - 0 means no freelist
  page[32] = 0; page[33] = 0; page[34] = 0; page[35] = 0;

  // Total freelist pages (36-39)
  page[36] = 0; page[37] = 0; page[38] = 0; page[39] = 0;

  // Schema cookie (40-43) - increment when schema changes
  page[40] = 0; page[41] = 0; page[42] = 0; page[43] = 1;

  // Schema format (44-47) - 4 = modern format
  page[44] = 0; page[45] = 0; page[46] = 0; page[47] = 4;

  // Default page cache size (48-51)
  page[48] = 0; page[49] = 0; page[50] = 0; page[51] = 0;

  // Largest root B-tree page (52-55) - 0 for no auto-vacuum
  page[52] = 0; page[53] = 0; page[54] = 0; page[55] = 0;

  // Text encoding (56-59): 1=UTF-8, 2=UTF-16le, 3=UTF-16be
  page[56] = 0; page[57] = 0; page[58] = 0; page[59] = 1;

  // User version (60-63)
  page[60] = 0; page[61] = 0; page[62] = 0; page[63] = 0;

  // Incremental vacuum (64-67) - 0=disabled
  page[64] = 0; page[65] = 0; page[66] = 0; page[67] = 0;

  // Application ID (68-71)
  page[68] = 0; page[69] = 0; page[70] = 0; page[71] = 0;

  // Reserved space (72-91) - must be zero
  for (let i = 72; i < 92; i++) page[i] = 0;

  // Version-valid-for number (92-95)
  page[92] = 0; page[93] = 0; page[94] = 0; page[95] = 1;

  // SQLite version number (96-99) - version that created this file
  page[96] = 0; page[97] = 0x3c; page[98] = 0x2c; page[99] = 0x04;

  // Page 1 B-tree header (starts at byte 100)
  // This is the sqlite_master table (schema table)
  page[100] = 0x0d;  // Page type: leaf table B-tree (13)

  // First freeblock (101-102) - 0 means no free blocks
  page[101] = 0; page[102] = 0;

  // Number of cells (103-104) - 0 for empty table
  page[103] = 0; page[104] = 0;

  // Cell content area start (105-106) - grows backward from end
  page[105] = (PAGE_SIZE >> 8) & 0xff;
  page[106] = PAGE_SIZE & 0xff;

  // Fragmented free bytes (107)
  page[107] = 0;

  // Cell pointer array starts at byte 108, but we have 0 cells
  // so no cell pointers needed

  return page;
}

function flagsToOpts(flag = "r"): Deno.OpenOptions {
  const o: Deno.OpenOptions = {};

  for (const ch of flag) {
    switch (ch) {
      case "r":                 // read-only
        o.read = true;
        break;

      case "w":                 // read-write, create, truncate
        o.read = true;
        o.write = true;
        o.create = true;
        o.truncate = true;
        break;

      case "a":                 // read-write, create — but *no* O_APPEND
        o.read = true;          // “a+” will also include '+', but be explicit
        o.write = true;
        o.create = true;
        //  ↖ intentionally do NOT set o.append
        break;

      case "c":                 // create only
        o.create = true;
        break;

      case "+":                 // upgrade to read-write if it wasn’t already
        o.read = true;
        o.write = true;
        break;

      default:
        throw new TypeError(`Unknown flag char '${ch}' in "${flag}"`);
    }
  }

  return o;
}

function getFile(fd: number): Deno.FsFile {
  const f = files.get(fd);
  if (!f) throw new Error(`Invalid file descriptor: ${fd}`);
  return f;
}

function loopRead(f: Deno.FsFile, buf: Uint8Array): number {
  let done = 0;
  while (done < buf.length) {
    const n = f.readSync(buf.subarray(done)) ?? 0;
    if (n === 0) break;
    done += n;
  }
  return done;
}

function loopWrite(f: Deno.FsFile, buf: Uint8Array): number {
  let done = 0;
  while (done < buf.length) {
    done += f.writeSync(buf.subarray(done));
  }
  return done;
}

function isSidecar(p: string): boolean {
  return p.endsWith("-wal") || p.endsWith("-shm");
}

type KvFile = {
  /** path (used as KV key component) */
  path: string;
  /** whole file kept in memory                     */
  buf: Uint8Array;
  /** current file cursor (seek position)           */
  pos: number;
  /** true ⇢ needs flushing back to KV on sync/close */
  dirty: boolean;
};

const DUMMY: KvFile = {
  path: "null",
  buf: new Uint8Array(0), // size = 0  ⇒  size(fd) === 0 OK
  pos: 0,
  dirty: false,
};

export class VFS {

  #kv: Deno.Kv;
  #files = new Map<number, KvFile>([
    [0, { ...DUMMY, path: "stdin" }],
    [1, { ...DUMMY, path: "stdout" }],
    [2, { ...DUMMY, path: "stderr" }],
  ]);
  #nextFd = 3;

  constructor(kv: Deno.Kv) {
    this.#kv = kv;
  }

  async open(path: string | URL, flag = "r"): Promise<number> {
    const p = path.toString();
    const opts = flagsToOpts(flag);

    // 1. fetch blob from KV if it exists
    let fileBlob = await getAsBlob(this.#kv, ["files", p]).catch(() => null);
    console.log(fileBlob);
    // 2. create new buffer if file absent and caller is allowed to create
    if (!fileBlob) {
      if (!opts.create && !opts.write) {
        throw new Deno.errors.NotFound(`No such file: ${p}`);
      }
      const initial = isSidecar(p) ? new Uint8Array()
                                   : initHeader();        // SQLite header
      fileBlob = new File([initial], p);
      await kvSet(this.#kv, ["files", p], fileBlob);
    }

    // 3. materialise into Uint8Array so I/O stays synchronous-looking
    const buf = new Uint8Array(await fileBlob.arrayBuffer());

    const fd = this.#nextFd++;
    this.#files.set(fd, { path: p, buf, pos: 0, dirty: false });
    console.log("open() returning", fd, "for", path.toString());
    return fd;
  }

  async close(fd: number): Promise<void> {
    const h = this.#files.get(fd);
    if (!h) throw new Error(`Invalid fd ${fd}`);

    if (h.dirty) {
      await kvSet(this.#kv, ["files", h.path], new File([h.buf], h.path));
    }
    this.#files.delete(fd);
  }

  /* ─────────────────────────────── PRIMITIVES ───────────────────────────── */

  pread(fd: number, dst: Uint8Array, off: number): number {
    const h = this.#get(fd);
    const end = Math.min(off + dst.length, h.buf.length);
    const slice = h.buf.subarray(off, end);
    dst.set(slice);
    return slice.length;
  }

  pwrite(fd: number, src: Uint8Array, off: number): number {
    const h = this.#get(fd);
    const needed = off + src.length;
    if (needed > h.buf.length) {                       // grow file
      const grown = new Uint8Array(needed);
      grown.set(h.buf);
      h.buf = grown;
    }
    h.buf.set(src, off);
    h.dirty = true;
    return src.length;
  }

  size(fd: number): bigint {
    return BigInt(this.#get(fd).buf.length);
  }

  /** flush current buffer to KV */
  async sync(fd: number): Promise<void> {
    const h = this.#get(fd);
    if (!h.dirty) return;
    await kvSet(this.#kv, ["files", h.path], new File([h.buf], h.path));
    h.dirty = false;
  }

  /* ─────────────────────────────── HELPERS ──────────────────────────────── */

  #get(fd: number): KvFile {
    const h = this.#files.get(fd);
    if (!h) throw new Error(`Invalid fd ${fd}`);
    return h;
  }

  /* optional: convenience for deleting side-cars when main DB recreated */
  async nukeSidecar(p: string) {
    for (const ext of ["-wal", "-shm"]) {
      const key = ["files", `${p}${ext}`];
      const r = await this.#kv.get(key);
      if (r.value) await kvRemove(this.#kv, key);
    }
  }
}