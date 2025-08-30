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
    libraries: Library[];
}

export interface ClasspathResult {
    classpath: string[];
    classpathString: string;
    nativesDir: string;
}

const currentOS = os.platform();
const normalizeOSMap: Record<string, string> = {
    win32: 'windows',
    darwin: 'osx',
    linux: 'linux'
};
const normalizeOS = normalizeOSMap[currentOS] || currentOS;

const isAllowed = (rules?: Library["rules"]) => {
    if (!rules) return true;
    let result: boolean | null = null;
    for (const rule of rules) {
        const matchOS = !rule.os || rule.os.name === normalizeOS;
        if (matchOS) result = rule.action === "allow";
    }
    return result ?? false;
};

export class ClasspathManager {
    constructor(private root: string, private version: VersionJSON) {}

    private mergeInheritedLibraries(versionData: VersionJSON): Library[] {
        let merged = [...(versionData.libraries || [])];
        let currentID = versionData.inheritsFrom;
        while (currentID) {
            const jsonPath = path.join(this.root, "versions", currentID, `${currentID}.json`);
            if (!fs.existsSync(jsonPath)) break;
            try {
                const parent = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as VersionJSON;
                merged = [...(parent.libraries || []), ...merged];
                currentID = parent.inheritsFrom;
            } catch {
                break;
            }
        }
        return merged;
    }

    private resolveLibPath(lib: Library): string | null {
        const libDir = path.join(this.root, "libraries");
        const maven2Dir = path.join(this.root, "maven2");
        const candidates: string[] = [];

        if (lib.downloads?.classifiers?.jar?.path) candidates.push(lib.downloads.classifiers.jar.path);
        if (lib.downloads?.artifact?.path) candidates.push(lib.downloads.artifact.path);
        if (lib.name) {
            const [group, name, version] = lib.name.split(":");
            if (group && name && version) {
                candidates.push(path.join(...group.split("."), name, version, `${name}-${version}.jar`));
            }
        }

        for (const relPath of candidates) {
            const fromLibs = path.join(libDir, relPath);
            if (fs.existsSync(fromLibs)) return fromLibs;
            const fromMaven = path.join(maven2Dir, relPath);
            if (fs.existsSync(fromMaven)) return fromMaven;
        }
        return null;
    }

    buildClasspath(): ClasspathResult {
        const classpath: string[] = [];
        const seen = new Set<string>();
        const pushIfExists = (p: string) => { if (!seen.has(p)) { classpath.push(p); seen.add(p); } };

        const libs = this.mergeInheritedLibraries(this.version)
            .filter(lib => isAllowed(lib.rules));

        const isOptiFine = this.version.id.toLowerCase().includes("optifine");
        const needsLaunchWrapper = this.version.id.startsWith("1.7") || isOptiFine || this.version.id.toLowerCase().includes("fml");

        // Rutas especiales
        let launchWrapperPath: string | null = null;
        let bootstrapPath: string | null = null;
        let universalPath: string | null = null;

        for (const lib of libs) {
            const libPath = this.resolveLibPath(lib);
            if (!libPath) continue;
            if (lib.name?.includes("launchwrapper")) launchWrapperPath = libPath;
            if (lib.name?.includes("bootstraplauncher")) bootstrapPath = libPath;
            if (lib.name?.includes("neoforge") && libPath.includes("universal")) universalPath = libPath;
        }

        if (needsLaunchWrapper) {
            if (!launchWrapperPath) {
                const lwVersion = this.version.id.startsWith("1.7") ? "1.5" : "1.12";
                launchWrapperPath = path.resolve(this.root, "libraries", "net", "minecraft", "launchwrapper", lwVersion, `launchwrapper-${lwVersion}.jar`);
            }
            pushIfExists(launchWrapperPath);
        }

        if (this.version.inheritsFrom) {
            const baseJar = path.resolve(this.root, "versions", this.version.inheritsFrom, `${this.version.inheritsFrom}.jar`);
            pushIfExists(baseJar);
        }

        const versionJar = path.resolve(this.root, "versions", this.version.id, `${this.version.id}.jar`);
        if (isOptiFine) pushIfExists(versionJar);
        if (bootstrapPath) pushIfExists(bootstrapPath);
        if (universalPath) pushIfExists(universalPath);

        for (const lib of libs) {
            const libPath = this.resolveLibPath(lib);
            if (!libPath) continue;
            if (
                (needsLaunchWrapper && lib.name?.includes("launchwrapper")) ||
                lib.name?.includes("bootstraplauncher") ||
                (lib.name?.includes("neoforge") && libPath.includes("universal"))
            ) continue;
            pushIfExists(libPath);
        }

        if (!isOptiFine) pushIfExists(versionJar);

        let nativesDir = path.resolve(this.root, "versions", this.version.id, "natives");
        if (this.version.inheritsFrom) {
            const parentNatives = path.resolve(this.root, "versions", this.version.inheritsFrom, "natives");
            nativesDir = nativesDir || parentNatives;
        }

        return {
            classpath,
            classpathString: classpath.join(path.delimiter),
            nativesDir
        };
    }
}
