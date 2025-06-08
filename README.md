![npm](./icon.png)

# Minecraft-Core-Master

**Minecraft-Core-Master** es una clase JavaScript que permite descargar versiones oficiales de Minecraft directamente desde los servidores oficiales de Mojang. Gestiona la descarga de:

* La versión específica de Minecraft (release o snapshot)
* Las librerías necesarias
* Los assets (recursos gráficos y sonidos)
* Los archivos nativos necesarios para el sistema operativo actual (Windows, Linux)
* La instalación opcional de Java (JVM)

El paquete está diseñado para usarse dentro de aplicaciones Node.js, especialmente en entornos Electron, y utiliza eventos para comunicar el progreso y posibles errores, lo que facilita su integración en interfaces gráficas.

**Creado por:** NovaStep Studios (empresa de desarrollo enfocada en mejorar la experiencia de usuario en aplicaciones Electron)
---

# Ejemplo básico de uso

```js
const path = require("path");
const { MinecraftDownloader } = require("minecraft-core-master");

// Directorio donde se descargará Minecraft
const downloadPath = path.join(__dirname, "minecraft");

// Crear instancia del downloader
const downloader = new MinecraftDownloader(downloadPath, true, "release");

// Escuchar eventos para mostrar progreso y errores
downloader.on("progress", (msg) => {
  console.log("[PROGRESO]", msg);
});

downloper.on("error", (err) => {
  console.error("[ERROR]", err);
});

downloader.on("done", (msg) => {
  console.log("[COMPLETADO]", msg);
});

// Descargar la versión más reciente tipo release
downloader.download();
```
# Parametros

---

### Parámetros de `new Minecraft-Core-Master(path, autoInstallJava, versionType)`

| Parámetro         | Tipo      | Obligatorio | Descripción                                                                                                                                                         |
| ----------------- | --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`            | `string`  | ✅ Sí        | Ruta absoluta o relativa donde se instalarán los archivos de Minecraft. Ejemplo: `"./minecraft"`.                                                                   |
| `autoInstallJava` | `boolean` | ✅ Sí        | Si es `true`, intentará instalar automáticamente una versión compatible de Java (JVM) si no existe. Si es `false`, se asume que el sistema ya tiene Java instalado. |
| `versionType`     | `string`  | ✅ Sí        | Tipo de versión a descargar si no se especifica una con `.download()`. Puede ser: `"release"`, `"snapshot"`, `"old_beta"`, `"old_alpha"`, etc.                      |

---

### Métodos disponibles

#### `.download(version?: string)`

* **`version`** *(opcional)*: Si se pasa, se descargará esa versión específica de Minecraft. Si se omite, se descargará la última versión del tipo indicado (por ejemplo, `"release"`).
* Retorna: `Promise<void>` (puede ser escuchado con eventos para saber cuándo termina).

---

### Eventos disponibles

Puedes escuchar estos eventos usando `.on(event, callback)`:

| Evento       | Parámetros | Descripción                                                                                 |
| ------------ | ---------- | ------------------------------------------------------------------------------------------- |
| `"progress"` | `string`   | Progreso actual del proceso, como descarga de librerías, assets, nativos, etc.              |
| `"error"`    | `Error`    | Si ocurre un error durante cualquier parte de la descarga.                                  |
| `"done"`     | `string`   | Se emite cuando se ha completado exitosamente la descarga de todos los archivos necesarios. |


---

# Descargar una versión específica (ejemplo: 1.19.3)

```js
const {MinecraftDownloader} = require("minecraft-core-master");

const downloader = new MinecraftDownloader("./minecraft", false, "release");

downloader.on("progress", console.log);
downloader.on("error", console.error);
downloader.on("done", console.log);

downloader.download("1.19.3");
```

---

# Descripción técnica resumida

* Usa el manifiesto oficial de Mojang para obtener la lista y detalles de versiones.
* Descarga el client.jar, librerías, assets y nativos según la versión y OS.
* Soporta Windows, macOS y Linux detectando automáticamente el sistema operativo.
* Extrae archivos `.zip` y `.tar.gz` donde corresponda.
* Implementa un sistema de eventos (`progress`, `error`, `done`) para manejar comunicación asíncrona.
* Permite descargar Java (JVM) para garantizar la ejecución correcta del juego.
* Configurable vía un archivo `config.json` para rutas y extras.

---
#### Proximamente podra descargar neoforge, fabric, forge, optifine, clients/modloaders