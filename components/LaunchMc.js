const child_process = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const EventEmitter = require("events");
const fsPromises = fs.promises;

class MinecraftEjecuting extends EventEmitter {
  constructor() {
    super();
    this.options = {};
    this.logBuffer = [];
    this.versionDataCache = null;
    this.libraryCache = new Map();
    this.assetIndexIdCache = null;
    this.platform = this._getPlatform();
  }

  async launch(opts) {
    if (!opts?.version?.versionID) {
      throw new Error("No se ha especificado una versión válida");
    }

    this.options = {
      root: path.resolve(opts.root || "./minecraft"),
      javaPath: opts.javaPath || "java",
      memory: opts.memory || { max: "4G", min: "1G" },
      window: opts.window || { width: 854, height: 480, fullscreen: false },
      version: opts.version,
      overrides: opts.overrides || {},
      user: {
        ...(await this._loadOrCreateUser(opts.root || "./minecraft")),
        ...opts.user,
      },
    };

    this.options.user.type = this.options.user.type || "legacy";

    const versionJsonPath = path.join(
      this.options.root,
      "versions",
      this.options.version.versionID,
      `${this.options.version.versionID}.json`
    );

    if (!fs.existsSync(versionJsonPath)) {
      throw new Error(`Archivo de versión no encontrado: ${versionJsonPath}`);
    }

    this.versionDataCache = JSON.parse(
      await fsPromises.readFile(versionJsonPath, "utf-8")
    );
    this.assetIndexIdCache =
      this.versionDataCache.assetIndex?.id || this.options.version.versionID;

    const [libraries] = await Promise.all([
      this.getLibraries(),
      this._createDirs(),
    ]);

    try {
      this.emit("debug", `Iniciando versión ${this.options.version.versionID}`);
      const launchArgs = await this._buildLaunchArgs(libraries);
      this.emit("debug", `Argumentos: ${launchArgs.join(" ")}`);
      return this._startMinecraftProcess(launchArgs);
    } catch (error) {
      this.emit("debug", `Error al lanzar Minecraft: ${error.message}`);
      this.emit("close", 1);
      return null;
    }
  }

  getAssets() {
    return path.join(this.options.root, "assets");
  }

  async getAssetsObjects() {
    const assetIndexPath = path.join(
      this.options.root,
      "assets",
      "indexes",
      `${this.assetIndexIdCache}.json`
    );

    try {
      const rawIndex = await fsPromises.readFile(assetIndexPath, "utf-8");
      return JSON.parse(rawIndex).objects || {};
    } catch {
      return {};
    }
  }

  getNatives() {
    return path.join(
      this.options.root,
      "natives",
      this.options.version.versionID
    );
  }

  async getLibraries() {
    if (!this.versionDataCache) return [];
    const cacheKey = JSON.stringify(this.versionDataCache.libraries);

    if (this.libraryCache.has(cacheKey)) {
      return this.libraryCache.get(cacheKey);
    }

    const applicableLibs = (this.versionDataCache.libraries || []).filter(
      (lib) => this._isLibraryApplicable(lib)
    );

    const libPaths = applicableLibs
      .map((lib) => {
        return lib.downloads?.artifact?.path
          ? path.join(
              this.options.root,
              "libraries",
              lib.downloads.artifact.path
            )
          : lib.name
          ? (([group, artifact, version]) =>
              path.join(
                this.options.root,
                "libraries",
                ...group.split("."),
                artifact,
                version,
                `${artifact}-${version}.jar`
              ))(lib.name.split(":"))
          : null;
      })
      .filter(Boolean);

    const existenceChecks = libPaths.map(async (libPath) => {
      try {
        await fsPromises.access(libPath);
        return libPath;
      } catch {
        return null;
      }
    });

    const existingLibs = (await Promise.all(existenceChecks)).filter(Boolean);
    this.libraryCache.set(cacheKey, existingLibs);
    return existingLibs;
  }

  _isLibraryApplicable(lib) {
    if (!lib.rules) return true;

    for (const rule of lib.rules) {
      if (rule.action === "allow") {
        if (!rule.os || rule.os.name === this.platform) return true;
      } else if (rule.action === "disallow") {
        if (!rule.os || rule.os.name === this.platform) return false;
      }
    }
    return true;
  }

  _getPlatform() {
    return process.platform === "win32"
      ? "windows"
      : process.platform === "darwin"
      ? "osx"
      : process.platform === "linux"
      ? "linux"
      : "unknown";
  }

  _formatTimestamp() {
    const now = new Date();
    const day = now.getDate();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const hours = now.getHours().toString().padStart(2, "0");
    const minutes = now.getMinutes().toString().padStart(2, "0");
    const seconds = now.getSeconds().toString().padStart(2, "0");

    return `[ ${day} / ${month} / ${year} || Time : ${hours} : ${minutes} : ${seconds} ]`;
  }

  async _loadOrCreateUser(rootPath) {
    const profileLauncher = path.resolve(rootPath, "usercache.json");

    try {
      const rawData = await fsPromises.readFile(profileLauncher, "utf-8");
      const userData = JSON.parse(rawData);

      if (userData.uuid && userData.accessToken) {
        return {
          type: "legacy",
          name: userData.name || "Player",
          uuid: userData.uuid,
          accessToken: userData.accessToken,
        };
      }
    } catch {}

    const newUser = {
      type: this.user.type || "multiplayer",
      name: this.user.name || "player",
      uuid: crypto.randomUUID(),
      accessToken: crypto.randomBytes(32).toString("hex"),
    };

    await fsPromises.writeFile(
      profileLauncher,
      JSON.stringify(newUser, null, 2),
      "utf-8"
    );

    return newUser;
  }

  async _createDirs() {
    const dirs = [
      this.options.root,
      this.options.overrides.gameDirectory,
      this.getNatives(),
      path.join(this.getAssets(), "indexes"),
      path.join(this.options.root, "logs"),
    ].filter(Boolean);

    await Promise.all(
      dirs.map((dir) => fsPromises.mkdir(dir, { recursive: true }))
    );
  }

  async _buildLaunchArgs(libraries) {
    const versionID = this.options.version.versionID;
    const versionJar = path.join(
      this.options.root,
      "versions",
      versionID,
      `${versionID}.jar`
    );

    try {
      await fsPromises.access(versionJar);
    } catch {
      throw new Error(`JAR de versión no encontrado: ${versionJar}`);
    }

    const mainClass =
      this.versionDataCache.mainClass || "net.minecraft.client.main.Main";
    const classPathSeparator = process.platform === "win32" ? ";" : ":";
    const classPath = [...libraries, versionJar].join(classPathSeparator);

    const args = [
      `-Xmx${this.options.memory.max}`,
      `-Xms${this.options.memory.min}`,
      `-Djava.library.path=${this.getNatives()}`,
      "-cp",
      classPath,
      mainClass,
      "--username",
      this.options.user.name,
      "--uuid",
      this.options.user.uuid,
      "--accessToken",
      this.options.user.accessToken,
      "--version",
      versionID,
      "--gameDir",
      this.options.overrides.gameDirectory || this.options.root,
      "--assetsDir",
      this.getAssets(),
      "--assetIndex",
      this.assetIndexIdCache,
      "--userType",
      this.options.user.type,
    ];

    if (this.options.window) {
      if (this.options.window.width)
        args.push("--width", String(this.options.window.width));
      if (this.options.window.height)
        args.push("--height", String(this.options.window.height));
      if (this.options.window.fullscreen) args.push("--fullscreen");
    }

    return [this.options.javaPath, ...args];
  }

  _startMinecraftProcess(args) {
    const javaPath = args[0];
    const spawnOptions = {
      cwd: this.options.overrides.gameDirectory || this.options.root,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    };

    const proc = child_process.spawn(javaPath, args.slice(1), spawnOptions);

    proc.stdout.on("data", (data) => {
      const msg = data.toString();
      this.emit("data", msg);
      this.logBuffer.push(`${this._formatTimestamp()} ${msg}`);
    });

    proc.stderr.on("data", (data) => {
      const err = data.toString();
      this.emit("error", err);
      this.logBuffer.push(`${this._formatTimestamp()} [ERROR] ${err}`);
    });

    proc.on("close", (code) => {
      if (code !== 0 && this.logBuffer.length > 0) {
        this._writeCrashLog();
      }
      this.emit("close", code);
      this.logBuffer = [];
    });

    proc.on("error", (err) => {
      this.emit("error", `Error en el proceso: ${err.message}`);
      this.emit("close", 1);
      if (this.logBuffer.length > 0) {
        this._writeCrashLog();
      }
      this.logBuffer = [];
    });

    return proc;
  }

  async _writeCrashLog() {
    const logDir = path.resolve(this.options.root, "logs");
    await fsPromises.mkdir(logDir, { recursive: true });

    const logPath = path.join(logDir, `stepLauncher_crash_${Date.now()}.log`);
    const content = this.logBuffer.join("");

    await fsPromises.writeFile(logPath, content, "utf-8");
    this.emit("debug", `Log de crash guardado en: ${logPath}`);
  }
}

module.exports = { MinecraftEjecuting };
