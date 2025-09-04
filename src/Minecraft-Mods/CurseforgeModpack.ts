import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import EventEmitter from 'events';
import fetch, { Response } from 'node-fetch';

export interface CFExtractOptions {
  root: string;
  filePath: string;
  apiKey: string;
  concurrency?: number | false;
  recursive?: boolean;
  keepJson?: boolean;
  maxRetries?: number;
}

export class CFModpackExtractor extends EventEmitter {
  constructor() {
    super();
  }

  async extract(options: CFExtractOptions): Promise<void> {
    const { root, filePath, apiKey = "$2a$10$qTTQj5XMpnktjDQl2.2wWeJSHt9PKrh9didxDDlT73FcwwVCX.VRO", concurrency = false, recursive = false, keepJson = true, maxRetries = 3 } = options;
    if (!apiKey) throw new Error("Debes proporcionar un API key válido de CurseForge.");

    try {
      await fsp.access(filePath).catch(() => { throw new Error(`Archivo no encontrado: ${filePath}`); });

      const cacheDir = path.join(root, 'cache', 'curseforge');
      await fsp.mkdir(cacheDir, { recursive: true });
      const packName = path.basename(filePath, path.extname(filePath));
      const packCacheDir = path.join(cacheDir, packName);
      await fsp.mkdir(packCacheDir, { recursive: true });
      if (keepJson) await fsp.copyFile(filePath, path.join(packCacheDir, path.basename(filePath)));

      const jsonData = JSON.parse(await fsp.readFile(filePath, 'utf-8'));
      const modpackName = jsonData.name || 'UnknownModpack';
      const modpackVersion = jsonData.version || 'UnknownVersion';
      const files = jsonData.files || [];

      // Copiar overrides
      if (jsonData.overrides) {
        const overridesSrc = path.join(path.dirname(filePath), jsonData.overrides);
        try { await fsp.access(overridesSrc); await CFModpackExtractor.moveFolderContents(overridesSrc, root); } catch {}
      }

      const modsDir = path.join(root, 'mods');
      await fsp.mkdir(modsDir, { recursive: true });

      const queue: (() => Promise<void>)[] = [];
      const errors: string[] = [];

      for (const file of files) {
        queue.push(async () => {
          let attempts = 0;
          while (attempts < maxRetries) {
            attempts++;
            try {
              // Obtener URL de descarga y nombre
              const apiRes = await fetch(`https://api.curseforge.com/v1/mods/${file.projectID}/files/${file.fileID}/download-url`, {
                headers: { 'X-Api-Key': apiKey, 'Accept': 'application/json' },
                redirect: 'follow'
              });
              if (!apiRes.ok) throw new Error(`API HTTP ${apiRes.status} projectID:${file.projectID} fileID:${file.fileID}`);

              const apiJson = (await apiRes.json()) as { data?: string, fileName?: string };
              const downloadUrl = apiJson.data?.replace(/ /g, '%20');
              const fileName = apiJson.fileName || `${file.fileID}.jar`;
              if (!downloadUrl) throw new Error(`No se obtuvo downloadUrl para fileID ${file.fileID}`);

              const destPath = path.join(modsDir, fileName);
              if (!recursive) { try { await fsp.access(destPath); return; } catch {} }

              // Descargar con stream y progreso
              const fileRes = await fetch(downloadUrl, { redirect: 'follow' });
              if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status} descargando fileID ${file.fileID}`);
              if (!fileRes.body) throw new Error(`No se pudo obtener el body para fileID ${file.fileID}`);
              await fsp.mkdir(path.dirname(destPath), { recursive: true });

              const totalSize = Number(fileRes.headers.get('content-length')) || 0;
              await this.downloadStreamWithProgress(fileRes, destPath, totalSize);

              this.emit('fileName', fileName);
              this.emit('fileInfo', { fileName, required: !!file.required });
              return;

            } catch (err: any) {
              this.emit('retry', file.fileID, attempts, err.message);
              if (attempts >= maxRetries) {
                errors.push(`${file.projectID}-${file.fileID}`);
                this.emit('errors', err);
              }
            }
          }
        });
      }

      // Ejecutar descargas concurrentes
      if (concurrency && typeof concurrency === 'number') {
        while (queue.length) {
          const chunk = queue.splice(0, concurrency);
          await Promise.all(chunk.map(fn => fn()));
        }
      } else {
        for (const fn of queue) await fn();
      }

      if (errors.length) await CFModpackExtractor.writeErrorLog(root, errors, { name: modpackName, version: modpackVersion });
      if (!keepJson) await fsp.unlink(filePath);
      this.emit('done');

    } catch (err: any) {
      await CFModpackExtractor.writeErrorLog(root, [filePath], { additionalInfo: err.message });
      this.emit('errors', err);
    }
  }

  private async downloadStreamWithProgress(fileRes: Response, destPath: string, totalSize: number) {
    return new Promise<void>((resolve, reject) => {
      const writeStream = fs.createWriteStream(destPath);
      let received = 0;

      fileRes.body!.on('data', (chunk: Buffer) => {
        received += chunk.length;
        const percent = totalSize ? ((received / totalSize) * 100).toFixed(2) + '%' : '100.00%';
        this.emit('progress', destPath, percent);
      });

      fileRes.body!.on('end', () => {
        this.emit('progress', destPath, '100.00%');
        resolve();
      });

      fileRes.body!.on('error', (err) => reject(err));
      fileRes.body!.pipe(writeStream);
    });
  }

  private static async moveFolderContents(src: string, dest: string) {
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await fsp.mkdir(destPath, { recursive: true });
        await this.moveFolderContents(srcPath, destPath);
      } else {
        await fsp.rename(srcPath, destPath);
      }
    }
  }

  private static async writeErrorLog(root: string, files: string[], context: any = {}) {
    const logDir = path.join(root, 'logs');
    await fsp.mkdir(logDir, { recursive: true });
    const now = new Date();
    const logPath = path.join(logDir, `CFM_ERROR_${now.getTime()}.log`);
    const content = `================== CURSEFORGE MODPACK ERROR LOG ==================
DATE       : ${now.toISOString()}
NAME       : ${context.name || 'Unknown'}
VERSION    : ${context.version || 'Unknown'}
OS         : ${process.platform}
ROOT       : ${root}
FILES WITH ERRORS:
${files.join('\n')}
ADDITIONAL : ${context.additionalInfo || 'N/A'}
===================================================================`;
    await fsp.writeFile(logPath, content);
  }
}
