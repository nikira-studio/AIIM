import { rm } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const target = path.resolve(projectRoot, "releases");
if (path.dirname(target) !== projectRoot) throw new Error(`Refusing to clean outside the project: ${target}`);
await rm(target, { recursive: true, force: true });