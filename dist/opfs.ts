//--------------------------------------------------------------------
// globals that the old worker and your WASM side already expect
//--------------------------------------------------------------------
let transferBuffer: SharedArrayBuffer;
let statusBuffer: SharedArrayBuffer;
let transferArray: Uint8Array;
let statusArray: Int32Array;
let statusView: DataView;

// very small in-memory “filesystem”
const handles = new Map<number, { path: string; data: Uint8Array }>();
let nextFd = 1;

//--------------------------------------------------------------------
// lightweight logger (unchanged)
//--------------------------------------------------------------------
const logLevel = 2;                                     // 0-silent … 3-debug
const loggers = { 0: console.error, 1: console.warn, 2: console.log };
const log = (...a: unknown[]) => { if (logLevel >= 2) loggers[2]("VFS:", ...a); };
const error = (...a: unknown[]) => loggers[0]("VFS:", ...a);

//====================================================================
//  VFS  – same public API, no workers
//====================================================================
export class VFS {
  transferBuffer: SharedArrayBuffer;
  statusBuffer:   SharedArrayBuffer;
  statusArray:    Int32Array;
  statusView:     DataView;
  isReady = false;
  ready: Promise<void>;

  constructor() {
    this.transferBuffer = new SharedArrayBuffer(1024 * 1024);               // 1 MiB
    this.statusBuffer   = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3);

    this.statusArray = new Int32Array(this.statusBuffer);
    this.statusView  = new DataView(this.statusBuffer);

    // without a worker we can resolve immediately
    this.ready = Promise.resolve();
  }

  //------------------------------------------------------------------
  //  kept exactly as you showed – just no messaging
  //------------------------------------------------------------------
  initWorker() {
    transferBuffer = this.transferBuffer;
    statusBuffer   = this.statusBuffer;
    transferArray  = new Uint8Array(transferBuffer);
    statusArray    = new Int32Array(statusBuffer);
    statusView     = new DataView(statusBuffer);
    this.isReady   = true;
  }

  //------------------------------------------------------------------
  // 1. open(path) → fd  (was “handleOpen” inside the worker)
  //------------------------------------------------------------------
  open(path: string): number {
    // resolve to a “full” path only for bookkeeping
    
    const rootDir = Deno.cwd();
    
    const fullPath = path.startsWith('/') ? path : `${rootDir}/${path}`;

    // if you already have bytes from your KV store, plug them in here
    const handleData = new Uint8Array(0);

    const fd = nextFd++;
    handles.set(fd, { path: fullPath, data: handleData });
    log("open:", fullPath, "→ fd", fd);
    return fd;
  }

  //------------------------------------------------------------------
  // 2. close(fd)
  //------------------------------------------------------------------
  close(fd: number): true {
    const h = this.expect(fd);
    // flush to KV if necessary (omitted because handled elsewhere)
    handles.delete(fd);
    log("close fd", fd);
    return true;
  }

  //------------------------------------------------------------------
  // 3. pread(fd, buffer, offset)
  //------------------------------------------------------------------
  pread(fd: number, buffer: Uint8Array, offset: number): number {
    const h       = this.expect(fd);
    const avail   = Math.max(0, h.data.length - offset);
    const toCopy  = Math.min(buffer.byteLength, avail);

    if (toCopy) buffer.set(h.data.subarray(offset, offset + toCopy), 0);
    log("pread fd", fd, "@", offset, "→", toCopy, "bytes");
    return toCopy;
  }

  //------------------------------------------------------------------
  // 4. pwrite(fd, buffer, offset)
  //------------------------------------------------------------------
  pwrite(fd: number, src: Uint8Array, offset: number): number {
    const h     = this.expect(fd);
    const need  = offset + src.length;

    if (need > h.data.length) {
      const grown = new Uint8Array(need);
      grown.set(h.data);
      h.data = grown;
      handles.set(fd, h);                               // re-store grown buf
    }

    h.data.set(src, offset);
    log("pwrite fd", fd, "@", offset, "←", src.length, "bytes");
    return src.length;
  }

  //------------------------------------------------------------------
  // 5. size(fd)
  //------------------------------------------------------------------
  size(fd: number): bigint {
    const sz = BigInt(this.expect(fd).data.length);
    log("size fd", fd, "→", sz);
    return sz;
  }

  //------------------------------------------------------------------
  // 6. sync(fd)  (noop until durability needed)
  //------------------------------------------------------------------
  sync(_fd: number): void {
    /* If durability is required, hook into your KV layer here */
    log("sync fd", _fd);
  }

  //------------------------------------------------------------------
  // helper
  //------------------------------------------------------------------
  private expect(fd: number) {
    const h = handles.get(fd);
    if (!h) throw new Error(`invalid fd ${fd}`);
    return h;
  }
}
