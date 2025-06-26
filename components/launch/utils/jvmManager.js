const { exec } = require("child_process");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { platformName } = require("./platform");

/**
 * Recursively walk a directory yielding files that match the provided predicate.
 * @param {string} dir
 * @param {(full:string)=>boolean} filter
 * @param {string[]} acc
 * @returns {string[]}
 */
function walk(dir, filter, acc = []) {
  if (!fsSync.existsSync(dir)) return acc;
  for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, filter, acc);
    } else if (filter(full)) {
      acc.push(full);
    }
  }
  return acc;
}

class JVMManager {
  /**
   * Intenta resolver un binario de Java válido.
   * 1. Si se pasa un `candidate`, se valida directamente.
   * 2. Si falla, se buscan binarios típicos según SO y en $JAVA_HOME.
   * 3. Si se pasa `root`, también se escanea `${root}/runtime/** java adecuado*.
   * @param {string|undefined|null} candidate Ruta absoluta, relativa o nombre de binario ("java").
   * @param {string|undefined|null} root Carpeta raíz del launcher para escanear `runtime`.
   * @returns {Promise<string>} Ruta o comando utilizable para ejecutar Java.
   */
  static async resolve(candidate, root) {
    if (candidate) {
      const ok = await JVMManager.#validate(candidate);
      if (ok) return candidate;
    }

    const candidates = await JVMManager.#getCandidates(root);
    for (const p of candidates) {
      const ok = await JVMManager.#validate(p);
      if (ok) return p;
    }
    throw new Error("Java no encontrado");
  }

  /**
   * Valida si `p` apunta a un binario Java que se puede ejecutar.
   * Acepta rutas con separadores o comandos en PATH.
   * @private
   * @param {string} p
   * @returns {Promise<boolean>}
   */
  static async #validate(p) {
    const isPath = p.includes(path.sep);
    if (isPath) {
      try {
        await fs.access(p, fsSync.constants.X_OK);
      } catch {
        return false;
      }
    }
    return await new Promise(res => {
      exec(`${p} -version`, err => res(!err));
    });
  }

  /**
   * Genera una lista de posibles rutas/comandos donde encontrar Java.
   * Incluye PATH/JAVA_HOME, ubicaciones típicas del SO y `${root}/runtime/**bin/java.
   * @private
   * @param {string|undefined|null} root
   * @returns {Promise<string[]>}
   */
  static async #getCandidates(root) {
    const list = [];
    const plat = platformName();

    // --- JAVA_HOME ---
    if (process.env.JAVA_HOME) {
      const bin = path.join(
        process.env.JAVA_HOME,
        plat === "windows" ? "bin\\java.exe" : "bin/java"
      );
      list.push(bin);
    }

    // --- PATH ---
    list.push("java");
    if (plat === "windows") list.push("java.exe");

    // --- SO-specific installs ---
    switch (plat) {
      case "windows": {
        for (const base of [
          "C:\\Program Files\\Java",
          "C:\\Program Files (x86)\\Java",
        ]) {
          if (!fsSync.existsSync(base)) continue;
          for (const dir of fsSync.readdirSync(base)) {
            const bin = path.join(base, dir, "bin", "java.exe");
            list.push(bin);
          }
        }
        break;
      }
      case "linux":
      case "darwin": {
        list.push("/usr/bin/java", "/usr/local/bin/java");
        const jvmDir = "/usr/lib/jvm";
        if (fsSync.existsSync(jvmDir)) {
          for (const dir of fsSync.readdirSync(jvmDir)) {
            list.push(path.join(jvmDir, dir, "bin", "java"));
          }
        }
        break;
      }
    }

    // --- runtime dentro del launcher ---
    if (root) {
      const runtimeDir = path.join(root, "runtime");
      const filter = (f) =>
        /\\bin\\java(?:\.exe)?$/.test(f) || /\/bin\/java$/.test(f);
      walk(runtimeDir, filter, list);
    }

    // Eliminar duplicados preservando orden
    return Array.from(new Set(list));
  }
}

module.exports = { JVMManager };