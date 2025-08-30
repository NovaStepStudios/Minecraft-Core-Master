/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */
import os from "os";
import path from "path";
import fs from "fs";
import EventEmitter from "events";
import fetch from "node-fetch";
import { fromURL } from "../Utils/Download";

export interface JavaFileItem {
	path: string;
	executable?: boolean;
	url?: string;
	sha1?: string;
	size?: number;
	type?: string;
}
export interface JavaDownloadResult {
	files: JavaFileItem[];
	path: string;
}
export interface RuntimeDownloaderOptions {
	root: string;
	javaVersion?: string;
	variant?: "alpha" | "beta" | "delta" | "gamma" | "gamma-snapshot" | "jre-legacy";
}
interface MojangJavaEntry {
	manifest: { url: string };
	version: { name: string };
}
interface MojangMeta {
	[platform: string]: {
		[variant: string]: MojangJavaEntry[];
	};
}
interface MojangManifestFiles {
	[filePath: string]: {
		downloads?: {
			raw?: { url: string; sha1?: string; size?: number };
			lzma?: { url: string; sha1?: string; size?: number };
		};
		type: "file" | "directory" | "link";
		executable?: boolean;
	};
}
export default class RuntimeDownloader extends EventEmitter {
	private root: string;
	private javaVersion: string;
	private variant: RuntimeDownloaderOptions["variant"];
	constructor(options: RuntimeDownloaderOptions) {
		super();
		this.root = options.root;
		this.javaVersion = options.javaVersion || "17";
		this.variant = options.variant || "beta";
	}
	public async start(): Promise<void> {
		try {
			const javaDir = path.join(this.root, "runtime", `jre-${this.javaVersion}`);
			fs.mkdirSync(javaDir, { recursive: true });
			const result = await this.downloadJava(javaDir);
			this.emit("done", result.path);
		} catch (err: any) {
			this.emit("error", err);
		}
	}
	private async downloadJava(javaDir: string): Promise<JavaDownloadResult> {
		const platformMap: Record<string, string> = {
			win32: "windows-x64",
			darwin: "mac-os",
			linux: "linux",
		};
		const platform = platformMap[os.platform()] || os.platform();
		const metaUrl =
			"https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
		const res = await fetch(metaUrl);
		if (!res.ok) throw new Error(`No se pudo obtener metadata de Mojang: ${res.status}`);
		const meta: MojangMeta = (await res.json()) as MojangMeta;
		const platformData = meta[platform];
		if (!platformData) throw new Error(`No hay datos para la plataforma ${platform}`);
		let runtimes = platformData[`java-runtime-${this.variant}`] ?? [];
		if (!runtimes.length) {
			const fallback = Object.entries(platformData).find(([_, arr]) => arr && arr.length > 0);
			if (!fallback) throw new Error(`No se encontraron runtimes para ${platform}`);
			const [fallbackVariant] = fallback;
			this.variant = fallbackVariant as RuntimeDownloaderOptions["variant"];
			runtimes = platformData[`java-runtime-${this.variant}`] ?? [];
			this.emit("warn", `Variant "${this.variant}" no disponible, usando "${fallbackVariant}"`);
		}
		const selected = runtimes[runtimes.length - 1];
		if (!selected) throw new Error(`No se pudo seleccionar versión de Java`);
		const manifestRes = await fetch(selected.manifest.url);
		if (!manifestRes.ok) throw new Error(`No se pudo descargar el manifest: ${manifestRes.status}`);
		const manifestJson = (await manifestRes.json()) as { files: MojangManifestFiles };
		const files: JavaFileItem[] = [];
		const manifestEntries = Object.entries(manifestJson.files).filter(([_, info]) => info.downloads);
		const totalSize = manifestEntries.reduce((acc, [_, info]) => {
			const dl = info.downloads!.raw || info.downloads!.lzma;
			return acc + (dl?.size || 0);
		}, 0);
		let downloadedSize = 0;
		for (const [relPath, info] of manifestEntries) {
            const downloadInfo = info.downloads!.raw || info.downloads!.lzma;
            if (!downloadInfo?.url) continue;
            const localPath = path.join(javaDir, relPath.replace(/\//g, path.sep));
            fs.mkdirSync(path.dirname(localPath), { recursive: true });
            await fromURL(downloadInfo.url, localPath);
            downloadedSize += downloadInfo.size || 0;
            let percent = totalSize ? (downloadedSize / totalSize) * 100 : 0;
            if (percent > 100) percent = 100;
            this.emit("progress", percent, totalSize, `Descargando: ${relPath}`);
            if (info.executable) fs.chmodSync(localPath, 0o777);
            const fileItem: JavaFileItem = {
                path: localPath,
                executable: !!info.executable,
                type: "Java",
                url: downloadInfo.url,
            };
            if (downloadInfo.sha1) fileItem.sha1 = downloadInfo.sha1;
            if (downloadInfo.size !== undefined) fileItem.size = downloadInfo.size;
            files.push(fileItem);
        }
		const exePath = path.join(javaDir, os.platform() === "win32" ? "bin/javaw.exe" : "bin/java");
		return { files, path: exePath };
	}
}
