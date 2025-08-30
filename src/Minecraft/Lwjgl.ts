/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */
import fs from "fs";
import path from "path";
import os from "os";
import * as https from "https";
import EventEmitter from "events";
import unzipper from "unzipper";
import crypto from "crypto";
import pLimit from "p-limit";

interface LwjglLibrary {
  name: string;
  downloads: { artifact: { url: string; sha1?: string } };
}
interface ProgressEvent {
  current: string;
  stepPercent: number;
  totalPercent: number;
}
export class LwjglDownloader extends EventEmitter {
  #root: string;
  #concurrency: number;
  #maxRetries: number;
  #overwrite: boolean;
  constructor(rootDir: string, concurrency = 6, maxRetries = 8, overwrite = false) {
    super();
    this.#root = rootDir;
    this.#concurrency = Math.max(1, Math.floor(concurrency));
    this.#maxRetries = maxRetries;
    this.#overwrite = overwrite;
  }
  private getArchFolder(): string {
    const arch = os.arch();
    return arch === "x64" || arch === "arm64" ? "aarch64" : "aarch";
  }
  public static getLwjglVersion(mcVersion: string): string | null {
    if (!mcVersion) return null;
    const [majorStr, minorStr] = mcVersion.split(".");
    const major = Number(majorStr) || 0;
    const minor = Number(minorStr) || 0;
    if (major > 1 || (major === 1 && minor >= 13)) return null;
    if (major === 1 && minor === 12) return "3.2.2";
    if (major === 1 && minor === 11) return "3.2.1";
    if (major === 1 && minor === 10) return "3.1.6";
    if (major === 1 && minor === 9) return "3.1.2";
    return "2.9.4";
  }
  async #readLocalJSON(version: string): Promise<{ libraries: LwjglLibrary[] }> {
    const archFolder = this.getArchFolder();
    const folder = path.join(__dirname, '../','../','../', "json", archFolder);
    const jsonFiles = await fs.promises.readdir(folder);
    const matchFile = jsonFiles.find(f => f.startsWith(version) && f.endsWith(".json"));
    if (!matchFile) throw new Error(`No se encontró JSON para LWJGL versión ${version}`);
    const filePath = path.join(folder, matchFile);
    const content = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(content) as { libraries: LwjglLibrary[] };
  }
  public async start(root: string, version: string | { id: string }, concurrency?: number) {
    const versionId = typeof version === "string" ? version : version?.id;
    if (!versionId) {
      this.emit("warn", "Versión inválida, no se puede descargar LWJGL.");
      this.emit("done", { total: 0, downloaded: 0 });
      return;
    }
    const lwjglVer = LwjglDownloader.getLwjglVersion(versionId);
    if (!lwjglVer) {
      this.emit("info", `Versión ${versionId} no requiere LWJGL.`);
      this.emit("done", { total: 0, downloaded: 0 });
      return;
    }
    let lwjglJSON: { libraries: LwjglLibrary[] };
    try {
      lwjglJSON = await this.#readLocalJSON(lwjglVer);
    } catch (err: any) {
      this.emit("warn", `No se pudo leer JSON LWJGL: ${err.message}`);
      this.emit("done", { total: 0, downloaded: 0 });
      return;
    }
    const nativesDir = path.join(root ?? this.#root, "versions",versionId,"natives");
    await fs.promises.mkdir(nativesDir, { recursive: true });
    const rawConcurrency = concurrency ?? this.#concurrency;
    let safeConcurrency = Number(rawConcurrency);
    if (!Number.isInteger(safeConcurrency) || safeConcurrency < 1) {
      safeConcurrency = 6;
    }
    const limit = pLimit(safeConcurrency);
    let downloaded = 0;
    const total = lwjglJSON.libraries.length;
    const tasks = lwjglJSON.libraries.map(lib =>
      limit(async () => {
        try {
          await this.#downloadAndExtract(lib, nativesDir);
          downloaded++;
          this.emit("progress", {
            current: lib.name,
            stepPercent: parseFloat(((downloaded / total) * 100).toFixed(2)),
            totalPercent: parseFloat(((downloaded / total) * 100).toFixed(2)),
          } as ProgressEvent);
        } catch (err: any) {
          this.emit("log", `Error descargando ${lib.name}: ${err.message}`);
        }
      })
    );
    await Promise.all(tasks);
    this.emit("done", { total, downloaded });
  }
  async #downloadAndExtract(lib: LwjglLibrary, destDir: string) {
    const url = lib.downloads.artifact.url;
    const jarName = path.basename(url);
    const jarPath = path.join(destDir, jarName);

    const needsDownload = this.#overwrite || !(await this.#verifyFile(jarPath, lib.downloads.artifact.sha1));
    if (needsDownload) await this.#downloadFileWithRetries(url, jarPath, lib.downloads.artifact.sha1);
    await this.#extractNativeFiles(jarPath, destDir);
  }
  async #verifyFile(filePath: string, expectedHash?: string) {
    if (!expectedHash || !fs.existsSync(filePath)) return false;
    const hash = await this.#calcSHA1(filePath);
    return hash === expectedHash;
  }
  async #calcSHA1(filePath: string) {
    return new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash("sha1");
      fs.createReadStream(filePath)
        .on("data", d => hash.update(d))
        .on("end", () => resolve(hash.digest("hex")))
        .on("error", reject);
    });
  }
  async #downloadFileWithRetries(url: string, dest: string, expectedHash?: string, retries = 0): Promise<void> {
    try {
      await this.#downloadFile(url, dest);
      if (expectedHash && !(await this.#verifyFile(dest, expectedHash))) throw new Error("SHA1 mismatch");
    } catch (err) {
      if (retries < this.#maxRetries) {
        this.emit("log", `Reintentando (${retries + 1}) descarga: ${url}`);
        await new Promise(r => setTimeout(r, 1000 * (retries + 1)));
        return this.#downloadFileWithRetries(url, dest, expectedHash, retries + 1);
      }
      throw err;
    }
  }
  async #downloadFile(url: string, dest: string) {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    return new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, (res: import("http").IncomingMessage) => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} - ${url}`));
        res.on("data", (chunk: Buffer) => file.write(chunk));
        res.on("end", () => file.end(resolve));
        res.on("error", (err: Error) => reject(err));
      }).on("error", (err: Error) => reject(err));
    });
  }
  async #extractNativeFiles(jarPath: string, destDir: string) {
    return new Promise<void>((resolve, reject) => {
      fs.createReadStream(jarPath)
        .pipe(unzipper.Parse())
        .on("entry", entry => {
          const ext = path.extname(entry.path).toLowerCase();
          const validExts = [".dll", ".so", ".dylib", ".jnilib", ".jar"];
          if (validExts.includes(ext)) {
            const outPath = path.join(destDir, path.basename(entry.path));
            fs.promises.mkdir(path.dirname(outPath), { recursive: true })
              .then(() => {
                entry.pipe(fs.createWriteStream(outPath));
              })
              .catch(() => entry.autodrain());
          } else {
            entry.autodrain();
          }
        })
        .on("close", resolve)
        .on("error", reject);
    });
  }
}
