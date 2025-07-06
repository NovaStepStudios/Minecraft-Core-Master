const EventEmitter = require("events");
const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");

const createAssetsDownloader    = require("./downloaders/assetsDownloader.js");
const createClientDownloader    = require("./downloaders/clientDownloader.js");
const createLibrariesDownloader = require("./downloaders/librariesDownloader.js");
const createNativesDownloader   = require("./downloaders/nativesDownloader.js");
const JVMDownloader             = require("./downloaders/jvmDownloader.js");
const JavaRuntimeFinder         = require("./downloaders/jvmOficial.js");
const { verifyVersion }         = require("./downloaders/patch.js");

class MinecraftDownloader extends EventEmitter {
  constructor(rootPath, javaVer = "auto", releaseType = "release", concurrency = 5) {
    super();
    this.rootPath = rootPath;
    this.javaVer = javaVer;
    this.releaseType = releaseType;
    this.concurrency = concurrency;

    this.weights = {
      jvm:     0.20,
      natives: 0.15,
      libs:    0.20,
      assets:  0.20,
      client:  0.25,
    };

    this.cumulative = {};
    let acc = 0;
    for (const key of Object.keys(this.weights)) {
      this.cumulative[key] = acc;
      acc += this.weights[key];
    }

    this.errorLogDir = path.join(this.rootPath, "temp", "download");
    if (!fs.existsSync(this.errorLogDir)) {
      fs.mkdirSync(this.errorLogDir, { recursive: true });
    }

    this.lastProgress = null;
  }

  _formatGlobalProgress(stage, localPercentStr) {
    const localPercent = parseFloat(localPercentStr.replace("%", "")) || 0;
    const globalPercent = (this.cumulative[stage] + (localPercent / 100) * this.weights[stage]) * 100;
    return `Descargando ${stage}… ${globalPercent.toFixed(1)}%`;
  }

  async _appendErrorLog(version, msg) {
    const logPath = path.join(this.errorLogDir, `Errores durante descarga de ${version}.log`);
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}\n`;
    try {
      await fsPromises.appendFile(logPath, line);
    } catch (err) {
      console.error("Error escribiendo log de descarga:", err);
    }
  }

  _attachCommonListeners(emitter, stage, version) {
    emitter.on("progress", (progress) => {
      const msg = this._formatGlobalProgress(stage, progress);
      if (msg !== this.lastProgress) {
        this.lastProgress = msg;
        this.emit("progress", msg);
      }
    });
    emitter.on("error", async (err) => {
      const msg = `[${stage.charAt(0).toUpperCase() + stage.slice(1)} Downloader] ${err.message || err}`;
      this.emit("error", msg);
      await this._appendErrorLog(version, msg);
    });
  }

  async _runDownloader(name, version, fn) {
    const startMsg = `Iniciando descarga de ${name} ${version}`;
    if (startMsg !== this.lastProgress) {
      this.lastProgress = startMsg;
      this.emit("progress", startMsg);
    }
    try {
      await fn();
    } catch (err) {
      const errorMsg = `Error en descarga de ${name}: ${err.message || err}`;
      this.emit("error", errorMsg);
      await this._appendErrorLog(version, errorMsg);
      throw err;  // Puedes quitar el throw si no quieres que se detenga
    }
  }

  async start(version) {
    try {
      let javaVersionToUse = this.javaVer;
      let skipJvmDownloader = false;

      if (javaVersionToUse === "auto") {
        const finder = new JavaRuntimeFinder(this.rootPath, version);
        finder.on("progress", msg => this.emit("progress", `[JVM] ${msg}`));
        finder.on("warn", msg => this.emit("warn", `[JVM] ${msg}`));
        finder.on("error", async e => {
          const emsg = `[JVM Finder] ${e.message || e}`;
          this.emit("error", emsg);
          await this._appendErrorLog(version, emsg);
        });

        await this._runDownloader("Java Runtime Finder", version, async () => {
          await finder.getJavaRuntime();
          await finder.download();
        });

        const info = finder.javaRuntimeInfo;
        if (info) {
          javaVersionToUse = info;
          this.emit("progress", `Java ${info.version.name} instalado correctamente.`);
          this.emit("progress", this._formatGlobalProgress("jvm", "100%"));
          skipJvmDownloader = true;
        }
      }

      if (javaVersionToUse === false) {
        skipJvmDownloader = true;
        this.emit("progress", this._formatGlobalProgress("jvm", "100%"));
      }

      if (!skipJvmDownloader && (typeof javaVersionToUse === "string" || javaVersionToUse?.files)) {
        await this._runDownloader(`Java ${javaVersionToUse.version?.name || javaVersionToUse}`, version, async () => {
          const jvm = new JVMDownloader(this.rootPath, javaVersionToUse);
          this._attachCommonListeners(jvm, "jvm", version);
          await jvm.download();
        });
      } else if (!skipJvmDownloader) {
        this.emit("warn", "No se pudo determinar la versión de Java para descargar.");
      }

      await this._runDownloader("nativos", version, async () => {
        const natives = createNativesDownloader(this.rootPath, version, { concurrency: this.concurrency });
        this._attachCommonListeners(natives, "natives", version);
        await natives.start();
      });

      await this._runDownloader("librerías", version, async () => {
        const libs = createLibrariesDownloader(this.rootPath, version, { concurrency: this.concurrency });
        this._attachCommonListeners(libs, "libs", version);
        await libs.start();
      });

      await this._runDownloader("assets", version, async () => {
        const assets = createAssetsDownloader(this.rootPath, version);
        this._attachCommonListeners(assets, "assets", version);
        await assets.start();
      });

      await this._runDownloader("cliente", version, async () => {
        const client = createClientDownloader(this.rootPath, version);
        this._attachCommonListeners(client, "client", version);
        await client.start();
      });

      // Aquí la integración: verificamos todo luego de descargar el cliente
      try {
        this.emit("progress", "Verificando instalación completa...");
        await verifyVersion(this.rootPath, version);
        this.emit("progress", "Verificación completada con éxito.");
      } catch (verErr) {
        this.emit("error", `Error durante la verificación: ${verErr.message || verErr}`);
        await this._appendErrorLog(version, `Error durante verificación: ${verErr.message || verErr}`);
      }

      this.emit("progress", `Minecraft ${version} descargado (100%)`);
      this.emit("done", `✅ Minecraft ${version} descargado correctamente.`);
    } catch (err) {
      const errorMsg = `Error crítico inesperado: ${err.message || err}`;
      this.emit("error", errorMsg);
      await this._appendErrorLog("general", errorMsg);
      throw err;
    }
  }
}

module.exports = MinecraftDownloader;
