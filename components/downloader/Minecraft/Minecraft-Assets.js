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
    this.concurrency = 10; // Limite de descargas paralelas
  }

  async start() {
    try {
      await this.#ensureDirs();

      const versionManifest = await this.#fetchJSON("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
      const versionMeta = versionManifest.versions.find(v => v.id === this.version);
      if (!versionMeta) throw new Error(`La versión ${this.version} no se encontró.`);

      const versionJSON = await this.#fetchJSON(versionMeta.url);
      const assetIndexURL = versionJSON.assetIndex.url;
      const assetIndex = await this.#fetchJSON(assetIndexURL);
      const assetIndexID = versionJSON.assetIndex.id;

      const indexPath = path.join(this.assetsDir, "indexes", `${assetIndexID}.json`);
      await fs.promises.writeFile(indexPath, JSON.stringify(assetIndex, null, 2));

      const assets = Object.entries(assetIndex.objects);
      let downloaded = 0;

      const limit = pLimit(this.concurrency);

      const downloadTask = async ([logicalPath, { hash }]) => {
        const subDir = hash.slice(0, 2);
        const objectPath = path.join(this.objectsDir, subDir, hash);

        if (!fs.existsSync(objectPath)) {
          const url = `https://resources.download.minecraft.net/${subDir}/${hash}`;
          await this.#downloadFile(url, objectPath);
        }

        // Escribir en: resources/
        const resPath = path.join(this.resourcesDir, logicalPath);
        await this.#copyFile(objectPath, resPath);

        // Escribir en: assets/legacy/virtual/
        const legacyPath = path.join(this.legacyVirtualDir, logicalPath);
        await this.#copyFile(objectPath, legacyPath);

        downloaded++;
        this.#emitProgress(downloaded, assets.length);
      };

      // Ejecutar descargas limitando concurrencia
      await Promise.all(assets.map(asset => limit(() => downloadTask(asset))));

      this.emit("done");
    } catch (err) {
      this.emit("error", err);
    }
  }

  async #ensureDirs() {
    await fs.promises.mkdir(this.objectsDir, { recursive: true });
    await fs.promises.mkdir(path.join(this.assetsDir, "indexes"), { recursive: true });
    await fs.promises.mkdir(this.resourcesDir, { recursive: true });
    await fs.promises.mkdir(this.legacyVirtualDir, { recursive: true });
  }

  async #copyFile(src, dest) {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(src, dest);
  }

  #emitProgress(current, total) {
    const percent = ((current / total) * 100).toFixed(2);
    this.emit("progress", { current, total, percent });
  }

  async #fetchJSON(url) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`[Minecraft-Core-Master || Downloader > Error found JSON] Error al obtener JSON: ${res.statusCode}`));
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

  async #downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const dir = path.dirname(dest);
      fs.mkdirSync(dir, { recursive: true });

      const file = fs.createWriteStream(dest);
      https.get(url, response => {
        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error(`[Minecraft-Core-Master || Downloader > Error] Fallo al descargar archivo: ${url}`));
        }

        response.pipe(file);
        file.on("finish", () => file.close(resolve));
      }).on("error", err => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  }
}

module.exports = MinecraftAssetsDownloader;
