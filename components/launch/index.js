// src/MinecraftExecutor.js
const { EventEmitter } = require("events");
const { spawn, exec }  = require("child_process");
const path             = require("path");
const fs               = require("fs/promises");
const fsSync           = require("fs");

const { platformName   } = require("./utils/platform");
const { formatTimestamp} = require("./utils/time");

const { UserManager    } = require("./utils/UserManager");
const { VersionResolver} = require("./utils/VersionResolver");
const { LibraryManager } = require("./utils/LibraryManager");
const { AssetsManager  } = require("./utils/AssetsManager");
const { NativesManager } = require("./utils/NativesManager");

class MinecraftExecutor extends EventEmitter {
  log = [];
  opts = {};

  async start(opts) {
    if (!opts?.version?.versionID) throw new Error("Missing versionID");

    // ---------- opciones ----------
    this.opts = {
      root: path.resolve(opts.root || "./minecraft"),
      javaPath: opts.javaPath || "java",
      memory:    opts.memory  || { max: "2G", min: "1G" },
      window:    opts.window  || { width: 854, height: 480, fullscreen: false },
      overrides: opts.overrides || {},
      jvm:       opts.jvm || [],          // flags extra para JVM
      mcArgs:    opts.mcArgs || [],       // args extra para Minecraft
      version:   opts.version,
      user:      opts.user,
      debug:     opts.debug ?? false,
    };

    // ---------- validar java ----------
    if (this.opts.javaPath.includes(path.sep) && !path.isAbsolute(this.opts.javaPath)) {
      // Si javaPath es relativo con separadores, lo resolvemos como absoluto con base en root
      this.opts.javaPath = path.resolve(this.opts.root, this.opts.javaPath);
    }

    const isPath = this.opts.javaPath.includes(path.sep);
    if (isPath) {
      try {
        await fs.access(this.opts.javaPath, fsSync.constants.X_OK);
      } catch {
        throw new Error(`Java no encontrado o sin permisos: ${this.opts.javaPath}`);
      }
    } else {
      // Validar java en PATH ejecutando 'java -version'
      const existsInPath = await new Promise(resolve => {
        exec(`${this.opts.javaPath} -version`, (error) => {
          resolve(!error);
        });
      });
      if (!existsInPath) throw new Error(`Java no encontrado en PATH: ${this.opts.javaPath}`);
    }

    // ---------- user ----------
    const userManager = new UserManager(this.opts.root);
    this.opts.user = await userManager.resolve(this.opts.user);
    const user = this.opts.user;
    if (!user.name || !user.uuid || !user.accessToken)
      throw new Error("User information incomplete");

    // ---------- versión ----------
    const versionResolver = new VersionResolver(this.opts.root, this.opts.version);
    await versionResolver.ensurePresent();
    const versionData = await versionResolver.getData();
    const vId = versionData.id || versionData.inheritsFrom;

    // ---------- assets ----------
    const assetsManager = new AssetsManager(this.opts.root, versionData);
    await assetsManager.ensurePresent();

    // ---------- nativos ----------
    const nativesManager = new NativesManager(this.opts.root, versionData);
    await nativesManager.ensureDir();
    const nativesDir = nativesManager.getNativesDir();

    // Recolectar todas las carpetas con libs nativos para java.library.path
    const nativePathList = [nativesDir];
    for (const dir of await fs.readdir(path.join(this.opts.root, "natives"))) {
      const fullDir = path.join(this.opts.root, "natives", dir);
      if (dir.startsWith(vId) && fsSync.statSync(fullDir).isDirectory()) {
        nativePathList.push(fullDir);
      }
    }
    const javaLibraryPath = nativePathList.join(path.delimiter);

    // ---------- classpath ----------
    const libManager = new LibraryManager(this.opts.root, versionData, platformName());
    const classPath  = await libManager.buildClasspath();

    // Guardar classpath en logs
    const logsDir = path.join(this.opts.root, "logs");
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(path.join(logsDir, "latest_cp.txt"), classPath);

    // ---------- JVM flags ----------
    const baseJvmFlags = [
      "-XX:+UseG1GC",
      "-XX:+UnlockExperimentalVMOptions",
      "-XX:+DisableExplicitGC",
      "-XX:G1NewSizePercent=20",
      "-XX:G1ReservePercent=20",
      "-XX:MaxGCPauseMillis=50",
      "-XX:G1HeapRegionSize=32M",
      "--enable-native-access=ALL-UNNAMED",
      `-Xmx${this.opts.memory.max}`,
      `-Xms${this.opts.memory.min}`,
      `-Djava.library.path=${javaLibraryPath}`,
      "-cp", classPath,
      ...this.opts.jvm, // flags custom
    ];

    // ---------- args Minecraft ----------
    const mcArgs = [
      versionData.mainClass,
      "--username",    user.name,
      "--uuid",        user.uuid,
      "--accessToken", user.accessToken,
      "--version",     this.opts.version.versionID,
      "--gameDir",     this.opts.overrides.gameDirectory || this.opts.root,
      "--assetsDir",   assetsManager.getAssetsDir(),
      "--assetIndex",  assetsManager.getAssetIndexId(),
      "--userType",    user.type || "legacy",
      "--width",       String(this.opts.window.width),
      "--height",      String(this.opts.window.height),
      ...(this.opts.window.fullscreen ? ["--fullscreen"] : []),
      ...this.opts.mcArgs, // args custom
    ];

    // ---------- debug ----------
    if (this.opts.debug) {
      const shownCP = classPath.split(path.delimiter);
      console.log(
        "\n· JAVA:", this.opts.javaPath,
        "\n· NATIVES:", javaLibraryPath,
        `\n· CP: ${shownCP.length} elementos (se muestran 3)`,
        shownCP.slice(0,3).map(s => `\n   - ${s}`).join(""),
        "\n"
      );
    }

    // ---------- lanzar ----------
    return this.#launch([this.opts.javaPath, ...baseJvmFlags, ...mcArgs]);
  }

  #launch(args) {
    const proc = spawn(args[0], args.slice(1), {
      cwd: this.opts.overrides.gameDirectory || this.opts.root,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    proc.stdout.on("data", d => this.#pushLog("data", d));
    proc.stderr.on("data", d => this.#pushLog("error", d));

    proc.on("close", code => {
      if (code !== 0 && this.log.length) this.#writeCrash(code);
      this.emit("close", code);
      this.log = [];
    });

    proc.on("error", err => {
      this.emit("error", err.message);
      this.emit("close", 1);
    });
    proc.unref();
    return proc;
  }

  #pushLog(channel, data) {
    const msg = data.toString();
    this.emit(channel, msg);
    this.log.push(`${formatTimestamp()} ${channel === "error" ? "[ERR] " : ""}${msg}`);
  }

  async #writeCrash(code) {
    const crashName = `stepLauncher_crash_${new Date().toISOString().replace(/[:.]/g,"-")}_code${code}.log`;
    const file = path.join(this.opts.root, "logs", crashName);
    await fs.writeFile(file, this.log.join(""));
    console.error(`\nCrash log guardado en ${file}`);
  }
}

module.exports = { MinecraftExecutor };
