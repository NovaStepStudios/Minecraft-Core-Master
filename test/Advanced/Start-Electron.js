const path = require('path');
const crypto = require('crypto');
const { MinecraftLauncher, Microsoft } = require('../../dist/index'); // Tu launcher

(async () => {
  try {
    console.log('Iniciando login con Microsoft...');

    // 1️⃣ Instancia de Microsoft
    const mcMicrosoft = new Microsoft('');

    // 2️⃣ Login
    const auth = await mcMicrosoft.getAuth('electron'); // 'electron' si estás en Electron

    if (!auth || auth.error) {
      console.error('Login fallido:', auth?.error ?? 'cancelado');
      return;
    }

    console.log('Login exitoso con Microsoft/Xbox:', auth.profile.name);

    // 3️⃣ Obtener el perfil de Minecraft
    const profile = auth.profile;

    // ⚠️ Evitamos problemas con skins/capes
    profile.skins.forEach(s => delete s.base64);
    profile.capes.forEach(c => delete c.base64);

    // 4️⃣ Crear objeto de autenticación para el launcher
    const authenticator = {
      access_token: auth.access_token,                  // Token real de Minecraft
      client_token: auth.client_token || crypto.randomBytes(16).toString('hex'),
      uuid: profile.id,                                 // UUID de Minecraft
      name: profile.name,                               // Nombre del jugador
      user_properties: '{}',
      meta: { online: true, type: 'msa' },             // Cuenta Microsoft
    };

    console.log('Perfil Minecraft:', profile.name);
    console.log('Skins disponibles:', profile.skins.length);
    console.log('Capes disponibles:', profile.capes.length);

    // 5️⃣ Lanzar Minecraft
    const launcher = new MinecraftLauncher({
      version: '1.12.2',
      gameDir: path.resolve('./.minecraft'),
      javaPath: 'java', // Recomiendo poner la ruta exacta a Java 8
      authenticator,
      memory: { min: '2G', max: '4G' },
      screen: { width: 1280, height: 720 },
    });

    // 6️⃣ Escuchar eventos
    launcher.on('info', console.log);
    launcher.on('progress', console.log);
    launcher.on('warn', console.warn);
    launcher.on('error', console.error);
    launcher.on('data', (child) => {
      console.log('Minecraft listo para ejecutar');
      child.on('close', (code) => console.log('Minecraft cerrado con código:', code));
    });

    console.log('Lanzando Minecraft...');
    await launcher.launch();

  } catch (err) {
    console.error('Ocurrió un error inesperado:', err);
  }
})();
