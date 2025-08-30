/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import pLimit from "p-limit";

import { MinecraftNativesDownloader } from "./Minecraft/Natives";
import { MinecraftLibrariesDownloader } from "./Minecraft/Libraries";
import { MinecraftClientDownloader } from "./Minecraft/Version";
import { MinecraftAssetsDownloader } from "./Minecraft/Assets";
import { LwjglDownloader } from "./Minecraft/Lwjgl";
import { downloadLoggingXml } from "./Minecraft/Logging";
import RuntimeDownloader from "./Minecraft/Runtime";
import MinecraftBundle, { BundleItem } from "./Minecraft/Bundle";

type VersionInput = string | { id: string; [key: string]: any };
type JavaOption = boolean | string | "auto";

interface DownloaderOptions {
  root: string;
  version: VersionInput;
  concurrency?: number | false | undefined;
  installJava?: JavaOption | undefined;
  variantJava?: "release" | "snapshot" | "alpha" | "beta" | undefined;
  bundle?: BundleItem[] | undefined;
}

interface InstancieOptions extends DownloaderOptions {
  instancieId?: string;
  manifest?: {
    name: string;
    description?: string | string[];
    icon?: string;
    created?: string;
  };
  userConfig?: any;
  gameConfig?: {
    resolution?: { width: string; height: string; fullscreen: boolean };
    memory?: { min: string; max: string };
    javaArgs?: string[];
    gameArgs?: string[];
  };
}

interface ErrorContext {
  task?: string;
  version?: string;
  root?: string;
  step?: string;
  profile?: string;
  progress?: string;
  additionalInfo?: string;
}

export class MinecraftDownloader extends EventEmitter {
  private tasks: (() => Promise<void>)[] = [];
  private completedSteps = 0;
  private totalSteps = 0;
  private controller = new AbortController();

  constructor() {
    super();
  }

  public async start(options: DownloaderOptions) {
    const { root, version, concurrency = 2, installJava = true, bundle } = options;

    if (!root) throw new Error("Debe especificar la carpeta raíz (root).");
    if (!version) throw new Error("Debe especificar la versión de Minecraft.");

    this.tasks = [];
    this.completedSteps = 0;
    this.controller = new AbortController();

    this.ensureLauncherProfiles(root);
    this.tasks.push(() => this.downloadLoggingXml(root, version));

    if (bundle?.length) {
      this.tasks.push(async () => {
        const bundleManager = new MinecraftBundle({ path: root, ignored: [] });
        await bundleManager.checkBundle(bundle);
        await bundleManager.checkFiles(bundle);
        this.completedSteps++;
        this.emitProgress("Bundle procesado", 100);
      });
    }

    // Detectar legacy assets
    const versionStr = typeof version === "string" ? version : version.id;
    const [major = 0, minor = 0, patch = 0] = versionStr.split(".").map(n => Number(n) || 0);
    const legacyAssets = major < 1 || (major === 1 && minor < 6) || (major === 1 && minor === 6 && patch < 1);

    const downloaders: [string, any][] = [
      ["LWJGL", LwjglDownloader],
      ["Nativos", MinecraftNativesDownloader],
      ["Librerías", MinecraftLibrariesDownloader],
      [
        "Assets",
        class extends MinecraftAssetsDownloader {
          constructor(rootPath: string, versionId: string) {
            super(rootPath, versionId, 20, 10, true, legacyAssets);
          }
        },
      ],
      ["Cliente", MinecraftClientDownloader],
    ];

    if (installJava !== false) {
      let javaVersion: string;
      if (installJava === "auto" || installJava === true) javaVersion = this.getRecommendedJavaVersion(version);
      else if (typeof installJava === "string") javaVersion = installJava;
      else javaVersion = this.getRecommendedJavaVersion(version);

      const userVariant = options.variantJava || "release";
      const variantMap: Record<string, "alpha" | "beta" | "delta" | "gamma" | "gamma-snapshot" | "jre-legacy"> = {
        release: "gamma",
        snapshot: "gamma-snapshot",
        alpha: "alpha",
        beta: "beta",
      };
      const variantJava = variantMap[userVariant] || "gamma";

      downloaders.unshift([
        "Java",
        class extends RuntimeDownloader {
          constructor(rootPath: string) {
            super({ root: rootPath, javaVersion, variant: variantJava });
          }
        },
      ]);
    }

    this.totalSteps = downloaders.length;
    for (const [name, ClassRef] of downloaders) {
      this.tasks.push(() => this.runDownloader(name, ClassRef, root, version));
    }

    this.emitProgress("Iniciando descarga...", 0);

    try {
      const limit = concurrency === false ? (fn: any) => fn() : pLimit(concurrency || 1);
      await Promise.all(this.tasks.map(task => limit(() => this.guardTask(task))));

      if (!this.controller.signal.aborted) {
        this.emitProgress("Descarga completada", 100);
        this.emit("done");
      }
    } catch (err: any) {
      this.emit("error", err);
    }
  }

  public async createInstancie(options: InstancieOptions) {
    const { root } = options;
    if (!root) throw new Error("Debes especificar la carpeta raíz (root)");
    const safeId = (options.manifest?.name || `inst_${Date.now()}`)
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-_]/g, "");
    const instancieId = options.instancieId || safeId;
    const instanciePath = path.join(root, "instancies", instancieId);
    if (!fs.existsSync(instanciePath)) fs.mkdirSync(instanciePath, { recursive: true });

    const config = {
      id: instancieId,
      manifest: {
        name: options.manifest?.name || "Instancia sin nombre",
        description: options.manifest?.description || "",
        icon: options.manifest?.icon || "",
        created: new Date().toISOString(),
      },
      userConfig: options.userConfig || { authenticator: null },
      gameConfig: options.gameConfig || {
        resolution: { width: "854", height: "480", fullscreen: false },
        memory: { min: "512M", max: "2G" },
        javaArgs: [],
        gameArgs: [],
      },
    };
    fs.writeFileSync(path.join(instanciePath, "configInstancie.json"), JSON.stringify(config, null, 2), "utf-8");
    this.emit("info", `configInstancie.json creado en ${instanciePath}`);

    return this.start({
      root: instanciePath,
      version: options.version,
      concurrency: options.concurrency,
      installJava: options.installJava,
      variantJava: options.variantJava,
      bundle: options.bundle,
    });
  }

  private getRecommendedJavaVersion(version: VersionInput): string {
    const ver = typeof version === "string" ? version : version.id;
    if (/^1\.1[7-9]|^1\.20/.test(ver)) return "17";
    return "22";
  }

  public stop() {
    this.controller.abort();
    this.emit("warn", "Descarga cancelada por el usuario.");
  }

  private async guardTask(task: () => Promise<void>) {
    if (this.controller.signal.aborted) return;
    try {
      await task();
    } catch (err: any) {
      this.emit("warn", `Tarea fallida: ${err.message}`);
    }
  }

  private async downloadLoggingXml(root: string, version: VersionInput) {
    if (this.controller.signal.aborted) return;
    try {
      const versionId = typeof version === "string" ? version : version.id;
      const xmlPath = await downloadLoggingXml(versionId, root);
      this.completedSteps++;
      this.emitStepDone("Logging XML");
      this.emit("info", `Logging XML descargado en: ${xmlPath}`);
      this.emitProgress("Logging XML", 100);
    } catch (err: any) {
      this.handleError(err, "Logging XML", version, root);
    }
  }

  private runDownloader(name: string, ClassRef: any, root: string, version: VersionInput) {
    return new Promise<void>((resolve, reject) => {
      if (this.controller.signal.aborted) return resolve();

      let instance: any;
      try {
        instance = new ClassRef(root, version);
      } catch (err: any) {
        this.handleError(err, name, version, root);
        return reject(err);
      }

      ["info", "warn", "error"].forEach(evt =>
        instance.on(evt, (...args: any[]) => {
          if (evt === "error") {
            this.handleError(args[0], name, version, root);
            reject(args[0]);
          } else {
            this.emit(evt, `[${name}]`, ...args);
          }
        })
      );

      instance.on("progress", (progress: any) => {
        const stepPercent = typeof progress === "number" ? progress : progress.stepPercent ?? 0;
        this.emitProgress(name, stepPercent);
      });

      instance.on("done", () => {
        this.completedSteps++;
        this.emitStepDone(name);
        this.emitProgress(`${name} completado`, 100);
        resolve();
      });

      if (typeof instance.start === "function") instance.start().catch((err: any) => reject(err));
      else process.nextTick(() => instance.emit("done"));
    });
  }

  private emitStepDone(name: string) {
    this.emit("step-done", name);
  }

  private handleError(err: Error, task: string, version: VersionInput, root: string) {
    const additionalInfo = JSON.stringify(err, Object.getOwnPropertyNames(err), 2);
    this.saveErrorLog(err, {
      task,
      version: typeof version === "string" ? version : version.id,
      root,
      step: task,
      profile: "UnknownUser",
      additionalInfo,
    });
    this.emit("error", new Error(`[${task}] ${err.message}`));
  }

  private saveErrorLog(err: Error, context: ErrorContext = {}) {
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now
      .getDate()
      .toString()
      .padStart(2, "0")}`;
    const logDir = path.resolve(context.root || "./", "logs");
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const fileName = `minecraft-core-master_${dateStr}_${now.getTime()}_${context.profile || "UnknownUser"}.log`;
    const logContent = `
============== MINECRAFT CORE MASTER ERROR LOG ================
DATE       : ${now.toISOString()}
PROFILE    : ${context.profile || "UnknownUser"}
VERSION    : ${context.version || "UnknownVersion"}
OS         : ${process.platform}
COMPONENT  : Downloader -> ${context.task || "General"}
STEP       : ${context.step || "N/A"}
PROGRESS   : ${context.progress || "0.00% / 100.00%"}
ROOT       : ${context.root || "UnknownRoot"}
ADDITIONAL : ${context.additionalInfo || "N/A"}

ERROR MESSAGE:
${err.message}

STACKTRACE:
${err.stack}
===============================================================
`;
    fs.writeFileSync(path.join(logDir, fileName), logContent, "utf-8");
    console.error(`❌ [ERROR LOG] Guardado en: ${path.join(logDir, fileName)}`);
  }

  private ensureLauncherProfiles(root: string) {
    const filePath = path.join(root, "launcher_profiles.json");
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify({ profiles: {}, version: 3 }, null, 2), "utf-8");
      this.emit("info", "launcher_profiles.json creado de forma básica");
    }
  }

  private emitProgress(current: string, stepPercent: number) {
    const formattedStep = (stepPercent ?? 0).toFixed(2);
    const totalPercent = ((this.completedSteps / this.totalSteps) * 100).toFixed(2);
    this.emit("progress", { current, stepPercent: Number(formattedStep), totalPercent: Number(totalPercent) });
  }
}
