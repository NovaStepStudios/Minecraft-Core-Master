const path = require('path');
const { MinecraftLauncher, Microsoft } = require('../../dist/index'); // Tu launcher

(async () => {
  try {
    console.log('Iniciando login con Microsoft...');

    // 1️⃣ Instancia de Microsoft
    const mcMicrosoft = new Microsoft('1450fa4a-a575-4178-a753-41d4642ebbd0');

    // 2️⃣ Login
    const auth = await mcMicrosoft.getAuth('terminal'); // 'electron' si estás en Electron

    if (!auth || auth.error) {
      console.error('Login falló:', auth?.error ?? 'cancelado');
      return;
    }
    console.log('Login exitoso con Microsoft/Xbox:', auth.name);

    // 3️⃣ Obtener el perfil de Minecraft
    const profile = await mcMicrosoft.getProfile({ access_token: auth.access_token });
    if ('error' in profile) {
      console.error('Error obteniendo perfil de Minecraft:', profile.error);
      return;
    }

    // 4️⃣ Crear objeto de autenticación para el launcher
    const authenticator = {
      access_token: auth.access_token, // token de sesión
      client_token: auth.client_token ?? auth.uuid, // fallback por si no lo da MS
      uuid: profile.id, // UUID real de la cuenta
      name: profile.name, // nombre del jugador
      user_properties: '{}',
      meta: { online: true, type: 'msa' }, // 'msa' = Microsoft Account
    };

    console.log('Perfil Minecraft:', profile.name);
    console.log('Skins disponibles:', profile.skins.length);
    console.log('Capes disponibles:', profile.capes.length);

    // 5️⃣ Lanzar Minecraft
    const launcher = new MinecraftLauncher({
      version: '1.12.2',
      gameDir: path.resolve('./.minecraft'),
      javaPath: 'java',
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

    await launcher.launch();

  } catch (err) {
    console.error('Ocurrió un error:', err);
  }
})();
