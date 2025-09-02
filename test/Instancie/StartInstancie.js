const { MinecraftLauncher, Mojang } = require('../../dist/index');
const path = require('path');

(async () => {
  // 1) Crear launcher con lo básico (solo necesita saber dónde está Java)
  const launcher = new MinecraftLauncher({
    javaPath: 'C:/Program Files/Java/jre1.8.0_461/bin/javaw.exe'
  });

  // 2) Eventos para logs
  launcher.on('debug', (msg) => console.log('[DEBUG]', msg));
  launcher.on('warn', (msg) => console.warn('[WARN]', msg));
  launcher.on('error', (err) => console.error('[ERROR]', err));
  launcher.on('data', (msg) => console.log(msg));

  // 3) Iniciar Instancia
  try {
    await launcher.launchInstancie(
      path.resolve("./.minecraft"), // Ruta Base a Buscar
      "mi-instancia" // Nombre de la instancia a Iniciar
    );
  } catch (err) {
    console.error('Falló el lanzamiento:', err);
  }
})();
