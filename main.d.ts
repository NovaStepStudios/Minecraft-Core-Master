declare module "minecraft-core-master" {
  import { EventEmitter } from "events";

  // Opciones para memoria JVM
  export interface MemoryOptions {
    max?: string;
    min?: string;
  }

  // Opciones para versión de Minecraft
  export interface VersionOptions {
    versionID?: string;
    type?: string;
  }

  // Opciones de ventana
  export interface WindowOptions {
    width?: number;
    height?: number;
    fullscreen?: boolean;
  }

  // Opciones para cliente/autenticación
  export interface ClientOptions {
    username?: string;
    password?: string;
    provider?: "microsoft" | "mojang" | "cracked" | "legacy";
    email?: string | null;
    mode?: "native" | "web" | string;
    appID?: string | null;
    appSecret?: string | null;
  }

  // Opciones completas para iniciar MinecraftExecutor
  export interface StartOptions {
    root?: string;
    javaPath?: string;
    memory?: MemoryOptions;
    version?: VersionOptions;
    window?: WindowOptions;
    gameDir?: string;
    client?: ClientOptions;
    jvmFlags?: string[];
    mcFlags?: string[];
    demo?: boolean;
    debug?: boolean;
  }

  // Datos de autenticación resultantes
  export interface AuthData {
    name: string;
    uuid: string;
    access_token: string;
    profile?: any;
    ownership?: any;
    provider: string;
  }

  export class MinecraftExecutor extends EventEmitter {
    childProcess: any;
    constructor();
    start(options?: StartOptions): Promise<void>;
    stop(): void;
  }

  // ---------------------------------------------------
  // Descargador de Minecraft
  export interface DownloadProgress {
    current: string;
    stepPercent: number;
    totalPercent: number;
  }

  export class MinecraftDownloader extends EventEmitter {
    constructor();

    /**
     * Descarga todos los archivos necesarios.
     * @param root Directorio raíz donde se guardará todo.
     * @param version ID de versión o el objeto versión completo.
     * @param jvmVersion Versión de Java ("Java16", "Java17", etc.) o false para omitir.
     * @param shouldDownloadAll Si es true, realiza todas las descargas automáticamente.
     */
    downloadAll(
      root: string,
      version: string | object,
      jvmVersion: string | false,
      shouldDownloadAll: boolean
    ): Promise<void>;

    on(event: "progress", listener: (progress: DownloadProgress) => void): this;
    on(event: "step-done", listener: (name: string) => void): this;
    on(event: "done", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
  }

  // ---------------------------------------------------
  // Instaladores de modloaders
  export interface InstallerOptions {
    root: string;
    version: string;
  }

  export interface ForgeProgress {
    progress: number;
    total: number;
    [key: string]: any;
  }

  export interface InstallEmitter extends EventEmitter {
    on(event: "data", listener: (msg: any) => void): this;
    on(event: "done", listener: () => void): this;
    on(event: "error", listener: (err: Error) => void): this;
  }

  export interface GetVersionsOptions {
    type: "forge" | "fabric" | "legacyfabric" | "quilt" | "neoforge";
  }

  export class MinecraftLoaders {
    forge(options: InstallerOptions): InstallEmitter;
    fabric(options: InstallerOptions): InstallEmitter;
    legacyfabric(options: InstallerOptions): InstallEmitter;
    quilt(options: InstallerOptions): InstallEmitter;
    neoforge(options: InstallerOptions): InstallEmitter;
    getVersions(options: GetVersionsOptions): InstallEmitter;
  }
}
