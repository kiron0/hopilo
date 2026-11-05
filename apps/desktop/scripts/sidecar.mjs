// Builds the browser bridge (hopilo-native-host) and places it where Tauri's
// `bundle.externalBin` expects it: src-tauri/binaries/<name>-<target-triple>.
// Tauri then ships it next to the app binary, where browser.rs looks for it.
//
//   node scripts/sidecar.mjs            debug build (tauri dev)
//   node scripts/sidecar.mjs --release  release build (tauri build)

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tauriDir = join(here, "..", "src-tauri");
const repo = join(here, "..", "..", "..");
const release = process.argv.includes("--release");

const hostTriple = () => {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("host:"));
  if (!line) throw new Error("could not read the host target from `rustc -vV`");
  return line.slice(5).trim();
};

// Tauri sets this for before*Command when building for an explicit --target.
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const explicit = Boolean(process.env.TAURI_ENV_TARGET_TRIPLE) && process.env.TAURI_ENV_TARGET_TRIPLE !== hostTriple();
const exe = triple.includes("windows") ? ".exe" : "";

const profile = release ? "release" : "debug";
const build = (target) => {
  const args = ["build", "-p", "hopilo-native-host"];
  if (release) args.push("--release");
  if (target) args.push("--target", target);
  execFileSync("cargo", args, { cwd: repo, stdio: "inherit" });
  return join(repo, "target", ...(target ? [target] : []), profile, `hopilo-native-host${exe}`);
};

const dest = join(tauriDir, "binaries", `hopilo-native-host-${triple}${exe}`);
mkdirSync(dirname(dest), { recursive: true });
if (triple === "universal-apple-darwin") {
  // A universal app needs a universal sidecar: build both slices, then lipo.
  const slices = ["aarch64-apple-darwin", "x86_64-apple-darwin"].map(build);
  execFileSync("lipo", ["-create", "-output", dest, ...slices], { stdio: "inherit" });
} else {
  copyFileSync(build(explicit ? triple : null), dest);
}
if (!exe) chmodSync(dest, 0o755);
console.log(`sidecar: ${dest}`);
