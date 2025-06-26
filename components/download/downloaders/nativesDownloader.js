const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const EventEmitter = require("events");
const unzipper = require("unzipper");

class NativesDownloader extends EventEmitter {
  constructor(rootPath, version, { concurrency = 3 } = {}) {
    super();
    this.rootPath = rootPath;
    this.version = version;
    this.platform = this.#detectPlatform();
    this.nativesDir = path.join(rootPath, "natives", version);
    this.concurrent = concurrency;
    this.totalBytes = 1; // default para evitar NaN
    this.doneBytes = 0;
  }
  #detectPlatform() {
    const p = os.platform();
    return p === "win32" ? "windows" :
           p === "darwin" ? "osx" :
           p === "linux"  ? "linux" : "unknown";
  }
  async start() {
    if (this.platform === "unknown") {
      this.emit("error", "Plataforma no reconocida para descargar nativos.");
      return;
    }
    try {
      await fs.promises.mkdir(this.nativesDir, { recursive: true });
      const manifest = await this.#fetchJSON("https://launchermeta.mojang.com/mc/game/version_manifest.json");
      const entry = manifest.versions.find(v => v.id === this.version);
      if (!entry) throw new Error(`Versión ${this.version} no encontrada.`);
      const versionData = await this.#fetchJSON(entry.url);
      const nativeLibs = (versionData.libraries || []).filter(lib => {
        if (!lib.name.includes(":natives-")) return false;
        if (!lib.downloads?.artifact?.url) return false;
        const rules = lib.rules || [];
        if (rules.length === 0) return true;
        return rules.some(r => r.action === "allow" && r.os?.name === this.platform);
      });
      if (nativeLibs.length === 0) {
        this.emit("progress", "100.0%");
        this.emit("done", "Sin nativos para esta plataforma.");
        return;
      }
      // Calcular totalBytes solo de lo necesario
      let total = 0;
      for (const lib of nativeLibs) {
        const art = lib.downloads.artifact;
        const zipPath = path.join(this.nativesDir, path.basename(art.path));
        try {
          const stat = await fs.promises.stat(zipPath);
          if (stat.size !== art.size) total += art.size || 0;
        } catch {
          total += art.size || 0;
        }
      }
      this.totalBytes = total > 0 ? total : 1;
      await this.#processDownloads(nativeLibs);
      this.emit("progress", "100.0%");
      this.emit("done", "✅ Nativos descargados y extraídos correctamente.");
    } catch (e) {
      this.emit("error", `Error en NativesDownloader: ${e.message}`);
    }
  }
  async #processDownloads(libs) {
    const queue = [];
    let active = 0;
    let index = 0;
    const runNext = () => {
      if (index >= libs.length) return;
      const lib = libs[index++];
      const work = this.#handleLib(lib).catch(() => {});
      queue.push(work);
      active++;
      work.finally(() => {
        active--;
        queue.splice(queue.indexOf(work), 1);
        this.#emitProgress();
        runNext();
      });
    };
    for (let i = 0; i < this.concurrent && i < libs.length; i++) {
      runNext();
    }
    // Esperar a que todos terminen
    while (queue.length > 0 || active > 0) {
      await new Promise(r => setTimeout(r, 100));
    }
  }
  async #handleLib(lib) {
    const art = lib.downloads.artifact;
    const zipPath = path.join(this.nativesDir, path.basename(art.path));
    const needsDownload = !(await this.#fileExistsWithSize(zipPath, art.size));
    if (needsDownload) {
      await this.#downloadFile(art.url, zipPath, art.size);
    }
    await this.#extractFlat(zipPath, this.nativesDir);
  }
  #emitProgress() {
    const percent = ((this.doneBytes / this.totalBytes) * 100).toFixed(1);
    this.emit("progress", `${percent}%`);
  }
  async #fileExistsWithSize(filePath, expectedSize) {
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.size === expectedSize;
    } catch {
      return false;
    }
  }
  #fetchJSON(url) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} en ${url}`));
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON malformado: ${e.message}`));
          }
        });
      }).on("error", reject);
    });
  }
  #downloadFile(url, dest, expectedSize) {
    return new Promise((resolve, reject) => {
      const dir = path.dirname(dest);
      fs.mkdirSync(dir, { recursive: true });
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) {
          file.close();
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          return reject(new Error(`HTTP ${res.statusCode} al descargar: ${url}`));
        }
        res.on("data", chunk => {
          this.doneBytes += chunk.length;
          this.#emitProgress();
        });
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", err => {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          reject(err);
        });
      }).on("error", err => {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
    });
  }
  async #extractFlat(zipPath, destDir) {
    const zip = fs.createReadStream(zipPath).pipe(unzipper.Parse({ forceStream: true }));
    for await (const entry of zip) {
      if (entry.type === "Directory" || entry.path.includes("META-INF")) {
        entry.autodrain();
        continue;
      }
      const fileName = path.basename(entry.path);
      const outPath = path.join(destDir, fileName);
      await fs.promises.writeFile(outPath, await entry.buffer());
    }
  }
}
module.exports = (rootPath, version, opts) => new NativesDownloader(rootPath, version, opts);
