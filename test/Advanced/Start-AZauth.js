const { MinecraftLauncher, Mojang, AZauth } = require('../../dist/index');
const path = require('path');

// ---------------- CONFIG ----------------
const GAME_DIR = path.resolve('./.minecraft');
const VERSION = '1.12.2';
const JAVA_PATH = 'java'; // O ruta completa a tu JDK/JRE
// ---------------------------------------

(async () => {
  try {
    console.log('Iniciando launcher...');

    // 1️⃣ Login con Mojang
    const mojangAuth = await Mojang.login('tuEmail@m.com', 'tuPassword');
    if (mojangAuth.error) {
      console.error('Error al loguear con Mojang:', mojangAuth.reason, mojangAuth.message);
      return;
    }
    console.log('Login Mojang exitoso:', mojangAuth.name);

    // 2️⃣ Login con AZauth (opcional si quieres usarlo también)
    const azAuthInstance = new AZauth('https://tuservidor.com'); // tu servidor AZauth
    const azUser = await azAuthInstance.login('username', 'password');
    if (azUser.error) {
      console.error('Error AZauth:', azUser.reason, azUser.message);
      return;
    }
    console.log('Login AZauth exitoso:', azUser.name);

    // 3️⃣ Configuración del launcher
    const launcher = new MinecraftLauncher({
      version: VERSION,
      gameDir: GAME_DIR,
      javaPath: JAVA_PATH,
      authenticator: mojangAuth, // Puedes cambiar a azUser si quieres usar AZauth
      memory: { min: '1G', max: '4G' },
      screen: { width: 1280, height: 720 },
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

    // 5️⃣ Lanzar Minecraft
    await launcher.launch();

  } catch (err) {
    console.error('Falló el lanzamiento:', err);
  }
})();
