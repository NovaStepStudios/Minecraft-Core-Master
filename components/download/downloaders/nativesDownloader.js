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
    this.arch = this.#detectArch();
    this.nativesDir = path.join(rootPath, "natives", version);
    this.concurrency = concurrency;
    this.totalBytes = 1; // Para evitar división por cero
    this.doneBytes = 0;
  }

  #detectPlatform() {
    switch (os.platform()) {
      case "win32": return "windows";
      case "darwin": return "osx";
      case "linux": return "linux";
      default: return "unknown";
    }
  }

  #detectArch() {
    const arch = os.arch();
    if (arch === "x64" || arch === "amd64") return "x64";
    if (arch === "ia32" || arch === "x86") return "x86";
    if (arch === "arm64") return "arm64";
    return arch;
  }

  #fetchJSON(url) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} en ${url}`));
        }
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`JSON malformado: ${err.message}`));
          }
        });
      }).on("error", err => reject(new Error(`Error HTTPS: ${err.message}`)));
    });
  }

  async start() {
    if (this.platform === "unknown") {
      this.emit("error", "Plataforma no reconocida para descargar nativos.");
      return;
    }

    try {
      await fs.promises.mkdir(this.nativesDir, { recursive: true });

      const manifest = await this.#fetchJSON("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
      const versionEntry = manifest.versions.find(v => v.id === this.version);
      if (!versionEntry) throw new Error(`Versión ${this.version} no encontrada en el manifest.`);

      const versionData = await this.#fetchJSON(versionEntry.url);

      const nativeLibs = (versionData.libraries || []).filter(lib => {
        if (!lib.downloads?.classifiers) return false;
        if (!lib.natives?.[this.platform]) return false;

        const rules = lib.rules || [];
        if (rules.length === 0) return true;
        return rules.some(rule => rule.action === "allow" && (!rule.os || rule.os.name === this.platform));
      });

      if (nativeLibs.length === 0) {
        this.emit("progress", "100.0%");
        this.emit("done", "Sin nativos para esta plataforma.");
        return;
      }

      // Calcular tamaño total para el progreso
      this.totalBytes = 0;
      for (const lib of nativeLibs) {
        let key = lib.natives[this.platform];
        if (!(key in lib.downloads.classifiers)) {
          this.emit("warn", `Native '${key}' no encontrado en librería ${lib.name}, se ignora.`);
          continue;  // <-- Aquí corregí: continue para saltar esa librería, no return
        }
        if (key.includes("${arch}")) key = key.replace("${arch}", this.arch);
        const artifact = lib.downloads.classifiers[key];
        if (!artifact) {
          this.emit("warn", `Artifact no encontrado para native '${key}' en librería ${lib.name}, se ignora.`);
          continue;
        }

        const zipPath = path.join(this.nativesDir, path.basename(artifact.path));
        try {
          const stat = await fs.promises.stat(zipPath);
          if (stat.size !== artifact.size) this.totalBytes += artifact.size || 0;
        } catch {
          this.totalBytes += artifact.size || 0;
        }
      }
      if (this.totalBytes === 0) this.totalBytes = 1;

      await this.#processDownloads(nativeLibs);

      this.emit("progress", "100.0%");
      this.emit("done", "✅ Nativos descargados y extraídos correctamente.");
    } catch (error) {
      this.emit("error", `Error en NativesDownloader: ${error.message}`);
    }
  }

  async #processDownloads(libs) {
    const queue = [];
    let active = 0;
    let index = 0;

    const next = () => {
      if (index >= libs.length) return;
      const lib = libs[index++];
      const task = this.#handleLib(lib).catch(err => this.emit("warn", `Error native ignorado: ${err.message}`));
      queue.push(task);
      active++;
      task.finally(() => {
        active--;
        queue.splice(queue.indexOf(task), 1);
        this.#emitProgress();
        next();
      });
    };

    for (let i = 0; i < this.concurrency && i < libs.length; i++) next();

    while (queue.length > 0 || active > 0) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  async #handleLib(lib) {
    let key = lib.natives[this.platform];
    if (key.includes("${arch}")) key = key.replace("${arch}", this.arch);

    const artifact = lib.downloads.classifiers[key];
    if (!artifact) {
      this.emit("warn", `No se encontró el native '${key}' en la librería ${lib.name}, se ignora.`);
      return; // <-- Ignorar, no lanzar error
    }

    const zipPath = path.join(this.nativesDir, path.basename(artifact.path));
    const needDownload = !(await this.#fileExistsWithSize(zipPath, artifact.size));

    if (needDownload) await this.#downloadFile(artifact.url, zipPath, artifact.size);

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

  #downloadFile(url, dest, expectedSize) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
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
    const zipStream = fs.createReadStream(zipPath).pipe(unzipper.Parse({ forceStream: true }));

    for await (const entry of zipStream) {
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
