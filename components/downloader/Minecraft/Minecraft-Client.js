"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const EventEmitter = require("events");

class MinecraftClientDownloader extends EventEmitter {
  constructor(root, version) {
    super();
    this.root = root;
    this.version = version;
    this.versionsDir = path.join(root, "versions", version);
  }

  async start() {
    try {
      await this.#ensureDir(this.versionsDir);

      const manifest = await this.#fetchJSON("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
      const versionMeta = manifest.versions.find(v => v.id === this.version);
      if (!versionMeta) throw new Error(`[Minecraft-Core-Master || Downloader > Version] Versión ${this.version} no encontrada.`);

      const versionJSON = await this.#fetchJSON(versionMeta.url);

      const versionJSONPath = path.join(this.versionsDir, `${this.version}.json`);
      await fs.promises.writeFile(versionJSONPath, JSON.stringify(versionJSON, null, 2));
      this.#emitProgress(1, 3); // 33%

      const clientURL = versionJSON.downloads?.client?.url;
      if (!clientURL) throw new Error(`[Minecraft-Core-Master || Downloader > Not Found Client] No se encontró el cliente para ${this.version}`);

      const clientJarPath = path.join(this.versionsDir, `${this.version}.jar`);
      if (!fs.existsSync(clientJarPath)) {
        await this.#downloadFile(clientURL, clientJarPath, (downloadedBytes, totalBytes) => {
          const totalSteps = 3;
          const progressFromDownload = (downloadedBytes / totalBytes) * (1 / totalSteps);
          this.emit("progress", {
            current: 2,
            total: 3,
            percent: ((1 + progressFromDownload) / totalSteps * 100).toFixed(2)
          });
        });
      } else {
        this.#emitProgress(2, 3);
      }

      this.#emitProgress(3, 3);
      this.emit("done");
    } catch (err) {
      this.emit("error", err);
    }
  }

  async #fetchJSON(url) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`[Minecraft-Core-Master || Downloader > HTTP Request] HTTP ${res.statusCode} - ${url}`));
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

  async #downloadFile(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`[Minecraft-Core-Master || Downloader > HTTP] Error HTTP: ${res.statusCode}`));

        const totalSize = parseInt(res.headers["content-length"], 10);
        let downloaded = 0;

        const file = fs.createWriteStream(dest);
        res.on("data", chunk => {
          downloaded += chunk.length;
          onProgress?.(downloaded, totalSize);
        });

        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
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

module.exports = MinecraftClientDownloader;
