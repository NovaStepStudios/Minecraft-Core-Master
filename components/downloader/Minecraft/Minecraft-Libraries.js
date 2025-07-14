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
    this.extraLibsPath = extraLibsPath || path.join(__dirname,'ExtraLibs.json');
    this.currentOS = this.#mapOS(os.platform());
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
        .filter(Boolean);

      // 4. Cargar librerías extras (si hay)
      const extraLibs = this.extraLibsPath && fs.existsSync(this.extraLibsPath)
        ? JSON.parse(fs.readFileSync(this.extraLibsPath, "utf-8"))
        : [];

      const allLibs = [...officialLibs, ...extraLibs];
      let downloaded = 0;

      for (const url of allLibs) {
        const relPath = url.replace("https://libraries.minecraft.net/", "");
        const fullPath = path.join(this.libsDir, relPath);

        if (!fs.existsSync(fullPath)) {
          await this.#downloadFile(url, fullPath);
        }

        downloaded++;
        this.#emitProgress(downloaded, allLibs.length);
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

  async #downloadFile(url, dest) {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error(`[Minecraft-Core-Master || Downloader > Error] Fallo al descargar: ${url}`));
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
            reject(err);
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
