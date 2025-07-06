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
    if (this.platform === "unknown") return this.emit("error", "🛑 Plataforma no reconocida.");
    try {
      await fs.promises.mkdir(this.nativesPath, { recursive: true });

      const manifest = await this.#fetchJSON("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
      const versionMeta = manifest.versions.find(v => v.id === this.version);
      if (!versionMeta) throw new Error(`Versión '${this.version}' no encontrada.`);

      const versionData = await this.#fetchJSON(versionMeta.url);
      const libraries = versionData.libraries || [];

      for (const lib of libraries) {
        const name = lib.name || "";
        if (!lib.downloads?.artifact) continue;
        if (!this.#rulesAllow(lib.rules)) continue;

        const nativeName = `natives-${this.platform}`;
        const nativeArchName = `natives-${this.platform}-${this.arch}`;

        if (name.includes(nativeName)) {
          if (name.includes(nativeArchName) || !name.includes("natives-" + this.platform + "-")) {
            lib._artifact = lib.downloads.artifact;
            this.queue.push(lib);
            this.totalBytes += lib._artifact.size || 0;
          }
        }
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

  #resolveNativeArtifact(lib) {
    if (!lib.downloads?.artifact || !lib.name.includes(":natives-")) return null;
    if (!this.#rulesAllow(lib.rules)) return null;

    const nameParts = lib.name.split(":");
    const classifier = nameParts[nameParts.length - 1];
    const isMatching = classifier.includes(this.platform) && classifier.includes(this.arch);

    return isMatching ? lib.downloads.artifact : null;
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
    await this.#extract(dest, this.nativesPath);
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
      }).on("error", reject).setTimeout(this.timeout, () => reject(new Error("Timeout")));
    });
  }

  async #extract(zipFile, targetDir) {
    const stream = fs.createReadStream(zipFile).pipe(unzipper.Parse());
    const tasks = [];

    stream.on("entry", entry => {
      if (entry.type === "Directory" || entry.path.includes("META-INF")) {
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