/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */
import fs from "fs";
import path from "path";

export interface Library {
    name: string;
    downloads?: {
        artifact?: {
            path: string;
            url: string;
            sha1: string;
            size: number;
        };
        classifiers?: Record<string, { path: string; url?: string; sha1?: string; size?: number }>;
    };
}
export interface VersionArguments {
    game: (string | { rules: any[]; value: string | string[] })[];
    jvm: (string | { rules: any[]; value: string | string[] })[];
}
export interface Version extends VersionJSON {
    inheritsFrom?: string;
    libraries: any[];
}
export interface VersionJSON {
    id: string;
    inheritsFrom?: string | undefined;
    time?: string | undefined;
    releaseTime?: string | undefined;
    type?: string | undefined;
    mainClass?: string | undefined;
    arguments?: VersionArguments | undefined;
    minecraftArguments?: string | undefined;
    libraries?: Library[] | undefined;
    assetIndex?: { id: string; url: string } | undefined;
    assets?: string | undefined;
    javaVersion?: { majorVersion: number; component?: string } | undefined;
    logging?: any;
}

export class VersionHandler {
    private root: string;
    private versionsRoot: string;
    constructor(minecraftRoot: string) {
        this.root = minecraftRoot;
        this.versionsRoot = path.join(this.root, "versions");
    }
    loadVersion(versionId: string): VersionJSON {
        const versionPath = path.join(this.versionsRoot, versionId, `${versionId}.json`);
        if (!fs.existsSync(versionPath)) {
            throw new Error(`[VersionHandler] No existe JSON para la versión: ${versionId}`);
        }
        let versionData: VersionJSON = JSON.parse(fs.readFileSync(versionPath, "utf-8"));
        if (versionData.inheritsFrom) {
            const parent = this.loadVersion(versionData.inheritsFrom);
            versionData = this.mergeVersions(parent, versionData);
            versionData.libraries = this.cleanLibraries(versionData.libraries ?? []);
        }
        versionData.arguments = this.normalizeArguments(versionData);
        return versionData;
    }
    getLaunchData(versionId: string, gameDir?: string, assetsDir?: string) {
        const version = this.loadVersion(versionId);
        const rootDir = this.root;
        const gameDirectory = gameDir ?? path.join(rootDir, versionId);
        const assetsDirectory = assetsDir ?? path.join(rootDir, "assets");

        const replacedArgs: VersionArguments = {
            game: version.arguments?.game.map(arg => {
                if (typeof arg === "string") {
                    return arg
                        .replace(/\$\{game_directory\}/g, gameDirectory)
                        .replace(/\$\{assets_root\}/g, assetsDirectory)
                        .replace(/\$\{assets_index_name\}/g, version.assetIndex?.id ?? "")
                        .replace(/\$\{version_name\}/g, version.id);
                }
                return arg;
            }) ?? [],
            jvm: version.arguments?.jvm ?? []
        };

        return {
            mainClass: version.mainClass ?? "",
            javaVersion: version.javaVersion,
            libraries: version.libraries ?? [],
            arguments: replacedArgs,
            assetIndex: version.assetIndex,
            gameDir: gameDirectory,
            assetsDir: assetsDirectory,
            rootDir
        };
    }
    private mergeVersions(base: VersionJSON, override: VersionJSON): VersionJSON {
        const merged: VersionJSON = {
            ...base,
            ...override,
            libraries: [...(base.libraries ?? []), ...(override.libraries ?? [])],
            minecraftArguments: override.minecraftArguments ?? base.minecraftArguments,
        };
        merged.arguments = this.mergeArguments(base.arguments, override.arguments);
        return merged;
    }
    private mergeArguments(base?: VersionArguments, override?: VersionArguments): VersionArguments {
        return {
            game: [...(base?.game ?? []), ...(override?.game ?? [])],
            jvm: [...(base?.jvm ?? []), ...(override?.jvm ?? [])]
        };
    }
    private normalizeArguments(version: VersionJSON): VersionArguments {
        if (version.arguments) {
            return {
                game: [...(version.arguments.game ?? [])],
                jvm: [...(version.arguments.jvm ?? [])]
            };
        }
        if (version.minecraftArguments) {
            return { game: version.minecraftArguments.split(" "), jvm: [] };
        }
        return { game: [], jvm: [] };
    }
    private cleanLibraries(libs: Library[]): Library[] {
        const seen = new Map<string, Library>();
        for (const lib of libs) {
            if (!lib.name) continue;
            if (seen.has(lib.name)) {
                const existing = seen.get(lib.name)!;
                if (lib.downloads?.artifact && !existing.downloads?.artifact) {
                    existing.downloads = { ...existing.downloads, artifact: lib.downloads.artifact };
                }
                if (lib.downloads?.classifiers) {
                    existing.downloads = existing.downloads ?? {};
                    existing.downloads.classifiers = { ...(existing.downloads.classifiers ?? {}), ...lib.downloads.classifiers };
                }
            } else {
                seen.set(lib.name, lib);
            }
        }
        return Array.from(seen.values());
    }
}
