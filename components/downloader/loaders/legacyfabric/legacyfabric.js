"use strict";
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

class LegacyFabricInstaller {
  constructor(minecraftPath, gameVersion, outputDir = null) {
    this.minecraftPath = path.resolve(minecraftPath);
    this.gameVersion = gameVersion;

    this.outputDir = outputDir
      ? path.resolve(outputDir)
      : path.join(this.minecraftPath, 'temp', 'legacyfabric');

    this.loaderApiUrl = `https://meta.legacyfabric.net/v2/versions/loader/${encodeURIComponent(gameVersion)}`;
  }

  getVersionId(loaderVersion) {
    return `legacyfabric-${this.gameVersion}-${loaderVersion}`;
  }

  isInstalled(versionId) {
    const verDir = path.join(this.minecraftPath, 'versions', versionId);
    return fs.existsSync(verDir);
  }

  fetchJson(url) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  downloadFile(url, dest, redirectCount = 0) {
    const MAX_REDIRECTS = 5;
    return new Promise((resolve, reject) => {
      if (redirectCount > MAX_REDIRECTS) {
        return reject(new Error(`Demasiadas redirecciones para ${url}`));
      }

      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const file = fs.createWriteStream(dest);

      const client = url.startsWith('https') ? https : http;

      const request = client.get(url, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const redirectUrl = res.headers.location;
          if (!redirectUrl) {
            file.close();
            fs.unlinkSync(dest);
            return reject(new Error(`Redirección sin Location para ${url}`));
          }
          file.close();
          fs.unlinkSync(dest);
          return resolve(this.downloadFile(redirectUrl, dest, redirectCount + 1));
        }

        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`HTTP ${res.statusCode} para ${url}`));
        }

        const timeoutId = setTimeout(() => {
          request.abort();
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`Timeout descargando ${url}`));
        }, 30000);

        res.pipe(file);
        file.on('finish', () => {
          clearTimeout(timeoutId);
          file.close(resolve);
        });

        res.on('error', err => {
          clearTimeout(timeoutId);
          file.close();
          fs.unlinkSync(dest);
          reject(err);
        });
      });

      request.on('error', err => {
        file.close();
        fs.unlinkSync(dest);
        reject(err);
      });
    });
  }

  getLibraryPath(name) {
    const parts = name.split(':');
    if (parts.length !== 3) throw new Error(`Formato inválido de library name: ${name}`);
    const [group, artifact, version] = parts;
    const groupPath = group.replace(/\./g, '/');
    return path.join(groupPath, artifact, version, `${artifact}-${version}.jar`);
  }

  getLibraryUrlPath(name) {
    const parts = name.split(':');
    if (parts.length !== 3) throw new Error(`Formato inválido de library name: ${name}`);
    const [group, artifact, version] = parts;
    const groupPath = group.replace(/\./g, '/');
    return `${groupPath}/${artifact}/${version}/${artifact}-${version}.jar`;
  }

  async fetchLatestStableLoader() {
    const loaders = await this.fetchJson(this.loaderApiUrl);
    if (!Array.isArray(loaders) || loaders.length === 0) {
      throw new Error(`No loader data available for Minecraft version ${this.gameVersion}`);
    }
    const stableLoader = loaders.find(l => l.loader.stable === true) || loaders[0];
    if (!stableLoader) throw new Error(`No loader version found for ${this.gameVersion}`);

    return stableLoader.loader.version;
  }

  async install() {
    console.log(`[LegacyFabricInstaller] Buscando loader para Minecraft ${this.gameVersion}...`);

    let loaderVersion;
    try {
      loaderVersion = await this.fetchLatestStableLoader();
    } catch (err) {
      console.error(`[LegacyFabricInstaller] Error al obtener loader: ${err.message}`);
      return false;
    }

    const versionId = this.getVersionId(loaderVersion);

    const profileUrl = `https://meta.legacyfabric.net/v2/versions/loader/${this.gameVersion}/${loaderVersion}/profile/json`;
    console.log(`[LegacyFabricInstaller] Descargando perfil desde: ${profileUrl}`);

    let profileJson;
    try {
      profileJson = await this.fetchJson(profileUrl);
    } catch (err) {
      console.error(`[LegacyFabricInstaller] Error al descargar perfil: ${err.message}`);
      return false;
    }

    try {
      const versionDir = path.join(this.minecraftPath, 'versions', versionId);
      fs.mkdirSync(versionDir, { recursive: true });
      const profilePath = path.join(versionDir, `${versionId}.json`);
      fs.writeFileSync(profilePath, JSON.stringify(profileJson, null, 2));
      console.log(`[LegacyFabricInstaller] Perfil guardado en: ${profilePath}`);
    } catch (err) {
      console.error(`[LegacyFabricInstaller] Error al guardar perfil: ${err.message}`);
      return false;
    }

    if (!Array.isArray(profileJson.libraries)) {
      console.warn('[LegacyFabricInstaller] No se encontraron librerías para descargar.');
      console.log(`[LegacyFabricInstaller] Instalación completa para ${versionId}`);
      return true;
    }

    console.log(`[LegacyFabricInstaller] Descargando ${profileJson.libraries.length} librerías...`);

    let failedLibs = [];

    for (const lib of profileJson.libraries) {
      try {
        const libPathFs = this.getLibraryPath(lib.name);
        const libPathUrl = this.getLibraryUrlPath(lib.name);
        const urlBase = lib.url || 'https://repo1.maven.org/maven2/';
        const fullUrl = urlBase.endsWith('/') ? urlBase + libPathUrl : urlBase + '/' + libPathUrl;
        const dest = path.join(this.minecraftPath, 'libraries', libPathFs);

        if (fs.existsSync(dest)) {
          console.log(`  [Skip] ${lib.name} ya existe.`);
          continue;
        }

        process.stdout.write(`  Descargando ${lib.name}... `);
        await this.downloadFile(fullUrl, dest);
        console.log('OK');
      } catch (e) {
        console.error(`  ERROR descargando ${lib.name}: ${e.message}`);
        failedLibs.push(lib.name);
      }
    }

    if (failedLibs.length > 0) {
      console.warn(`[LegacyFabricInstaller] Terminó con errores en ${failedLibs.length} librerías:`);
      failedLibs.forEach(lib => console.warn(`  - ${lib}`));
      return false;
    }

    console.log(`[LegacyFabricInstaller] Instalación completa para ${versionId}`);
    process.exit(0);
  }

  static async run(minecraftPath, gameVersion) {
    const installer = new LegacyFabricInstaller(minecraftPath, gameVersion);
    const result = await installer.install();

    if (result) {
      console.log('Instalación terminada correctamente.');
      process.exit(0);
    } else {
      console.error('Hubo errores durante la instalación.');
      process.exit(1);
    }
  }
}

module.exports = LegacyFabricInstaller;
