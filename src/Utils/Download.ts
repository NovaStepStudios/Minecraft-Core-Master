/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */

import fs from 'fs';
import path from 'path';
import https from 'https';

/**
 * Descarga un archivo desde una URL y lo guarda en la ruta indicada.
 * Crea las carpetas necesarias si no existen.
 * Permite callback de progreso.
 * @param url URL del archivo a descargar
 * @param destination Ruta local donde guardar el archivo
 * @param onProgress Callback opcional: recibe bytes descargados y total
 */
export async function fromURL(
  url: string,
  destination: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.promises.mkdir(path.dirname(destination), { recursive: true })
      .then(() => {
        const file = fs.createWriteStream(destination);

        https.get(url, (res) => {
          if (res.statusCode !== 200) {
            file.close();
            return reject(new Error(`Error al descargar: HTTP ${res.statusCode} -> ${url}`));
          }

          const totalSize = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            if (onProgress) onProgress(downloaded, totalSize);
          });

          res.pipe(file);

          file.on('finish', () => {
            file.close();
            resolve();
          });

          file.on('error', (err) => {
            file.close();
            fs.unlink(destination, () => reject(err));
          });

        }).on('error', (err) => {
          fs.unlink(destination, () => reject(err));
        });
      })
      .catch(reject);
  });
}

/**
 * Descarga un JSON desde una URL y lo devuelve parseado.
 * @param url URL del JSON
 */
export async function downloadJSON<T = any>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} -> ${url}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}
