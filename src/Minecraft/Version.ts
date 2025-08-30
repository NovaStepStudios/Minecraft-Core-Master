/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */
import fs from "fs";
import path from "path";
import https from "https";
import { EventEmitter } from "events";

interface ProgressData {
  current: number;
  total: number;
  percent: string;
}
interface VersionJSONDownloader {
  downloads?: {
    client?: {
      url: string;
      sha1?: string;
      size?: number;
    };
    [key: string]: any;
  };
  [key: string]: any;
}
export class MinecraftClientDownloader extends EventEmitter {
  root: string;
  version: string;
  private versionsDir: string;
  constructor(root: string, version: string) {
    super();
    this.root = root;
    this.version = version;
    this.versionsDir = path.join(root, "versions", version);
  }
  public async start(): Promise<void> {
    try {
      await this.ensureDir(this.versionsDir);
      const manifest: any = await this.fetchJSON("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
      const versionMeta = manifest.versions.find((v: any) => v.id === this.version);
      if (!versionMeta) throw new Error(`[Version] Versión ${this.version} no encontrada.`);
      const versionJSON: VersionJSONDownloader = await this.fetchJSON(versionMeta.url);
      const versionJSONPath = path.join(this.versionsDir, `${this.version}.json`);
      await fs.promises.writeFile(versionJSONPath, JSON.stringify(versionJSON, null, 2));
      this.emitProgress(1, 3);
      const clientURL = versionJSON.downloads?.client?.url;
      if (!clientURL) throw new Error(`[Not Found Client] No se encontró el cliente para ${this.version}`);
      const clientJarPath = path.join(this.versionsDir, `${this.version}.jar`);
      if (!fs.existsSync(clientJarPath)) {
        await this.downloadFile(clientURL, clientJarPath, (downloadedBytes, totalBytes) => {
          const safeTotal = totalBytes > 0 ? totalBytes : 1;
          const percentFile = (downloadedBytes / safeTotal) * 100;
          const overallPercent = 33.33 + (percentFile / 3);
          this.emit("progress", {
            current: 2,
            total: 3,
            percent: overallPercent.toFixed(2),
          } as ProgressData);
        });
      } else {
        this.emitProgress(2, 3);
      }
      this.emitProgress(3, 3);
      this.emit("done");
    } catch (err) {
      this.emit("error", err);
    }
  }
  private async fetchJSON<T>(url: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`[HTTP Request] HTTP ${res.statusCode} - ${url}`));
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try { resolve(JSON.parse(data) as T); } 
          catch (err) { reject(err); }
        });
      }).on("error", reject);
    });
  }
  private async downloadFile(
    url: string,
    dest: string,
    onProgress?: (downloaded: number, total: number, percent: number) => void
  ): Promise<void> {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    return new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`[HTTP] Error HTTP: ${res.statusCode}`));
        const totalSize = parseInt(res.headers["content-length"] || "0", 10);
        let downloaded = 0;
        res.on("data", chunk => {
          downloaded += chunk.length;
          let percent = totalSize > 0 ? (downloaded / totalSize) * 100 : 0;
          onProgress?.(downloaded, totalSize, percent);
        });
        res.pipe(file);
        file.on("finish", () => file.close(err => err ? reject(err) : resolve()));
        file.on("error", err => {
          file.close();
          fs.unlink(dest, () => {});
          reject(err);
        });
      }).on("error", err => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  }
  private async ensureDir(dir: string) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
  private emitProgress(current: number, total: number) {
    const safeCurrent = Number(current) || 0;
    const safeTotal = Number(total) || 1;
    const stepPercent = (safeCurrent / safeTotal) * 100;
    this.emit("progress", {
      current: safeCurrent,
      total: safeTotal,
      percent: stepPercent.toFixed(2),
    } as ProgressData);
  }
}
