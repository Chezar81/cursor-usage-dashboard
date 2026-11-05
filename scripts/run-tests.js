/**
 * Typecheck src+test, bundle the tests with esbuild (aliasing `vscode` to a
 * small stub), and run them with Node's built-in test runner.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const esbuild = require("esbuild");

const root = path.join(__dirname, "..");
const outdir = path.join(root, ".test-dist");

async function main() {
  const tsc = spawnSync(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "--noEmit",
      "-p",
      path.join(root, "tsconfig.test.json"),
    ],
    { stdio: "inherit" }
  );
  if (tsc.status !== 0) {
    process.exit(tsc.status ?? 1);
  }

  const entries = fs
    .readdirSync(path.join(root, "test"))
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => path.join(root, "test", name));
  if (!entries.length) {
    console.error("No test files found under test/");
    process.exit(1);
  }

  await esbuild.build({
    entryPoints: entries,
    bundle: true,
    platform: "node",
    format: "cjs",
    outdir,
    alias: { vscode: path.join(root, "test", "vscode-stub.ts") },
    logLevel: "warning",
  });

  try {
    const run = spawnSync(process.execPath, ["--test", outdir], {
      stdio: "inherit",
    });
    process.exit(run.status ?? 1);
  } finally {
    fs.rmSync(outdir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(outdir, { recursive: true, force: true });
  process.exit(1);
});
