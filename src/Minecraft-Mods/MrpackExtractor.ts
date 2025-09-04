/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */
import fs from 'fs/promises';
import path from 'path';
import EventEmitter from 'events';
import AdmZip from 'adm-zip';
import fetch from 'node-fetch';
import crypto from 'crypto';

export interface ExtractOptions {
  root: string;
  filePath: string;
  concurry?: number | false;
  recursive?: boolean;
  verify?: boolean;
  keepMrpack?: boolean;
}

export interface MrpackEvents {
  progress: (file: string, percent: number) => void;
  done: () => void;
  errors: (err: Error) => void;
  retry: (file: string) => void;
  fileName: (name: string) => void;
}

export class MrpackExtractor extends EventEmitter {
  constructor() { super(); }

  async extract(options: ExtractOptions): Promise<void> {
    const { root, filePath, concurry = false, recursive = false, verify = false, keepMrpack = true } = options;

    try {
      await fs.access(filePath).catch(() => { throw new Error(`Archivo no encontrado: ${filePath}`); });

      // --- CACHE INTELIGENTE ---
      const cacheBase = path.join(root, 'cache', 'mrpack');
      await fs.mkdir(cacheBase, { recursive: true });
      const packName = path.basename(filePath, path.extname(filePath));
      const packCacheDir = path.join(cacheBase, `x${packName}`);
      await fs.mkdir(packCacheDir, { recursive: true });
      if (keepMrpack) await fs.copyFile(filePath, path.join(packCacheDir, path.basename(filePath)));

      // Abrimos el ZIP
      const zip = new AdmZip(filePath);
      const zipEntries = zip.getEntries();
      zip.extractAllTo(root, true);

      // Mover overrides al root
      const overridesPath = path.join(root, 'overrides');
      try {
        await fs.access(overridesPath);
        await MrpackExtractor.moveFolderContents(overridesPath, root);
        await fs.rm(overridesPath, { recursive: true, force: true });
      } catch {}

      // Parsear modrinth.index.json y guardarlo en cache
      const indexEntry = zipEntries.find(e => e.entryName === 'modrinth.index.json');
      if (indexEntry) {
        await fs.writeFile(path.join(packCacheDir, 'modrinth.index.json'), indexEntry.getData());
      } else {
        if (!keepMrpack) await fs.unlink(filePath);
        this.emit('done');
        return;
      }

      const indexJson = JSON.parse(indexEntry.getData().toString('utf-8'));
      const files = indexJson.files;

      // --- DESCARGAS ---
      const queue: (() => Promise<void>)[] = [];
      const errors: string[] = [];

      for (const file of files) {
        queue.push(async () => {
          const filePathInside = path.join(root, file.path);
          if (!recursive) {
            try { await fs.access(filePathInside); return; } catch {}
          }

          const url = Array.isArray(file.downloads) ? file.downloads[0] : file.downloads;

          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Error descargando ${url}`);
            const buffer = Buffer.from(await res.arrayBuffer());

            if (verify && file.hashes?.sha1) {
              const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
              if (sha1 !== file.hashes.sha1) throw new Error(`Hash no coincide: ${file.path}`);
            }

            await fs.mkdir(path.dirname(filePathInside), { recursive: true });
            await fs.writeFile(filePathInside, buffer);

            // Emitir eventos
            this.emit('progress', filePathInside, 100);
            if (filePathInside.endsWith('.jar')) {
              this.emit('fileName', path.basename(filePathInside));
            }

          } catch (err: any) {
            errors.push(filePathInside);
            this.emit('errors', err);
            this.emit('retry', filePathInside);
          }
        });
      }

      // Ejecutar descargas
      if (concurry && typeof concurry === 'number') {
        while (queue.length) {
          const chunk = queue.splice(0, concurry);
          await Promise.all(chunk.map(fn => fn()));
        }
      } else {
        for (const fn of queue) await fn();
      }

      // Guardar log si hay errores
      if (errors.length) {
        await MrpackExtractor.writeErrorLog(root, errors, { 
          profile: indexJson.name,
          version: indexJson.versionId,
          root, filePath, concurry, recursive, verify, keepMrpack
        });
      }

      if (!keepMrpack) await fs.unlink(filePath);
      this.emit('done');

    } catch (err: any) {
      await MrpackExtractor.writeErrorLog(root, [filePath], { 
        profile: 'Unknown',
        version: 'Unknown',
        root, filePath, concurry, recursive, verify, keepMrpack,
        additionalInfo: err.message
      });
      this.emit('errors', err);
    }
  }

  private static async moveFolderContents(src: string, dest: string) {
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await fs.mkdir(destPath, { recursive: true });
        await this.moveFolderContents(srcPath, destPath);
      } else {
        await fs.rename(srcPath, destPath);
      }
    }
  }

  private static async writeErrorLog(root: string, files: string[], context: any = {}) {
    const logDir = path.join(root, 'logs');
    await fs.mkdir(logDir, { recursive: true });
    const now = new Date();
    const logPath = path.join(logDir, `MCM_ERROR_${now.getTime()}.log`);
    const content = `============== MINECRAFT CORE MASTER ERROR LOG ================
DATE       : ${now.toISOString()}
PROFILE    : ${context.profile || "UnknownUser"}
VERSION    : ${context.version || "UnknownVersion"}
OS         : ${process.platform}
ROOT       : ${context.root || root}
FILEPATH   : ${context.filePath || 'N/A'}
CONCURRY   : ${context.concurry ?? 'false'}
RECURSIVE  : ${context.recursive ?? 'false'}
VERIFY     : ${context.verify ?? 'false'}
KEEPMRPACK : ${context.keepMrpack ?? 'true'}
ADDITIONAL : ${context.additionalInfo || "N/A"}

FILES WITH ERRORS:
${files.join('\n')}

===============================================================`;
    await fs.writeFile(logPath, content);
  }
}
