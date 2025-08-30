/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */
import fs from "fs";
import path from "path";
import https from "https";
import os from "os";
import crypto from "crypto";
import { EventEmitter } from "events";

interface LibraryArtifact {
  url: string;
  path: string;
  sha1?: string;
}
interface Library {
  downloads?: {
    artifact?: LibraryArtifact;
    classifiers?: Record<string, LibraryArtifact>;
  };
  rules?: any[];
  name?: string;
}
export interface LibraryDownload {
  sha1?: string;
  size?: number;
  path: string;
  type: 'Library' | 'Native' | 'CFILE';
  url?: string;
  content?: string;
}

export class MinecraftLibrariesDownloader extends EventEmitter {
  #version: string;
  #libsDir: string;
  #currentOS: string;
  #maxRetries = 5;
  #concurrency: number;
  constructor(root: string, version: string, concurrency = 20) {
    super();
    this.#version = version;
    this.#libsDir = path.join(root, "libraries");
    this.#currentOS = this.#mapOS(os.platform());
    this.#concurrency = concurrency;
  }
  public async start(): Promise<void> {
    await this.#ensureDir(this.#libsDir);
    const manifest = await this.#fetchJSON<any>("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
    const versionMeta = manifest.versions.find((v: any) => v.id === this.#version);
    if (!versionMeta) throw new Error(`[Downloader] Versión ${this.#version} no encontrada.`);
    const versionJSON = await this.#fetchJSON<any>(versionMeta.url);
    const libraries: Library[] = versionJSON.libraries || [];
    const filtered = libraries.filter(lib => this.#matchesRules(lib.rules));
    const officialLibs: LibraryArtifact[] = filtered
      .map(lib => lib.downloads?.artifact)
      .filter((a): a is LibraryArtifact => !!a && !!a.url && !!a.path);
    const extraLibs: LibraryArtifact[] = await this.#loadExtraLibs();
    const allLibs = [...officialLibs, ...extraLibs];
    let downloaded = 0;
    await this.#runConcurrent(allLibs, this.#concurrency, async lib => {
      const fullPath = path.join(this.#libsDir, lib.path);
      const needsDownload =
        !fs.existsSync(fullPath) ||
        (lib.sha1 && !(await this.#verifySHA1(fullPath, lib.sha1)));

      if (needsDownload) {
        await this.#downloadFileWithRetries(lib.url, fullPath, lib.sha1);
      }
      downloaded++;
      this.#emitProgress(downloaded, allLibs.length);
    });
    this.emit("done", { current: downloaded, total: allLibs.length });
  }
  #mapOS(platform: string) {
    switch (platform) {
      case "win32": return "windows";
      case "darwin": return "osx";
      case "linux": return "linux";
      default: return platform;
    }
  }
  #matchesRules(rules?: any[]): boolean {
    if (!rules || rules.length === 0) return true;
    let allowed: boolean | null = null;
    for (const rule of rules) {
      const osRule = rule.os?.name;
      const matches = osRule === this.#currentOS;
      if (rule.action === "disallow" && matches) return false;
      if (rule.action === "allow" && matches) allowed = true;
    }
    return allowed ?? true;
  }
  async #loadExtraLibs(): Promise<LibraryArtifact[]> {
    const jsonPath = path.join(__dirname, "../../resources/libs/extralibs.json");
    let urls: string[] = [];
    if (fs.existsSync(jsonPath)) {
      try {
        const content = await fs.promises.readFile(jsonPath, "utf-8");
        urls = JSON.parse(content);
        if (!Array.isArray(urls)) throw new Error("extralibs.json local no es un array de strings");
      } catch (err) {
        console.warn(`[Downloader] Error leyendo el extralibs.json local:`, err);
        urls = [];
      }
    } else {
      console.warn(`[Downloader] extralibs.json no encontrado en ${jsonPath}, usando URL remota`);
    }
    if (urls.length === 0) {
      try {
        const remoteContent = await this.#fetchRemoteJSON<string[]>(
          "https://raw.githubusercontent.com/NovaStepStudios/Mojang-Api-Meta/refs/heads/minecraft-core-master/extraLibs.json"
        );
        if (Array.isArray(remoteContent)) urls = remoteContent;
      } catch (err) {
        console.warn(`[Downloader] No se pudo cargar el extralibs.json remoto:`, err);
        urls = [];
      }
    }
    return urls.map(url => {
      const u = new URL(url);
      const libPath = u.pathname.replace(/^\/+/, '');
      return { url, path: libPath };
    });
  }
  async #fetchRemoteJSON<T>(url: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} - ${url}`));
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try { resolve(JSON.parse(data) as T); }
          catch (err: any) { reject(new Error(`Error parseando JSON remoto de ${url}: ${err.message}`)); }
        });
      }).on("error", reject);
    });
  }
  async #verifySHA1(filePath: string, expected: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha1");
      const stream = fs.createReadStream(filePath);
      stream.on("data", d => hash.update(d));
      stream.on("end", () => resolve(hash.digest("hex") === expected));
      stream.on("error", reject);
    });
  }
  async #downloadFileWithRetries(url: string, dest: string, sha1?: string, retries = 0): Promise<void> {
    try {
      await this.#downloadFile(url, dest);
      if (sha1 && !(await this.#verifySHA1(dest, sha1))) throw new Error(`SHA1 mismatch en ${dest}`);
    } catch (err) {
      if (retries < this.#maxRetries) {
        await new Promise(r => setTimeout(r, 1500));
        return this.#downloadFileWithRetries(url, dest, sha1, retries + 1);
      }
      throw err;
    }
  }
  async #downloadFile(url: string, dest: string) {
    await this.#ensureDir(path.dirname(dest));
    return new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error(`HTTP ${res.statusCode} en ${url}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(err => (err ? reject(err) : resolve())));
      }).on("error", err => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  }
  async #fetchJSON<T>(url: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} - ${url}`));
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try { resolve(JSON.parse(data) as T); }
          catch (err: any) { reject(new Error(`Error parseando JSON de ${url}: ${err.message}`)); }
        });
      }).on("error", reject);
    });
  }
  async #ensureDir(dir: string) { await fs.promises.mkdir(dir, { recursive: true }); }
  async #runConcurrent<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
    const queue = [...items];
    const workers = new Array(limit).fill(null).map(async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item) await worker(item);
      }
    });
    await Promise.all(workers);
  }
  #emitProgress(current: number, total: number) {
    const stepPercent = total > 0 ? (current / total) * 100 : 100;
    this.emit("progress", { current, total, stepPercent });
  }
}
