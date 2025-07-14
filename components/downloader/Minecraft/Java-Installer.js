const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const EventEmitter = require("events");
const unzipper = require("unzipper");
const tar = require("tar");

class JavaInstaller extends EventEmitter {
  constructor(root, version, jsonPath) {
    super();
    this.root = root;
    this.version = version;
    this.jsonPath = jsonPath || path.join(__dirname,'JVM.json');
    this.currentOS = this.#detectOS();
    this.destDir = path.join(this.root, "runtime", version);
  }

  async start() {
    try {
      const config = await this.#loadConfig();

      const osKey = this.currentOS;
      const versionEntry = config[this.version];
      if (!versionEntry || !versionEntry[osKey]) {
        throw new Error(`[Minecraft-Core-Master || Downloader > Error Not Found URL for JVM] No se encontró URL para Java ${this.version} en ${osKey}`);
      }

      const url = versionEntry[osKey];
      const ext = path.extname(url);
      const fileName = `java-${this.version}-${this.currentOS}${ext}`;
      const filePath = path.join(this.destDir, fileName);

      await this.#ensureDir(this.destDir);
      await this.#downloadFile(url, filePath);
      await this.#extract(filePath, this.destDir);

      this.emit("done", this.destDir);
    } catch (err) {
      this.emit("error", err);
    }
  }

  #detectOS() {
    const platform = os.platform();
    if (platform === "win32") return "Windows";
    if (platform === "darwin") return "MacOs";
    if (platform === "linux") return "Linux";
    throw new Error("Sistema operativo no soportado");
  }

  async #loadConfig() {
    const raw = await fs.promises.readFile(this.jsonPath, "utf-8");
    return JSON.parse(raw);
  }

  async #downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error(`[Minecraft-Core-Master || Downloader > Error Download JVM] Fallo al descargar: ${url}`));
        }

        const totalSize = parseInt(res.headers["content-length"] || "1", 10);
        let downloaded = 0;

        res.on("data", chunk => {
          downloaded += chunk.length;
          const percent = ((downloaded / totalSize) * 100).toFixed(2);
          this.emit("progress", { downloaded, totalSize, percent });
        });

        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      }).on("error", err => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  }

  async #extract(archivePath, destDir) {
    const ext = path.extname(archivePath);
    if (ext === ".zip") {
      await fs.createReadStream(archivePath)
        .pipe(unzipper.Extract({ path: destDir }))
        .promise();
    } else if (ext === ".gz" || ext === ".tar" || ext === ".tgz") {
      await tar.x({ file: archivePath, cwd: destDir });
    } else {
      throw new Error(`[Minecraft-Core-Master || Downloader > Format Not Support] Formato de archivo no soportado: ${ext}`);
    }
  }

  async #ensureDir(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  }
}

module.exports = JavaInstaller;
