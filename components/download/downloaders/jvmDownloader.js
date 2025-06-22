const fs        = require("fs");
const path      = require("path");
const https     = require("https");
const EventEmitter = require("events");
const unzipper  = require("unzipper");
const tar       = require("tar");

class JVMDownloader extends EventEmitter {
  constructor(rootPath, version) {
    super();
    this.rootPath   = rootPath;
    this.version    = version;
    this.jvmJsonPath = path.join(__dirname, "jvm.json");
    this.jvmData    = null;
  }

  /* --------------- Utilidades internas --------------- */

  async #loadJvmJson() {
    if (!this.jvmData) {
      const raw = await fs.promises.readFile(this.jvmJsonPath, "utf-8");
      this.jvmData = JSON.parse(raw);
    }
  }

  #normalizeOS(os) {
    if (os === "win32") return "windows";
    if (os === "darwin") return "macos";
    return os; // linux u otro
  }

  /** Devuelve true si existe bin/java (o java.exe) */
  #isInstalled(destDir) {
    const exe = process.platform === "win32" ? "java.exe" : "java";
    return fs.existsSync(path.join(destDir, "bin", exe));
  }

  /* --------------- Descarga con progreso --------------- */

  #downloadFileWithProgress(url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) {
          file.close();
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          return reject(new Error(`HTTP ${res.statusCode} descargando ${url}`));
        }

        const total = parseInt(res.headers["content-length"], 10);
        let downloaded = 0;

        res.on("data", chunk => {
          downloaded += chunk.length;
          if (total) {
            const pct = ((downloaded / total) * 100).toFixed(1);
            this.emit("progress", `${pct}%`);
          }
        });

        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      }).on("error", err => {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
    });
  }

  /* --------------- Extracción “aplanada” --------------- */

  async #extractZipFlat(zipPath, destDir) {
    const zip = fs.createReadStream(zipPath).pipe(
      unzipper.Parse({ forceStream: true })
    );

    for await (const entry of zip) {
      if (entry.type === "Directory") { entry.autodrain(); continue; }
      // Remove first path segment (jdk-xx/...)
      const parts = entry.path.split(/\/|\\/).slice(1);
      const outPath = path.join(destDir, ...parts);
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      await fs.promises.writeFile(outPath, await entry.buffer());
    }
  }

  async #extractTarFlat(tarPath, destDir) {
    // strip:1 quita el primer directorio de todos los paths
    await tar.x({ file: tarPath, cwd: destDir, strip: 1 });
  }

  /* --------------- API pública --------------- */

  /**
   * Descarga y descomprime el JDK si no está instalado.
   * @param {string} osName — Forzar plataforma (default: process.platform)
   * @returns {Promise<string>} Ruta final del JDK.
   */
  async download(osName = process.platform) {
    try {
      await this.#loadJvmJson();

      const osKey = this.#normalizeOS(osName);
      const url   = this.jvmData?.[this.version]?.[osKey];
      if (!url) throw new Error(`No hay URL para ${this.version} en ${osKey}`);

      const destDir  = path.join(this.rootPath, "runtime", this.version);
      await fs.promises.mkdir(destDir, { recursive: true });

      /* ---- Si ya existe bin/java, saltamos ---- */
      if (this.#isInstalled(destDir)) {
        this.emit("progress", "100%");
        this.emit("done", `JVM ${this.version} ya presente en ${destDir}`);
        return destDir;
      }

      /* ---- Descarga ---- */
      const archive = path.join(destDir, path.basename(url));
      this.emit("progress", `Descargando Java para ${osKey}: ${this.version}`);
      await this.#downloadFileWithProgress(url, archive);

      /* ---- Extracción “aplanada” ---- */
      if (archive.endsWith(".zip")) {
        await this.#extractZipFlat(archive, destDir);
      } else if (archive.endsWith(".tar.gz") || archive.endsWith(".tgz")) {
        await this.#extractTarFlat(archive, destDir);
      } else {
        throw new Error("Formato de archivo JVM no soportado");
      }

      /* ---- Limpieza ---- */
      if (fs.existsSync(archive)) await fs.promises.unlink(archive);

      this.emit("progress", "100%");
      this.emit("done", `JVM ${this.version} listo en ${destDir}`);
      return destDir;

    } catch (err) {
      this.emit("error", `[JVM] ${err.message}`);
      throw err;
    }
  }
}

module.exports = JVMDownloader;
