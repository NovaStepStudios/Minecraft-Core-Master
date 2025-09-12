import fs from "fs";
import path from "path";
import { spawn, execSync } from "child_process";
import { EventEmitter } from "events";
import prompt from "prompt";
import { VersionHandler, VersionJSON } from "./Minecraft/Version";
import { ArgumentBuilder, Version } from "./Minecraft/Arguments";
import { ClasspathManager } from "./Minecraft/Classpath";

export interface LauncherOptions {
  version: string;
  root: string;
  javaPath?: string;
  jvmArgs?: string[];
  mcArgs?: string[];
  debug?: boolean;
  memory?: { min?: string; max?: string };
  authenticator?: {
    name?: string;
    uuid?: string;
    access_token?: string;
    meta?: { type?: string };
    user_properties?: string;
    client_token?: string;
  };
  window?: { width?: number; height?: number; fullscreen?: boolean };
}

function resolveJavaPath(customPath?: string): string | null {
  const candidates: string[] = [];

  if (customPath) candidates.push(path.normalize(customPath));

  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, "bin", "java"));
  }

  try {
    const found = process.platform === "win32"
      ? execSync("where java").toString().split(/\r?\n/)[0]?.trim()
      : execSync("which java").toString()?.trim();
    if (found) candidates.push(path.normalize(found));
  } catch {}

  if (process.platform === "win32") {
    candidates.push(
      "C:\\Program Files\\Java\\bin\\java.exe",
      "C:\\Program Files (x86)\\Java\\bin\\java.exe"
    );
  } else if (process.platform === "darwin") {
    candidates.push("/Library/Java/JavaVirtualMachines/jdk-latest/Contents/Home/bin/java");
  } else {
    candidates.push(
      "/usr/bin/java",
      "/usr/local/bin/java",
      "/usr/lib/jvm/java-21-openjdk/bin/java",
      "/usr/lib/jvm/java-17-openjdk/bin/java"
    );
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return path.normalize(c);
  }

  return null;
}

export class MinecraftLauncher extends EventEmitter {
  private options: LauncherOptions;
  private timers: Record<string, number> = {};

  constructor(options: LauncherOptions) {
    super();
    this.options = options;
  }

  private startTimer(label: string) {
    this.timers[label] = Date.now();
  }

  private endTimer(label: string) {
    if (!this.timers[label]) return;
    const elapsed = Date.now() - this.timers[label];
    this.emit("speed", `${label} completado en ${elapsed}ms`);
    delete this.timers[label];
  }

  private async getJavaPath(): Promise<string> {
    const runtimeDir = path.join(this.options.root, "runtime");

    if (fs.existsSync(runtimeDir)) {
        const runtimeFolders = fs.readdirSync(runtimeDir).filter(f => f.startsWith("jre-"));
        for (const folder of runtimeFolders) {
            const binFolder = path.join(runtimeDir, folder, "bin");
            let javaExe: string;

            if (process.platform === "win32") {
                const javaw = path.join(binFolder, "javaw.exe");
                const java = path.join(binFolder, "java.exe");
                if (fs.existsSync(javaw)) javaExe = javaw;
                else if (fs.existsSync(java)) javaExe = java;
                else continue;
            } else {
                javaExe = path.join(binFolder, "java");
                if (!fs.existsSync(javaExe)) continue;
            }

            const javaPathAbsolute = path.resolve(javaExe);
            this.emit("info", `Usando Java desde runtime: ${javaPathAbsolute}`);
            return javaPathAbsolute;
        }
    }

    const javaExec = resolveJavaPath(this.options.javaPath);
    if (javaExec) return path.resolve(javaExec);

    this.emit("warn", "No se encontró Java automáticamente. Solicitando al usuario...");
    prompt.start();
    const { manualJava } = await prompt.get({
        name: "manualJava",
        description: "Ruta del ejecutable de Java",
        required: true
    });

    if (typeof manualJava === "string" && fs.existsSync(manualJava)) {
        return path.resolve(manualJava);
    }

    throw new Error("La ruta de Java ingresada no es válida.");
  }

  async launch(): Promise<void> {
    const { root, version, authenticator, debug, memory, jvmArgs = [], mcArgs = [] } = this.options;

    try {
      const javaPath = await this.getJavaPath();

      this.emit("debug", `Cargando versión: ${version}`);
      this.startTimer("Carga de versión");

      const versionHandler = new VersionHandler(root);
      const versionData = versionHandler.loadVersion(version);

      const versionSafe: VersionJSON & { inheritsFrom?: string; libraries: any[] } = {
        id: versionData.id,
        type: versionData.type || "release",
        mainClass: versionData.mainClass ?? "net.minecraft.client.main.Main",
        assets: versionData.assets || "legacy",
        assetIndex: versionData.assetIndex || { id: "legacy", url: "" },
        minecraftArguments: versionData.minecraftArguments || "",
        arguments: versionData.arguments ?? { game: [], jvm: [] },
        inheritsFrom: versionData.inheritsFrom || "",
        libraries: versionData.libraries ?? [],
        logging: versionData.logging ?? undefined,
        javaVersion: versionData.javaVersion ?? { majorVersion: 8 },
      };

      this.endTimer("Carga de versión");

      this.emit("debug", `Construyendo classpath...`);
      this.startTimer("Construcción de classpath");

      const classpathManager = new ClasspathManager(root, versionSafe);
      const { classpath } = classpathManager.buildClasspath();

      this.endTimer("Construcción de classpath");
      this.emit("debug", `Classpath listo con ${classpath.length} entradas.`);
      const classpathString = classpath.join(path.delimiter);
      this.emit("debug", `Classpath: ${classpathString}`);

      this.emit("debug", `Generando argumentos de inicio...`);
      this.startTimer("Generación de argumentos");

      const args = ArgumentBuilder.build({
        opts: {
          root,
          memory: memory ?? { min: "512M", max: "2G" },
          window: {
            width: this.options.window?.width ?? 854,
            height: this.options.window?.height ?? 480,
            fullscreen: this.options.window?.fullscreen ?? false,
          },
          debug: Boolean(debug),
        },
        version: versionSafe as Version,
        auth: {
          name: authenticator?.name ?? "Player",
          uuid: authenticator?.uuid ?? "00000000-0000-0000-0000-000000000000",
          accessToken: authenticator?.access_token ?? "",
          provider: authenticator?.meta?.type ?? "mojang",
          userProperties: { value: authenticator?.user_properties ?? "{}" },
          clientId: authenticator?.client_token ?? "",
          offline: !authenticator,
        },
        classPath: classpath,
      });

      this.endTimer("Generación de argumentos");

      const finalArgs = [...jvmArgs, ...args, ...mcArgs];

      this.emit("debug", `Ejecutando Java desde: ${javaPath}`);
      this.emit("debug", `Argumentos finales: ${finalArgs.join(" ")}`);

      const childProcess = spawn(javaPath, finalArgs, { cwd: root, detached: false, stdio: ["pipe", "pipe", "pipe"] });

      childProcess.stdout?.on("data", (data) => this.emit("data", data.toString().trim()));
      childProcess.stderr?.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg.toLowerCase().includes("error")) this.emit("error", msg);
        else this.emit("warn", msg);
      });

      childProcess.on("error", (err) => this.emit("error", `Error al iniciar el proceso: ${err}`));
      childProcess.on("close", (code) => {
        if (code === 0) this.emit("debug", `Minecraft salió correctamente con código ${code}`);
        else this.emit("error", `Minecraft salió con código ${code}`);
      });

    } catch (err) {
      this.emit("error", err instanceof Error ? err.message : String(err));
      throw err;
    }
  }
}
