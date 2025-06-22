![npm](./icon.png)

# Minecraft-Core-Master

**Minecraft-Core-Master** es un conjunto modular en JavaScript para descargar, instalar y ejecutar versiones oficiales de Minecraft directamente desde los servidores de Mojang. Está pensado para entornos Node.js, idealmente con Electron, facilitando la creación de launchers personalizados mediante eventos que informan progreso, errores y logs en tiempo real.

Desarrollado por NovaStep Studios para ofrecer una experiencia robusta, flexible y fácil de integrar.

---

## Componentes principales

### MinecraftDownloader

Clase encargada de descargar todos los elementos necesarios para ejecutar Minecraft:

* Java Runtime (JVM) opcional, según versión requerida.
* Librerías necesarias.
* Assets (texturas, sonidos, etc.).
* Cliente principal (`client.jar`).
* Archivos nativos según sistema operativo (Windows, Linux, macOS).

#### Uso básico

```js
const path = require("path");
const { MinecraftDownloader } = require("minecraft-core-master");

const downloadPath = path.join(__dirname, "minecraft");
const downloader = new MinecraftDownloader(downloadPath, "Java17", "release");

downloader.on("progress", (msg) => console.log("[PROGRESO]", msg));
downloader.on("error", (err) => console.error("[ERROR]", err));

(async () => {
  try {
    await downloader.start("1.20.4"); // Versión a descargar
    console.log("Descarga completada.");
  } catch (error) {
    console.error("Error en la descarga:", error);
  }
})();
```

#### Constructor

| Parámetro     | Tipo     | Descripción                                      |
| ------------- | -------- | ------------------------------------------------ |
| `rootPath`    | `string` | Carpeta raíz donde se instalará Minecraft.       |
| `javaVer`     | `string` | Versión de Java requerida (ej: `"Java17"`).      |
| `versionType` | `string` | Tipo de versión: `"release"`, `"snapshot"`, etc. |

#### Eventos

* `"progress"`: Mensajes de progreso y estado.
* `"error"`: Errores durante la descarga.

---

### CustomInstaller

Clase para instalar mods populares (Forge u OptiFine) en una instalación Minecraft ya existente. No descarga Minecraft base, solo instala el mod en la ruta indicada.

#### Uso básico

```js
const { CustomInstaller } = require("minecraft-core-master");

const installer = new CustomInstaller("./Minecraft", "1.21.6-56.0.7", "Forge");

installer.on("progress", (data) => console.log("[Progreso]", data));
installer.on("done", (msg) => console.log("[✔]", msg));
installer.on("error", (err) => console.error("[❌]", err));

installer.start()
  .then(() => console.log("✅ Instalación completada"))
  .catch((err) => console.error("❌ Error crítico:", err));
```

#### Notas

* `destDir` es la carpeta donde está o estará Minecraft.
* `modType` puede ser `"Forge"` o `"Optifine"`.
* Requiere que Java esté instalado y disponible en PATH (para Forge).
* Solo instala el mod, no descarga Minecraft base.

---

### MinecraftExecutor

Clase para lanzar instancias de Minecraft con control completo y configuración avanzada.

#### Funcionalidades

* Valida y configura Java (ruta, flags JVM, memoria).
* Resuelve versión de Minecraft y sus componentes.
* Gestiona assets, librerías y nativos.
* Construye el classpath y los argumentos para ejecutar Minecraft.
* Emite logs stdout/stderr en tiempo real.
* Guarda logs de errores y crashes.
* Soporta mods y versiones personalizadas (Forge, OptiFine, NeoForge, Quilt, etc.).

#### Uso básico

```js
const { MinecraftExecutor } = require("minecraft-core-master");

(async () => {
  const executor = new MinecraftExecutor();

  await executor.start({
    root: "./Minecraft",
    javaPath: "java",
    memory: { max: "6G", min: "1G" },
    window: { width: 854, height: 480, fullscreen: false },
    version: { versionID: "1.20.4", type: "release" },
    user: {
      name: "Jugador123",
      uuid: "uuid-del-jugador",
      accessToken: "token-de-acceso",
    },
    jvm: ["-XX:+UseG1GC"], // Opcional, flags JVM extras
    mcArgs: [],            // Opcional, argumentos Minecraft extras
    debug: true,           // Opcional, activa logs detallados
  });

  executor.on("data", (data) => console.log("[MC STDOUT]", data));
  executor.on("error", (err) => console.error("[MC STDERR]", err));
  executor.on("close", (code) => console.log("Minecraft cerrado con código", code));
})();
```

#### Parámetros para `start(opts)`

| Propiedad  | Tipo                                                                 | Descripción                                |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------ |
| `root`     | `string`                                                             | Carpeta raíz con instalación de Minecraft. |
| `javaPath` | `string`                                                             | Ruta o nombre del ejecutable Java.         |
| `memory`   | `{ max: string, min: string }`                                       | Memoria máxima y mínima para la JVM.       |
| `window`   | `{ width: number, height: number, fullscreen: boolean }`             | Configuración de ventana del juego.        |
| `version`  | `{ versionID: string, type: string }`                                | Versión y tipo de Minecraft a lanzar.      |
| `user`     | `{ name: string, uuid: string, accessToken: string, type?: string }` | Información del usuario autenticado.       |
| `jvm`      | `string[]`                                                           | Flags adicionales para JVM.                |
| `mcArgs`   | `string[]`                                                           | Argumentos adicionales para Minecraft.     |
| `debug`    | `boolean`                                                            | Activar logs detallados para depuración.   |

#### Eventos emitidos

* `"data"`: salida estándar del juego.
* `"error"`: salida de error.
* `"close"`: código de cierre del proceso.

---

## Características técnicas

* Obtiene manifest y versiones oficiales directamente de Mojang.
* Descarga y valida client.jar, librerías, assets y nativos automáticamente.
* Detecta sistema operativo para descargar nativos correctos.
* Soporta extracción de archivos comprimidos (`.zip`, `.tar.gz`).
* Instalación automática opcional de Java si es necesario.
* Permite personalización completa de memoria, ventana, versión y usuario.
* Uso extensivo de eventos para notificar progreso, errores y logs.
* Próximamente, soporte nativo para modloaders (Forge, NeoForge, Fabric, OptiFine).

---

#### NovaStep Studios — Innovando la experiencia Minecraft en Electron
