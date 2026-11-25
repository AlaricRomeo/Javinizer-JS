const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

/**
 * "Run Javinizer-js as a service": starts the server at boot/login with the
 * user's own service manager, no admin rights needed.
 *
 * - Linux: systemd user unit (+ lingering, so it also starts before login)
 * - macOS: launchd LaunchAgent (starts at login)
 * - Windows: Task Scheduler task at logon, launching a hidden window
 *
 * Processes started by the service manager get JAVINIZER_SERVICE=1, so the
 * server (and the updater, see bin/apply-update.js) knows how it was started.
 * The installed state is read from disk, never stored in config.json.
 */

const NAME = "javinizer-js";
const REPO_ROOT = path.join(__dirname, "../..");
const SERVER_SCRIPT = path.join(REPO_ROOT, "src/server/index.js");

const LINUX_UNIT = path.join(os.homedir(), ".config/systemd/user", `${NAME}.service`);
const MAC_LABEL = "com.javinizer-js";
const MAC_PLIST = path.join(os.homedir(), "Library/LaunchAgents", `${MAC_LABEL}.plist`);
const WIN_TASK = "Javinizer-JS";
const WIN_LAUNCHER = path.join(REPO_ROOT, "data", "runtime", "javinizer-service.vbs");

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] });
}

function tryRun(cmd, args) {
  try {
    run(cmd, args);
    return true;
  } catch (_) {
    return false;
  }
}

function isSupported() {
  return ["linux", "darwin", "win32"].includes(process.platform);
}

function isRunningAsService() {
  return process.env.JAVINIZER_SERVICE === "1";
}

// ── Linux ─────────────────────────────

function linuxUnit() {
  return `[Unit]
Description=Javinizer-JS (JAV metadata manager)
After=network-online.target

[Service]
WorkingDirectory=${REPO_ROOT}
ExecStart="${process.execPath}" "${SERVER_SCRIPT}"
Environment=JAVINIZER_SERVICE=1
# Clean exit (in-app update) = no restart: the updater starts the service again
Restart=on-failure
RestartSec=5
# The updater outlives the server: kill only the main process on stop
KillMode=process

[Install]
WantedBy=default.target
`;
}

function linuxLingering() {
  try {
    return run("loginctl", ["show-user", os.userInfo().username, "--property=Linger"]).trim() === "Linger=yes";
  } catch (_) {
    return false;
  }
}

// ── macOS ─────────────────────────────

function macPlist() {
  const logPath = path.join(REPO_ROOT, "data", "service.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${process.execPath}</string><string>${SERVER_SCRIPT}</string></array>
  <key>WorkingDirectory</key><string>${REPO_ROOT}</string>
  <key>EnvironmentVariables</key><dict><key>JAVINIZER_SERVICE</key><string>1</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${logPath}</string>
  <key>StandardErrorPath</key><string>${logPath}</string>
</dict>
</plist>
`;
}

function macDomain() {
  return `gui/${os.userInfo().uid}`;
}

// ── Windows ─────────────────────────────

function winLauncher() {
  const q = s => s.replace(/"/g, '""');
  return `' Javinizer-JS service launcher (hidden window), created by Configuration
Set shell = CreateObject("WScript.Shell")
shell.Environment("Process")("JAVINIZER_SERVICE") = "1"
shell.CurrentDirectory = "${q(REPO_ROOT)}"
shell.Run """${q(process.execPath)}"" ""${q(SERVER_SCRIPT)}""", 0, False
`;
}

// ── Public API ─────────────────────────────

/**
 * @returns {{supported: boolean, installed: boolean, running: boolean, platform: string, atBoot: boolean}}
 * atBoot: starts before anyone logs in (Linux lingering); otherwise at login.
 */
function getStatus() {
  const status = { supported: isSupported(), installed: false, running: isRunningAsService(), platform: process.platform, atBoot: false };
  if (process.platform === "linux") {
    status.installed = fs.existsSync(LINUX_UNIT);
    status.atBoot = status.installed && linuxLingering();
  } else if (process.platform === "darwin") {
    status.installed = fs.existsSync(MAC_PLIST);
  } else if (process.platform === "win32") {
    status.installed = tryRun("schtasks", ["/Query", "/TN", WIN_TASK]);
  }
  return status;
}

/** Installs and enables the service for the next boot/login (not started now). */
function install() {
  if (process.platform === "linux") {
    fs.mkdirSync(path.dirname(LINUX_UNIT), { recursive: true });
    fs.writeFileSync(LINUX_UNIT, linuxUnit());
    run("systemctl", ["--user", "daemon-reload"]);
    run("systemctl", ["--user", "enable", NAME]);
    // Start at boot, not only at login: allowed for one's own user on most distros
    tryRun("loginctl", ["enable-linger", os.userInfo().username]);
  } else if (process.platform === "darwin") {
    fs.mkdirSync(path.dirname(MAC_PLIST), { recursive: true });
    fs.writeFileSync(MAC_PLIST, macPlist());
    // RunAtLoad applies at the next login; bootstrap now would start a second server
  } else if (process.platform === "win32") {
    fs.mkdirSync(path.dirname(WIN_LAUNCHER), { recursive: true });
    fs.writeFileSync(WIN_LAUNCHER, winLauncher());
    run("schtasks", ["/Create", "/F", "/TN", WIN_TASK, "/SC", "ONLOGON", "/RL", "LIMITED",
      "/TR", `wscript.exe "${WIN_LAUNCHER}"`]);
  } else {
    throw new Error(`Unsupported platform: ${process.platform}`);
  }
  return getStatus();
}

/** Disables and removes the service. A server running as service keeps running. */
function uninstall() {
  if (process.platform === "linux") {
    tryRun("systemctl", ["--user", "disable", NAME]);
    fs.rmSync(LINUX_UNIT, { force: true });
    tryRun("systemctl", ["--user", "daemon-reload"]);
  } else if (process.platform === "darwin") {
    // bootout would stop a server running as service: just remove the agent
    fs.rmSync(MAC_PLIST, { force: true });
  } else if (process.platform === "win32") {
    tryRun("schtasks", ["/Delete", "/F", "/TN", WIN_TASK]);
    fs.rmSync(WIN_LAUNCHER, { force: true });
  }
  return getStatus();
}

/** Starts the installed service (the server must not be listening already). */
function startService() {
  if (process.platform === "linux") run("systemctl", ["--user", "start", NAME]);
  else if (process.platform === "darwin") {
    if (!tryRun("launchctl", ["kickstart", `${macDomain()}/${MAC_LABEL}`])) {
      run("launchctl", ["bootstrap", macDomain(), MAC_PLIST]);
    }
  } else if (process.platform === "win32") run("schtasks", ["/Run", "/TN", WIN_TASK]);
}

/**
 * Hands over to the service: a detached helper waits for this process to
 * exit, then starts the service. The caller exits right after responding.
 */
function handOverToService() {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, "bin", "service-start.js"), `--pid=${process.pid}`], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
}

const DESKTOP_VARS = ["DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_SESSION_TYPE", "XDG_CURRENT_DESKTOP", "DBUS_SESSION_BUS_ADDRESS"];

/**
 * Environment for launching desktop apps (video player, file manager).
 * A service started at boot (systemd lingering) has no graphical session in
 * its environment, so GUI apps start but can't open a window: take the
 * session variables from the user's systemd manager, which the desktop
 * imports at login. Read on every launch, since they change at each login.
 */
function desktopEnv() {
  const env = { ...process.env };
  if (process.platform !== "linux" || env.DISPLAY || env.WAYLAND_DISPLAY) return env;
  try {
    for (const line of run("systemctl", ["--user", "show-environment"]).split("\n")) {
      const eq = line.indexOf("=");
      const key = line.slice(0, eq);
      if (eq > 0 && DESKTOP_VARS.includes(key) && !env[key]) env[key] = line.slice(eq + 1);
    }
  } catch (_) {}
  return env;
}

module.exports = { getStatus, install, uninstall, startService, handOverToService, isRunningAsService, desktopEnv };
