import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const tauriDir = join(here, "..", "src-tauri");
const repo = join(here, "..", "..", "..");
const release = process.argv.includes("--release");

if (process.platform === "win32") {
  const msysBin = "C:\\msys64\\mingw64\\bin";
  if (!process.env.PATH?.includes(msysBin)) {
    process.env.PATH = `${msysBin};${process.env.PATH || ""}`;
  }
}

const hostTriple = () => {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const line = out.split("\n").find((l) => l.startsWith("host:"));
  if (!line) throw new Error("could not read the host target from `rustc -vV`");
  return line.slice(5).trim();
};

const triple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const explicit = Boolean(process.env.TAURI_ENV_TARGET_TRIPLE) && process.env.TAURI_ENV_TARGET_TRIPLE !== hostTriple();
const exe = triple.includes("windows") ? ".exe" : "";

const sidecars = [
  { pkg: "hopilo-native-host", bin: "hopilo-native-host" },
  { pkg: "hopilo-agent-cli", bin: "hopilo-cli" },
];

const profile = release ? "release" : "debug";
const build = (target) => {
  const args = ["build"];
  for (const { pkg } of sidecars) args.push("-p", pkg);
  if (release) args.push("--release");
  if (target) args.push("--target", target);
  execFileSync("cargo", args, { cwd: repo, stdio: "inherit" });
  return (bin) => join(repo, "target", ...(target ? [target] : []), profile, `${bin}${exe}`);
};

mkdirSync(join(tauriDir, "binaries"), { recursive: true });
const destFor = (bin, t) => join(tauriDir, "binaries", `${bin}-${t}${exe}`);
if (triple === "universal-apple-darwin") {
  const slices = ["aarch64-apple-darwin", "x86_64-apple-darwin"].map((target) => ({ target, built: build(target) }));
  for (const { bin } of sidecars) {
    const parts = slices.map(({ target, built }) => {
      const sliceDest = destFor(bin, target);
      copyFileSync(built(bin), sliceDest);
      chmodSync(sliceDest, 0o755);
      return built(bin);
    });
    const dest = destFor(bin, triple);
    execFileSync("lipo", ["-create", "-output", dest, ...parts], { stdio: "inherit" });
    chmodSync(dest, 0o755);
    console.log(`sidecar: ${dest}`);
  }
} else {
  const built = build(explicit ? triple : null);
  for (const { bin } of sidecars) {
    const dest = destFor(bin, triple);
    copyFileSync(built(bin), dest);
    if (!exe) chmodSync(dest, 0o755);
    console.log(`sidecar: ${dest}`);
  }
}
