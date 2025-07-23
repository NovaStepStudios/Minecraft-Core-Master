const fs = require("fs");
const path = require("path");
const https = require("https");
const EventEmitter = require("events");
const pLimit = require("p-limit").default;

class MinecraftAssetsDownloader extends EventEmitter {
  constructor(root, version) {
    super();
    this.root = root;
    this.version = version;
    this.assetsDir = path.join(root, "assets");
    this.objectsDir = path.join(this.assetsDir, "objects");
    this.legacyVirtualDir = path.join(this.assetsDir, "legacy", "virtual");
    this.resourcesDir = path.join(root, "resources");
    this.concurrency = 10;
  }

  async start() {
    try {
      await this.#ensureDirs();

      const versionManifest = await this.#fetchJSON("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
      const versionMeta = versionManifest?.versions?.find(v => v.id === this.version);
      if (!versionMeta) throw new Error(`La versión ${this.version} no se encontró.`);

      const versionJSON = await this.#fetchJSON(versionMeta.url);
      const assetIndexURL = versionJSON?.assetIndex?.url;
      if (!assetIndexURL) throw new Error(`No se encontró el assetIndex para la versión ${this.version}`);

      const assetIndex = await this.#fetchJSON(assetIndexURL);
      const assetIndexID = versionJSON.assetIndex.id;

      const indexPath = path.join(this.assetsDir, "indexes", `${assetIndexID}.json`);
      await fs.promises.writeFile(indexPath, JSON.stringify(assetIndex, null, 2));

      const assets = Object.entries(assetIndex.objects || {});
      let downloaded = 0;

      const limit = pLimit(this.concurrency);
      const tasks = assets.map(([logicalPath, { hash }]) => limit(() => this.#handleAsset(logicalPath, hash, ++downloaded, assets.length)));

      await Promise.allSettled(tasks);

      this.emit("done");
    } catch (err) {
      this.emit("error", err);
    }
  }

  async #handleAsset(logicalPath, hash, index, total) {
    try {
      const subDir = hash.slice(0, 2);
      const objectPath = path.join(this.objectsDir, subDir, hash);

      // Descargar si no existe
      if (!fs.existsSync(objectPath)) {
        const url = `https://resources.download.minecraft.net/${subDir}/${hash}`;
        await this.#downloadFile(url, objectPath);
      }

      // Copiar a resources/
      const resPath = path.join(this.resourcesDir, logicalPath);
      await this.#safeCopy(objectPath, resPath);

      // Copiar a legacy/virtual/
      const legacyPath = path.join(this.legacyVirtualDir, logicalPath);
      await this.#safeCopy(objectPath, legacyPath);

      this.#emitProgress(index, total);
    } catch (e) {
      this.emit("warn", `Error al manejar el asset ${logicalPath}: ${e.message}`);
    }
  }

  async #ensureDirs() {
    await Promise.all([
      fs.promises.mkdir(this.objectsDir, { recursive: true }),
      fs.promises.mkdir(path.join(this.assetsDir, "indexes"), { recursive: true }),
      fs.promises.mkdir(this.resourcesDir, { recursive: true }),
      fs.promises.mkdir(this.legacyVirtualDir, { recursive: true }),
    ]);
  }

  async #safeCopy(src, dest) {
    if (!fs.existsSync(src)) return;
    try {
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(src, dest);
    } catch (err) {
      this.emit("warn", `Fallo al copiar archivo a ${dest}: ${err.message}`);
    }
  }

  #emitProgress(current, total) {
    const percent = ((current / total) * 100).toFixed(2);
    this.emit("progress", { current, total, percent });
  }

  async #fetchJSON(url) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`Error al obtener JSON desde ${url} (status ${res.statusCode})`));
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Error al parsear JSON desde ${url}: ${err.message}`));
          }
        });
      }).on("error", reject);
    });
  }

  async #downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const dir = path.dirname(dest);
      fs.mkdirSync(dir, { recursive: true });

      const file = fs.createWriteStream(dest);
      https.get(url, response => {
        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error(`Fallo al descargar archivo: ${url} (status ${response.statusCode})`));
        }

        response.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", err => {
          file.close();
          fs.unlink(dest, () => {});
          reject(err);
        });
      }).on("error", err => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  }
}

module.exports = MinecraftAssetsDownloader;
