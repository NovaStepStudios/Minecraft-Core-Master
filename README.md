![npm](./docs/icon.png)

# Minecraft-Core-Master

**Minecraft-Core-Master** es un conjunto modular escrito en JavaScript que permite descargar, instalar y ejecutar cualquier versión de Minecraft directamente desde los servidores oficiales de Mojang. Su arquitectura basada en eventos lo hace ideal para integrarse en **launchers personalizados** (como los desarrollados en **Electron**), con feedback visual de progreso y errores en tiempo real.

Desarrollado por **NovaStep Studios** con un enfoque en rendimiento, control total, personalización y compatibilidad total con versiones *legacy*, *modernas* y con modloaders populares.

---

## 🚀 Componentes principales

---

### 🧩 `MinecraftDownloader`

Clase que descarga todos los recursos necesarios para ejecutar Minecraft:

* 🔧 Java Runtime (JVM) oficial o personalizado.
* 📦 Librerías del juego.
* 🎨 Assets (texturas, sonidos, fuentes, etc.).
* 🧠 `client.jar`.
* 💻 Archivos nativos específicos para tu sistema operativo.

#### 🧪 Uso básico

```js
const path = require("path");
const { MinecraftDownloader } = require("minecraft-core-master");

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

| Parámetro     | Tipo               | Descripción                                                               |
| ------------- | ------------------ | ------------------------------------------------------------------------- |
| `rootPath`    | `string`           | Carpeta donde se descargará e instalará Minecraft.                        |
| `javaVer`     | `string / boolean` | `"auto"` o versión específica (`"Java8"`, `"Java17"`, `"Java21"`, false). |
| `versionType` | `string`           | `"release"`, `"snapshot"`, `"old_beta"`, `"old_alpha"`.                   |

#### 📡 Eventos

* `"progress"` → Estado textual en tiempo real.
* `"done"` → Descarga finalizada correctamente.
* `"error"` → Fallos críticos o interrupciones.

---

### 🛠️ `CustomInstaller`

Instala modloaders como **Forge** u **OptiFine** sobre una instalación existente de Minecraft.

#### 📦 Ejemplo de uso

```js
const { CustomInstaller } = require("minecraft-core-master");

const installer = new CustomInstaller("./Minecraft", "1.20.4-forge-47.2.0", "Forge");

installer.on("progress", (msg) => console.log("[Progreso]", msg));
installer.on("done", (msg) => console.log("[✔]", msg));
installer.on("error", (err) => console.error("[❌]", err));

installer.start()
  .then(() => console.log("✅ Instalación completada"))
  .catch((err) => console.error("❌ Error crítico:", err));
```

#### ℹ️ Notas

* La carpeta `destDir` debe tener una instalación válida de Minecraft.
* Requiere **Java en PATH** para instalar Forge.
* No descarga Minecraft base, solo inyecta el modloader deseado.

---

### 🎮 `MinecraftExecutor`

Clase que permite **lanzar Minecraft** con control total: configuración de memoria, ruta Java, ventana, argumentos, y sistema de logs y errores con persistencia.

#### 🚀 Ejemplo práctico

```js
const { MinecraftExecutor } = require("minecraft-core-master");

const executor = new MinecraftExecutor();

executor.on("data", (msg) => console.log("[MC STDOUT]", msg));
executor.on("error", (err) => console.error("[MC STDERR]", err));
executor.on("close", (code) => console.log("⚠️ Minecraft cerrado con código", code));

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
