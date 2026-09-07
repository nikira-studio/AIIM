import { rm } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
for (const directory of ["dist", "dist-electron"]) {
  const target = path.resolve(projectRoot, directory);
  if (path.dirname(target) !== projectRoot) throw new Error(`Refusing to clean outside the project: ${target}`);
  await removeBuildDirectory(target);
}

async function removeBuildDirectory(target) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 });
      return;
    } catch (error) {
      if (attempt === 4 || !isRetryableWindowsLock(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}

function isRetryableWindowsLock(error) {
  return error && typeof error === "object" && "code" in error && (error.code === "EPERM" || error.code === "EBUSY");
}
