/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */
import fs from "fs";
import path from "path";
import https from "https";
import EventEmitter from "events";
import crypto from "crypto";
import pLimit from "p-limit";

interface AssetObject {
  hash: string;
  size: number;
}
interface AssetIndex {
  objects: Record<string, AssetObject>;
}

export class MinecraftAssetsDownloader extends EventEmitter {
  #version: string;
  #assetsDir: string;
  #objectsDir: string;
  #indexesDir: string;
  #legacyVirtualDir: string;
  #resourcesDir: string;
  #concurrency: number;
  #maxRetries: number;
  #overwrite: boolean;
  #downloadLegacyResources: boolean;

  constructor(
    root: string,
    version: string,
    concurrency = 20,
    maxRetries = 10,
    overwrite = true,
    downloadLegacyResources = false,
  ) {
    super();
    this.#version = version;
    this.#concurrency = concurrency;
    this.#maxRetries = maxRetries;
    this.#overwrite = overwrite;
    this.#downloadLegacyResources = downloadLegacyResources;
    this.#assetsDir = path.join(root, "assets");
    this.#objectsDir = path.join(this.#assetsDir, "objects");
    this.#indexesDir = path.join(this.#assetsDir, "indexes");
    this.#legacyVirtualDir = path.join(this.#assetsDir, "legacy", "virtual");
    this.#resourcesDir = path.join(root, "resources");
  }

  public async start(): Promise<void> {
    try {
      await this.#ensureDirs();
      const versionManifest = await this.#fetchJSON<any>(
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
      );
      const versionMeta = versionManifest?.versions?.find((v: any) => v.id === this.#version);
      if (!versionMeta) throw new Error(`La versión ${this.#version} no se encontró.`);
      const versionJSON = await this.#fetchJSON<any>(versionMeta.url);
      const assetIndexURL = versionJSON?.assetIndex?.url;
      if (!assetIndexURL) throw new Error(`No se encontró el assetIndex para la versión ${this.#version}`);
      const assetIndex = await this.#fetchJSON<AssetIndex>(assetIndexURL);
      const assetIndexID = versionJSON.assetIndex.id;
      const indexPath = path.join(this.#indexesDir, `${assetIndexID}.json`);
      await fs.promises.writeFile(indexPath, JSON.stringify(assetIndex, null, 2));
      const assets = Object.entries(assetIndex.objects || {});
      let downloaded = 0;
      const limit = pLimit(this.#concurrency);
      const tasks = assets.map(([logicalPath, { hash }]) =>
        limit(async () => {
          try {
            await this.#handleAsset(logicalPath, hash, versionJSON.assets);
            downloaded++;
            this.#emitProgress(downloaded, assets.length);
          } catch (err: any) {
            this.emit("log", `❌ Error descargando ${logicalPath}: ${err.message}`);
          }
        })
      );

      await Promise.allSettled(tasks);
      this.emit("done", { totalAssets: assets.length, downloaded });
    } catch (err: any) {
      this.emit("error", err);
    }
  }
  async #handleAsset(logicalPath: string, hash: string, assetsType: string): Promise<void> {
    const subDir = hash.slice(0, 2);
    const objectPath = path.join(this.#objectsDir, subDir, hash);
    if (!fs.existsSync(objectPath) || this.#overwrite) {
      if (!fs.existsSync(objectPath) || !(await this.#verifyFile(objectPath, hash))) {
        const url = `https://resources.download.minecraft.net/${subDir}/${hash}`;
        await this.#downloadFileWithRetries(url, objectPath, hash);
      }
    }
    if (this.#downloadLegacyResources && ["legacy", "pre-1.6"].includes(assetsType)) {
      await this.#safeCopy(objectPath, path.join(this.#resourcesDir, logicalPath), this.#overwrite);
      await this.#safeCopy(objectPath, path.join(this.#legacyVirtualDir, logicalPath), this.#overwrite);
    }
  }
  async #safeCopy(src: string, dest: string, overwrite: boolean) {
    if (!fs.existsSync(src)) return;
    if (!overwrite && fs.existsSync(dest)) return;
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(src, dest);
  }
  async #verifyFile(filePath: string, expectedHash: string): Promise<boolean> {
    if (!fs.existsSync(filePath)) return false;
    const actualHash = await this.#calcSHA1(filePath);
    return actualHash === expectedHash;
  }
  async #calcSHA1(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha1");
      const stream = fs.createReadStream(filePath);
      stream.on("data", d => hash.update(d));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }
  async #downloadFileWithRetries(url: string, dest: string, expectedHash: string, retries = 0): Promise<void> {
    try {
      await this.#downloadFile(url, dest);
      if (!(await this.#verifyFile(dest, expectedHash))) {
        throw new Error(`SHA1 mismatch en ${dest}`);
      }
    } catch (err) {
      if (retries < this.#maxRetries) {
        const delay = 1000 * Math.pow(2, retries);
        this.emit("log", `🔄 Reintentando (${retries + 1}) -> ${url} en ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        return this.#downloadFileWithRetries(url, dest, expectedHash, retries + 1);
      }
      throw err;
    }
  }
  async #downloadFile(url: string, dest: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https
        .get(url, res => {
          if (res.statusCode !== 200) {
            file.close(() => fs.unlink(dest, () => void 0));
            return reject(new Error(`Fallo al descargar: ${url} (status ${res.statusCode})`));
          }
          res.pipe(file);
          file.on("finish", () => file.close(err => (err ? reject(err) : resolve())));
          file.on("error", err => {
            file.close(() => fs.unlink(dest, () => void 0));
            reject(err);
          });
        })
        .on("error", err => {
          file.close(() => fs.unlink(dest, () => void 0));
          reject(err);
        });
    });
  }
  async #ensureDirs(): Promise<void> {
    await Promise.all([
      fs.promises.mkdir(this.#objectsDir, { recursive: true }),
      fs.promises.mkdir(this.#indexesDir, { recursive: true }),
      fs.promises.mkdir(this.#resourcesDir, { recursive: true }),
      fs.promises.mkdir(this.#legacyVirtualDir, { recursive: true }),
    ]);
  }
  #emitProgress(current: number, total: number) {
    const stepPercent = total > 0 ? parseFloat(((current / total) * 100).toFixed(2)) : 100;
    this.emit("progress", { current, total, stepPercent });
  }
  async #fetchJSON<T>(url: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      https
        .get(url, res => {
          if (res.statusCode !== 200) return reject(new Error(`Error JSON desde ${url} (status ${res.statusCode})`));
          let data = "";
          res.on("data", chunk => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data) as T);
            } catch (err: any) {
              reject(new Error(`Error parseando JSON: ${err.message}`));
            }
          });
        })
        .on("error", reject);
    });
  }
}
