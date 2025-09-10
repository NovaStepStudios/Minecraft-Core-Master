/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */

import crypto from 'crypto';
import fs from 'fs';
import { Readable } from 'stream';
import { Unzipper, ZipEntry } from './Unzipper.js';

export interface LibraryRule {
  action: 'allow' | 'disallow';
  os?: { name?: string };
  features?: any;
}
export interface MinecraftLibrary {
  name: string;
  rules?: LibraryRule[];
  downloads?: { artifact?: { url?: string; size?: number } };
  natives?: Record<string, string>;
  [key: string]: any;
}
export interface MinecraftVersionJSON {
  assets?: string;
  [key: string]: any;
}
export function getPathLibraries(main: string, nativeString?: string, forceExt = '.jar') {
  const parts = main.split(':');
  const group = parts[0] ?? '';
  const artifact = parts[1] ?? '';
  const version = parts[2] ?? '';
  const classifier = parts[3] ? `-${parts[3]}` : '';
  const fileName = `${artifact}-${version.replace('@', '.')}${nativeString || ''}${classifier}${forceExt}`;
  const filePath = `${group.replace(/\./g, '/')}/${artifact}/${version.split('@')[0]}`;
  return { path: filePath, name: fileName, version };
}
export async function getFileHash(filePath: string, algorithm = 'sha1'): Promise<string> {
  const hash = crypto.createHash(algorithm);
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
export function isOldVersion(json: MinecraftVersionJSON): boolean {
  return json.assets === 'legacy' || json.assets === 'pre-1.6';
}
export function loader(type: string) {
  const data: Record<string, any> = {
    forge: {
      meta: 'https://files.minecraftforge.net/net/minecraftforge/forge/maven-metadata.json',
      installer: 'https://maven.minecraftforge.net/net/minecraftforge/forge/${version}/forge-${version}-installer.jar',
      universal: 'https://maven.minecraftforge.net/net/minecraftforge/forge/${version}/forge-${version}-universal.jar'
    },
    neoforge: {
      meta: 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge',
      installer: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar'
    },
    fabric: { 
      meta: 'https://meta.fabricmc.net/v2/versions',
      data: 'https://meta.legacyfabric.net/v2/versions/loader',
      installer: 'https://meta.fabricmc.net/v2/versions/loader/${game_version}/${loader_version}/installer/${installer_version}/fabric-installer.jar',
      json: 'https://meta.fabricmc.net/v2/versions/loader/${version}/${build}/profile/json'
    },
    legacyfabric: {
      meta: 'https://meta.legacyfabric.net/v2/versions',
      json: 'https://meta.legacyfabric.net/v2/versions/loader/${version}/${build}/profile/json'
    },
    quilt: {
      meta: 'https://meta.quiltmc.org/v3/versions',
      json: 'https://meta.quiltmc.org/v3/versions/loader/${version}/${build}/profile/json'
    },
    curseforge: {
      api: "https://api.curseforge.com/v1"
    }
  };
  return data[type];
}
export const mirrors = [
  'https://maven.minecraftforge.net',
  'https://maven.neoforged.net/releases',
  'https://maven.creeperhost.net',
  'https://libraries.minecraft.net',
  'https://repo1.maven.org/maven2'
];
export async function getFileFromArchive(
  jar: string,
  file: string | null = null,
  prefix: string | null = null
): Promise<Buffer | ZipEntry[] | undefined> {
  const unzip = new Unzipper(jar);
  if (file) {
    const entry = unzip.getEntry(file);
    if (!entry) return undefined;
    return entry.getData();
  }
  const entries = prefix ? unzip.getEntriesWithPrefix(prefix) : unzip.getEntries();
  return entries.length > 0 ? entries : undefined;
}
export function skipLibrary(lib: MinecraftLibrary): boolean {
  const map: Record<string, string> = { win32: 'windows', darwin: 'osx', linux: 'linux' };
  if (!lib.rules) return false;
  let skip = true;
  for (const rule of lib.rules) {
    if (rule.action === 'allow' && (!rule.os || rule.os.name === map[process.platform])) skip = false;
    if (rule.action === 'disallow' && (!rule.os || rule.os.name === map[process.platform])) skip = true;
  }
  return skip;
}
export function fromAnyReadable(webStream: ReadableStream<Uint8Array>): Readable {
  const nodeStream = new Readable({
    read() {}
  });
  const reader = webStream.getReader();
  const pump = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          nodeStream.push(null);
          break;
        }
        nodeStream.push(value ? Buffer.from(value) : Buffer.alloc(0));
      }
    } catch (err) {
      nodeStream.destroy(err as Error);
    }
  };
  pump();
  return nodeStream;
}
