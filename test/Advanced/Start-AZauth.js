const { MinecraftLauncher, Mojang, NovaAZauth } = require('../../dist/index');
const path = require('path');

// ---------------- CONFIG ----------------
const GAME_DIR = path.resolve('./.minecraft');
const VERSION = '1.12.2';
const JAVA_PATH = 'C:/Program Files/Java/jre1.8.0_461/bin';

(async () => {
  try {
    console.log('Iniciando launcher...');


    // Login con AZauth (opcional si quieres usarlo también)
    const azAuthInstance = new NovaAZauth('https://novastep-studios.web.app/mcm/users'); // tu servidor AZauth
    const azUser = await azAuthInstance.login('Stepnicka012', '12345');
    if (azUser.error) {
      console.error('Error AZauth:', azUser.reason, azUser.message);
      return;
    }
    console.log('Login AZauth exitoso:', azUser.name);

    // Configuración del launcher
    const launcher = new MinecraftLauncher({
      version: VERSION,
      gameDir: GAME_DIR,
      javaPath: JAVA_PATH,
      authenticator: azUser,
      memory: { min: '1G', max: '4G' }, 
    });

    // 4️⃣ Eventos del launcher
    launcher.on('info', (msg) => console.log('[INFO]', msg));
    launcher.on('progress', (msg) => console.log('[PROGRESS]', msg));
    launcher.on('warn', (msg) => console.warn('[WARN]', msg));
    launcher.on('error', (err) => console.error('[ERROR]', err));
    launcher.on('data', (child) => {
      console.log('[DATA] Minecraft listo para ejecutar');
      child.on('close', (code) => {
        console.log('Minecraft cerrado con código:', code);
      });
    });

    await launcher.launch();

  } catch (err) {
    console.error('Falló el lanzamiento:', err);
  }
})();
