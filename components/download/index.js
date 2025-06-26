const EventEmitter = require("events");
const fs = require("fs");
const path = require("path");

const createAssetsDownloader    = require("./downloaders/assetsDownloader.js");
const createClientDownloader    = require("./downloaders/clientDownloader.js");
const createLibrariesDownloader = require("./downloaders/librariesDownloader.js");
const createNativesDownloader   = require("./downloaders/nativesDownloader.js");
const JVMDownloader             = require("./downloaders/jvmDownloader.js");
const JavaRuntimeFinder         = require("./downloaders/jvmOficial.js");

class MinecraftDownloader extends EventEmitter {
  constructor(rootPath, javaVer = "auto", releaseType = "release", currentDownloads = 5) {
    super();
    this.rootPath = rootPath;
    this.javaVer = javaVer;
    this.releaseType = releaseType;
    this.concurrent = currentDownloads;

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

  async start(version) {
    const toNumber = (s) => parseFloat(String(s).replace("%", "")) || 0;

    const globalProgress = (stage, localStr) => {
      const local = toNumber(localStr);
      const global = (this.cumulative[stage] + (local / 100) * this.weights[stage]) * 100;
      const msg = `Descargando ${stage}… ${global.toFixed(1)}%`;
      if (msg !== this.lastProgress) {
        this.lastProgress = msg;
        this.emit("progress", msg);
      }
    };

    const appendErrorLog = (msg) => {
      const logPath = path.join(this.errorLogDir, `Errores durante descarga de ${version}.log`);
      const time = new Date().toISOString();
      const line = `[${time}] ${msg}\n`;
      fs.appendFile(logPath, line, (err) => {
        if (err) console.error("Error escribiendo log de descarga:", err);
      });
    };

    const runDownloader = async (name, fn) => {
      try {
        const msg = `Iniciando descarga de ${name} ${version}`;
        if (msg !== this.lastProgress) {
          this.lastProgress = msg;
          this.emit("progress", msg);
        }
        await fn();
      } catch (err) {
        const errorMsg = `Error en descarga de ${name}: ${err.message || err}`;
        this.emit("error", errorMsg);
        appendErrorLog(errorMsg);
      }
    };

    try {
      let javaVersionToUse = this.javaVer;
      let skipJvmDownloader = false;

      if (javaVersionToUse === "auto") {
        const finder = new JavaRuntimeFinder(this.rootPath, version);
        finder.on("progress", (msg) => this.emit("progress", `[JVM] ${msg}`));
        finder.on("warn", (msg) => this.emit("warn", `[JVM] ${msg}`));
        finder.on("error", (e) => {
          const emsg = `[JVM Finder] ${e.message || e}`;
          this.emit("error", emsg);
          appendErrorLog(emsg);
        });

        await runDownloader("Java Runtime Finder", async () => {
          await finder.getJavaRuntime();
          await finder.download();
        });

        const info = finder.javaRuntimeInfo;
        if (info) {
          javaVersionToUse = info;
          this.emit("progress", `Java ${info.version.name} instalado correctamente.`);
          globalProgress("jvm", "100%");
          skipJvmDownloader = true;
        }
      }

      if (javaVersionToUse === false) {
        skipJvmDownloader = true;
        globalProgress("jvm", "100%");
      }

      if (!skipJvmDownloader && (typeof javaVersionToUse === "string" || javaVersionToUse?.files)) {
        await runDownloader(`Java ${javaVersionToUse.version?.name || javaVersionToUse}`, async () => {
          const jvm = new JVMDownloader(this.rootPath, javaVersionToUse);
          jvm.on("progress", (p) => globalProgress("jvm", p));
          jvm.on("error", (e) => {
            const emsg = `[JVM Downloader] ${e.message || e}`;
            this.emit("error", emsg);
            appendErrorLog(emsg);
          });
          await jvm.download();
        });
      }

      await runDownloader("nativos", async () => {
        const natives = createNativesDownloader(this.rootPath, version, { concurrency: this.concurrent });
        natives.on("progress", (p) => globalProgress("natives", p));
        natives.on("error", (e) => {
          const emsg = `[Natives Downloader] ${e.message || e}`;
          this.emit("error", emsg);
          appendErrorLog(emsg);
        });
        await natives.start();
      });

      await runDownloader("librerías", async () => {
        const libs = createLibrariesDownloader(this.rootPath, version, { concurrency: this.concurrent });
        libs.on("progress", (p) => globalProgress("libs", p));
        libs.on("error", (e) => {
          const emsg = `[Libraries Downloader] ${e.message || e}`;
          this.emit("error", emsg);
          appendErrorLog(emsg);
        });
        await libs.start();
      });

      await runDownloader("assets", async () => {
        const assets = createAssetsDownloader(this.rootPath, version);
        assets.on("progress", (p) => globalProgress("assets", p));
        assets.on("error", (e) => {
          const emsg = `[Assets Downloader] ${e.message || e}`;
          this.emit("error", emsg);
          appendErrorLog(emsg);
        });
        await assets.start();
      });

      await runDownloader("cliente", async () => {
        const client = createClientDownloader(this.rootPath, version);
        client.on("progress", (p) => globalProgress("client", p));
        client.on("error", (e) => {
          const emsg = `[Client Downloader] ${e.message || e}`;
          this.emit("error", emsg);
          appendErrorLog(emsg);
        });
        await client.start();
      });

      this.emit("progress", `Minecraft ${version} descargado (100%)`);
      this.emit("done", `✅ Minecraft ${version} descargado correctamente.`);
    } catch (err) {
      const errorMsg = `Error crítico inesperado: ${err.message || err}`;
      this.emit("error", errorMsg);
      appendErrorLog(errorMsg);
      throw err;
    }
  }
}

module.exports = MinecraftDownloader;