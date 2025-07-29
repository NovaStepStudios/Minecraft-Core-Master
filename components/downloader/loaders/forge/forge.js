"use strict";
const { spawn } = require('child_process');
const https = require('https');
const fs = require('fs');
const path = require('path');

class ForgeInstaller {
  constructor(minecraftPath, forgeVersion, installerOutputDir = null) {
    this.minecraftPath = path.resolve(minecraftPath);
    this.forgeVersion = forgeVersion;

    this.installerUrl = `https://maven.minecraftforge.net/net/minecraftforge/forge/${forgeVersion}/forge-${forgeVersion}-installer.jar`;

    this.outputDir = installerOutputDir
      ? path.resolve(installerOutputDir)
      : path.join(this.minecraftPath, 'temp','forge');

    this.installerPath = path.join(this.outputDir, `forge-${forgeVersion}-installer.jar`);
  }

  isInstalled() {
    const versionDir = path.join(this.minecraftPath, 'versions', this.forgeVersion);
    return fs.existsSync(versionDir);
  }

  async downloadInstaller() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(this.installerPath);
      https.get(this.installerUrl, res => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Error descargando instalador: ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(resolve));
      }).on('error', err => {
        if (fs.existsSync(this.installerPath)) fs.unlinkSync(this.installerPath);
        reject(err);
      });
    });
  }

  runInstaller() {
    return new Promise((resolve, reject) => {
      const java = 'java';
      const args = ['-jar', this.installerPath, '--installClient', this.minecraftPath];
      const proc = spawn(java, args, { stdio: 'inherit' });

      proc.on('error', reject);
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Forge installer exited with code ${code}`));
      });
    });
  }

  async install() {
    if (this.isInstalled()) {
      console.log(`[ForgeInstaller] Forge ${this.forgeVersion} ya está instalado.`);
      return;
    }

    console.log(`[ForgeInstaller] Descargando instalador...`);
    await this.downloadInstaller();

    console.log(`[ForgeInstaller] Ejecutando instalador...`);
    await this.runInstaller();

    console.log(`[ForgeInstaller] Forge instalado correctamente.`);

    if (fs.existsSync(this.installerPath)) {
      fs.unlinkSync(this.installerPath);
    }
  }
}

module.exports = ForgeInstaller;
