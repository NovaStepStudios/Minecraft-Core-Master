/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */
import fs from 'fs';
import zlib from 'zlib';

export interface ZipEntry {
    entryName: string;
    isDirectory: boolean;
    getData: () => Buffer;
}

export class Unzipper {
    private entries: ZipEntry[] = [];
    constructor(zipFilePath: string) {
        const buffer = fs.readFileSync(zipFilePath);
        this.parseBuffer(buffer);
    }
    private parseBuffer(buffer: Buffer) {
        const LFH_SIG = 0x04034b50;
        let offset = 0;
        while (offset < buffer.length - 4) {
            const sig = buffer.readUInt32LE(offset);
            if (sig !== LFH_SIG) {
                offset++;
                continue;
            }
            try {
                const compressionMethod = buffer.readUInt16LE(offset + 8);
                const compressedSize = buffer.readUInt32LE(offset + 18);
                const fileNameLength = buffer.readUInt16LE(offset + 26);
                const extraFieldLength = buffer.readUInt16LE(offset + 28);
                const fileNameStart = offset + 30;
                const fileNameEnd = fileNameStart + fileNameLength;
                const fileName = buffer.toString('utf-8', fileNameStart, fileNameEnd);
                const dataStart = fileNameEnd + extraFieldLength;
                const dataEnd = dataStart + compressedSize;
                const compressedData = buffer.slice(dataStart, dataEnd);
                this.entries.push({
                    entryName: fileName,
                    isDirectory: fileName.endsWith('/'),
                    getData: () => {
                        if (compressionMethod === 0) return compressedData;
                        if (compressionMethod === 8) return zlib.inflateRawSync(compressedData);
                        throw new Error(`Unsupported compression method: ${compressionMethod} for file ${fileName}`);
                    }
                });
                offset = dataEnd;
            } catch (err) {
                console.warn('Error parsing zip entry, skipping...', err);
                offset += 4;
            }
        }
    }
    getEntries(): ZipEntry[] {
        return this.entries;
    }
    getEntry(name: string): ZipEntry | undefined {
        return this.entries.find(e => e.entryName === name);
    }
    getEntriesWithPrefix(prefix: string): ZipEntry[] {
        return this.entries.filter(e => e.entryName.startsWith(prefix));
    }
    getFiles(): ZipEntry[] {
        return this.entries.filter(e => !e.isDirectory);
    }
    getDirectories(): ZipEntry[] {
        return this.entries.filter(e => e.isDirectory);
    }
    count(): number {
        return this.entries.length;
    }
}
