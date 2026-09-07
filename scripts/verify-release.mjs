import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const bundleDirectory = "dist";
const desktopDirectory = "dist-electron";
const outputDirectory = "releases";

runNpm("test");
runNpm("build");

assert(packageJson.main === `${desktopDirectory}/main/main.js`, `package main must point to ${desktopDirectory}`);
assert(packageJson.build?.directories?.output === outputDirectory, `installer output must be ${outputDirectory}`);
assert(packageJson.scripts?.["package:win"]?.includes("npm run clean:releases"), "Windows packaging must remove the previous release output");
assert(packageJson.build?.files?.includes(`${bundleDirectory}/**/*`), `installer must include ${bundleDirectory}`);
assert(packageJson.build?.files?.includes(`${desktopDirectory}/**/*`), `installer must include ${desktopDirectory}`);

const mainSource = read("src/main/main.ts");
const viteSource = read("vite.config.mjs");
const cleanSource = read("scripts/clean.mjs");
const versionSource = read("src/shared/version.ts");
const nodeTypeScriptConfig = JSON.parse(read("tsconfig.node.json"));
assert(mainSource.includes(`../../${bundleDirectory}/index.html`), "desktop window must load the current renderer bundle");
assert(viteSource.includes(`outDir: "${bundleDirectory}"`), "Vite must build the current renderer bundle");
assert(cleanSource.includes(`"${bundleDirectory}"`) && cleanSource.includes(`"${desktopDirectory}"`), "clean must target both current build directories");
assert(nodeTypeScriptConfig.compilerOptions?.outDir === desktopDirectory, "desktop TypeScript output must use the current release directory");
assert(versionSource.includes(`appVersion = "${packageJson.version}"`), "the shared app version must match package.json");
assert(!Object.values({ ...packageJson.dependencies, ...packageJson.devDependencies }).includes("latest"), "release dependencies must use exact versions");
for (const requiredFile of ["README.md", "PRIVACY.md", "SECURITY.md", "CHANGELOG.md", "RELEASE-CHECKLIST.md", "LICENSE", "CONTRIBUTING.md", "build/installer.nsh", "src/templates/aiim-character.schema.json", "scripts/ui-smoke.cjs", "scripts/clean-releases.mjs"]) assert(existsSync(path.join(root, requiredFile)), `release documentation is missing: ${requiredFile}`);
assert(packageJson.license === "MIT", "package license must be MIT");
assert(packageJson.author?.name === "Nikira Studio" && packageJson.author?.url === "https://nikira.com", "publisher metadata must identify Nikira Studio");
assert(packageJson.build?.files?.includes("LICENSE"), "the packaged app must include the MIT license");
assert(packageJson.build?.nsis?.include === "build/installer.nsh", "the installer must include the custom uninstall behavior");
assert(read("index.html").includes("Content-Security-Policy"), "renderer content security policy is missing");
assert(mainSource.includes("new Tray(") && mainSource.includes("app:quit"), "Windows tray and explicit quit behavior are missing");
assertPublicFilesContainNoSensitiveData();

const bundleIndex = path.join(root, bundleDirectory, "index.html");
assert(existsSync(bundleIndex), "renderer index was not built");
assert(existsSync(path.join(root, desktopDirectory, "main", "main.js")), "desktop main process was not built");
assert(existsSync(path.join(root, desktopDirectory, "preload.js")), "desktop preload was not built");
for (const relativeAsset of linkedAssets(readFileSync(bundleIndex, "utf8"))) {
  assert(existsSync(path.join(root, bundleDirectory, relativeAsset)), `renderer asset is missing: ${relativeAsset}`);
}

const templateDirectory = path.join(root, "src", "templates", "built-in-characters");
const templateFiles = readdirSync(templateDirectory).filter((file) => file.endsWith(".json"));
const ids = new Set();
const screenNames = new Set();
for (const file of templateFiles) {
  const template = JSON.parse(readFileSync(path.join(templateDirectory, file), "utf8"));
  assert(template.schemaVersion === 1, `${file} must use character schema version 1`);
  for (const field of ["id", "displayName", "screenName", "pack", "group", "systemPrompt"]) assert(typeof template[field] === "string" && template[field].trim(), `${file} is missing ${field}`);
  assert(typeof template.userRole === "string", `${file} has an invalid userRole`);
  const id = template.id.toLowerCase();
  const screenName = template.screenName.toLowerCase();
  assert(!ids.has(id), `duplicate character id: ${template.id}`);
  assert(!screenNames.has(screenName), `duplicate character screen name: ${template.screenName}`);
  ids.add(id);
  screenNames.add(screenName);
  if (template.avatarUrl) {
    assert(!path.isAbsolute(template.avatarUrl) && !template.avatarUrl.includes(".."), `${file} has an unsafe bundled portrait path`);
    assert(existsSync(path.join(root, "public-release", template.avatarUrl)), `${file} portrait is missing: ${template.avatarUrl}`);
    assert(existsSync(path.join(root, bundleDirectory, template.avatarUrl)), `${file} portrait was not copied into the app bundle`);
  }
}
assert(existsSync(path.join(root, bundleDirectory, "running-robot.png")), "running robot branding is missing from the app bundle");

console.log(`\nAIIM ${packageJson.version} verified: ${templateFiles.length} character templates, renderer bundle, desktop process, persistence tests, and integration checks.`);

function runNpm(script) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const arguments_ = npmCli ? [npmCli, "run", script] : ["run", script];
  const result = spawnSync(command, arguments_, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function linkedAssets(html) {
  return [...html.matchAll(/(?:src|href)="\.\/([^"#?]+)"/g)].map((match) => match[1]);
}

function assertPublicFilesContainNoSensitiveData() {
  const roots = ["src", "scripts"];
  const files = [
    ...roots.flatMap((relativeRoot) => textFiles(path.join(root, relativeRoot))),
    ...[".gitignore", "CHANGELOG.md", "CONTRIBUTING.md", "PRIVACY.md", "README.md", "RELEASE-CHECKLIST.md", "SECURITY.md", "index.html", "package.json", "tsconfig.json", "tsconfig.node.json", "vite.config.mjs"].map((file) => path.join(root, file)),
  ];
  const forbidden = [
    { label: "Windows user-profile path", pattern: /[A-Za-z]:\\Users\\[^\\/\s]+/i },
    { label: "macOS user-profile path", pattern: /\/Users\/[^/\s]+/i },
    { label: "Linux user-profile path", pattern: /\/home\/[^/\s]+/i },
    { label: "private network address", pattern: /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})\b/ },
    { label: "secret-shaped access token", pattern: /\b(?:sk|xox[baprs]|gh[pousr])-[A-Za-z0-9_-]{12,}\b|\bBearer\s+[A-Za-z0-9._-]{12,}/i },
    { label: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  ];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const check of forbidden) assert(!check.pattern.test(content), `${path.relative(root, file)} contains a ${check.label}`);
  }
}

function textFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return textFiles(fullPath);
    return /\.(?:cjs|css|html|json|md|mjs|ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`Release verification failed: ${message}`);
}
