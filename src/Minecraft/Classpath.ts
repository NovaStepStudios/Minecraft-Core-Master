/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */

import fs from "fs";
import path from "path";
import os from "os";

export interface Library {
    name?: string;
    downloads?: {
        artifact?: { path: string };
        classifiers?: Record<string, { path: string }>;
    };
    natives?: Record<string, string>;
    rules?: { action: "allow" | "disallow"; os?: { name: string } }[];
}

export interface VersionJSON {
    id: string;
    inheritsFrom?: string;
    libraries?: Library[];
    mainClass?: string | undefined;
}

export interface ClasspathResult {
    classpath: string[];
    classpathString: string;
    nativesDir: string;
    modulePath?: string[];
}

const OS_MAP: Record<string, string> = { win32: "windows", darwin: "osx", linux: "linux" };
const CURRENT_OS = OS_MAP[os.platform()] || os.platform();

const isAllowed = (rules?: Library["rules"]) => {
    if (!rules) return true;
    let result: boolean | null = null;
    for (const rule of rules) {
        const matchOS = !rule.os || rule.os.name === CURRENT_OS;
        if (matchOS) result = rule.action === "allow";
    }
    return result ?? false;
};

export class ClasspathManager {
    constructor(private root: string, private version: VersionJSON) {}

    /** Combina librerías heredadas de versiones padre */
    private mergeInheritedLibraries(versionData: VersionJSON): Library[] {
        const merged: Library[] = [...(versionData.libraries || [])];
        let parentID = versionData.inheritsFrom;
        while (parentID) {
            const parentPath = path.join(this.root, "versions", parentID, `${parentID}.json`);
            if (!fs.existsSync(parentPath)) break;
            try {
                const parent = JSON.parse(fs.readFileSync(parentPath, "utf-8")) as VersionJSON;
                merged.unshift(...(parent.libraries || []));
                parentID = parent.inheritsFrom;
            } catch {
                break;
            }
        }
        return merged;
    }

    /** Obtiene la ruta física de la librería */
    private resolveLibPath(lib: Library): string | null {
        const candidates: string[] = [];

        if (lib.downloads?.artifact?.path) candidates.push(lib.downloads.artifact.path);
        if (lib.downloads?.classifiers) {
            for (const classifier of Object.values(lib.downloads.classifiers)) {
                if (classifier.path) candidates.push(classifier.path);
            }
        }
        if (lib.name) {
            const [group, name, version] = lib.name.split(":");
            if (group && name && version) {
                candidates.push(path.join(...group.split("."), name, version, `${name}-${version}.jar`));
            }
        }

        for (const rel of candidates) {
            const p1 = path.join(this.root, "libraries", rel);
            const p2 = path.join(this.root, "maven2", rel);
            if (fs.existsSync(p1)) return p1;
            if (fs.existsSync(p2)) return p2;
        }

        return null;
    }

    /** Agrega ASM si falta según la versión de Minecraft */
    private addASMIfMissing(classpath: string[], seen: Set<string>) {
        const mcVerMatch = this.version.id.match(/^(\d+)\.(\d+)/) ?? [];
        const mcMajor = mcVerMatch[1] ? parseInt(mcVerMatch[1], 10) : 1;
        const mcMinor = mcVerMatch[2] ? parseInt(mcVerMatch[2], 10) : 12;
        let asmVersion = "9.2";
        if (mcMajor === 1 && mcMinor <= 7) asmVersion = "4.2";
        else if (mcMajor === 1 && mcMinor <= 16) asmVersion = "5.2";

        const asmJar = path.join(this.root, "libraries", "org", "ow2", "asm", "asm", asmVersion, `asm-${asmVersion}.jar`);
        if (fs.existsSync(asmJar) && !seen.has(asmJar)) {
            classpath.push(asmJar);
            seen.add(asmJar);
        }
    }

    buildClasspath(): ClasspathResult {
        const classpath: string[] = [];
        const modulePath: string[] = [];
        const seen = new Set<string>();

        const push = (p: string | null, toModule = false) => {
            if (p && fs.existsSync(p) && !seen.has(p)) {
                seen.add(p);
                if (toModule) modulePath.push(p);
                else classpath.push(p);
            }
        };

        const libs = this.mergeInheritedLibraries(this.version).filter(lib => isAllowed(lib.rules));

        const isOptiFine = this.version.id.toLowerCase().includes("optifine");
        const isNeoForge = this.version.id.toLowerCase().includes("neoforge");
        const needsLaunchWrapper = this.version.id.startsWith("1.7") || isOptiFine || this.version.id.toLowerCase().includes("fml");

        // Paths especiales
        let launchWrapper: string | null = null;
        let bootstrap: string | null = null;
        let universal: string | null = null;

        for (const lib of libs) {
            const p = this.resolveLibPath(lib);
            if (!p) continue;
            if (lib.name?.includes("launchwrapper")) launchWrapper = p;
            else if (lib.name?.includes("bootstraplauncher")) bootstrap = p;
            else if (isNeoForge && lib.name?.includes("neoforge") && p.includes("universal")) universal = p;
        }

        // LaunchWrapper
        if (needsLaunchWrapper) {
            if (!launchWrapper) {
                const lwVer = this.version.id.startsWith("1.7") ? "1.5" : "1.12";
                launchWrapper = path.join(this.root, "libraries", "net", "minecraft", "launchwrapper", lwVer, `launchwrapper-${lwVer}.jar`);
            }
            push(launchWrapper);
        }

        // Boostrap según mainClass
        const mainClass: string = this.version.mainClass || "";
        const needsBootstrap = /bootstrap/i.test(mainClass);

        if (needsBootstrap && !bootstrap) {
            for (const lib of libs) {
                if (!lib.name?.includes("bootstraplauncher")) continue;
                const p = this.resolveLibPath(lib);
                if (p) {
                    push(p);
                    bootstrap = p;
                    break;
                }
            }
        }

        // JARs de versión
        if (this.version.inheritsFrom) push(path.join(this.root, "versions", this.version.inheritsFrom, `${this.version.inheritsFrom}.jar`));
        const versionJar = path.join(this.root, "versions", this.version.id, `${this.version.id}.jar`);
        push(versionJar);
        push(bootstrap);
        push(universal);

        // Librerías normales
        for (const lib of libs) {
            const p = this.resolveLibPath(lib);
            if (!p) continue;
            // Saltar LaunchWrapper, Bootstrap y universal ya agregados
            if ((needsLaunchWrapper && lib.name?.includes("launchwrapper")) || lib.name?.includes("bootstraplauncher") || (isNeoForge && lib.name?.includes("neoforge") && p.includes("universal"))) continue;
            // ASM de NeoForge va a modulePath
            if (isNeoForge && /org[\\/]ow2[\\/]asm[\\/]/.test(p.replace(/\\/g, "/"))) push(p, true);
            else push(p);
        }

        // Agregar ASM faltante si es necesario
        this.addASMIfMissing(isNeoForge ? modulePath : classpath, seen);

        // Directorio de natives
        let nativesDir = path.join(this.root, "versions", this.version.id, "natives");
        if (this.version.inheritsFrom) {
            const parentNatives = path.join(this.root, "versions", this.version.inheritsFrom, "natives");
            if (fs.existsSync(parentNatives)) nativesDir = parentNatives;
        }

        const result: ClasspathResult = {
            classpath,
            classpathString: classpath.join(path.delimiter),
            nativesDir,
        };

        if (isNeoForge) result.modulePath = modulePath;

        return result;
    }
}
