"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const os = require("os");
const EventEmitter = require("events");

class MinecraftLibrariesDownloader extends EventEmitter {
  constructor(root, version, extraLibsPath = null) {
    super();
    this.root = root;
    this.version = version;
    this.libsDir = path.join(root, "libraries");
    this.extraLibsPath = extraLibsPath || path.join(__dirname, 'ExtraLibs.json');
    this.currentOS = this.#mapOS(os.platform());
    this.maxRetries = 5
  }

  async start() {
    try {
      await this.#ensureDir(this.libsDir);

      // 1. Cargar manifest de versiones
      const manifest = await this.#fetchJSON("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
      const versionMeta = manifest.versions.find(v => v.id === this.version);
      if (!versionMeta) throw new Error(`[Minecraft-Core-Master || Downloader > Version] Versión ${this.version} no encontrada.`);

      // 2. Cargar json de versión
      const versionJSON = await this.#fetchJSON(versionMeta.url);
      const libraries = versionJSON.libraries || [];

      // 3. Filtrar librerías compatibles con el SO actual
      const filtered = libraries.filter(lib => this.#matchesRules(lib.rules));
      const officialLibs = filtered
        .map(lib => lib.downloads?.artifact?.url)
        .filter(url => url && url.endsWith('.jar'));

      // 4. Cargar librerías extras (si hay)
      const extraLibs = this.extraLibsPath && fs.existsSync(this.extraLibsPath)
        ? JSON.parse(fs.readFileSync(this.extraLibsPath, "utf-8"))
        : [];
      const extraLibsFiltered = extraLibs.filter(url => typeof url === 'string' && url.endsWith('.jar'));

      const allLibs = [...officialLibs, ...extraLibsFiltered];
      let downloaded = 0;

      for (const url of allLibs) {
        try {
          const urlObj = new URL(url);
          const relPath = urlObj.pathname.substring(1); // quitar slash inicial
          const fullPath = path.join(this.libsDir, relPath);

          if (!fs.existsSync(fullPath)) {
            await this.#downloadFileWithRetries(url, fullPath);
            this.emit("log", `Descargado: ${url}`);
          } else {
            this.emit("log", `Ya existe: ${fullPath}`);
          }
          downloaded++;
          this.#emitProgress(downloaded, allLibs.length);
        } catch (err) {
          this.emit("log", `[Warning] URL inválida o error: ${url} -> ${err.message}`);
        }
      }

      this.emit("done");
    } catch (err) {
      this.emit("error", err);
    }
  }

  #mapOS(platform) {
    switch (platform) {
      case "win32": return "windows";
      case "darwin": return "osx";
      case "linux": return "linux";
      default: return platform;
    }
  }

  #matchesRules(rules) {
    if (!rules || rules.length === 0) return true;
    let allowed = null;
    for (const rule of rules) {
      const osRule = rule.os?.name;
      const matches = osRule === this.currentOS;
      if (rule.action === "allow" && matches) allowed = true;
      if (rule.action === "disallow" && matches) allowed = false;
    }
    return allowed ?? true;
  }

  async #downloadFileWithRetries(url, dest, retries = 0) {
    try {
      await this.#downloadFile(url, dest);
    } catch (err) {
      if (retries < this.maxRetries) {
        this.emit("log", `Reintentando descarga (${retries + 1}): ${url}`);
        await new Promise(r => setTimeout(r, 1000)); // espera 1s
        return this.#downloadFileWithRetries(url, dest, retries + 1);
      }
      throw err;
    }
  }

  async #downloadFile(url, dest) {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error(`Error HTTP ${res.statusCode} al descargar: ${url}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      }).on("error", err => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  }

  async #fetchJSON(url) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} - ${url}`));
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Error parseando JSON de ${url}: ${err.message}`));
          }
        });
      }).on("error", reject);
    });
  }

  async #ensureDir(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  #emitProgress(current, total) {
    const percent = ((current / total) * 100).toFixed(2);
    this.emit("progress", { current, total, percent });
  }
}

module.exports = MinecraftLibrariesDownloader;
