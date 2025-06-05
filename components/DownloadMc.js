const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const EventEmitter = require("events");
const tar = require("tar");
const unzipper = require("unzipper");

const ManifestURL =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

class MinecraftDownloader extends EventEmitter {
  constructor(rootPath, downloadJava = true, type = "release") {
    super();
    this.rootPath = rootPath;
    this.downloadJavaEnabled = downloadJava;
    this.configPath = path.join(__dirname, "config.json");
    this.osName = this.getOSName();
    this.type = type;

    if (!fs.existsSync(this.configPath)) {
      throw new Error("Archivo config.json no encontrado");
    }

    this.config = JSON.parse(fs.readFileSync(this.configPath, "utf-8"));
  }

  getOSName() {
    const platform = os.platform();
    if (platform === "win32") return "windows";
    if (platform === "darwin") return "macOs";
    if (platform === "linux") return "linux";
    return "unknown";
  }

  async getVersionByType() {
    this.emit(
      "progress",
      `Obteniendo la versión más reciente de tipo '${this.type}'...`
    );

    const data = await this.fetchJson(ManifestURL);
    const { latest, versions } = data;

    // Según el tipo, obtenemos el id correcto
    let versionId;
    if (this.type === "release") {
      versionId = latest.release;
    } else if (this.type === "snapshot") {
      versionId = latest.snapshot;
    } else {
      throw new Error(
        `Tipo de versión inválido: ${this.type}. Usa "release" o "snapshot".`
      );
    }

    const versionInfo = versions.find((v) => v.id === versionId);

    if (!versionInfo) {
      throw new Error(
        `No se pudo obtener información para la versión ${versionId}`
      );
    }

    return {
      type: this.type,
      version: versionId,
      info: versionInfo,
    };
  }

  async fetchJson(url) {
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(JSON.parse(data)));
        })
        .on("error", reject);
    });
  }

  async checkInternetConnection(url = ManifestURL) {
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          if (res.statusCode === 200) {
            resolve(true);
          } else {
            reject(
              new Error(
                `Sin conexión o servidor inaccesible (${res.statusCode})`
              )
            );
          }
        })
        .on("error", (err) => reject(new Error("No hay conexión a Internet")));
    });
  }

  async download(versionId) {
    try {
      this.emit("progress", "Verificando conexión a Internet...");
      await this.checkInternetConnection();

      // Si no se especifica una versión, se usa la más reciente del tipo configurado automáticamente
      if (!versionId) {
        this.emit(
          "progress",
          `No se especificó una versión. Obteniendo la versión más reciente tipo '${this.type}'...`
        );
        const { version } = await this.getVersionByType();
        versionId = version;
      }

      this.emit("progress", "Creando estructura de carpetas...");
      this.createFolders();

      if (this.downloadJavaEnabled) {
        await this.downloadJava();
      }

      this.emit("progress", `Iniciando descarga de Minecraft ${versionId}...`);
      const versionData = await this.fetchManifestData(versionId);

      this.emit("progress", "Descargando y extrayendo nativos...");
      await this.downloadAndExtractNatives(versionData, versionId);

      this.emit("progress", "Descargando librerías de Minecraft...");
      await this.downloadLibraries(versionData);

      this.emit("progress", "Descargando assets de Minecraft...");
      await this.downloadAssets(versionData);

      this.emit(
        "progress",
        "Descargando client.jar y guardando JSON de versión..."
      );
      await this.downloadClientAndSaveJson(versionData, versionId);

      this.emit("done", `Minecraft ${versionId} descargado correctamente.`);
    } catch (err) {
      this.emit("error", err.message);
    }
  }

  createFolders() {
    const root = this.rootPath;
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }

    const { Folders, assets, versionNative } = this.config.structure;
    Folders.forEach((folder) => {
      const folderPath = path.join(root, folder);
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }
    });
    if (assets && Array.isArray(assets)) {
      assets.forEach((asset) => {
        const assetPath = path.join(root, "assets", asset);
        if (!fs.existsSync(assetPath)) {
          fs.mkdirSync(assetPath, { recursive: true });
        }
      });
    }
    if (versionNative) {
      const nativePath = path.join(root, versionNative);
      if (!fs.existsSync(nativePath)) {
        fs.mkdirSync(nativePath, { recursive: true });
      }
    }
  }

  async downloadJava() {
    this.emit("progress", "Verificando JVM...");

    const javaVersion = "Java17";
    const url = this.config?.JVMDownload?.[javaVersion]?.[this.osName];
    if (!url) {
      throw new Error(`No hay URL de Java ${javaVersion} para ${this.osName}`);
    }

    const runtimePath = path.join(
      this.rootPath,
      this.config.DefaultPathJVM?.[this.osName] || "runtime"
    );

    if (!fs.existsSync(runtimePath)) {
      fs.mkdirSync(runtimePath, { recursive: true });
    }

    const javaFolderPath = path.join(runtimePath, javaVersion.toLowerCase());
    if (fs.existsSync(javaFolderPath)) {
      this.emit("progress", `Java ya descargado en ${javaFolderPath}`);
      return;
    } else {
      fs.mkdirSync(javaFolderPath, { recursive: true });
    }

    const fileName = path.basename(url.split("?")[0]);
    const downloadDest = path.join(runtimePath, fileName);

    await this.downloadFile(url, downloadDest);
    await this.extractFile(downloadDest, javaFolderPath);
    fs.unlinkSync(downloadDest);

    this.emit("progress", `Java instalado en ${javaFolderPath}`);
  }

  async fetchManifestData(versionId) {
    // Busca la versión en el manifiesto global
    const manifest = await fetch(ManifestURL).then((r) => r.json());
    const version = manifest.versions.find((v) => v.id === versionId);
    if (!version) throw new Error(`Versión ${versionId} no encontrada`);

    // Obtiene datos específicos de la versión
    const versionData = await fetch(version.url).then((r) => r.json());
    return versionData;
  }

  downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      this.emit("progress", `Descargando archivo: ${url}`);
      const fileStream = fs.createWriteStream(dest);
      https
        .get(url, (response) => {
          if (response.statusCode !== 200) {
            reject(
              new Error(`Fallo en descarga: ${url} (${response.statusCode})`)
            );
            return;
          }
          response.pipe(fileStream);
          fileStream.on("finish", () => {
            fileStream.close(() => resolve(dest));
          });
        })
        .on("error", (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
    });
  }

  async extractFile(filePath, destFolder) {
    this.emit("progress", `Extrayendo archivo: ${filePath}`);
    if (filePath.endsWith(".zip")) {
      await fs
        .createReadStream(filePath)
        .pipe(unzipper.Extract({ path: destFolder }))
        .promise();
    } else if (filePath.endsWith(".tar.gz") || filePath.endsWith(".tgz")) {
      await tar.x({ file: filePath, cwd: destFolder, strip: 1 });
    } else {
      throw new Error("Tipo de archivo no soportado");
    }
    this.emit("progress", `Extracción completada en: ${destFolder}`);
  }

  async downloadAndExtractNatives(versionData, versionId) {
    const platform =
      this.osName === "windows"
        ? "windows"
        : this.osName === "macOs"
        ? "osx"
        : "linux";

    const nativesDir = path.join(this.rootPath, "natives", versionId);
    if (!fs.existsSync(nativesDir)) {
      fs.mkdirSync(nativesDir, { recursive: true });
      this.emit("progress", `[Nativos] Carpeta creada: ${nativesDir}`);
    } else {
      this.emit("progress", `[Nativos] Carpeta ya existe: ${nativesDir}`);
    }

    for (const lib of versionData.libraries) {
      if (!lib.downloads?.classifiers || !lib.natives) continue;

      const nativeKey = lib.natives[platform];
      if (!nativeKey) continue;

      const native = lib.downloads.classifiers[nativeKey];
      if (!native || !native.url || !native.path) continue;

      const zipFileName = path.basename(native.path);
      const nativeZipPath = path.join(nativesDir, zipFileName);

      if (!fs.existsSync(nativeZipPath)) {
        this.emit("progress", `[Nativos] Descargando: ${lib.name}`);
        try {
          await this.downloadFile(native.url, nativeZipPath);
          this.emit("progress", `[Nativos] Descargado: ${lib.name}`);
        } catch (err) {
          this.emit(
            "error",
            `[Nativos] Error al descargar ${lib.name}: ${err.message}`
          );
          continue;
        }
      } else {
        this.emit("progress", `[Nativos] Ya descargado: ${lib.name}`);
      }

      try {
        const zipStream = fs
          .createReadStream(nativeZipPath)
          .pipe(unzipper.Parse({ forceStream: true }));
        for await (const entry of zipStream) {
          if (!entry.path.includes("META-INF")) {
            const fullPath = path.join(nativesDir, entry.path);
            await fs.promises.mkdir(path.dirname(fullPath), {
              recursive: true,
            });
            entry.pipe(fs.createWriteStream(fullPath));
          } else {
            entry.autodrain(); // Ignorar META-INF
          }
        }
        this.emit("progress", `[Nativos] Extraído: ${lib.name}`);
      } catch (err) {
        this.emit(
          "error",
          `[Nativos] Error al extraer ${lib.name}: ${err.message}`
        );
      }
    }
  }

  async downloadLibraries(versionData) {
    const librariesFolder = path.join(this.rootPath, "libraries");

    // Cargar config.json y extraer ExtraLibreries
    const configPath = path.join(this.rootPath, "config.json");
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (Array.isArray(config.ExtraLibreries)) {
          const extraLibs = config.ExtraLibreries.map((url) => {
            const urlPath = new URL(url).pathname.replace(/^\/+/, "");
            return {
              name: path.basename(url), // solo el archivo, para mostrar
              downloads: {
                artifact: {
                  url,
                  path: urlPath,
                },
              },
            };
          });
          versionData.libraries = [
            ...(versionData.libraries || []),
            ...extraLibs,
          ];
        }
      } catch (err) {
        this.emit("error", `Error al leer config.json: ${err.message}`);
      }
    }

    // Continuar descarga como antes
    for (const lib of versionData.libraries) {
      if (!lib.downloads || !lib.downloads.artifact) continue;

      const { url, path: libPath } = lib.downloads.artifact;
      const fullPath = path.join(librariesFolder, libPath);
      const dir = path.dirname(fullPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (!fs.existsSync(fullPath)) {
        this.emit("progress", `[Librería] Descargando: ${lib.name}`);
        try {
          await this.downloadFile(url, fullPath);
          this.emit("progress", `[Librería] Descargado: ${lib.name}`);
        } catch (err) {
          this.emit("error", `Error al descargar ${lib.name}: ${err.message}`);
        }
      } else {
        this.emit("progress", `[Librería] Ya existe: ${lib.name}`);
      }
    }
  }

  async downloadAssets(versionData) {
    const assetsFolder = path.join(this.rootPath, "assets");
    const assetIndexURL = versionData.assetIndex.url;

    let assetIndexData;
    try {
      assetIndexData = await fetch(assetIndexURL).then((res) => res.json());
    } catch (error) {
      this.emit(
        "error",
        `[Assets] Error al obtener el asset index: ${error.message}`
      );
      return;
    }

    // Función interna para descargar archivos usando el hash
    const downloadFromHashList = async (folder, hashList, label) => {
      for (const [name, data] of Object.entries(hashList)) {
        const hash = data.hash;
        const subDir = hash.substring(0, 2);
        const fileUrl = `https://resources.download.minecraft.net/${subDir}/${hash}`;
        const filePath = path.join(assetsFolder, folder, subDir, hash);

        const fileDir = path.dirname(filePath);
        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }

        if (!fs.existsSync(filePath)) {
          this.emit("progress", `[Assets] Descargando ${label}: ${name}`);
          try {
            await this.downloadFile(fileUrl, filePath);
            this.emit("progress", `[Assets] ${label} descargado: ${name}`);
          } catch (err) {
            this.emit(
              "error",
              `[Assets] Error al descargar ${label} ${name}: ${err.message}`
            );
          }
        } else {
          this.emit("progress", `[Assets] ${label} ya existe: ${name}`);
        }
      }
    };

    // Descargar distintos tipos de assets si existen
    if (assetIndexData.objects) {
      await downloadFromHashList("objects", assetIndexData.objects, "asset");
    }

    if (assetIndexData.indexes) {
      await downloadFromHashList("indexes", assetIndexData.indexes, "index");
    }

    if (assetIndexData.skins) {
      await downloadFromHashList("skins", assetIndexData.skins, "skin");
    }

    if (assetIndexData.logs) {
      await downloadFromHashList("logs", assetIndexData.logs, "log");
    }

    this.emit("progress", "[Assets] ✅ Descarga de assets completada.");
  }

  async downloadClientAndSaveJson(versionData, versionId) {
    // Descargar client.jar
    const clientInfo = versionData.downloads.client;
    if (!clientInfo || !clientInfo.url) {
      throw new Error("No se encontró el client.jar para esta versión.");
    }

    const versionDir = path.join(this.rootPath, "versions", versionId);
    const clientJarPath = path.join(versionDir, `${versionId}.jar`);
    const versionJsonPath = path.join(versionDir, `${versionId}.json`);

    if (!fs.existsSync(versionDir)) {
      fs.mkdirSync(versionDir, { recursive: true });
    }

    if (!fs.existsSync(clientJarPath)) {
      this.emit("progress", `Descargando client.jar para ${versionId}...`);
      try {
        await this.downloadFile(clientInfo.url, clientJarPath);
        this.emit("progress", `client.jar descargado en: ${clientJarPath}`);
      } catch (err) {
        this.emit("error", `Error al descargar client.jar: ${err.message}`);
      }
    } else {
      this.emit("progress", `✔️ client.jar ya existe en: ${clientJarPath}`);
    }

    // Guardar JSON de versión
    try {
      fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2));
      this.emit("progress", `Guardado JSON de versión en: ${versionJsonPath}`);
    } catch (err) {
      this.emit(
        "error",
        `Error al guardar el .json de versión: ${err.message}`
      );
    }
  }
}

module.exports = {
  MinecraftDownloader,
};
