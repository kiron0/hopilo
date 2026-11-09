import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const packageJson = join(root, "package.json");
const tauriConf = join(root, "apps", "desktop", "src-tauri", "tauri.conf.json");
const desktopPkg = join(root, "apps", "desktop", "package.json");
const extPkg = join(root, "apps", "extension", "package.json");
const manifestJson = join(root, "apps", "extension", "public", "manifest.json");
const cargoToml = join(root, "Cargo.toml");
const changelogFile = join(root, "CHANGELOG.md");

for (const req of [packageJson, tauriConf, cargoToml]) {
  if (!existsSync(req)) {
    console.error(`Error: Required file not found: ${req}`);
    process.exit(1);
  }
}

let currentVersion = "";
try {
  const conf = JSON.parse(readFileSync(tauriConf, "utf8"));
  currentVersion = conf.version || "";
} catch {}
if (!currentVersion) {
  try {
    const pkg = JSON.parse(readFileSync(packageJson, "utf8"));
    currentVersion = pkg.version || "";
  } catch {}
}

const semverMatch = currentVersion.split("-")[0].split(".");
const major = parseInt(semverMatch[0] || "0", 10);
const minor = parseInt(semverMatch[1] || "0", 10);
const patch = parseInt(semverMatch[2] || "0", 10);

const suggestedPatch = `${major}.${minor}.${patch + 1}`;
const suggestedMinor = `${major}.${minor + 1}.0`;
const suggestedMajor = `${major + 1}.0.0`;

const inputArg = process.argv[2];
let targetVersion = "";

if (!inputArg) {
  const rl = readline.createInterface({ input, output });
  try {
    console.log(`Current version: ${currentVersion}\n`);
    console.log("Select bump type:");
    console.log(`  1) Patch  -> ${suggestedPatch}`);
    console.log(`  2) Minor  -> ${suggestedMinor}`);
    console.log(`  3) Major  -> ${suggestedMajor}`);
    console.log("  4) Custom");
    const choice = (await rl.question("Enter choice [1-4] (default: 1): ")).trim();

    if (choice === "2") {
      targetVersion = suggestedMinor;
    } else if (choice === "3") {
      targetVersion = suggestedMajor;
    } else if (choice === "4") {
      targetVersion = (await rl.question("Enter new version (e.g. 1.0.3): ")).trim();
    } else {
      targetVersion = suggestedPatch;
    }
  } finally {
    rl.close();
  }
} else {
  switch (inputArg.toLowerCase()) {
    case "patch":
    case "--patch":
    case "-p":
      targetVersion = suggestedPatch;
      break;
    case "minor":
    case "--minor":
    case "-m":
      targetVersion = suggestedMinor;
      break;
    case "major":
    case "--major":
      targetVersion = suggestedMajor;
      break;
    default:
      targetVersion = inputArg;
  }
}

targetVersion = targetVersion.replace(/^v/, "");

const semverRegex = /^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$/;
if (!semverRegex.test(targetVersion)) {
  console.error(
    `Error: Invalid version format '${targetVersion}'. Must match semver (e.g. 1.0.3 or 1.0.3-beta.1).`
  );
  process.exit(1);
}

console.log("\nSummary of changes:");
console.log(`  Version: ${currentVersion} -> ${targetVersion}\n`);

if (!inputArg) {
  const rl = readline.createInterface({ input, output });
  try {
    const confirm = (await rl.question("Apply changes? [Y/n]: ")).trim();
    if (confirm && !/^[Yy]$/.test(confirm)) {
      console.log("Aborted.");
      process.exit(0);
    }
  } finally {
    rl.close();
  }
}

const jsonFiles = [packageJson, desktopPkg, extPkg, manifestJson, tauriConf];
for (const file of jsonFiles) {
  if (existsSync(file)) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    if (data.version !== targetVersion) {
      data.version = targetVersion;
      writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
      console.log(`  ✓ Updated ${relative(root, file)}`);
    }
  }
}

const cargo = readFileSync(cargoToml, "utf8");
const pattern = /(\[workspace\.package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/;
if (!pattern.test(cargo)) {
  console.error(`Error: [workspace.package] version not found in ${cargoToml}`);
  process.exit(1);
}
const nextCargo = cargo.replace(pattern, `$1"${targetVersion}"`);
if (nextCargo !== cargo) {
  writeFileSync(cargoToml, nextCargo);
  console.log(`  ✓ Updated ${relative(root, cargoToml)}`);
}

try {
  const res = spawnSync("cargo", ["check", "--workspace", "--quiet"], {
    cwd: root,
    shell: true,
    stdio: "ignore",
  });
  if (res.status !== 0) {
    spawnSync("cargo", ["check", "--workspace"], { cwd: root, shell: true, stdio: "inherit" });
  }
  console.log("  ✓ Updated Cargo.lock");
} catch {}

try {
  const res = spawnSync("pnpm", ["install", "--lockfile-only", "--quiet"], {
    cwd: root,
    shell: true,
    stdio: "ignore",
  });
  if (res.status !== 0) {
    spawnSync("pnpm", ["install", "--no-frozen-lockfile"], {
      cwd: root,
      shell: true,
      stdio: "inherit",
    });
  }
  console.log("  ✓ Updated pnpm-lock.yaml");
} catch {}

if (existsSync(changelogFile)) {
  const changelog = readFileSync(changelogFile, "utf8");
  if (!changelog.includes(`## ${targetVersion}`)) {
    const headingIndex = changelog.search(/^## /m);
    if (headingIndex !== -1) {
      const template = `## ${targetVersion}\n\n### Added\n\n- \n\n### Fixed\n\n- \n\n### Changed\n\n- \n\n`;
      const nextChangelog =
        changelog.slice(0, headingIndex) + template + changelog.slice(headingIndex);
      writeFileSync(changelogFile, nextChangelog, "utf8");
      console.log("  ✓ Added release section to CHANGELOG.md");
    }
  }
}

console.log(`\n✅ Version bumped to ${targetVersion} successfully!`);

