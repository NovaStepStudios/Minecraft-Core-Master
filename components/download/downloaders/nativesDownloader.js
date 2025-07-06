const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const EventEmitter = require("events");
const unzipper = require("unzipper");

class NativesDownloader extends EventEmitter {
  constructor(root, version, options = {}) {
    super();
    this.root = root;
    this.version = version;
    this.nativesPath = path.join(root, "natives", version);
    this.platform = this.#detectPlatform();
    this.arch = this.#detectArch();
    this.concurrency = options.concurrency ?? 4;
    this.timeout = options.timeout ?? 15000;

    this.queue = [];
    this.doneBytes = 0;
    this.totalBytes = 1;
  }

  #detectPlatform() {
    const map = { win32: "windows", darwin: "osx", linux: "linux" };
    return map[os.platform()] || "unknown";
  }

  #detectArch() {
    const arch = os.arch();
    return arch === "x64" || arch === "amd64" ? "x64"
         : arch === "ia32" || arch === "x86" ? "x86"
         : arch === "arm64" ? "arm64" : arch;
  }

  async start() {
    if (this.platform === "unknown") {
      this.emit("error", "🛑 Plataforma no reconocida.");
      return;
    }

    try {
      await fs.promises.mkdir(this.nativesPath, { recursive: true });

      // Obtener manifest y versión
      const manifest = await this.#fetchJSON("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
      const versionMeta = manifest.versions.find(v => v.id === this.version);
      if (!versionMeta) throw new Error(`Versión '${this.version}' no encontrada.`);

      const versionData = await this.#fetchJSON(versionMeta.url);
      const libraries = versionData.libraries || [];

      // Detectar si la versión es antigua o moderna:
      // Antiguo: tienen classifiers con claves fijas y natives mapeando esas claves (ej: 1.7.10, 1.8.9)
      // Moderno: nativos usan claves con ${arch} o solo classifier directo (ej: 1.16+)

      const isOldVersion = libraries.some(lib =>
        lib.natives && lib.downloads && lib.downloads.classifiers && typeof lib.natives === "object"
      );

      if (isOldVersion) {
        this.emit("debug", "🧠 Versión antigua detectada, usando método viejo para nativos");
        this.#queueOldNatives(libraries);
      } else {
        this.emit("debug", "🧠 Versión moderna detectada, usando método moderno para nativos");
        this.#queueModernNatives(libraries);
      }

      if (this.queue.length === 0) {
        this.emit("done", "✅ No hay nativos para esta plataforma.");
        return;
      }

      this.emit("progress", "0.0%");
      const workers = Array.from({ length: this.concurrency }, () => this.#worker());
      await Promise.all(workers);
      this.emit("progress", "100.0%");
      this.emit("done", "✅ Nativos descargados y extraídos correctamente.");

    } catch (e) {
      this.emit("error", `💥 Error al descargar nativos: ${e.message}`);
    }
  }

  #queueOldNatives(libraries) {
    for (const lib of libraries) {
      if (!this.#rulesAllow(lib.rules)) continue;
      if (!lib.natives || !lib.downloads?.classifiers) continue;

      const nativeKey = lib.natives[this.platform];
      if (!nativeKey) continue;

      const artifact = lib.downloads.classifiers[nativeKey];
      if (!artifact) continue;

      lib._artifact = artifact;
      lib._extractExclude = lib.extract?.exclude || [];
      this.queue.push(lib);
      this.totalBytes += artifact.size || 0;

      this.emit("debug", `✅ Añadido nativo (antiguo): ${lib.name} → ${nativeKey}`);
    }
  }

  #queueModernNatives(libraries) {
    for (const lib of libraries) {
      if (!this.#rulesAllow(lib.rules)) continue;
      if (!lib.natives || !lib.downloads?.classifiers) continue;

      // Clave posible con arch, o solo platform
      let nativeTemplate = lib.natives[this.platform];
      if (!nativeTemplate) continue;

      // Sustituir ${arch} si existe
      const keys = nativeTemplate.includes("${arch}")
        ? [this.arch, "x64", "x86"].map(a => nativeTemplate.replace("${arch}", a))
        : [nativeTemplate];

      // Buscar primer classifier válido en keys
      const key = keys.find(k => lib.downloads.classifiers[k]);
      if (!key) continue;

      lib._artifact = lib.downloads.classifiers[key];
      lib._extractExclude = lib.extract?.exclude || [];
      this.queue.push(lib);
      this.totalBytes += lib._artifact.size || 0;

      this.emit("debug", `✅ Añadido nativo (moderno): ${lib.name} → ${key}`);
    }
  }

  #rulesAllow(rules = []) {
    if (!rules.length) return true;
    let allow = false;
    for (const rule of rules) {
      if (rule.os?.name && rule.os.name !== this.platform) continue;
      if (rule.action === "allow") allow = true;
      if (rule.action === "disallow") return false;
    }
    return allow;
  }

  async #worker() {
    while (this.queue.length > 0) {
      const lib = this.queue.shift();
      try {
        await this.#process(lib);
      } catch (e) {
        this.emit("warn", `⚠️ Error procesando ${lib.name}: ${e.message}`);
      }
    }
  }

  async #process(lib) {
    const artifact = lib._artifact;
    const dest = path.join(this.nativesPath, path.basename(artifact.path));

    if (!(await this.#fileExists(dest, artifact.size))) {
      this.emit("debug", `⬇️ Descargando ${artifact.url}`);
      await this.#download(artifact.url, dest);
    } else {
      this.doneBytes += artifact.size;
    }

    this.emit("debug", `📦 Extrayendo ${dest}`);
    await this.#extract(dest, this.nativesPath, lib._extractExclude);
    this.#emitProgress();
  }

  #emitProgress() {
    const percent = ((this.doneBytes / this.totalBytes) * 100).toFixed(1);
    this.emit("progress", `${percent}%`);
  }

  async #fileExists(file, size) {
    try {
      const stats = await fs.promises.stat(file);
      return stats.size === size;
    } catch {
      return false;
    }
  }

  #download(url, dest) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) {
          file.close();
          fs.existsSync(dest) && fs.unlinkSync(dest);
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.on("data", chunk => {
          this.doneBytes += chunk.length;
          this.#emitProgress();
        });
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
        file.on("error", reject);
      }).on("error", err => {
        fs.existsSync(dest) && fs.unlinkSync(dest);
        reject(err);
      }).setTimeout(this.timeout, () => reject(new Error("Timeout")));
    });
  }

  async #extract(zipFile, targetDir, exclude = []) {
    const stream = fs.createReadStream(zipFile).pipe(unzipper.Parse());
    const tasks = [];

    stream.on("entry", entry => {
      if (entry.type === "Directory") {
        entry.autodrain();
        return;
      }

      if (exclude.some(ex => entry.path.startsWith(ex))) {
        entry.autodrain();
        return;
      }

      const outPath = path.join(targetDir, path.basename(entry.path));
      const task = new Promise((res, rej) => {
        const writer = fs.createWriteStream(outPath);
        entry.pipe(writer);
        writer.on("finish", res);
        writer.on("error", rej);
      });
      tasks.push(task);
    });

    return new Promise((resolve, reject) => {
      stream.on("close", () => Promise.all(tasks).then(resolve).catch(reject));
      stream.on("error", reject);
    });
  }

  #fetchJSON(url) {
    return new Promise((resolve, reject) => {
      https.get(url, { timeout: this.timeout }, res => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("JSON inválido"));
          }
        });
      }).on("error", reject);
    });
  }
}

module.exports = (root, version, options) => new NativesDownloader(root, version, options);
