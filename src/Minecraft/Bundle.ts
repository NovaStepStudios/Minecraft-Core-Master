import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { getFileHash } from '../Utils/Index';

export interface BundleItem {
  type?: 'CFILE' | 'Assets' | string;
  path: string;
  folder?: string;
  content?: string;
  sha1?: string;
  size?: number;
  url?: string;
}

export interface MinecraftBundleOptions {
  path: string;
  instance?: string;
  ignored: string[];
}

export default class MinecraftBundle extends EventEmitter {
  private options: MinecraftBundleOptions;

  constructor(options: MinecraftBundleOptions) {
    super();
    this.options = options;
  }

  public async checkBundle(bundle: BundleItem[]): Promise<BundleItem[]> {
    const toDownload: BundleItem[] = [];

    for (let i = 0; i < bundle.length; i++) {
      const file = bundle[i];
      if (!file?.path ) continue;

      file.path = path.resolve(this.options.path, file.path).replace(/\\/g, '/');
      file.folder = path.dirname(file.path);

      if (file.type === 'CFILE') {
        await this.#writeCFile(file);
        this.emitProgress(file, i, bundle.length);
        continue;
      }

      const exists = fs.existsSync(file.path);
      const ignored = this.#shouldIgnore(file.path);
      let hashMatches = true;
      let sizeMatches = true;

      if (exists && !ignored) {
        if (file.sha1) {
          const currentHash = await getFileHash(file.path);
          hashMatches = currentHash === file.sha1;
        }
        if (file.size) {
          const stats = fs.statSync(file.path);
          sizeMatches = stats.size === file.size;
        }
      }

      if (!exists || !hashMatches || !sizeMatches) {
        toDownload.push(file);
      }

      this.emitProgress(file, i, bundle.length);
    }

    return toDownload;
  }

  public async getTotalSize(bundle: BundleItem[]): Promise<number> {
    return bundle.reduce((acc, f) => acc + (f.size ?? 0), 0);
  }

  public async checkFiles(bundle: BundleItem[]): Promise<void> {
    const instancePath = this.options.instance ? `/instances/${this.options.instance}` : '';
    const basePath = path.join(this.options.path, instancePath);
    const allFiles = this.getFiles(basePath);

    const allowed = new Set([
      ...this.getFiles(path.join(this.options.path, 'loader')),
      ...this.getFiles(path.join(this.options.path, 'runtime')),
      ...bundle.map(f => f.path),
      ...this.options.ignored.map(f => path.join(basePath, f))
    ]);

    for (const filePath of allFiles) {
      if (!allowed.has(filePath)) {
        try {
          const stats = fs.statSync(filePath);
          if (stats.isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
            this.#cleanupEmptyDirs(filePath, basePath);
          }
        } catch { /* ignorar errores */ }
      }
    }
  }

  private getFiles(dirPath: string, collected: string[] = []): string[] {
    if (!fs.existsSync(dirPath)) return collected;
    for (const entry of fs.readdirSync(dirPath)) {
      const full = path.join(dirPath, entry);
      const stats = fs.statSync(full);
      stats.isDirectory() ? this.getFiles(full, collected) : collected.push(full);
    }
    return collected;
  }

  async #writeCFile(file: BundleItem) {
    const folder = file.folder ?? path.dirname(file.path ?? '');
    const filePath = file.path ?? '';
    if (!filePath) throw new Error('BundleItem.path no puede ser undefined para CFILE');
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true, mode: 0o777 });
    fs.writeFileSync(filePath, file.content ?? '', { encoding: 'utf8', mode: 0o755 });
  }

  #shouldIgnore(filePath: string): boolean {
    const prefix = this.options.instance
      ? path.join(this.options.path, 'instances', this.options.instance)
      : this.options.path;
    const rel = path.relative(prefix, filePath).replace(/\\/g, '/');
    return this.options.ignored.includes(rel);
  }

  #cleanupEmptyDirs(filePath: string, basePath: string) {
    let current = path.dirname(filePath);
    while (current.startsWith(basePath) && current !== basePath) {
      if (fs.existsSync(current) && fs.readdirSync(current).length === 0) {
        fs.rmdirSync(current);
      }
      current = path.dirname(current);
    }
  }

  private emitProgress(file: BundleItem, index: number, total: number) {
    this.emit('progress', {
      filePath: file.path,
      type: file.type,
      currentIndex: index + 1,
      totalFiles: total,
      percent: Number(((index + 1) / total * 100).toFixed(2))
    });
  }
}
