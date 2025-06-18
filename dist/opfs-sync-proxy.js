// deno-sync-proxy.js - Deno 2.x compatible version
let transferBuffer, statusBuffer, statusArray, statusView;
let transferArray;
let rootDir = null;
const handles = new Map();
let nextFd = 1;

// Deno worker message handling
self.onmessage = async (e) => {
  log("handle message: ", e.data);
  
  if (e.data.cmd === "init") {
    log("init");
    transferBuffer = e.data.transferBuffer;
    statusBuffer = e.data.statusBuffer;
    transferArray = new Uint8Array(transferBuffer);
    statusArray = new Int32Array(statusBuffer);
    statusView = new DataView(statusBuffer);
    self.postMessage("done");
    return;
  }
  
  try {
    const result = await handleCommand(e.data);
    sendResult(result);
  } catch (err) {
    err("Command failed:", err);
    sendResult({ success: false, error: err.message });
  }
};

// Send ready signal
self.postMessage("ready");

self.onerror = (err) => {
  console.error("deno-sync error: ", err);
  // Don't close, keep running
  return true; // Prevents default error handling
};

function handleCommand(msg) {
  log(`handle message: ${msg.cmd}`);
  switch (msg.cmd) {
    case "open":
      return handleOpen(msg.path);
    case "close":
      return handleClose(msg.fd);
    case "read":
      return handleRead(msg.fd, msg.offset, msg.size);
    case "write":
      return handleWrite(msg.fd, msg.buffer, msg.offset);
    case "size":
      return handleSize(msg.fd);
    case "sync":
      return handleSync(msg.fd);
    default:
      throw new Error(`Unknown command: ${msg.cmd}`);
  }
}

async function handleOpen(path) {
  if (!rootDir) {
    // Use current working directory as root, or specify a different base path
    rootDir = Deno.cwd();
  }
  
  const fd = nextFd++;
  
  // Resolve the full path
  const fullPath = path.startsWith('/') ? path : `${rootDir}/${path}`;
  
  try {
    // Try to open existing file first
    let file;
    /* try {
      file = await Deno.open(fullPath, { read: true, write: true });
    } catch (error) {
      // If file doesn't exist, create it
      if (error instanceof Deno.errors.NotFound) {
        file = await Deno.open(fullPath, { 
          read: true, 
          write: true, 
          create: true 
        });
      } else {
        throw error;
      }
    } */
    
    handles.set(fd, { file, path: fullPath });
    log(`Opened file: ${fullPath} with fd: ${fd}`);
    return { fd };
  } catch (err) {
    logError(`Failed to open file ${fullPath}:`, err);
    throw err;
  }
}

function handleClose(fd) {
  const handle = handles.get(fd);
  if (!handle) {
    throw new Error(`Invalid file descriptor: ${fd}`);
  }
  log(`handle: ${handle}`);
  handle.file.close();
  handles.delete(fd);
  log(`Closed fd: ${fd}`);
  return { success: true };
}

async function handleRead(fd, offset, size) {
  const handle = handles.get(fd);
  if (!handle) {
    throw new Error(`Invalid file descriptor: ${fd}`);
  }
  
  try {
    // Seek to the specified offset
    await handle.file.seek(offset, Deno.SeekMode.Start);
    
    // Create buffer for reading
    const readBuffer = new Uint8Array(size);
    
    // Read data
    const bytesRead = await handle.file.read(readBuffer);
    const actualSize = bytesRead || 0;
    
    log("deno-sync read: size: ", actualSize);
    log("deno-sync read buffer: ", [...readBuffer.slice(0, Math.min(10, actualSize))]);
    
    // Copy to transfer buffer
    transferArray.set(readBuffer.slice(0, actualSize));
    
    return { success: true, length: actualSize };
  } catch (err) {
    logError(`Read failed for fd ${fd}:`, err);
    throw err;
  }
}

async function handleWrite(fd, buffer, offset) {
  const handle = handles.get(fd);
  if (!handle) {
    throw new Error(`Invalid file descriptor: ${fd}`);
  }
  
  try {
    log("deno-sync buffer size:", buffer.byteLength);
    log("deno-sync write buffer: ", [...buffer.slice(0, Math.min(10, buffer.byteLength))]);
    
    // Seek to the specified offset
    await handle.file.seek(offset, Deno.SeekMode.Start);
    
    // Write data
    const bytesWritten = await handle.file.write(buffer);
    
    log(`Written ${bytesWritten} bytes to fd ${fd}`);
    return { success: true, length: bytesWritten };
  } catch (err) {
    logError(`Write failed for fd ${fd}:`, err);
    throw err;
  }
}

async function handleSize(fd) {
  const handle = handles.get(fd);
  if (!handle) {
    throw new Error(`Invalid file descriptor: ${fd}`);
  }
  
  try {
    const stat = await handle.file.stat();
    const size = stat.size;
    log(`File size for fd ${fd}: ${size}`);
    return { success: true, length: size };
  } catch (error) {
    error(`Size check failed for fd ${fd}:`, error);
    throw error;
  }
}

async function handleSync(fd) {
  const handle = handles.get(fd);
  if (!handle) {
    throw new Error(`Invalid file descriptor: ${fd}`);
  }
  
  try {
    // Sync file to disk
    await handle.file.sync();
    log(`Synced fd ${fd}`);
    return { success: true };
  } catch (err) {
    logError(`Sync failed for fd ${fd}:`, err);
    throw err;
  }
}

function sendResult(result) {
  try {
    if (result?.fd) {
      statusView.setInt32(4, result.fd, true);
    } else {
      log("deno-sync-proxy: result.length: ", result.length);
      statusView.setInt32(4, result?.length || 0, true);
    }
    
    // Set success/error status
    statusView.setInt32(8, result?.success ? 1 : 0, true);
      // index 0 : ready flag
     // index 1 : positive = fd/length  |  negative = error code
     const value = result?.fd ?? result?.length ?? 0;
     statusArray[1] = result?.success !== false ? value : -value;
    
    Atomics.store(statusArray, 0, 1);
    Atomics.notify(statusArray, 0);
  } catch (err) {
    logError("Failed to send result:", err);
  }
}

// logLevel:
//
// 0 = no logging output
// 1 = only errors
// 2 = warnings and errors
// 3 = debug, warnings, and errors
const logLevel = 3; // Increased for debugging

const loggers = {
  0: console.error.bind(console),
  1: console.warn.bind(console),
  2: console.log.bind(console),
};

const logImpl = (level, ...args) => {
  if (logLevel > level) loggers[level]("DENO asyncer:", ...args);
};

const log = (...args) => logImpl(2, ...args);
const warn = (...args) => logImpl(1, ...args);
const error = (...args) => logImpl(0, ...args);
const logError = (...a) => logImpl(0, ...a);