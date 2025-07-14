const EventEmitter = require("events");
const path = require("path");

const MinecraftNativesDownloader    = require("./Minecraft/Minecraft-Natives.js");
const MinecraftLibrariesDownloader  = require("./Minecraft/Minecraft-Libraries.js");
const MinecraftClientDownloader     = require("./Minecraft/Minecraft-Client.js");
const MinecraftAssetsDownloader     = require("./Minecraft/Minecraft-Assets.js");
const JavaInstaller                 = require("./Minecraft/Java-Installer.js");
const { downloadLoggingXml }        = require('./Minecraft/Minecraft-XML.js');

class MinecraftDownloader extends EventEmitter {
  constructor() {
    super();
    this.tasks = [];
    this.totalSteps = 0;
    this.completedSteps = 0;
  }

  async downloadAll(root, version, jvmVersion = false, shouldDownloadAll = true) {
    try {
      this.tasks = [];

      if (jvmVersion) {
        this.tasks.push(() => this.#runJavaInstaller(root, jvmVersion));
      }

      // Descarga el archivo XML de logging como tarea
      this.tasks.push(async () => {
        try {
          // version puede ser string o un objeto con id
          const versionId = typeof version === 'string' ? version : version.id;
          const xmlPath = await downloadLoggingXml(versionId, root);
          this.#emitStepDone("Logging XML");
          this.emit('info', `[Minecraft-Core-Master || Downloader] Logging XML descargado en: ${xmlPath}`);
        } catch (error) {
          this.emit('error', new Error(`[Minecraft-Core-Master || Downloader > XML] Fallo descarga Logging XML: ${error.message}`));
        }
      });

      this.tasks.push(() => this.#runDownloader("Nativos", MinecraftNativesDownloader, root, version));
      this.tasks.push(() => this.#runDownloader("Librerías", MinecraftLibrariesDownloader, root, version));
      this.tasks.push(() => this.#runDownloader("Assets", MinecraftAssetsDownloader, root, version));
      this.tasks.push(() => this.#runDownloader("Cliente", MinecraftClientDownloader, root, version));

      this.totalSteps = this.tasks.length;
      this.completedSteps = 0;

      if (shouldDownloadAll) {
        for (const task of this.tasks) {
          await task();
          this.completedSteps++;
        }
        this.emit("done");
      } else {
        this.emit("ready", this.tasks);
      }

    } catch (err) {
      this.emit("error", err);
    }
  }

  async #runJavaInstaller(root, jvmVersion) {
    return new Promise((resolve, reject) => {
      const installer = new JavaInstaller(root, jvmVersion, path.join(__dirname, "../data/java-urls.json"));

      installer.on("progress", ({ percent }) => {
        this.#emitProgress("Java", percent);
      });

      installer.on("done", () => {
        this.#emitStepDone("Java");
        resolve();
      });

      installer.on("error", reject);
      installer.start();
    });
  }

  async #runDownloader(name, ClassRef, root, version) {
    return new Promise((resolve, reject) => {
      const instance = new ClassRef(root, version);

      instance.on("progress", ({ percent }) => {
        this.#emitProgress(name, percent);
      });

      instance.on("done", () => {
        this.#emitStepDone(name);
        resolve();
      });

      instance.on("error", reject);
      instance.start();
    });
  }

  #emitProgress(type, percent) {
    const globalPercent = (((this.completedSteps + percent / 100) / this.totalSteps) * 100).toFixed(2);
    this.emit("progress", {
      current: type,
      stepPercent: percent,
      totalPercent: globalPercent
    });
  }

  #emitStepDone(name) {
    this.emit("step-done", name);
  }
}

module.exports = MinecraftDownloader;
