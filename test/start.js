const { MinecraftLauncher, Mojang } = require('../dist/index');

(async()=>{
  const user = await Mojang.login("Stepnicka012"); // user ahora tiene el objeto devuelto
  console.log(user); // Para debug
  /**
   Mojang.login("Stepnicka012") => {
      access_token: '3cb84f07461800a947dffb283de26ac7',
      client_token: '3cb84f07461800a947dffb283de26ac7',
      uuid: '3cb84f07461800a947dffb283de26ac7',        
      name: 'Stepnicka012',
      user_properties: '{}',
      meta: { online: false, type: 'Mojang' }
    }
  */

  // Configuración del launcher
  const launcherOptions = {
    version: '1.21.8-OptiFine_HD_U_J6_pre16',                // Cambia por la versión que tengas
    root: './.minecraft',            // Carpeta donde está tu .minecraft
    javaPath: "C:/Program Files/Java/jdk-24/bin/javaw.exe"||'C:/Program Files/Java/jre1.8.0_461/bin/javaw.exe',
    jvmArgs: [], // Argumentos de JVM *Java* [ Opcional ]
    mcArgs:[], // Argumentos de Minecraft [ Opcional ]
    debug: true, // Modo Deubg [ Opcional ]
    memory:{
      min: "512M",
      max: "4G"
    },
    authenticator: user,
    window: {
      width: null,
      height: null,
      fullscreen: false
    }
  };

  // Crear instancia del launcher
  const launcher = new MinecraftLauncher(launcherOptions);

  // Eventos para logs
  launcher.on('debug', (msg) => console.log('[DEBUG]', msg));
  launcher.on('warn', (msg) => console.warn('[WARN]', msg));
  launcher.on('error', (err) => console.error('[ERROR]', err));
  launcher.on('data', (msg) => console.log(msg));

  try {
    await launcher.launch();
  } catch (err) {
    console.error('Falló el lanzamiento:', err);
  }
})();