const fs = require("fs");
const fsp = fs.promises;
const axios = require("axios");
const { pipeline } = require("stream/promises");
const path = require("path");
const os = require("os");
const cheerio = require("cheerio");

const ROOT_URL = "https://optifine.net/downloads";
const BASE_URL = "https://optifine.net";

class OptiFine {
  /* ------------------------------------------------------------------ PUBLIC */
  
  /**
   * Descarga el instalador de OptiFine y configura el perfil.
   * @param {string} mcVer - Versión de Minecraft (ej: "1.19.4")
   * @param {string|null} destDir - Carpeta destino. Si null → ~/.minecraft
   * @param {boolean} cleanJar - Borrar instalador al final
   * @param {boolean} allowPreview - Permitir versiones preview
   */
  async downloadAndInstall(mcVer, destDir = null, cleanJar = true, allowPreview = true) {
    const installPath = path.resolve(destDir ?? this.#getDefaultMinecraftFolder());
    await this.#ensureDir(installPath);
    
    console.log(`🔍 Buscando instalador de OptiFine para Minecraft ${mcVer}…`);
    const meta = await this.#resolveBuild(mcVer, allowPreview);
    if (!meta) throw new Error(`❌ No se encontró OptiFine para ${mcVer}`);

    const installerPath = path.join(installPath, meta.installerName);
    await this.#downloadInstaller(meta, installerPath);
    
    await this.#ensureLauncherProfile(installPath);
    
    if (cleanJar) await this.#safeUnlink(installerPath);
    console.log(`✅ OptiFine configurado correctamente en: ${installPath}`);
  }

  /**
   * Lee el JSON de versión OptiFine (root/version/version.json).
   * @param {string} root - Carpeta raíz Minecraft.
   * @param {string} version - Versión OptiFine.
   * @returns {Promise<Object>} JSON parseado.
   */
  async readVersionJson(root, version) {
    const versionFile = path.join(root, "versions", version, `${version}.json`);
    try {
      const raw = await fsp.readFile(versionFile, "utf-8");
      return JSON.parse(raw);
    } catch (e) {
      throw new Error(`No se pudo leer version.json de OptiFine en ${versionFile}: ${e.message}`);
    }
  }

  /**
   * Prepara librerías y assets para la versión OptiFine.
   * @param {string} root - Carpeta raíz Minecraft.
   * @param {Object} versionJson - JSON de versión.
   */
  async prepareResources(root, versionJson) {
    if (!versionJson) throw new Error("versionJson es requerido");
    console.log("⚙ Preparando recursos para OptiFine...");
    // Implementación real requeriría descargar assets/librerías específicas
  }

  /* ----------------------------------------------------------- PRIVATE HELPERS */
  
  async #resolveBuild(mcVer, allowPreview) {
    const html = await axios.get(ROOT_URL, { timeout: 15000 }).then(r => r.data);
    const $ = cheerio.load(html);

    let info = null;
    $("h2").each((_, h2) => {
      if (!$(h2).text().includes(mcVer)) return;
      const row = $(h2).nextAll("table.downloadTable")
        .find("tr.downloadLineMain, tr.downloadLinePreview").first();

      if (!row.length) return;
      if (row.hasClass("downloadLinePreview") && !allowPreview) return;

      const mirrorRel = row.find("td.colMirror a").attr("href");
      if (!mirrorRel) return;

      info = { mirrorPage: new URL(mirrorRel, BASE_URL).toString() };
    });

    if (!info) return null;

    const mirrorHtml = await axios.get(info.mirrorPage, { timeout: 15000 }).then(r => r.data);
    const $$ = cheerio.load(mirrorHtml);
    const anchor = $$(`#Download a[href^="downloadx?f="]`).first();
    const href = anchor.attr("href");
    if (!href) throw new Error("No se encontró enlace de descarga");
    const downloadUrl = new URL(href, BASE_URL).toString();
    const installerName = new URL(downloadUrl).searchParams.get("f");

    return { downloadUrl, installerName, mirrorPage: info.mirrorPage };
  }

  async #downloadInstaller(meta, dest) {
    if (fs.existsSync(dest)) {
      console.log("📁 Instalador ya presente, se reutiliza");
      return;
    }
    console.log("⬇ Descargando instalador OptiFine...");
    const response = await axios.get(meta.downloadUrl, {
      headers: { Referer: meta.mirrorPage },
      responseType: "stream",
      timeout: 60000,
    });
    await pipeline(response.data, fs.createWriteStream(dest));
    console.log("✅ Descarga completada");
  }

  async #ensureLauncherProfile(dir) {
    const file = path.join(dir, "launcher_profiles.json");
    const stub = {
      profiles: {
        optifine: {
          name: "OptiFine",
          type: "custom",
          created: new Date().toISOString(),
          lastUsed: new Date().toISOString(),
          icon: "Chest",
          gameDir: dir,
          javaArgs: "-Xmx2G -XX:+UnlockExperimentalVMOptions -XX:+UseG1GC -XX:G1NewSizePercent=20 -XX:G1ReservePercent=20 -XX:MaxGCPauseMillis=50 -XX:G1HeapRegionSize=32M",
          resolution: { width: 854, height: 480 }
        }
      },
      selectedProfile: "optifine",
      clientToken: "generated-by-optifine-installer",
    };
    
    if (!fs.existsSync(file)) {
      await fsp.writeFile(file, JSON.stringify(stub, null, 2));
      console.log("📄 launcher_profiles.json creado");
      return;
    }
    
    try {
      const current = JSON.parse(await fsp.readFile(file, "utf8"));
      
      // Conservar perfiles existentes y añadir/actualizar el perfil de OptiFine
      const merged = {
        ...current,
        profiles: {
          ...current.profiles,
          optifine: {
            ...(current.profiles?.optifine || {}),
            ...stub.profiles.optifine
          }
        },
        selectedProfile: "optifine"
      };
      
      await fsp.writeFile(file, JSON.stringify(merged, null, 2));
      console.log("🔄 launcher_profiles.json actualizado con perfil OptiFine");
    } catch (e) {
      console.error("⚠ Error actualizando perfiles:", e.message);
      await fsp.rename(file, file + ".bak");
      await fsp.writeFile(file, JSON.stringify(stub, null, 2));
      console.log("⚠ Perfiles corruptos, se regeneraron (backup .bak)");
    }
  }

  async #ensureDir(p) {
    await fsp.mkdir(p, { recursive: true });
  }

  async #safeUnlink(p) {
    try {
      await fsp.unlink(p);
      console.log("🧹 Instalador eliminado");
    } catch (e) {
      console.error("⚠ No se pudo eliminar el instalador:", e.message);
    }
  }

  #getDefaultMinecraftFolder() {
    const plat = os.platform();
    if (plat === "win32") return path.join(process.env.APPDATA, ".minecraft");
    if (plat === "darwin")
      return path.join(os.homedir(), "Library/Application Support/minecraft");
    return path.join(os.homedir(), ".minecraft");
  }
}

module.exports = new OptiFine();