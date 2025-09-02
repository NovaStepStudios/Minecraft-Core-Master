/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 * @external https://music.youtube.com/watch?v=DVXMmKadzYU&si=ofY-WTm-mFeVsehz Disfrutalo :)
 */

import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import child from "child_process";

const platformMap: Record<string, string> = {
  win32: "windows",
  linux: "linux",
  darwin: "osx",
};

interface Rule {
  action: "allow" | "disallow";
  os?: {
    name?: string;
  };
  features?: {
    is_demo_user?: boolean;
    has_custom_resolution?: boolean;
  };
}

interface MemoryOptions {
  min?: string;
  max?: string;
}

interface WindowOptions {
  width?: number;
  height?: number;
  fullscreen?: boolean;
}

interface Auth {
  name: string;
  uuid?: string;
  accessToken?: string;
  provider?: string;
  userProperties?: {
    value?: string;
  };
  clientId?: string;
  offline?: boolean;
}

export interface Version {
  id: string;
  type?: string | "release";
  javaVersion?: {
    majorVersion: number;
  };
  mainClass?: string;
  assets?: string;
  assetIndex?: {
    id: string;
  };
  minecraftArguments?: string;
  arguments?: {
    game?: (string | { rules?: Rule[]; value: string | string[] })[];
    jvm?: string[];
  };
  inheritsFrom?: string;
}

interface BuildOptions {
  root: string;
  memory?: MemoryOptions;
  window?: WindowOptions;
  mcFlags?: string[];
  version?: {
    type?: string;
  };
  debug?: boolean;
  javaPath?: string;
}

function isRuleAllowed(rules?: Rule[]) {
  if (!rules || rules.length === 0) return true;
  const platform = platformMap[os.platform()] || os.platform();
  return (
    rules.some((rule) => !rule.os || rule.os.name === platform) &&
    rules.some((rule) => rule.action === "allow")
  );
}

function replaceVars(input: string, vars: Record<string, any>) {
  if (typeof input !== "string") return input;
  return input.replace(/\${([^}]+)}/g, (_, key) => vars[key] ?? "");
}

function resolveIfExists(p: string): string | null {
  try {
    const r = path.resolve(p);
    return fs.existsSync(r) ? r : null;
  } catch {
    return null;
  }
}

function uniquePaths(paths: string[] = []) {
  const seen = new Set<string>();
  return (paths || []).reduce((out: string[], p) => {
    const r = resolveIfExists(p);
    if (r && !seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
    return out;
  }, []);
}

function splitModuleAndClassPath(classPath: string[]) {
  const modulePath: string[] = [];
  const classPathFiltered: string[] = [];
  const unique = uniquePaths(classPath);

  for (const jar of unique) {
    const l = jar.toLowerCase();
    if (l.includes("securejarhandler") || l.includes("bootstraplauncher")) modulePath.push(jar);
    else classPathFiltered.push(jar);
  }

  return { modulePath: uniquePaths(modulePath), classPathFiltered: uniquePaths(classPathFiltered) };
}

function getJavaVersion(javaPath: string) {
  try {
    const output = child.execSync(`${javaPath} -version 2>&1`).toString();
    const match = output.match(/version "(?<v>\d+)/);
    if (match && match.groups?.v) return parseInt(match.groups.v);
    throw new Error();
  } catch {
    throw new Error("[Minecraft-Core] No se pudo detectar la versión de Java instalada.");
  }
}

function filterLwjglDuplicates(paths: string[]): string[] {
  const latest: Record<string, string> = {};

  for (const p of paths) {
    const base = path.basename(p);
    const match = base.match(/^(?<lib>lwjgl(?:-[a-z]+)*)-(?<ver>\d+\.\d+\.\d+)\.jar$/);

    if (match?.groups) {
      const lib = match.groups["lib"];
      const ver = match.groups["ver"];
      if (lib && ver) {
        if (!latest[lib] || latest[lib] < ver) {
          latest[lib] = ver;
        }
      }
    }
  }

  return paths.filter((p) => {
    const base = path.basename(p);
    const match = base.match(/^(?<lib>lwjgl(?:-[a-z]+)*)-(?<ver>\d+\.\d+\.\d+)\.jar$/);

    if (!match?.groups) return true;

    const lib = match.groups["lib"];
    const ver = match.groups["ver"];

    return !!(lib && ver && latest[lib] === ver);
  });
}

export const ArgumentBuilder = {
  build({
    opts,
    version,
    auth,
    classPath,
  }: {
    opts: BuildOptions;
    version: Version;
    auth: Auth;
    classPath: string[] | string;
  }) {
    const args: string[] = [];
    const debug = !!opts.debug;
    const javaPath = opts.javaPath || "java";

    // Java version
    const javaVersion = getJavaVersion(javaPath);
    const requiredJava = version.javaVersion?.majorVersion ?? 8;
    if (javaVersion < requiredJava)
      throw new Error(`[Minecraft-Core] Java v${javaVersion} no compatible. Se requiere v${requiredJava}+`);

    // Memory
    const memory = opts.memory || {};
    const memPattern = /^[0-9]+[GM]$/i;
    args.push(memPattern.test(memory.max || "") ? `-Xmx${memory.max}` : "-Xmx2G");
    args.push(memPattern.test(memory.min || "") ? `-Xms${memory.min}` : "-Xms512M");

    // Game paths
    const gameRoot = path.resolve(opts.root);
    const versionsRoot = path.join(gameRoot, "versions");

    let actualVersion: Version = version;
    while ((actualVersion as any).inheritsFrom) {
      const parentId = (actualVersion as any).inheritsFrom;
      const parentPath = path.join(versionsRoot, parentId, `${parentId}.json`);
      if (!fs.existsSync(parentPath)) break;
      actualVersion = JSON.parse(fs.readFileSync(parentPath, "utf-8"));
    }

    const nativesPath = path.join(versionsRoot, actualVersion.id, "natives");
    if (!fs.existsSync(nativesPath)) throw new Error(`[Minecraft-Core] Nativos no encontrados: ${nativesPath}`);
    args.push(`-Djava.library.path=${path.resolve(nativesPath)}`);
    args.push(`-Dorg.lwjgl.librarypath=${path.resolve(nativesPath)}`);
    if (requiredJava > 8) args.push("--enable-native-access=ALL-UNNAMED");

    // Normalizar classPath a array
    let classPathArray: string[] = [];
    if (typeof classPath === "string") classPathArray = classPath.split(path.delimiter).map((p) => p.replace(/^"(.*)"$/, "$1"));
    else if (Array.isArray(classPath)) classPathArray = classPath;

    // Classpath
    const isNeoForge = version.id?.toLowerCase().includes("neoforge") || version.type?.toLowerCase() === "neoforge";

    if (isNeoForge) {
      args.unshift("--add-opens", "java.base/java.lang.invoke=ALL-UNNAMED");
      const { modulePath, classPathFiltered } = splitModuleAndClassPath(classPathArray);
      const moduleSet = new Set(modulePath.map((p) => path.resolve(p)));
      const cleanedClassPath = classPathFiltered.filter((p) => !moduleSet.has(path.resolve(p)));
      if (!modulePath.length) throw new Error("[Minecraft-Core] Falta jar para module-path (NeoForge)");
      if (!cleanedClassPath.length) throw new Error("[Minecraft-Core] classPath vacío tras separar module-path (NeoForge)");
      if (debug) console.log("[Minecraft-Core] module-path:", modulePath.length, "class-path:", cleanedClassPath.length);
      args.push("--module-path", modulePath.join(path.delimiter));
      args.push("--class-path", cleanedClassPath.join(path.delimiter));
    } else {
      const filteredClassPath = filterLwjglDuplicates(uniquePaths(classPathArray));
      if (!filteredClassPath.length) throw new Error("[Minecraft-Core] classPath vacío o inválido");
      if (debug) console.log("[Minecraft-Core] classpath count:", filteredClassPath.length);
      args.push("-cp", filteredClassPath.join(path.delimiter));
    }

    // Main class
    const mainClass = version.mainClass || (isNeoForge ? "cpw.mods.bootstraplauncher.BootstrapLauncher" : "net.minecraft.client.main.Main");
    if (!mainClass || !mainClass.trim()) throw new Error("[Minecraft-Core] mainClass inválido");
    args.push(mainClass);

    // Vars
    const assetDir = path.join(gameRoot, version.assets === "pre-1.6" ? "resources" : "assets");
    const vars = {
      auth_player_name: auth.name || "Player",
      version_name: version.id,
      game_directory: gameRoot,
      assets_root: assetDir,
      assets_index_name: version.assets || version.assetIndex?.id || "legacy",
      auth_uuid: auth.uuid || uuidv4(),
      auth_session: auth.accessToken || uuidv4(),
      auth_access_token: auth.accessToken || uuidv4(),
      user_type: auth.provider || "mojang",
      version_type: opts.version?.type || "release",
      user_properties: auth.userProperties?.value || "{}",
      resolution_width: opts.window?.width || 854,
      resolution_height: opts.window?.height || 480,
      fullscreen: opts.window?.fullscreen ?? false,
      clientid: auth.clientId || "unknown",
      offline: auth.offline ?? false,
      demo: false,
    };
    if (opts.debug) console.log("[Minecraft-Core] Vars preparadas para ejecución:");
    if (opts.debug) console.table(vars);
    if (opts.debug) console.log("[Minecraft-Core] Ajustando flags según loader/version...");
    opts.mcFlags = opts.mcFlags || [];
    
    if (version.id.toLowerCase().includes("fabric") && !opts.mcFlags.includes("--fabric")) {
      opts.mcFlags.push("--fabric");
    }

    if (version.id.toLowerCase().includes("neoforge")) {
      if (!opts.mcFlags.includes("--neoforge")) opts.mcFlags.push("--neoforge");
      if (!opts.mcFlags.includes("--enable-preview")) opts.mcFlags.push("--enable-preview");
    }

    if (vars.demo) {
      const demoIdx = args.indexOf("--demo");
      if (demoIdx !== -1) {
        args.splice(demoIdx, 2);
      }
    }

    if (opts.debug) console.log("[Minecraft-Core] JVM args añadidos:", version.arguments?.jvm ?? "Ninguno");
    if (opts.debug) console.log("[Minecraft-Core] mcFlags actualizados:", opts.mcFlags) ?? "Ninguno";
    if (opts.debug) console.log("[Minecraft-Core] mcFlags finales:", opts.mcFlags ?? "Todo esta listo");

    // Raw args
    let rawArgs: string[] = [];
    if (version.minecraftArguments?.trim()) {
      rawArgs = version.minecraftArguments.split(" ").map((a) => replaceVars(a, vars));
    } else if (version.arguments?.game) {
      for (const arg of version.arguments.game) {
        if (typeof arg === "string") {
          rawArgs.push(replaceVars(arg, vars));
        } else if (arg.rules && isRuleAllowed(arg.rules)) {
          // Ignorar demo
          const hasDemoFeature = arg.rules.some((r) => r.features?.is_demo_user);
          if (hasDemoFeature) continue;

          if (Array.isArray(arg.value)) rawArgs.push(...arg.value.map((v) => replaceVars(v, vars)));
          else rawArgs.push(replaceVars(arg.value, vars));
        }
      }
    }

    // Filtrar argumentos QuickPlay
    const blockedArgs = new Set([
      "--quickPlayPath",
      "--quickPlaySingleplayer",
      "--quickPlayMultiplayer",
      "--quickPlayRealms",
    ]);

    rawArgs = rawArgs.filter((arg, i, arr): arg is string => {
      if (!arg) return false; // elimina undefined o strings vacíos
      if (blockedArgs.has(arg)) return false;
      if (i > 0 && blockedArgs.has(arr[i - 1]!)) return false;
      return true;
    });

    // mcFlags y userProperties
    if (opts.mcFlags) rawArgs.push(...opts.mcFlags);
    if (!rawArgs.includes("--userProperties")) rawArgs.push("--userProperties", vars.user_properties);

    // Limpieza de duplicados y flags vacías
    const cleanedRaw: string[] = [];
    const seenFlags = new Set<string>();
    for (let i = 0; i < rawArgs.length; i++) {
      const token = rawArgs[i];
      if (!token) continue;
      if (token.startsWith("--")) {
        const next = rawArgs[i + 1];
        if (seenFlags.has(token)) {
          i++;
          continue;
        }
        cleanedRaw.push(token);
        if (next && !next.startsWith("--")) {
          cleanedRaw.push(next);
          i++;
        }
        seenFlags.add(token);
      } else cleanedRaw.push(token);
    }

    // Assets, uuid, accessToken, gameDir
    const pushIfMissing = (flag: string, value: string) => {
      if (!cleanedRaw.includes(flag)) cleanedRaw.push(flag, value);
    };
    pushIfMissing("--assetsDir", assetDir);
    if (version.assetIndex) pushIfMissing("--assetIndex", version.assetIndex.id);
    pushIfMissing("--uuid", vars.auth_uuid);
    pushIfMissing("--accessToken", vars.auth_access_token);
    // Quitar --demo si existe
    const demoIndex = cleanedRaw.indexOf("--demo");
    if (demoIndex !== -1) {
      cleanedRaw.splice(demoIndex, 1);
      cleanedRaw.splice(demoIndex, 1); // también elimina el valor siguiente, aunque generalmente no hay
    }
    if (opts.window?.fullscreen) cleanedRaw.push("--fullscreen");
    pushIfMissing("--gameDir", gameRoot);

    if (debug) console.log(`[Minecraft-Core] rawArgs finales: ${cleanedRaw.length}`);
    args.push(...cleanedRaw);

    return args;
  },
};
