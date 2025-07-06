const { join, resolve, sep } = require("path");
const { spawnSync } = require("child_process");
const fs = require("fs/promises");

class LaunchArgumentBuilder {
  constructor(options) {
    const root = resolve(options.root || "./minecraft");
    const versionId = options.versionFile?.id || options.versionFile?.inheritsFrom || "unknown";

    this.opts = {
      root,
      memory: options.memory || { max: "2G", min: "1G" },
      gameDirectory: options.overrides?.gameDirectory || root,
      jvm: [],
      mcArgs: [],
      nativePath: options.nativePath || join(root, "natives", versionId),
      ...options,
    };

    this.versionFile = this.opts.versionFile;
    this.customFile = this.opts.customFile || {};
    this.classPath = this.opts.libs || "";
    this.nativePath = this.opts.nativePath;
    this._javaMajorCache = null;
  }

  #javaMajor(javaPath) {
    if (this._javaMajorCache !== null) return this._javaMajorCache;
    try {
      const out = spawnSync(javaPath, ["-version"], { encoding: "utf8", stdio: "pipe" });
      const text = out.stderr || out.stdout || "";
      const match = text.match(/version "(?:(\d+)(?:\.(\d+))?)"/);
      this._javaMajorCache = match
        ? (match[1] === "1" ? parseInt(match[2], 10) : parseInt(match[1], 10))
        : 8;
    } catch {
      this._javaMajorCache = 8;
    }
    return this._javaMajorCache;
  }

  #isLegacy(versionId) {
    const [major, minor, patch] = versionId.split(".").map(n => parseInt(n, 10) || 0);
    return major < 1 || (major === 1 && minor < 6) || (major === 1 && minor === 6 && patch < 1);
  }

  async #resolveClientJar() {
    const versionId = this.versionFile.id || this.versionFile.inheritsFrom || "";
    const versionDir = join(this.opts.root, "versions", versionId);
    const jarPath = join(versionDir, `${versionId}.jar`);

    try {
      await fs.access(jarPath);
      return jarPath;
    } catch {
      if (this.versionFile.inheritsFrom) {
        const baseId = this.versionFile.inheritsFrom;
        const baseDir = join(this.opts.root, "versions", baseId);
        const baseJar = join(baseDir, `${baseId}.jar`);
        try {
          await fs.access(baseJar);
          return baseJar;
        } catch { return null; }
      }
      return null;
    }
  }

  #placeholders() {
    const auth = this.opts.authorization || {};
    const v = this.opts.version || {};
    const versionId = v.number || v.id || v.inheritsFrom || "unknown";
    const isLegacy = this.#isLegacy(versionId);

    const assetsRoot = isLegacy
      ? join(this.opts.gameDirectory, "assets", "virtual", "legacy")
      : join(this.opts.gameDirectory, "assets");

    const assetIndexId = this.opts.overrides?.assetIndex
      || v.assetIndex?.id
      || v.custom
      || v.number
      || "legacy";

    return {
      "${auth_access_token}": auth.access_token || "",
      "${auth_session}": auth.access_token || "",
      "${auth_player_name}": auth.name || "Player",
      "${auth_uuid}": auth.uuid || "00000000-0000-0000-0000-000000000000",
      "${auth_xuid}": auth.meta?.xuid || "",
      "${user_properties}": auth.user_properties || "{}",
      "${user_type}": auth.meta?.type || "legacy",
      "${version_name}": v.number || this.opts.overrides?.versionName || "unknown",
      "${assets_index_name}": assetIndexId,
      "${game_directory}": this.opts.gameDirectory,
      "${assets_root}": assetsRoot,
      "${game_assets}": assetsRoot,
      "${version_type}": v.type || "release",
      "${clientid}": auth.meta?.clientId || auth.client_token || "",
      "${resolution_width}": this.opts.window?.width || 856,
      "${resolution_height}": this.opts.window?.height || 482,
      "${library_directory}": join(this.opts.gameDirectory, "libraries").split(sep).join("/"),
      "${classpath_separator}": process.platform === "win32" ? ";" : ":",
      "${natives_directory}": this.nativePath.replace(/\\/g, "/"),
      "${classpath}": this.classPath,
    };
  }

  #buildJvmFlags() {
    const major = this.#javaMajor(this.opts.javaPath);

    const memoryFlags = [
      `-Xmx${this.opts.memory.max}`,
      `-Xms${this.opts.memory.min}`,
    ];

    const gcFlags = [
      "-XX:+UseG1GC",
      "-XX:+UnlockExperimentalVMOptions",
      "-XX:+DisableExplicitGC",
      "-XX:G1NewSizePercent=20",
      "-XX:G1ReservePercent=15",
      "-XX:MaxGCPauseMillis=40",
      "-XX:G1HeapRegionSize=16M",
      "-XX:+AlwaysPreTouch",
    ];

    const perfFlags = [
      "-Dsun.rmi.dgc.server.gcInterval=2147483646",
      "-Dsun.rmi.dgc.client.gcInterval=2147483646",
      "-Djava.awt.headless=true",
      "-Dfile.encoding=UTF-8",
      `-Djava.library.path=${this.nativePath.replace(/\\/g, "/")}`,
    ];

    const addOpensFlags = major >= 17 ? [
      "--add-opens", "java.base/sun.security.util=ALL-UNNAMED",
      "--add-opens", "java.base/java.util=ALL-UNNAMED",
      "--add-opens", "java.base/java.lang=ALL-UNNAMED",
      "--add-opens", "java.base/java.io=ALL-UNNAMED",
    ] : [];

    const customFlags = [
      ...(this.customFile?.arguments?.jvm || []),
      ...this.opts.jvm,
    ];

    return [
      ...memoryFlags,
      ...gcFlags,
      ...perfFlags,
      ...addOpensFlags,
      ...customFlags,
    ];
  }

  #buildGameArgs() {
    let { mainClass, minecraftArguments, arguments: argObj } = this.versionFile;

    if (this.customFile?.mainClass) mainClass = this.customFile.mainClass;
    if (!mainClass) throw new Error("mainClass no definido.");

    let args = [];

    if (minecraftArguments) {
      args = minecraftArguments.split(" ");
    } else if (argObj?.game) {
      args = [...argObj.game];
    } else if (this.customFile?.arguments?.game) {
      args = [...this.customFile.arguments.game];
    }

    const gameDir = this.opts.gameDirectory;
    const assetsDir = join(gameDir, "assets");
    const versionId = this.versionFile.id || this.versionFile.inheritsFrom || "unknown";
    const assetIndex = this.opts.overrides?.assetIndex
      || this.opts.version?.assetIndex?.id
      || this.opts.version?.number
      || "legacy";

    const auth = this.opts.authorization || {};
    const username = auth.name || "Player";
    const uuid = auth.uuid || "00000000-0000-0000-0000-000000000000";
    const accessToken = auth.access_token || "0";
    const userType = auth.meta?.type || "legacy";
    const versionType = this.opts.version?.type || "release";

    if (!args.includes("--gameDir")) args.push("--gameDir", gameDir);
    if (!args.includes("--assetsDir")) args.push("--assetsDir", assetsDir);
    if (!args.includes("--version")) args.push("--version", versionId);
    if (!args.includes("--assetIndex")) args.push("--assetIndex", assetIndex);
    if (!args.includes("--username")) args.push("--username", username);
    if (!args.includes("--uuid")) args.push("--uuid", uuid);
    if (!args.includes("--accessToken")) args.push("--accessToken", accessToken);
    if (!args.includes("--userType")) args.push("--userType", userType);
    if (!args.includes("--versionType")) args.push("--versionType", versionType);

    if (
      mainClass === "net.minecraft.launchwrapper.Launch" &&
      !args.includes("--tweakClass")
    ) {
      const tweak = this.versionFile.minecraftArguments?.match(/--tweakClass\s+([^\s]+)/)?.[1]
        || this.customFile?.arguments?.tweakClass
        || "cpw.mods.fml.common.launcher.FMLTweaker";

      args.push("--tweakClass", tweak);
    }

    args.push(...this.opts.mcArgs);

    return { mainClass, args };
  }

  async build() {
    const major = this.#javaMajor(this.opts.javaPath);
    const mainClass = this.customFile?.mainClass || this.versionFile.mainClass;

    if (mainClass === "net.minecraft.launchwrapper.Launch" && major > 8) {
      throw new Error(`LaunchWrapper no soportado en Java ${major}. Usá Java 8.`);
    }

    const clientJar = await this.#resolveClientJar();
    if (!clientJar) throw new Error("No se encontró el .jar del cliente.");

    const sepChar = process.platform === "win32" ? ";" : ":";
    const cpSet = new Set(this.classPath.split(sepChar).filter(Boolean));
    cpSet.add(clientJar);
    this.classPath = [...cpSet].join(sepChar);

    const placeholders = this.#placeholders();
    const jvmFlags = this.#buildJvmFlags();
    const { mainClass: mcClass, args: gameArgs } = this.#buildGameArgs();

    const finalArgs = [
      this.opts.javaPath,
      ...jvmFlags,
      "-cp",
      this.classPath,
      mcClass,
      ...gameArgs,
    ];

    const argv = finalArgs.map(arg =>
      typeof arg === "string"
        ? arg.replace(/\$\{[^}]+\}/g, m => placeholders[m] ?? m)
        : arg
    );

    if (this.opts.debug) {
      console.log("> ARGUMENTOS JVM:", argv.slice(1, argv.indexOf(mcClass)).join(" "));
      console.log("> CLASSPATH:", this.classPath);
      console.log("> NATIVES PATH:", this.nativePath);
    }

    return argv;
  }
}

module.exports = { LaunchArgumentBuilder };
