const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

class FabricInstaller {
  constructor(minecraftPath, gameVersion, outputDir = null) {
    this.minecraftPath = path.resolve(minecraftPath);
    this.gameVersion = gameVersion;

    this.outputDir = outputDir
      ? path.resolve(outputDir)
      : path.join(this.minecraftPath, 'temp', 'fabric');

    this.loaderApiUrl = `https://meta.fabricmc.net/v1/versions/loader`;
  }

  getVersionId(loaderVersion) {
    return `fabric-${this.gameVersion}-${loaderVersion}`;
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
        return reject(new Error(`Too many redirects for ${url}`));
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
            return reject(new Error(`Redirect without location header for ${url}`));
          }
          file.close();
          fs.unlinkSync(dest);
          return resolve(this.downloadFile(redirectUrl, dest, redirectCount + 1));
        }

        if (res.statusCode !== 200) {
          file.close();
          fs.unlinkSync(dest);
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }

        const timeoutId = setTimeout(() => {
          request.abort();
          file.close();
          fs.unlinkSync(dest);
          reject(new Error(`Timeout downloading ${url}`));
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
    if (parts.length !== 3) throw new Error(`Invalid library name format: ${name}`);
    const [group, artifact, version] = parts;
    const groupPath = group.replace(/\./g, '/');
    return path.join(groupPath, artifact, version, `${artifact}-${version}.jar`);
  }

  getLibraryUrlPath(name) {
    const parts = name.split(':');
    if (parts.length !== 3) throw new Error(`Invalid library name format: ${name}`);
    const [group, artifact, version] = parts;
    const groupPath = group.replace(/\./g, '/');
    return `${groupPath}/${artifact}/${version}/${artifact}-${version}.jar`;
  }

  async fetchLatestStableLoader() {
    const loaders = await this.fetchJson(this.loaderApiUrl);
    if (!Array.isArray(loaders) || loaders.length === 0) {
      throw new Error(`No loader data available for Minecraft version ${this.gameVersion}`);
    }
    // Fabric API marks stable loaders with "stable": true
    const stableLoader = loaders.find(l => l.stable === true) || loaders[0];
    if (!stableLoader) throw new Error(`No loader version found for ${this.gameVersion}`);

    return stableLoader.version;
  }

  async install() {
    console.log(`[FabricInstaller] Buscando loader para Minecraft ${this.gameVersion}...`);

    let loaderVersion;
    try {
      loaderVersion = await this.fetchLatestStableLoader();
    } catch (err) {
      console.error(`[FabricInstaller] Error al obtener loader: ${err.message}`);
      return false;
    }

    const versionId = this.getVersionId(loaderVersion);

    const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${this.gameVersion}/${loaderVersion}/profile/json`;
    console.log(`[FabricInstaller] Descargando perfil desde: ${profileUrl}`);

    let profileJson;
    try {
      profileJson = await this.fetchJson(profileUrl);
    } catch (err) {
      console.error(`[FabricInstaller] Error al descargar perfil: ${err.message}`);
      return false;
    }

    try {
      const versionDir = path.join(this.minecraftPath, 'versions', versionId);
      fs.mkdirSync(versionDir, { recursive: true });
      const profilePath = path.join(versionDir, `${versionId}.json`);
      fs.writeFileSync(profilePath, JSON.stringify(profileJson, null, 2));
      console.log(`[FabricInstaller] Perfil guardado en: ${profilePath}`);
    } catch (err) {
      console.error(`[FabricInstaller] Error al guardar perfil: ${err.message}`);
      return false;
    }

    if (!Array.isArray(profileJson.libraries)) {
      console.warn('[FabricInstaller] No se encontraron librerías para descargar.');
      console.log(`[FabricInstaller] Instalación completa para ${versionId}`);
      return true;
    }

    console.log(`[FabricInstaller] Descargando ${profileJson.libraries.length} librerías...`);

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
      console.warn(`[FabricInstaller] Terminó con errores en ${failedLibs.length} librerías:`);
      failedLibs.forEach(lib => console.warn(`  - ${lib}`));
      return false;
    }

    console.log(`[FabricInstaller] Instalación completa para ${versionId}`);
    return true;
  }

  static async run(minecraftPath, gameVersion) {
    const installer = new FabricInstaller(minecraftPath, gameVersion);
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

module.exports = FabricInstaller;
