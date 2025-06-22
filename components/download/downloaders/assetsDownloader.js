const fs = require("fs");
const path = require("path");
const https = require("https");
const EventEmitter = require("events");

class AssetsDownloader extends EventEmitter {
  constructor(root, version) {
    super();
    this.root = root;
    this.version = version;
    this.assetsBaseURL = "https://resources.download.minecraft.net";
    this.indexPath = path.join(root, "assets", "indexes");
    this.objectsPath = path.join(root, "assets", "objects");
    this.virtualPath = path.join(root, "assets", "virtual", "legacy");
    this.concurrentDownloads = 5;
  }

  async start() {
    try {
      this.#createFolders();

      const assetIndex = await this.#fetchAssetIndexInfo(this.version);

      if (!assetIndex?.id || !assetIndex?.url) {
        throw new Error("No se encontró assetIndex válido para la versión.");
      }

      const indexFilePath = path.join(this.indexPath, `${assetIndex.id}.json`);
      const indexData = await this.#getAssetIndexJson(assetIndex.url, indexFilePath);

      await this.#downloadAssets(indexData.objects || {});

      this.emit("done", "100.0%");
    } catch (error) {
      this.emit("error", error.message);
    }
  }

  #createFolders() {
    [this.indexPath, this.objectsPath, this.virtualPath].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  #fetchJson(url) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} al descargar: ${url}`));
          return;
        }
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("Error al parsear JSON"));
          }
        });
      }).on("error", reject);
    });
  }

  async #fetchAssetIndexInfo(version) {
    const manifestURL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    const manifest = await this.#fetchJson(manifestURL);

    const versionInfo = manifest.versions.find(v => v.id === version);
    if (!versionInfo) throw new Error(`Versión '${version}' no encontrada en manifest.`);

    const versionJson = await this.#fetchJson(versionInfo.url);

    if (!versionJson.assetIndex) throw new Error("No se encontró assetIndex en versión.");

    return versionJson.assetIndex;
  }

  async #getAssetIndexJson(url, localPath) {
    let needDownload = true;
    if (fs.existsSync(localPath)) {
      const stat = fs.statSync(localPath);
      if (stat.size > 100) {
        try {
          const raw = fs.readFileSync(localPath, "utf-8");
          JSON.parse(raw);
          needDownload = false;
          return JSON.parse(raw);
        } catch {
          fs.unlinkSync(localPath);
          needDownload = true;
        }
      }
    }

    if (needDownload) {
      await this.#downloadFile(url, localPath);
    }

    const raw = fs.readFileSync(localPath, "utf-8");
    return JSON.parse(raw);
  }

  async #downloadAssets(objects) {
    const entries = Object.entries(objects);
    const total = entries.length;
    let completed = 0;
    let active = 0;
    let index = 0;

    return new Promise((resolve, reject) => {
      const next = () => {
        if (completed === total) {
          resolve();
          return;
        }

        while (active < this.concurrentDownloads && index < total) {
          active++;
          const [name, { hash }] = entries[index++];
          this.#downloadAsset(name, hash)
            .then(() => {
              completed++;
              active--;
              const percent = ((completed / total) * 100).toFixed(1);
              this.emit("progress", `${percent}%`);
              next();
            })
            .catch(err => reject(err));
        }
      };

      next();
    });
  }

  async #downloadAsset(name, hash) {
    const subDir = hash.substring(0, 2);
    const url = `${this.assetsBaseURL}/${subDir}/${hash}`;
    const dest = path.join(this.objectsPath, subDir, hash);
    const virtualDest = path.join(this.virtualPath, name);

    if (!fs.existsSync(dest)) {
      await this.#downloadFile(url, dest);
    }

    if (!fs.existsSync(virtualDest)) {
      fs.mkdirSync(path.dirname(virtualDest), { recursive: true });
      fs.copyFileSync(dest, virtualDest);
    }
  }

  #downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const options = new URL(url);
      options.family = 4; // IPv4

      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const file = fs.createWriteStream(dest);
      https.get(options, res => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      }).on("error", err => {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
    });
  }
}

module.exports = (root, version) => new AssetsDownloader(root, version);
