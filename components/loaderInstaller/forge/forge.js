const fs = require("fs");
const fsp = fs.promises;
const axios = require("axios");
const { exec } = require("child_process");
const { pipeline } = require("stream/promises");
const path = require("path");
const os = require("os");
const { promisify } = require("util");

const execAsync = promisify(exec);
const FORGE_URL =
  "https://files.minecraftforge.net/maven/net/minecraftforge/forge/{version}/forge-{version}-installer.jar";

class Forge {
  /* ------------------------------------------------------------------ PUBLIC */

  /**
   * Descarga e instala Forge.
   * @param {string} version      - p.e. "1.19.4-45.1.0"
   * @param {string|null} destDir - Carpeta destino. Si null → ~/.minecraft
   * @param {boolean}   cleanJar  - Borrar instalador al final
   */
  async downloadAndInstall(version, destDir = null, cleanJar = true) {
    const resolvedVersion = this.#normalizeVersion(version);
    const installPath = path.resolve(
      destDir ?? this.#getDefaultMinecraftFolder()
    );
    await this.#ensureDir(installPath);
    await this.#ensureLauncherProfile(installPath);
    console.log(`Forge ${resolvedVersion} → ${installPath}`);
    const installerPath = await this.#downloadForge(resolvedVersion, installPath);
    await this.#runInstaller(installerPath, installPath);
    if (cleanJar) await this.#safeUnlink(installerPath);
    console.log("Forge instalado correctamente");
  }

  /**
   * Lee el JSON de versión Forge (root/version/version.json).
   * @param {string} root - Carpeta raíz Minecraft.
   * @param {string} version - Versión Forge, ej: "1.19.4-45.1.0".
   * @returns {Promise<Object>} JSON parseado.
   */
  async readVersionJson(root, version) {
    const versionFile = path.join(root, version, `${version}.json`);
    try {
      const raw = await fsp.readFile(versionFile, "utf-8");
      return JSON.parse(raw);
    } catch (e) {
      throw new Error(`No se pudo leer version.json de Forge en ${versionFile}: ${e.message}`);
    }
  }

  /**
   * Prepara librerías y assets necesarios para la versión Forge.
   * Descarga los que falten.
   * @param {string} root - Carpeta raíz Minecraft.
   * @param {Object} versionJson - JSON leído con readVersionJson.
   */
  async prepareResources(root, versionJson) {
    if (!versionJson) throw new Error("versionJson es requerido");

    // Descargar librerías
    if (Array.isArray(versionJson.libraries)) {
      for (const lib of versionJson.libraries) {
        if (!lib.downloads || !lib.downloads.artifact) continue;

        const artifact = lib.downloads.artifact;
        const libPath = path.join(root, "libraries", artifact.path);

        if (fs.existsSync(libPath)) continue;

        await fsp.mkdir(path.dirname(libPath), { recursive: true });
        console.log(`Descargando librería ${artifact.path} ...`);
        const response = await axios({ url: artifact.url, method: "GET", responseType: "stream" });
        await pipeline(response.data, fs.createWriteStream(libPath));
        console.log(`Librería descargada: ${artifact.path}`);
      }
    }

    // Descargar assets index si falta
    if (versionJson.assetIndex && versionJson.assetIndex.id && versionJson.assetIndex.url) {
      const assetsIndexesDir = path.join(root, "assets", "indexes");
      const indexJsonPath = path.join(assetsIndexesDir, `${versionJson.assetIndex.id}.json`);
      if (!fs.existsSync(indexJsonPath)) {
        await fsp.mkdir(assetsIndexesDir, { recursive: true });
        console.log(`Descargando assets index ${versionJson.assetIndex.id} ...`);
        const response = await axios({ url: versionJson.assetIndex.url, method: "GET", responseType: "stream" });
        await pipeline(response.data, fs.createWriteStream(indexJsonPath));
        console.log(`Assets index descargado: ${versionJson.assetIndex.id}`);
      }
    }
  }

  /* ----------------------------------------------------------- PRIVATE HELPERS */

  #normalizeVersion(v) {
    if (!v || typeof v !== "string") throw new Error("Versión inválida");
    return v.trim().replace(/\s+/g, "-");
  }

  async #downloadForge(version, installPath) {
    const url = FORGE_URL.replace(/{version}/g, version);
    const jarPath = path.join(installPath, `forge-${version}-installer.jar`);
    if (fs.existsSync(jarPath)) {
      console.log("Instalador ya presente, se reutiliza");
      return jarPath;
    }
    console.log(`⬇ Descargando instalador…`);
    const response = await axios({ url, method: "GET", responseType: "stream" });
    await pipeline(response.data, fs.createWriteStream(jarPath));
    console.log("Descarga completa");
    return jarPath;
  }

  async #runInstaller(jarPath, installPath) {
    await this.#checkJavaOnce();
    const cmd = `java -jar "${jarPath}" --installClient`;
    console.log("Ejecutando instalador…");
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: installPath,
      maxBuffer: 1024 * 1024 * 20,
    });
    if (stdout.trim()) console.log(stdout.trim());
    if (stderr.trim()) console.warn(stderr.trim());
  }

  async #ensureLauncherProfile(dir) {
    const file = path.join(dir, "launcher_profiles.json");
    const stub = {
      profiles: {},
      selectedProfile: "forge",
      clientToken: "generated-by-minecraft-core-master",
    };
    if (!fs.existsSync(file)) {
      await fsp.writeFile(file, JSON.stringify(stub, null, 2));
      console.log("launcher_profiles.json creado");
      return;
    }
    try {
      const current = JSON.parse(await fsp.readFile(file, "utf8"));
      const merged = { ...stub, ...current };
      await fsp.writeFile(file, JSON.stringify(merged, null, 2));
      console.log("launcher_profiles.json actualizado");
    } catch {
      await fsp.rename(file, file + ".bak");
      await fsp.writeFile(file, JSON.stringify(stub, null, 2));
      console.log("Perfil corrupto, se regeneró (backup .bak)");
    }
  }

  async #ensureDir(p) {
    await fsp.mkdir(p, { recursive: true });
  }

  async #safeUnlink(p) {
    try {
      await fsp.unlink(p);
      console.log("🧹 Instalador eliminado");
    } catch {}
  }

  #getDefaultMinecraftFolder() {
    const plat = os.platform();
    if (plat === "win32") return path.join(process.env.APPDATA, ".minecraft");
    if (plat === "darwin")
      return path.join(os.homedir(), "Library/Application Support/minecraft");
    return path.join(os.homedir(), ".minecraft"); // linux / demás
  }

  #javaChecked = false;
  async #checkJavaOnce() {
    if (this.#javaChecked) return;
    try {
      const { stderr } = await execAsync("java -version", { shell: true });
      console.log("☕ Java detectado:", stderr.split("\n")[0]);
      this.#javaChecked = true;
    } catch {
      throw new Error(
        "Java no está en el PATH o no está instalado (se requiere Java 17+)."
      );
    }
  }
}

module.exports = new Forge();
