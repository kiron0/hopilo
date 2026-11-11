import { spawnSync, spawn, execSync } from "node:child_process";
import { existsSync, readdirSync, statSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const appName = "Hopilo";
const bundleId = "io.coreify.hopilo";
const keyPath = join(root, "apps", "desktop", ".tauri", "hopilo.key");

const getPlatform = () => {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      console.error(`Unsupported platform: ${process.platform}`);
      process.exit(1);
  }
};

const platform = getPlatform();

if (platform === "windows") {
  const msysBin = "C:\\msys64\\mingw64\\bin";
  if (existsSync(msysBin) && !process.env.PATH?.includes(msysBin)) {
    process.env.PATH = `${msysBin};${process.env.PATH || ""}`;
  }
}

const run = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32" && cmd === "pnpm",
    ...opts,
    env: { ...process.env, ...opts.env },
  });
  if (res.error) {
    console.error(res.error);
    process.exit(1);
  }
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
  return res;
};

const getRunningPids = () => {
  if (platform === "macos") {
    try {
      const out = execSync(
        `lsappinfo list 2>/dev/null | awk -v id='"${bundleId}"' '
          /bundleID=/ { want = index($0, "bundleID=" id) > 0 }
          want && /pid = / { for (i = 1; i <= NF; i++) if ($i == "pid") { print $(i + 2); want = 0 } }
        '; pgrep -f "\\.app/Contents/MacOS/${appName}$" 2>/dev/null || true`,
        { encoding: "utf8" }
      );
      return Array.from(new Set(out.split(/\s+/).filter(Boolean).map(Number)));
    } catch {
      return [];
    }
  }

  if (platform === "linux") {
    try {
      const out = execSync(
        `pgrep -f "${appName}\\.AppImage" 2>/dev/null || true; pgrep -x "${appName}" 2>/dev/null || true`,
        { encoding: "utf8" }
      );
      return Array.from(new Set(out.split(/\s+/).filter(Boolean).map(Number)));
    } catch {
      return [];
    }
  }

  if (platform === "windows") {
    try {
      const out = execSync(
        `powershell.exe -NoProfile -Command "Get-Process '${appName}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id"`,
        { encoding: "utf8" }
      );
      return Array.from(new Set(out.split(/\s+/).filter(Boolean).map(Number)));
    } catch {
      return [];
    }
  }

  return [];
};

const stopRunning = () => {
  if (platform === "windows") {
    spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-Process '${appName}' -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep -Milliseconds 500`,
      ],
      { stdio: "inherit" }
    );
    return;
  }

  let pids = getRunningPids();
  if (pids.length === 0) return;

  console.log(`Stopping ${appName} (pid ${pids.join(" ")})`);
  for (const pid of pids) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }

  let attempt = 0;
  while (getRunningPids().length > 0 && attempt < 20) {
    spawnSync("sleep", ["0.25"]);
    attempt++;
  }

  pids = getRunningPids();
  if (pids.length > 0) {
    for (const pid of pids) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
    spawnSync("sleep", ["0.5"]);
  }

  if (getRunningPids().length > 0) {
    console.error(`${appName} did not exit.`);
    process.exit(1);
  }
};

const repointLoginItem = (exe) => {
  const home = homedir();
  if (platform === "macos") {
    const plist = join(home, "Library", "LaunchAgents", `${appName}.plist`);
    if (!existsSync(plist)) return;
    try {
      const current = execSync(
        `/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "${plist}" 2>/dev/null || true`,
        { encoding: "utf8" }
      ).trim();
      if (current !== exe) {
        execSync(`/usr/libexec/PlistBuddy -c "Set :ProgramArguments:0 ${exe}" "${plist}"`);
        console.log(`Launch at login now starts: ${exe} (was: ${current || "unset"})`);
      }
    } catch {}
  } else if (platform === "linux") {
    const configHome = process.env.XDG_CONFIG_HOME || join(home, ".config");
    const desktop = join(configHome, "autostart", `${appName}.desktop`);
    if (!existsSync(desktop)) return;
    try {
      const content = readFileSync(desktop, "utf8");
      const updated = content.replace(/^Exec=.*/m, `Exec=${exe}`);
      writeFileSync(desktop, updated, "utf8");
    } catch {}
  }
};

const warnOtherCopies = (dest) => {
  if (platform !== "macos") return;
  try {
    const out = execSync(`mdfind "kMDItemCFBundleIdentifier == '${bundleId}'" 2>/dev/null || true`, {
      encoding: "utf8",
    });
    const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const app of lines) {
      if (app !== dest && !app.startsWith(root)) {
        let version = "?";
        try {
          version = execSync(`defaults read "${app}/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo '?'`, {
            encoding: "utf8",
          }).trim();
        } catch {}
        console.log(`Note: another copy of ${appName} is installed at ${app} (${version}). Only one runs at a time; remove it if you no longer need it.`);
      }
    }
  } catch {}
};

const findSetupFiles = (dir) => {
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "bundle" || full.includes("bundle")) {
          results.push(...findSetupFiles(full));
        } else if (!["deps", "build", "incremental", ".fingerprint", "examples"].includes(entry.name)) {
          results.push(...findSetupFiles(full));
        }
      } else if (/-setup\.exe$/i.test(entry.name)) {
        results.push(full);
      }
    }
  } catch {}
  return results;
};

console.log("[1/5] Verify");
run("pnpm", ["--filter", "@hopilo/desktop", "typecheck"]);
run("pnpm", ["--filter", "@hopilo/desktop", "test"]);
run("node", ["apps/desktop/scripts/sidecar.mjs"]);
run("cargo", ["check", "-p", "hopilo-desktop"]);

console.log(`[2/5] Build signed ${platform} bundle`);
if (!existsSync(keyPath)) {
  console.error(`Updater signing key missing: ${keyPath}`);
  process.exit(1);
}

const bundleFlag = platform === "macos" ? "app" : platform === "linux" ? "appimage" : "nsis";
run("pnpm", ["--filter", "@hopilo/desktop", "tauri", "build", "--bundles", bundleFlag], {
  env: {
    TAURI_SIGNING_PRIVATE_KEY: keyPath,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
  },
});

console.log(`[3/5] Stop every running ${appName}`);
stopRunning();

console.log("[4/5] Install native bundle");
const home = homedir();
let dest = "";
let dataDir = "";

if (platform === "macos") {
  const targetDir = join(root, "target");
  const findMacApp = (dir) => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === `${appName}.app` && full.includes(join("release", "bundle", "macos"))) {
            return full;
          }
          if (!["deps", "build", "incremental", ".fingerprint"].includes(entry.name)) {
            const found = findMacApp(full);
            if (found) return found;
          }
        }
      }
    } catch {}
    return null;
  };

  const bundle = findMacApp(targetDir);
  if (!bundle) {
    console.error("macOS app bundle not found.");
    process.exit(1);
  }
  const appDir = join(home, "Applications");
  mkdirSync(appDir, { recursive: true });
  dest = join(appDir, `${appName}.app`);
  rmSync(dest, { recursive: true, force: true });
  spawnSync("ditto", [bundle, dest], { stdio: "inherit" });
  dataDir = join(home, "Library", "Application Support", bundleId);
  repointLoginItem(join(dest, "Contents", "MacOS", appName));
  warnOtherCopies(dest);
} else if (platform === "linux") {
  const targetDir = join(root, "target");
  const findAppImage = (dir) => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory() && !["deps", "build", "incremental", ".fingerprint"].includes(entry.name)) {
          const found = findAppImage(full);
          if (found) return found;
        } else if (entry.name.endsWith(".AppImage")) {
          return full;
        }
      }
    } catch {}
    return null;
  };

  const bundle = findAppImage(targetDir);
  if (!bundle) {
    console.error("Linux AppImage not found.");
    process.exit(1);
  }
  const binDir = join(home, ".local", "bin");
  mkdirSync(binDir, { recursive: true });
  dest = join(binDir, `${appName}.AppImage`);
  spawnSync("install", ["-m", "755", bundle, dest], { stdio: "inherit" });
  const dataHome = process.env.XDG_DATA_HOME || join(home, ".local", "share");
  dataDir = join(dataHome, bundleId);
  repointLoginItem(dest);
} else if (platform === "windows") {
  const setupFiles = findSetupFiles(join(root, "target"));
  if (setupFiles.length === 0) {
    console.error("Windows NSIS installer not found.");
    process.exit(1);
  }
  setupFiles.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const bundle = setupFiles[0];

  spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Start-Process -FilePath '${bundle}' -ArgumentList '/S' -Wait`],
    { stdio: "inherit" }
  );

  const localAppData = process.env.LOCALAPPDATA || "";
  const candidates = [
    join(localAppData, "Programs", appName, `${appName}.exe`),
    join(localAppData, appName, `${appName}.exe`),
  ];
  dest = candidates.find((c) => existsSync(c));
  for (let i = 0; i < 10 && !dest; i++) {
    spawnSync("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 500"]);
    dest = candidates.find((c) => existsSync(c));
  }
  if (!dest) {
    console.error(`Installed ${appName}.exe not found.`);
    process.exit(1);
  }
  dataDir = "%APPDATA%\\io.coreify.hopilo";
}

console.log(`Installed: ${dest}`);
console.log(`App data preserved: ${dataDir}`);

console.log("[5/5] Launch + verify");
if (platform === "macos") {
  spawnSync("open", [dest], { stdio: "inherit" });
} else if (platform === "linux") {
  spawn("nohup", [dest], {
    detached: true,
    stdio: "ignore",
  }).unref();
} else if (platform === "windows") {
  spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Start-Process -FilePath '${dest}'`],
    { stdio: "inherit" }
  );
}

if (platform === "windows") {
  spawnSync("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Seconds 2"]);
  const verifyRes = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `if (-not (Get-Process '${appName}' -ErrorAction SilentlyContinue)) { exit 1 }`,
    ]
  );
  if (verifyRes.status !== 0) {
    console.error(`${appName} launch verification failed.`);
    process.exit(1);
  }
} else {
  spawnSync("sleep", ["2"]);
  const pids = getRunningPids();
  if (pids.length === 0) {
    console.error(`${appName} launch verification failed.`);
    process.exit(1);
  } else if (pids.length > 1) {
    console.error(`More than one ${appName} is running: ${pids.join(" ")}`);
    process.exit(1);
  }
}

console.log(`${appName} installed, launched, app data kept.`);
