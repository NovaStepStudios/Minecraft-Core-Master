const EventEmitter = require("events");

// ⬇️ Estos tres exportan una FUNCIÓN que ya devuelve la instancia
const AssetsDownloader     = require("./downloaders/assetsDownloader.js");
const ClientDownloader     = require("./downloaders/clientDownloader.js");
const LibrariesDownloader  = require("./downloaders/librariesDownloader.js");

// ⬇️ Estos dos exportan directamente la clase
const NativesDownloader    = require("./downloaders/nativesDownloader.js");
const JVMDownloader        = require("./downloaders/jvmDownloader.js");

class MinecraftDownloader extends EventEmitter {
  /**
   * @param {string} rootPath   Carpeta raíz de Minecraft.
   * @param {string} javaVer    Versión de Java (p.e. "Java24").
   * @param {string} release    Tipo de release ("release", "snapshot", etc.).
   */
  constructor(rootPath, javaVer, release) {
    super();
    this.rootPath   = rootPath;
    this.javaVer    = javaVer;
    this.release    = release;

    /** Peso de cada fase (debe sumar 1.0) */
    this.weights = {
      jvm    : 0.20,
      libs   : 0.20,
      natives: 0.15,
      assets : 0.20,
      client : 0.25,
    };

    // Pre-calcular acumulados para no repetir switch
    this.cumulative = {};
    let acc = 0;
    for (const k of ["jvm","libs","natives","assets","client"]) {
      this.cumulative[k] = acc;
      acc += this.weights[k];
    }
  }

  /**
   * Inicia la descarga completa.
   * @param {string} version Versión de Minecraft (p.e. "1.20.4").
   */
  async start(version) {
    /** Convierte "45.6%" ➜ 45.6 */
    const toNumber = (s) => parseFloat(String(s).replace("%","")) || 0;

    /** Retransmite progreso global */
    const globalProgress = (stage, localStr) => {
      const local = toNumber(localStr);
      const global =
        (this.cumulative[stage] + (local / 100) * this.weights[stage]) * 100;
      this.emit("progress", `Descargando ${stage}… ${global.toFixed(1)}%`);
    };

    try {
      /**************** JVM ****************/
      this.emit("progress", `Iniciando descarga de Java ${this.javaVer}`);
      const jvm = new JVMDownloader(this.rootPath, this.javaVer);
      jvm.on("progress", (p) => globalProgress("jvm", p));
      await jvm.download();

      /**************** Librerías ****************/
      this.emit("progress", `Iniciando descarga de librerías ${version}`);
      const libs = LibrariesDownloader(this.rootPath, version);   // ← función
      libs.on("progress", (p) => globalProgress("libs", p));
      await libs.start();

      /**************** Assets ****************/
      this.emit("progress", `Iniciando descarga de assets ${version}`);
      const assets = AssetsDownloader(this.rootPath, version);    // ← función
      assets.on("progress", (p) => globalProgress("assets", p));
      await assets.start();

      /**************** Cliente ****************/
      this.emit("progress", `Iniciando descarga de cliente ${version}`);
      const client = ClientDownloader(this.rootPath, version);    // ← función
      client.on("progress", (p) => globalProgress("natives", p));
      await client.start();
      
      /**************** Nativos ****************/
      this.emit("progress", `Iniciando descarga de nativos ${version}`);
      const natives = new NativesDownloader(this.rootPath, version);
      natives.on("progress", (p) => globalProgress("client", p));
      await natives.start();
      
      this.emit("progress", `Descarga completa de Minecraft ${version} (100%)`);
    } catch (err) {
      this.emit("error", err);
      throw err;
    }
  }
}

module.exports = MinecraftDownloader;
