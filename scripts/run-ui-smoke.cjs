const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const electronPath = require("electron");

const marker = "AIIM Electron smoke test passed:";
const child = spawn(electronPath, ["--disable-gpu", path.join(__dirname, "ui-smoke.cjs")], {
  cwd: path.resolve(__dirname, ".."),
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
let finished = false;
const timeout = setTimeout(() => finish(1, "AIIM Electron smoke test timed out.\n"), 90_000);

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  output += text;
  if (output.includes(marker)) finish(0);
});
child.stderr.on("data", (chunk) => {
  const text = chunk.toString();
  process.stderr.write(text);
  output += text;
});
child.on("error", (error) => finish(1, `${error.message}\n`));
child.on("exit", (code) => {
  if (!finished) finish(code === 0 && output.includes(marker) ? 0 : code ?? 1);
});

function finish(code, message = "") {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  if (message) process.stderr.write(message);
  if (child.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  process.exit(code);
}
