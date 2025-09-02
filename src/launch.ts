import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { EventEmitter } from "events";
import { VersionHandler, VersionJSON } from "./Minecraft/Handler/Version";
import { ArgumentBuilder, Version } from "./Minecraft/Handler/Arguments";
import { ClasspathManager } from "./Minecraft/Handler/Classpath";

export interface LauncherOptions {
  version: string;
  root: string;
  javaPath: string;
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

  async launch(): Promise<void> {
    const { root, version, javaPath, authenticator, debug, memory, jvmArgs = [], mcArgs = [] } = this.options;

    try {
      if (!fs.existsSync(javaPath)) {
        const msg = `No se encontró el ejecutable de Java en: ${javaPath}`;
        this.emit("error", msg);
        throw new Error(msg);
      }

      this.emit("debug", `Cargando versión: ${version}`);
      this.startTimer("Carga de versión");

      const versionHandler = new VersionHandler(root);
      const versionData = versionHandler.loadVersion(version);

      // versionSafe: Todos los valores obligatorios con fallback
      const versionSafe: VersionJSON & { inheritsFrom?: string; libraries: any[] } = {
        id: versionData.id,
        type: versionData.type || "release",
        mainClass: versionData.mainClass || "net.minecraft.client.main.Main",
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
  async launchInstancie(rootBase: string, instancieName: string): Promise<void> {
    try {
      const instancePath = path.join(rootBase, "instancies", instancieName);
      const manifestPath = path.join(instancePath, "Manifest-Instancie.json");

      if (!fs.existsSync(manifestPath)) {
        throw new Error(`No existe Manifest-Instancie.json en la instancia: ${instancePath}`);
      }

      const instance = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

      this.options = {
        version: instance.version || "",
        root: instancePath,
        javaPath: instance.gameConfig?.javaPath || this.options.javaPath,
        jvmArgs: instance.gameConfig?.javaArgs || [],
        mcArgs: instance.gameConfig?.gameArgs || [],
        debug: this.options.debug ?? false,
        memory: instance.gameConfig?.memory || { min: "512M", max: "2G" },
        authenticator: instance.userConfig?.authenticator,
        window: {
          width: instance.gameConfig?.resolution?.width
            ? Number(instance.gameConfig.resolution.width)
            : 854,
          height: instance.gameConfig?.resolution?.height
            ? Number(instance.gameConfig.resolution.height)
            : 480,
          fullscreen: instance.gameConfig?.resolution?.fullscreen || false,
        },
      };

      await this.launch();
    } catch (err) {
      this.emit("error", err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

}
