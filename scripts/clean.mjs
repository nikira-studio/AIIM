import { rm } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
for (const directory of ["dist", "dist-electron"]) {
  const target = path.resolve(projectRoot, directory);
  if (path.dirname(target) !== projectRoot) throw new Error(`Refusing to clean outside the project: ${target}`);
  await rm(target, { recursive: true, force: true });
}
