import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { LocalStore } from "../src/storage";
import type { DashboardData, WorkspaceStore } from "../src/types";
import type { Uri } from "vscode";

function makeStore(dir: string): LocalStore {
  return new LocalStore({ fsPath: dir } as Uri);
}

function seed(store: LocalStore): Promise<WorkspaceStore> {
  return store.updateWorkspaceStore((data) => {
    data.workspaces["file:///ws"] = {
      displayName: "WS",
      tokens: 0,
      costCents: 0,
      lastActiveAt: new Date().toISOString(),
    };
  });
}

test("concurrent updates from two store instances lose no increments", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-store-test-"));
  try {
    // Two instances = two extension hosts (windows) sharing one directory;
    // only the lock file can serialize their load→mutate→save cycles.
    const a = makeStore(dir);
    const b = makeStore(dir);
    await seed(a);

    const increments = Array.from({ length: 25 }, (_, i) =>
      (i % 2 === 0 ? a : b).updateWorkspaceStore((data) => {
        data.workspaces["file:///ws"].tokens += 1;
      })
    );
    await Promise.all(increments);

    const loaded = await a.loadWorkspaceStore();
    assert.equal(loaded.workspaces["file:///ws"].tokens, 25);
    // Lock is released afterwards.
    assert.equal(fs.existsSync(path.join(dir, "workspace-usage.json.lock")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("mutator returning false skips the write", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-store-test-"));
  try {
    const store = makeStore(dir);
    await seed(store);
    await store.updateWorkspaceStore((data) => {
      data.workspaces["file:///ws"].tokens = 99;
      return false;
    });
    const loaded = await store.loadWorkspaceStore();
    assert.equal(loaded.workspaces["file:///ws"].tokens, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cached dashboard round-trips through concurrent saves", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-store-test-"));
  try {
    const store = makeStore(dir);
    const data = { fetchedAt: "2026-10-25T08:00:00.000Z" } as DashboardData;
    await Promise.all([
      store.saveCachedDashboard(data),
      store.saveCachedDashboard(data),
      store.saveCachedDashboard(data),
    ]);
    const loaded = await store.loadCachedDashboard();
    assert.equal(loaded?.fetchedAt, data.fetchedAt);
    // No orphaned atomic-write temps remain.
    const temps = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(temps, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
