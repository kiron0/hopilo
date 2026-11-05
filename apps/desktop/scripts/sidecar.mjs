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
  const slices = ["aarch64-apple-darwin", "x86_64-apple-darwin"].map((target) => {
    const built = build(target);
    const sliceDest = join(tauriDir, "binaries", `hopilo-native-host-${target}`);
    copyFileSync(built, sliceDest);
    chmodSync(sliceDest, 0o755);
    return built;
  });
  execFileSync("lipo", ["-create", "-output", dest, ...slices], { stdio: "inherit" });
} else {
  copyFileSync(build(explicit ? triple : null), dest);
}
if (!exe) chmodSync(dest, 0o755);
console.log(`sidecar: ${dest}`);
