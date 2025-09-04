/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */

import https from "https";
import fs from "fs";
import path from "path";

const VERSION_MANIFEST_URL = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";
async function download(url: string, timeout = 15000): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}, status code: ${res.statusCode}`));
        res.resume();
        return;
      }
      const data: Buffer[] = [];
      res.on("data", (chunk: Buffer) => data.push(chunk));
      res.on("end", () => resolve(Buffer.concat(data)));
    });
    req.on("error", reject);
    req.setTimeout(timeout, () => {
      req.destroy(new Error(`Request timeout after ${timeout}ms for ${url}`));
    });
  });
}
interface VersionInfo {
  id: string;
  url: string;
  [key: string]: any;
}
interface LoggingFile {
  url: string;
  id: string;
  size: number;
}
interface VersionJSON {
  logging?: {
    client?: {
      file?: LoggingFile;
    };
  };
  [key: string]: any;
}
export async function downloadLoggingXml(
  versionId: string,
  root: string,
  outputFolder?: string
): Promise<string | null> {
  if (!root) throw new Error("Se debe pasar el parámetro root");
  try {
    console.log(`Descargando manifiesto de versiones...`);
    const manifestData = await download(VERSION_MANIFEST_URL);
    const manifest = JSON.parse(manifestData.toString()) as { versions: VersionInfo[] };
    const manifestCachePath = path.join(root, "cache", "json");
    fs.mkdirSync(manifestCachePath, { recursive: true });
    const manifestFile = path.join(manifestCachePath, "manifest_v2.json");
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    console.log(`Manifest guardado en: ${manifestFile}`);
    const versionInfo = manifest.versions.find((v) => v.id === versionId);
    if (!versionInfo) throw new Error(`Versión ${versionId} no encontrada en el manifiesto`);
    console.log(`Descargando JSON de la versión ${versionId}...`);
    const versionJsonData = await download(versionInfo.url);
    const versionJson = JSON.parse(versionJsonData.toString()) as VersionJSON;
    if (!versionJson.logging?.client?.file) {
      console.log(`Versión ${versionId} no tiene logging XML. Saltando...`);
      return null;
    }
    const { url: xmlUrl, id: xmlName, size: xmlSize } = versionJson.logging.client.file;
    outputFolder = outputFolder || path.join(root, "logging");
    fs.mkdirSync(outputFolder, { recursive: true });
    console.log(`Directorio creado: ${outputFolder}`);
    console.log(`Descargando archivo XML de logging: ${xmlName} desde ${xmlUrl}...`);
    const xmlData = await download(xmlUrl);
    if (xmlData.length !== xmlSize) {
      console.log(`Tamaño del XML inesperado. Recibido: ${xmlData.length}, Esperado: ${xmlSize}. Saltando...`);
      return null;
    }
    const outputPath = path.join(outputFolder, xmlName);
    fs.writeFileSync(outputPath, xmlData);
    console.log(`Archivo XML guardado en: ${outputPath}`);
    return outputPath;
  } catch (error: any) {
    console.log(`Error al descargar logging XML para ${versionId}: ${error.message}`);
    console.log(`Continuando sin el archivo XML...`);
    return null;
  }
}
