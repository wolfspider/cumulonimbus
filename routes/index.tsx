/// <reference lib="deno.unstable" />
import { useSignal } from "@preact/signals";
import { define } from "../utils.ts";
import Counter from "../islands/Counter.tsx";

import { VFS } from "../dist/opfs.js";
import init, { Database } from "../dist/index.js";

let db: Database | null = null;
let currentStmt = null;

const res: [string] = [""];

type LocalFS = {
  VFS: VFS | null;
  FD: number | null;
}

const localVFS: LocalFS = { VFS: null, FD: null };

const path = "./test2.db";

async function initVFS() {
  const vfs = new VFS();
  await vfs.ready;
  localVFS.VFS = vfs;
  localVFS.FD = vfs.open(path);
  return vfs;
}

async function initAll() {
  await initVFS();
  await init();
}

await initAll();

export default define.page(function Home() {
  const count = useSignal(3);

  db = new Database("test2.db");

  try {
    db?.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT);`);

    db?.exec(`INSERT INTO users VALUES (1, 'Alice', 'alice@example.org');`);

    db?.exec(`INSERT INTO users VALUES (2, 'Bob', 'bob@example.org');`);

    db?.exec(`INSERT INTO users VALUES (3, 'bill', 'bill@example.com');`);
  } catch (e) {
    console.log(e);
  }

  currentStmt = db?.prepare("SELECT * FROM users;");
  const results = currentStmt?.raw().all();

  results?.forEach(r => res.push(r[1]));

  console.log("results: ", results, "LocalVFS: ", localVFS);

  //Does not work
  //localVFS.VFS?.close(localVFS.FD);

  localVFS.VFS?.worker.terminate();

  console.log(res);

  return (
    <div class="px-4 py-8 mx-auto fresh-gradient">
      <div class="max-w-screen-md mx-auto flex flex-col items-center justify-center">
        <img
          class="my-6"
          src="/logo.svg"
          width="128"
          height="128"
          alt="the Fresh logo: a sliced lemon dripping with juice"
        />
        <h1 class="text-4xl font-bold">Welcome to Fresh</h1>
        <p class="my-4">
          Try updating this message in the
          <code class="mx-2">./routes/index.tsx</code> file, and refresh.
        </p>
        <Counter count={count} />
      </div>
      {res.map(r => <div>{r}</div>)}
    </div>
  );
});
