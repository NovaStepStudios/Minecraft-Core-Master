/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */
import fs from "fs";
import path from "path";
import os from "os";
import https from "https";
import EventEmitter from "events";
import unzipper from "unzipper";
import crypto from "crypto";
import pLimit from "p-limit";

interface NativeLibrary {
  name: string;
  downloads?: {
    artifact?: { url: string; sha1?: string };
    classifiers?: Record<string, { url: string; sha1?: string }>;
  };
  rules?: any[];
}
interface URLInfo {
  url: string;
  sha1?: string | undefined;
}
export class MinecraftNativesDownloader extends EventEmitter {
  #version: string;
  #destDir: string;
  #concurrency: number;
  #overwrite: boolean;
  #currentOS: string;
  #currentArch: string;

  constructor(root: string, version: string, concurrency = 5, overwrite = true) {
    super();
    this.#version = version;
    this.#concurrency = concurrency;
    this.#overwrite = overwrite;
    this.#destDir = path.join(root, "versions", version, "natives");
    this.#currentOS = this.#mapOS(os.platform());
    this.#currentArch = os.arch();
  }

  public async start(): Promise<void> {
    try {
      await fs.promises.mkdir(this.#destDir, { recursive: true });
      const versionJSON = await this.#fetchVersionJSON(this.#version);
      const libraries: NativeLibrary[] = versionJSON.libraries || [];
      const nativeLibs = libraries.filter((lib) => this.#isNativeLibrary(lib));

      const limit = pLimit(this.#concurrency);
      let completed = 0;

      await Promise.all(
        nativeLibs.map((lib) =>
          limit(async () => {
            await this.#handleNative(lib);
            completed++;
            this.emit("progress", {
              current: completed,
              total: nativeLibs.length,
              stepPercent: parseFloat(((completed / nativeLibs.length) * 100).toFixed(2)),
            });
          })
        )
      );

      this.emit("done", { total: nativeLibs.length, downloaded: completed });
    } catch (err: any) {
      this.emit("error", err);
    }
  }

  async #handleNative(lib: NativeLibrary): Promise<void> {
    const urlInfo = this.#getNativeURL(lib);
    if (!urlInfo) return;

    const jarPath = path.join(this.#destDir, path.basename(urlInfo.url));
    const needsDownload = this.#overwrite || !(await this.#verifyFile(jarPath, urlInfo.sha1));

    if (needsDownload) {
      await this.#downloadFileWithRetries(urlInfo.url, jarPath, urlInfo.sha1);
    }

    await this.#extractAndCleanup(jarPath, this.#destDir);
  }

  async #extractAndCleanup(jarPath: string, destDir: string): Promise<void> {
    const exts: Record<string, string[]> = { windows: [".dll"], linux: [".so"], osx: [".dylib", ".jnilib"] };
    const validExts = exts[this.#currentOS] || [];

    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(jarPath)
        .pipe(unzipper.Parse())
        .on("entry", (entry) => {
          const ext = path.extname(entry.path).toLowerCase();
          if (!validExts.includes(ext) || !this.#isValidForCurrentArch(entry.path)) return entry.autodrain();

          const outPath = path.join(destDir, path.basename(entry.path));
          entry.pipe(fs.createWriteStream(outPath));
        })
        .on("close", resolve)
        .on("error", reject);
    });

    await fs.promises.unlink(jarPath).catch(() => {});
  }

  #isValidForCurrentArch(fileName: string): boolean {
    fileName = fileName.toLowerCase();
    if (this.#currentOS === "windows") {
      if (this.#currentArch === "x64" && (fileName.includes("arm64") || fileName.includes("x86") || fileName.includes("windows-32"))) return false;
      if (this.#currentArch === "ia32" && !fileName.includes("windows-32")) return false;
    }
    if (this.#currentOS === "linux" || this.#currentOS === "osx") {
      if (this.#currentArch === "x64" && fileName.includes("arm64")) return false;
      if (this.#currentArch === "arm64" && (fileName.includes("x86") || fileName.includes("x64"))) return false;
    }
    return true;
  }

  #isNativeLibrary(lib: NativeLibrary): boolean {
    if (!this.#matchesRules(lib.rules)) return false;
    if (lib.name.includes(":natives")) return true;
    if (lib.downloads?.classifiers) return Object.keys(lib.downloads.classifiers).some((k) => k.startsWith("natives-"));
    return false;
  }

  #getNativeURL(lib: NativeLibrary): URLInfo | null {
    if (!this.#matchesRules(lib.rules)) return null;

    // Primero intentamos classifiers
    if (lib.downloads?.classifiers) {
      const keysToTry = [`natives-${this.#currentOS}-${this.#mapArchForURL()}`, `natives-${this.#currentOS}`];
      for (const key of keysToTry) {
        const classifier = lib.downloads.classifiers[key];
        if (classifier) return { url: classifier.url, sha1: classifier.sha1 };
      }
    }

    // Fallback a artifact si es un native
    if (lib.downloads?.artifact && lib.name.includes(":natives")) {
      return { url: lib.downloads.artifact.url, sha1: lib.downloads.artifact.sha1 };
    }

    return null;
  }

  #matchesRules(rules?: any[]): boolean {
    if (!rules) return true;
    let allowed: boolean | null = null;
    for (const rule of rules) {
      if (!rule.os) { allowed = rule.action === "allow"; continue; }
      if (rule.os.name && rule.os.name !== this.#currentOS) continue;
      allowed = rule.action === "allow";
    }
    return allowed ?? true;
  }

  #mapOS(platform: string): string {
    switch (platform) {
      case "win32": return "windows";
      case "darwin": return "osx";
      case "linux": return "linux";
      default: return platform;
    }
  }

  #mapArchForURL(): string {
    switch (this.#currentOS) {
      case "windows": return this.#currentArch === "x64" ? "x64" : "x86";
      case "linux": return this.#currentArch === "x64" ? "x64" : this.#currentArch === "arm64" ? "arm64" : this.#currentArch;
      case "osx": return this.#currentArch === "x64" ? "x64" : "arm64";
      default: return this.#currentArch;
    }
  }

  async #verifyFile(filePath: string, sha1?: string): Promise<boolean> {
    if (!sha1 || !fs.existsSync(filePath)) return false;
    const hash = crypto.createHash("sha1");
    const data = await fs.promises.readFile(filePath);
    hash.update(data);
    return hash.digest("hex") === sha1;
  }

  async #downloadFileWithRetries(url: string, dest: string, sha1?: string, retries = 0): Promise<void> {
    try {
      await this.#downloadFile(url, dest);
      if (sha1) {
        const ok = await this.#verifyFile(dest, sha1);
        if (!ok) throw new Error(`SHA1 mismatch en ${dest}`);
      }
    } catch (err) {
      if (retries < 5) {
        this.emit("log", `Retry ${retries + 1} for ${url}`);
        await new Promise((r) => setTimeout(r, 1500));
        return this.#downloadFileWithRetries(url, dest, sha1, retries + 1);
      }
      throw err;
    }
  }

  async #downloadFile(url: string, dest: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    return new Promise<void>((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, (res) => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        res.pipe(file);
        file.on("finish", () => file.close(err => err ? reject(err) : resolve()));
        file.on("error", err => { file.close(() => fs.unlink(dest, () => {})); reject(err); });
      }).on("error", err => { file.close(() => fs.unlink(dest, () => {})); reject(err); });
    });
  }

  async #fetchVersionJSON(version: string): Promise<any> {
    const manifest = await this.#fetchJSON<any>("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
    const versionMeta = manifest.versions.find((v: any) => v.id === version);
    if (!versionMeta) throw new Error(`Versión ${version} no encontrada`);
    return this.#fetchJSON<any>(versionMeta.url);
  }

  async #fetchJSON<T>(url: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
          try { resolve(JSON.parse(data) as T); }
          catch (e) { reject(e); }
        });
      }).on("error", reject);
    });
  }
}
