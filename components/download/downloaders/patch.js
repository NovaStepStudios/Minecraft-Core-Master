// verifyAll.js

const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const https = require("https");
const unzipper = require("unzipper");

const platform = process.platform === "win32" ? "windows" :
                 process.platform === "darwin" ? "osx" : "linux";

const debug = (...args) => console.log("[Verifier]", ...args);

const exists = async (f) => {
  try { await fs.access(f); return true; } catch { return false; }
};

const compareVersions = (a, b) =>
  a.split('.').map(Number).reduce((acc, cur, i) => acc || cur - (b.split('.')[i] || 0), 0);

const reconstructArtifact = (name) => {
  const [group, artifact, version] = name.split(":");
  if (!version) return null;
  const basePath = `${group.replace(/\./g, "/")}/${artifact}/${version}`;
  const jarName = `${artifact}-${version}.jar`;
  return {
    url: `https://libraries.minecraft.net/${basePath}/${jarName}`,
    path: `${basePath}/${jarName}`,
  };
};

const downloadFile = async (url, dest) => {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  return new Promise((resolve, reject) => {
    const stream = fsSync.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200)
        return reject(new Error(`HTTP ${res.statusCode}`));
      res.pipe(stream);
      stream.on("finish", () => stream.close(resolve));
      stream.on("error", reject);
    }).on("error", reject);
  });
};

const jarHasClass = async (jarPath, className) => {
  try {
    const zip = fsSync.createReadStream(jarPath).pipe(unzipper.Parse({ forceStream: true }));
    for await (const entry of zip) {
      if (entry.path === className) return true;
      entry.autodrain();
    }
  } catch {}
  return false;
};

const extractNativeFiles = async (jarPath, destination) => {
  const stream = fsSync.createReadStream(jarPath).pipe(unzipper.Parse({ forceStream: true }));
  for await (const entry of stream) {
    if (
      entry.type === "File" &&
      !entry.path.includes("META-INF") &&
      entry.path.match(/\.(dll|so|dylib|jnilib)$/i)
    ) {
      const destPath = path.join(destination, path.basename(entry.path));
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await new Promise((res, rej) => {
        entry.pipe(fsSync.createWriteStream(destPath)).on("close", res).on("error", rej);
      });
    } else {
      entry.autodrain();
    }
  }
};

const checkRules = (lib, platformName) => {
  if (!lib.rules) return true;
  let allowed = false;
  for (const rule of lib.rules) {
    if (!rule.os || rule.os.name === platformName)
      allowed = rule.action === "allow";
  }
  return allowed;
};

const loadVersionJson = async (id, rootDir) => {
  const file = path.join(rootDir, "versions", id, `${id}.json`);
  try {
    const content = await fs.readFile(file, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    debug(`❌ Error cargando JSON de ${id}:`, err.message);
    return null;
  }
};

const mergeLibraries = (base, override) => {
  const map = new Map(base.map((l) => [l.name, l]));
  for (const l of override) map.set(l.name, l);
  return [...map.values()];
};

const downloadAssets = async (rootDir, versionData, debugFn, platformName) => {
  const versionId = versionData.id || versionData.inheritsFrom || "";
  const [major, minor, patch] = versionId.split('.').map(n => parseInt(n) || 0);
  const isLegacy = (major < 1) || (major === 1 && minor < 6) || (major === 1 && minor === 6 && patch < 1);

  const assetsDir = isLegacy
    ? path.join(rootDir, "assets", "virtual", "legacy")
    : path.join(rootDir, "assets");

  let indexId = versionData.assetIndex?.id;
  let indexUrl = versionData.assetIndex?.url;

  if (!indexId || !indexUrl) {
    const inherits = versionData.inheritsFrom;
    if (!inherits) throw new Error("No hay assetIndex definido.");
    const baseJson = path.join(rootDir, "versions", inherits, `${inherits}.json`);
    const raw = await fs.readFile(baseJson, "utf-8");
    const base = JSON.parse(raw);
    indexId = base.assetIndex?.id;
    indexUrl = base.assetIndex?.url;
    if (!indexId || !indexUrl) throw new Error(`Tampoco se pudo heredar assetIndex de ${inherits}`);
  }

  const indexPath = path.join(assetsDir, "indexes", `${indexId}.json`);
  if (!(await exists(indexPath))) {
    debugFn(`📥 Descargando asset index: ${indexId}`);
    await downloadFile(indexUrl, indexPath);
  }

  const rawIndex = await fs.readFile(indexPath, "utf-8");
  const indexData = JSON.parse(rawIndex);
  const objects = indexData.objects;
  const total = Object.keys(objects).length;
  let done = 0;

  for (const [key, { hash }] of Object.entries(objects)) {
    const subdir = hash.substring(0, 2);
    const remote = `https://resources.download.minecraft.net/${subdir}/${hash}`;
    const local = path.join(assetsDir, "objects", subdir, hash);
    if (!(await exists(local))) {
      await downloadFile(remote, local);
      debugFn(`📦 Asset descargado: ${key}`);
    }
    done++;
  }

  debugFn(`🎉 Assets verificados: ${done}/${total}`);
};

async function verifyVersion(rootDir, versionId) {
  const debugFn = debug;
  const platformName = platform;

  debugFn(`🔍 Verificando librerías, nativos y assets para ${versionId}`);
  const versionData = await loadVersionJson(versionId, rootDir);
  if (!versionData) return;

  let libs = versionData.libraries || [];
  if (versionData.inheritsFrom) {
    const inherited = await loadVersionJson(versionData.inheritsFrom, rootDir);
    if (inherited?.libraries) {
      debugFn(`📚 Heredando librerías desde ${versionData.inheritsFrom}`);
      libs = mergeLibraries(inherited.libraries, libs);
    }
  }

  libs = libs.filter(lib => checkRules(lib, platformName));

  const libMap = new Map();
  for (const lib of libs) {
    const [group, artifact, version] = lib.name.split(":");
    if (!artifact || !version) continue;
    const key = `${group}:${artifact}`;
    const existing = libMap.get(key);
    if (!existing || compareVersions(version, existing.name.split(":")[2]) > 0) {
      libMap.set(key, lib);
    }
  }

  const uniqueLibs = Array.from(libMap.values());
  const nativesToExtract = [];

  for (const lib of uniqueLibs) {
    const artifact = lib.downloads?.artifact || reconstructArtifact(lib.name);
    if (!artifact) {
      debugFn(`⚠️ No se pudo reconstruir artifact para ${lib.name}`);
      continue;
    }

    const fullPath = path.join(rootDir, "libraries", artifact.path);
    if (!(await exists(fullPath))) {
      debugFn(`⬇️ Descargando ${lib.name}...`);
      try {
        await downloadFile(artifact.url, fullPath);
      } catch (e) {
        debugFn(`❌ Error al descargar ${lib.name}: ${e}`);
        continue;
      }
    } else {
      debugFn(`✅ ${lib.name} ya presente`);
    }

    if (lib.name.startsWith("net.minecraftforge:forge")) {
      const hasTweaker = await jarHasClass(fullPath, "cpw/mods/fml/common/launcher/FMLTweaker.class");
      debugFn(hasTweaker ? `🔧 Forge OK (${lib.name})` : `⚠️ Forge inválido: FMLTweaker no encontrado`);
    }

    if (lib.natives && lib.natives[platformName]) {
      const classifier = lib.natives[platformName];
      const nativeArtifact = lib.downloads?.classifiers?.[classifier];
      if (nativeArtifact) {
        const nativePath = path.join(rootDir, "libraries", nativeArtifact.path);
        if (!(await exists(nativePath))) {
          debugFn(`⬇️ Descargando nativo ${lib.name}`);
          await downloadFile(nativeArtifact.url, nativePath);
        }
        nativesToExtract.push({ path: nativePath, name: lib.name });
      }
    }
  }

  const nativesDir = path.join(rootDir, "natives", versionId);
  await fs.mkdir(nativesDir, { recursive: true });

  for (const native of nativesToExtract) {
    try {
      await extractNativeFiles(native.path, nativesDir);
      debugFn(`🧩 Extraídos nativos de ${native.name}`);
    } catch (e) {
      debugFn(`❌ Error extrayendo nativos: ${e.message}`);
    }
  }

  await downloadAssets(rootDir, versionData, debugFn, platformName);

  debugFn("✅ Verificación COMPLETA.");
}

module.exports = { verifyVersion };

// Ejecución CLI (opcional)
if (require.main === module) {
  const versionId = process.argv[2];
  if (!versionId) {
    console.error("❌ Debes pasar un ID de versión. Ejemplo:");
    console.error("   node verifyAll.js 1.7.10");
    process.exit(1);
  }
  const rootDir = path.resolve("./Minecraft");
  verifyVersion(rootDir, versionId).catch(e => {
    console.error("Error durante la verificación:", e);
  });
}
