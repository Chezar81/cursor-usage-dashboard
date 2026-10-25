const fs = require("fs");
const os = require("os");
const path = require("path");

const extensionsDir = path.join(os.homedir(), ".cursor", "extensions");
const prefix = "local.cursor-usage-dashboard-";
const source = path.join(__dirname, "..", "dist", "extension.js");

if (!fs.existsSync(source)) {
  console.error("Missing build output:", source);
  process.exit(1);
}

const matches = fs
  .readdirSync(extensionsDir)
  .filter((name) => name.startsWith(prefix))
  .sort();

if (matches.length === 0) {
  console.error("Installed extension not found under", extensionsDir);
  process.exit(1);
}

const targetDir = path.join(extensionsDir, matches[matches.length - 1], "dist");
const target = path.join(targetDir, "extension.js");
const temporary = path.join(targetDir, "extension.js.installing");

fs.copyFileSync(source, temporary);
fs.renameSync(temporary, target);
console.log("Installed", target);
