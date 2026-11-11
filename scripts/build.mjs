import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..");
const keyPath = join(repo, "apps", "desktop", ".tauri", "hopilo.key");

const env = { ...process.env };
const args = ["--filter", "@hopilo/desktop", "tauri", "build", ...process.argv.slice(2)];

if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  if (existsSync(keyPath)) {
    env.TAURI_SIGNING_PRIVATE_KEY = keyPath;
    if (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) {
      env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
    }
  } else if (!args.includes("--no-sign")) {
    args.push("--no-sign");
  }
}

const res = spawnSync("pnpm", args, {
  cwd: repo,
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});
if (res.error) {
  console.error(res.error);
  process.exit(1);
}
process.exit(res.status ?? 0);

