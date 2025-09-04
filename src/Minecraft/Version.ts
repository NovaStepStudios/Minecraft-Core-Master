import fs from "fs";
import path from "path";
import https from "https";
import { EventEmitter } from "events";
import crypto from "crypto";

interface ProgressData {
  current: number;
  total: number;
  percent: number;
}

interface VersionJSONDownloader {
  downloads?: {
    client?: {
      url: string;
      sha1?: string;
      size?: number;
    };
  };
}

export class MinecraftClientDownloader extends EventEmitter {
  root: string;
  version: string;
  private versionsDir: string;
  private maxRetries = 5;

  constructor(root: string, version: string) {
    super();
    this.root = root;
    this.version = version;
    this.versionsDir = path.join(root, "versions", version);
  }

  public async start(): Promise<void> {
    try {
      await fs.promises.mkdir(this.versionsDir, { recursive: true });

      const manifest: any = await this.fetchJSON("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
      const versionMeta = manifest.versions.find((v: any) => v.id === this.version);
      if (!versionMeta) throw new Error(`Versión ${this.version} no encontrada.`);

      const versionJSON: VersionJSONDownloader = await this.fetchJSON(versionMeta.url);
      const versionJSONPath = path.join(this.versionsDir, `${this.version}.json`);
      await fs.promises.writeFile(versionJSONPath, JSON.stringify(versionJSON, null, 2));
      this.emitProgress(1, 3);

      const clientURL = versionJSON.downloads?.client?.url;
      if (!clientURL) throw new Error(`No se encontró el cliente para ${this.version}`);

      const clientJarPath = path.join(this.versionsDir, `${this.version}.jar`);
      if (!fs.existsSync(clientJarPath)) {
        await this.downloadFileWithRetries(clientURL, clientJarPath, versionJSON.downloads?.client?.sha1, 0, (percentFile) => {

          const overallPercent = 33.33 + (percentFile / 3);
          this.emit("progress", { current: 2, total: 3, percent: overallPercent } as ProgressData);
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
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} - ${url}`));
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try { resolve(JSON.parse(data) as T); }
          catch (err) { reject(err); }
        });
      }).on("error", reject);
    });
  }

  private async downloadFileWithRetries(
    url: string,
    dest: string,
    sha1?: string,
    attempt = 0,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    try {
      await this.downloadFile(url, dest, onProgress);
      if (sha1 && !(await this.verifySHA1(dest, sha1))) throw new Error(`SHA1 mismatch en ${dest}`);
    } catch (err) {
      if (attempt < this.maxRetries) {
        await new Promise(r => setTimeout(r, 1500));
        return this.downloadFileWithRetries(url, dest, sha1, attempt + 1, onProgress);
      }
      throw err;
    }
  }

  private async downloadFile(
    url: string,
    dest: string,
    onProgress?: (percent: number) => void
  ): Promise<void> {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} en ${url}`));

        const totalSize = parseInt(res.headers["content-length"] as string, 10) || 0;
        let downloaded = 0;

        res.on("data", chunk => {
          downloaded += chunk.length;
          if (onProgress) {
            const percent = totalSize ? (downloaded / totalSize) * 100 : 50;
            onProgress(Math.min(percent, 100));
          }
        });

        res.pipe(file);
        file.on("finish", () => file.close(err => (err ? reject(err) : resolve())));
        file.on("error", err => { file.close(); fs.unlink(dest, () => {}); reject(err); });
      }).on("error", err => { fs.unlink(dest, () => {}); reject(err); });
    });
  }

  private async verifySHA1(filePath: string, expected: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha1");
      const stream = fs.createReadStream(filePath);
      stream.on("data", data => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex") === expected));
      stream.on("error", reject);
    });
  }

  private emitProgress(current: number, total: number) {
    const percent = total ? (current / total) * 100 : 100;
    this.emit("progress", { current, total, percent } as ProgressData);
  }
}
