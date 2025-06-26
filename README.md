![npm](./docs/icon.png)

# Minecraft-Core-Master

<<<<<<< HEAD
**Minecraft-Core-Master** es un conjunto modular escrito en JavaScript diseñado para descargar, instalar y ejecutar cualquier versión de Minecraft directamente desde los servidores oficiales de Mojang. Su arquitectura basada en eventos lo hace ideal para integrarse en **launchers personalizados**, especialmente aquellos desarrollados en **Electron**, con feedback visual de progreso y errores en tiempo real.

Desarrollado por **NovaStep Studios** con un enfoque en rendimiento, control total, personalización y compatibilidad total con versiones *legacy*, *modernas* y modloaders populares.

---

## 🚀 Componentes principales

---

### 🧩 `MinecraftDownloader`
=======
**Minecraft-Core-Master** es un conjunto modular en JavaScript para descargar, instalar y ejecutar versiones oficiales de Minecraft directamente desde los servidores de Mojang. Está pensado para entornos Node.js, idealmente con Electron, facilitando la creación de launchers personalizados mediante eventos que informan progreso, errores y logs en tiempo real.

Desarrollado por NovaStep Studios para ofrecer una experiencia robusta, flexible y fácil de integrar.

---

## Componentes principales
>>>>>>> Minecraft-Core-Master/main

Clase que descarga todos los recursos necesarios para ejecutar Minecraft:

<<<<<<< HEAD
* 🔧 Java Runtime (JVM) oficial o personalizado.
* 📦 Librerías del juego.
* 🎨 Assets (texturas, sonidos, fuentes, etc.).
* 🧠 `client.jar`.
* 💻 Archivos nativos específicos para tu SO (Linux, Windows, macOS).

#### 🧪 Uso básico
=======
Clase encargada de descargar todos los elementos necesarios para ejecutar Minecraft:

* Java Runtime (JVM) opcional, según versión requerida.
* Librerías necesarias.
* Assets (texturas, sonidos, etc.).
* Cliente principal (`client.jar`).
* Archivos nativos según sistema operativo (Windows, Linux, macOS).

#### Uso básico
>>>>>>> Minecraft-Core-Master/main

```js
const path = require("path");
const { MinecraftDownloader } = require("minecraft-core-master");

<<<<<<< HEAD
const downloader = new MinecraftDownloader(path.join(__dirname, "minecraft"), "auto", "release");

downloader.on("progress", (msg) => console.log("[PROGRESO]", msg));
downloader.on("done", (msg) => console.log("[✔]", msg));
downloader.on("error", (err) => console.error("[❌]", err));

(async () => {
  try {
    await downloader.start("1.20.4");
    console.log("✅ Descarga completada.");
  } catch (e) {
    console.error("❌ Error en la descarga:", e);
  }
})();
```

#### 🔧 Constructor
=======
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
>>>>>>> Minecraft-Core-Master/main

| Parámetro     | Tipo     | Descripción                                                              |
| ------------- | -------- | ------------------------------------------------------------------------ |
| `rootPath`    | `string` | Carpeta donde se descargará e instalará Minecraft.                       |
| `javaVer`     | `string / booleano` | `"auto"` o versión específica (`"Java8"`, `"Java17"`, `"Java21"`, false.). |
| `versionType` | `string` | Tipo de versión: `"release"`, `"snapshot"`, `"old_beta"`, `"old_alpha"`. |

<<<<<<< HEAD
#### 📡 Eventos

* `"progress"` → Estado textual en tiempo real.
* `"done"` → Descarga finalizada correctamente.
* `"error"` → Fallos críticos o interrupciones.

---

### 🛠️ `CustomInstaller`

Instala modloaders como **Forge** u **OptiFine** sobre una instalación existente de Minecraft.

#### 📦 Ejemplo de uso
=======
* `"progress"`: Mensajes de progreso y estado.
* `"error"`: Errores durante la descarga.

---

### CustomInstaller

Clase para instalar mods populares (Forge u OptiFine) en una instalación Minecraft ya existente. No descarga Minecraft base, solo instala el mod en la ruta indicada.

#### Uso básico
>>>>>>> Minecraft-Core-Master/main

```js
const { CustomInstaller } = require("minecraft-core-master");

<<<<<<< HEAD
const installer = new CustomInstaller("./Minecraft", "1.20.4-forge-47.2.0", "Forge");

installer.on("progress", (msg) => console.log("[Progreso]", msg));
installer.on("done", (msg) => console.log("[✔]", msg));
installer.on("error", (err) => console.error("[❌]", err));

=======
const installer = new CustomInstaller("./Minecraft", "1.21.6-56.0.7", "Forge");

installer.on("progress", (data) => console.log("[Progreso]", data));
installer.on("done", (msg) => console.log("[✔]", msg));
installer.on("error", (err) => console.error("[❌]", err));

>>>>>>> Minecraft-Core-Master/main
installer.start()
  .then(() => console.log("✅ Instalación completada"))
  .catch((err) => console.error("❌ Error crítico:", err));
```

<<<<<<< HEAD
#### ℹ️ Notas

* La carpeta `destDir` debe tener una instalación válida de Minecraft.
* Requiere **Java en PATH** para instalar Forge.
* No descarga Minecraft base, solo inyecta el modloader deseado.

---

### 🎮 `MinecraftExecutor`

Clase que permite **lanzar Minecraft** con control total: configuración de memoria, ruta Java, ventana, argumentos, y sistema de logs y errores con persistencia.

#### 🚀 Ejemplo práctico
=======
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
>>>>>>> Minecraft-Core-Master/main

```js
const { MinecraftExecutor } = require("minecraft-core-master");

const executor = new MinecraftExecutor();

<<<<<<< HEAD
executor.on("data", (msg) => console.log("[MC STDOUT]", msg));
executor.on("error", (err) => console.error("[MC STDERR]", err));
executor.on("close", (code) => console.log("⚠️ Minecraft cerrado con código", code));
=======
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
>>>>>>> Minecraft-Core-Master/main

executor.start({
  root: "./.minecraft",
  version: { versionID: "1.20.4", type: "release" },
  authenticator: {
    username: "Steve", // Obligatorio
    password: null     // Opcional: para cuentas Mojang
  },
  javaPath: "java", // Opcional
  memory: { max: "4G", min: "1G" },
  window: { width: 1280, height: 720, fullscreen: false },
  mcArgs: ["--demo"], // Opcional
  jvm: ["-XX:+DisableAttachMechanism"], // Opcional
  overrides: { gameDirectory: "./.minecraft/custom" }, // Opcional
  debug: true,
});
```

<<<<<<< HEAD
#### ⚙️ Argumentos disponibles en `start(opts)`

| Campo           | Tipo                                                  | Descripción                                                     |
| --------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `root`          | `string`                                              | Carpeta raíz del juego.                                         |
| `javaPath`      | `string`                                              | Ruta a `java` (opcional, se autodetecta si no está).            |
| `memory`        | `{ min: string, max: string }`                        | Memoria asignada.                                               |
| `window`        | `{ width: number, height: number, fullscreen: bool }` | Tamaño de ventana.                                              |
| `version`       | `{ versionID: string, type: string }`                 | Versión de Minecraft a lanzar.                                  |
| `authenticator` | `{ username: string, password?: string }`             | Usuario Mojang u offline.                                       |
| `jvm`           | `string[]`                                            | Argumentos JVM adicionales.                                     |
| `mcArgs`        | `string[]`                                            | Argumentos adicionales para Minecraft.                          |
| `overrides`     | `object`                                              | Sobrescribe directorios como `assetsDir`, `gameDirectory`, etc. |
| `debug`         | `boolean`                                             | Muestra logs detallados.                                        |

#### 📁 Logs y errores

* Guarda logs en `root/temp/stepLauncher_crash_*.log` ante errores críticos.
* Toda la salida estándar y de error se puede redireccionar en tiempo real vía eventos.

---

## 📜 Scripts de prueba recomendados

Ejecutá desde `examples/` un test básico del launcher:

```bash
node examples/MinecraftDownloader.js      # Descarga Minecraft
node examples/MinecraftExecutor.js        # Lanza Minecraft
```

Cada archivo incluye pruebas reales con eventos de progreso, error y finalización.

---

## 🧪 Características técnicas destacadas

* ✅ Descarga oficial desde Mojang con validación de integridad.
* ✅ Compatible con **todas las versiones** de Minecraft: release, snapshot, beta, alpha.
* ✅ Instalación modular y reutilizable para launchers propios.
* ✅ Uso extensivo de `EventEmitter` para integración con GUI o CLI.
* ✅ Soporte para sistemas Linux, Windows y macOS.
* ✅ Próximamente: integración directa con Fabric, NeoForge y Quilt.

---

## 🏢 NovaStep Studios

**Desarrollado con pasión y precisión por Santiago Stepnicka (a.k.a. Stepnicka)**
🎯 Transformando launchers de Minecraft en plataformas profesionales.
=======
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
>>>>>>> Minecraft-Core-Master/main
