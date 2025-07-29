"use strict";
const EventEmitter = require("events");
const fs = require('fs');
const path = require('path');

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

  /**
   * @param {string} root - Directorio raíz donde se guardará todo.
   * @param {string|object} version - ID de la versión o el objeto de versión completo.
   * @param {string|false} jvmVersion - "Java16", "Java17", etc., o false para omitir.
   * @param {boolean} shouldDownloadAll - Si es true, ejecuta todas las descargas automáticamente.
   */
  async downloadAll(root, version, jvmVersion = false, shouldDownloadAll = true) {
    try {
      this.tasks = [];

      // 1. Java
      if (typeof jvmVersion === 'string') {
        this.tasks.push(() => this.#runJavaInstaller(root, jvmVersion));
      }

      // 2. Logging XML
      this.tasks.push(async () => {
        try {
          const versionId = typeof version === 'string' ? version : version.id;
          const xmlPath = await downloadLoggingXml(versionId, root);
          this.#emitStepDone("Logging XML");
          this.emit('info', `[Minecraft-Core-Master || Downloader] Logging XML descargado en: ${xmlPath}`);
        } catch (error) {
          this._saveErrorLog(error, {
            task: 'Logging XML',
            version: version.id || version,
            root,
            step: 'downloadLoggingXml',
            profile: 'UnknownUser'
          });
          this.emit('error', new Error(`[Minecraft-Core-Master || Downloader > XML] Fallo descarga Logging XML: ${error.message}`));
        }
      });

      // 3. Otros componentes
      this.tasks.push(() => this.#runDownloader("Nativos",   MinecraftNativesDownloader, root, version));
      this.tasks.push(() => this.#runDownloader("Librerías", MinecraftLibrariesDownloader, root, version));
      this.tasks.push(() => this.#runDownloader("Assets",    MinecraftAssetsDownloader, root, version));
      this.tasks.push(() => this.#runDownloader("Cliente",   MinecraftClientDownloader, root, version));

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

  async #runJavaInstaller(root, version, jvmVersion) {
    return new Promise((resolve, reject) => {
      const installer = new JavaInstaller(root, jvmVersion);

      installer.on("progress", ({ percent }) => {
        this.#emitProgress("Java", percent);
      });

      installer.on("done", () => {
        this.#emitStepDone("Java");
        resolve();
      });

      installer.on("error", (err) => {
        this._saveErrorLog(err, {
          task: 'Java Installer',
          version: typeof version === 'string' ? version : version.id,
          root,
          step: 'Java',
          profile: 'UnknownUser'
        });
        reject(err);
      });

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

      instance.on("error", (err) => {
        this._saveErrorLog(err, {
          task: name,
          version: version.id || version,
          root: root,
          step: name,
          profile: 'UnknownUser'
        });
        reject(err);
      });

      instance.start();
    });
  }
  _saveErrorLog(err, context = {}) {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${(now.getMonth()+1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
    const timeStr = `${now.getHours().toString().padStart(2, '0')}-${now.getMinutes().toString().padStart(2, '0')}-${now.getSeconds().toString().padStart(2, '0')}`;
    const fileName = `minecraft-core-master_step_download_${dateStr}_${timeStr}_${context.profile || 'UnknownUser'}.log`;

    const logContent = `
    =========== MINECRAFT CORE MASTER ERROR LOG ===========
    Date         : ${now.toISOString()}
    Profile      : ${context.profile || 'UnknownUser'}
    Version      : ${context.version || 'UnknownVersion'}
    OS           : ${process.platform}
    Component    : Downloader -> ${context.task || 'General'}
    Step         : ${context.step || 'N/A'}
    Progress     : ${context.progress || '0%'}
    Root         : ${context.root || 'UnknownRoot'}

    ERROR MESSAGE:
    ${err.message}

    STACKTRACE:
    ${err.stack}
    =======================================================
    `;

    const logDir = path.resolve(context.root || './', 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const logPath = path.join(logDir, fileName);
    fs.writeFileSync(logPath, logContent, 'utf-8');
    console.error(`❌ [ERROR LOG] Guardado en: ${logPath}`);
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
