import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Resolve the Cursor IDE session cookie from the local state DB
 * (same approach as community usage tools). No browser cookie paste needed
 * while you are signed into Cursor.
 */
export async function resolveIdeSessionCookie(): Promise<string | undefined> {
  const dbPath = findStateDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) {
    return undefined;
  }

  const accessToken = await readAccessToken(dbPath);
  if (!accessToken?.startsWith("eyJ")) {
    return undefined;
  }

  const sub = jwtSub(accessToken);
  if (!sub) {
    return undefined;
  }

  // Cookie value uses URL-encoded "::" between sub and JWT.
  return `${sub}%3A%3A${accessToken}`;
}

export function findStateDbPath(): string | undefined {
  const home = os.homedir();
  const candidates: string[] = [];

  if (process.platform === "darwin") {
    candidates.push(
      path.join(
        home,
        "Library",
        "Application Support",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb"
      )
    );
  } else if (process.platform === "win32") {
    const appdata = process.env.APPDATA;
    if (appdata) {
      candidates.push(
        path.join(appdata, "Cursor", "User", "globalStorage", "state.vscdb")
      );
    }
  } else {
    // Linux / other
    candidates.push(
      path.join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb")
    );
  }

  // Cursor nightlies / alternate installs
  candidates.push(
    path.join(home, ".cursor", "User", "globalStorage", "state.vscdb")
  );

  return candidates.find((p) => fs.existsSync(p));
}

async function readAccessToken(dbPath: string): Promise<string | undefined> {
  // Copy to avoid "database is locked" while Cursor holds a WAL write lock.
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cursor-usage-"));
  const tmpDb = path.join(tmpDir, "state.vscdb");
  try {
    await fs.promises.copyFile(dbPath, tmpDb);
    for (const suffix of ["-wal", "-shm"]) {
      const side = dbPath + suffix;
      if (fs.existsSync(side)) {
        try {
          await fs.promises.copyFile(side, tmpDb + suffix);
        } catch {
          // ignore side-car copy failures
        }
      }
    }

    const fromNode = await tryNodeSqlite(tmpDb);
    if (fromNode) {
      return fromNode;
    }

    const fromPython = await tryPythonSqlite(tmpDb);
    if (fromPython) {
      return fromPython;
    }

    return trySqliteCli(tmpDb);
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function tryNodeSqlite(dbPath: string): Promise<string | undefined> {
  try {
    // Available in newer Node / some Electron builds (experimental).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("node:sqlite") as {
      DatabaseSync: new (
        path: string,
        opts?: { readOnly?: boolean }
      ) => {
        prepare: (sql: string) => {
          get: (...params: unknown[]) => { value?: unknown } | undefined;
        };
        close: () => void;
      };
    };
    const db = new mod.DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare("SELECT value FROM ItemTable WHERE key = ?")
        .get("cursorAuth/accessToken");
      const value = row?.value;
      return typeof value === "string" ? value : undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

async function tryPythonSqlite(dbPath: string): Promise<string | undefined> {
  const script = [
    "import sqlite3,sys",
    "conn=sqlite3.connect(sys.argv[1])",
    "cur=conn.cursor()",
    "cur.execute(\"SELECT value FROM ItemTable WHERE key='cursorAuth/accessToken'\")",
    "row=cur.fetchone()",
    "sys.stdout.write(row[0] if row and row[0] else '')",
  ].join(";");

  for (const bin of pythonBins()) {
    try {
      const { stdout } = await execFileAsync(bin, ["-c", script, dbPath], {
        timeout: 8000,
        maxBuffer: 2 * 1024 * 1024,
      });
      const token = String(stdout || "").trim();
      if (token.startsWith("eyJ")) {
        return token;
      }
    } catch {
      // try next interpreter
    }
  }
  return undefined;
}

function pythonBins(): string[] {
  if (process.platform === "win32") {
    return ["py", "python", "python3"];
  }
  return ["python3", "python"];
}

async function trySqliteCli(dbPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "sqlite3",
      [dbPath, "SELECT value FROM ItemTable WHERE key='cursorAuth/accessToken';"],
      { timeout: 8000, maxBuffer: 2 * 1024 * 1024 }
    );
    const token = String(stdout || "").trim();
    return token.startsWith("eyJ") ? token : undefined;
  } catch {
    return undefined;
  }
}

function jwtSub(token: string): string | undefined {
  const parts = token.split(".");
  if (parts.length < 2) {
    return undefined;
  }
  try {
    const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
    const json = Buffer.from(padded, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { sub?: string };
    return typeof payload.sub === "string" ? payload.sub : undefined;
  } catch {
    try {
      const padded = parts[1] + "=".repeat((4 - (parts[1].length % 4)) % 4);
      const json = Buffer.from(padded, "base64").toString("utf8");
      const payload = JSON.parse(json) as { sub?: string };
      return typeof payload.sub === "string" ? payload.sub : undefined;
    } catch {
      return undefined;
    }
  }
}
