"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const EventEmitter = require("events");
const unzipper = require("unzipper");
const tar = require("tar");

class JavaInstaller extends EventEmitter {
  constructor(root, version = false, jsonPath) {
    super();
    this.root = root;
    this.version = version; // Puede ser false, true o "Java20"
    this.jsonPath = jsonPath || path.join(__dirname, "JVM.json");
    this.jvmData = null;
  }

  /* Utilidades internas */

  #normalizeOS(osName) {
    if (osName === "win32") return "windows";
    if (osName === "darwin") return "macos";
    return "linux";
  }

  async #loadConfig() {
    if (!this.jvmData) {
      const raw = await fs.promises.readFile(this.jsonPath, "utf-8");
      this.jvmData = JSON.parse(raw);
    }
  }

  #isInstalled(destDir) {
    const exe = process.platform === "win32" ? "java.exe" : "java";
    return fs.existsSync(path.join(destDir, "bin", exe));
  }

  async #downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) {
          file.close();
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          return reject(new Error(`HTTP ${res.statusCode} al descargar ${url}`));
        }

        const total = parseInt(res.headers["content-length"] || "1", 10);
        let downloaded = 0;

        res.on("data", chunk => {
          downloaded += chunk.length;
          const percent = ((downloaded / total) * 100).toFixed(1);
          this.emit("progress", { percent: parseFloat(percent) });
        });

        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      }).on("error", err => {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
    });
  }

  async #extractZipFlat(zipPath, destDir) {
    const zip = fs.createReadStream(zipPath).pipe(unzipper.Parse({ forceStream: true }));
    for await (const entry of zip) {
      if (entry.type === "Directory") {
        entry.autodrain();
        continue;
      }
      const parts = entry.path.split(/\/|\\/).slice(1); // Strip jdk-xx/
      const outPath = path.join(destDir, ...parts);
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      await fs.promises.writeFile(outPath, await entry.buffer());
    }
  }

  async #extractTarFlat(tarPath, destDir) {
    await tar.x({ file: tarPath, cwd: destDir, strip: 1 });
  }

  /* API pública */

  async start(forcedOS = process.platform) {
    try {
      await this.#loadConfig();

      const osKey = this.#normalizeOS(forcedOS);

      // Resolver versión si es true/false/undefined
      let javaVersionKey = this.version;
      if (!this.version || this.version === true || this.version === false) {
        if (this.jvmData.latest) {
          javaVersionKey = this.jvmData.latest;
        } else {
          const keys = Object.keys(this.jvmData).filter(k => k !== "latest").sort();
          javaVersionKey = keys[keys.length - 1];
        }
      }

      const url = this.jvmData?.[javaVersionKey]?.[osKey];
      if (!url) throw new Error(`No se encontró URL para Java ${javaVersionKey} en ${osKey}`);

      const destDir = path.join(this.root, "runtime", javaVersionKey);
      await fs.promises.mkdir(destDir, { recursive: true });

      if (this.#isInstalled(destDir)) {
        this.emit("progress", 100);
        this.emit("done", `JVM ${javaVersionKey} ya está instalada en ${destDir}`);
        return destDir;
      }

      this.emit("progress", 0); // Iniciar progreso en 0%

      const archive = path.join(destDir, path.basename(url));
      await this.#downloadFile(url, archive);

      if (archive.endsWith(".zip")) {
        await this.#extractZipFlat(archive, destDir);
      } else if (archive.endsWith(".tar.gz") || archive.endsWith(".tgz")) {
        await this.#extractTarFlat(archive, destDir);
      } else {
        throw new Error(`Formato no soportado: ${path.extname(archive)}`);
      }

      if (fs.existsSync(archive)) await fs.promises.unlink(archive);

      this.emit("progress", 100);
      this.emit("done", `Java ${javaVersionKey} lista en ${destDir}`);
      return destDir;

    } catch (err) {
      this.emit("error", `[JavaInstaller] ${err.message}`);
      throw err;
    }
  }
}

module.exports = JavaInstaller;
