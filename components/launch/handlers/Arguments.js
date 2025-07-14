const path = require('path');
const os = require('os');

const platformMap = {
  win32: 'windows',
  linux: 'linux',
  darwin: 'osx'
};

function isRuleAllowed(rules) {
  if (!rules || rules.length === 0) return true;

  const platform = platformMap[os.platform()] || os.platform();

  // Evalúa todas las reglas y la última que coincida con el SO decide
  let allowed = false;
  for (const rule of rules) {
    const osRule = rule.os?.name;
    if (!osRule || osRule === platform) {
      allowed = rule.action === 'allow';
    }
  }
  return allowed;
}

const replaceVars = (input, vars) => {
  if (typeof input !== 'string') return input;

  return input.replace(/\${([^}]+)}/g, (_, key) => {
    if (key in vars) return vars[key];
    console.warn(`[Minecraft-Core] Variable no encontrada: ${key}`);
    return '';
  });
};

module.exports = {
  build({ opts, version, auth, classPath }) {
    const args = [];

    // ===== JVM ARGUMENTS =====
    const memory = opts.memory || {};
    const maxMem = memory.max || '2G';
    const minMem = memory.min || '512M';

    args.push(`-Xmx${maxMem}`);
    args.push(`-Xms${minMem}`);

    // Rutas absolutas para natives (carpeta dentro de root)
    const nativesPath = path.resolve(opts.root, 'natives', version.id);
    args.push(`-Djava.library.path=${nativesPath}`);
    args.push(`-Dorg.lwjgl.librarypath=${nativesPath}`);

    const requiresJava8 = version.javaVersion?.majorVersion === 8;
    if (!requiresJava8) {
      args.push('--enable-native-access=ALL-UNNAMED');
    }

    if (Array.isArray(opts.jvmFlags)) {
      args.push(...opts.jvmFlags);
    }

    // ===== CLASSPATH =====
    args.push('-cp', classPath.join(path.delimiter));

    // ===== MAIN CLASS =====
    const mainClass = version.mainClass || 'net.minecraft.client.main.Main';
    args.push(mainClass);

    // ===== GAME ARGUMENTS =====

    // Detectar carpeta assets vs resources
    const assetDir = (version.assets === 'legacy' || version.assets === 'resources')
      ? 'resources'
      : 'assets';

    const assetsRootPath = path.resolve(opts.root, assetDir);

    // Variables para reemplazo en argumentos
    const vars = {
      auth_player_name: auth.name,
      version_name: version.id,
      game_directory: path.resolve(opts.root),
      assets_root: assetsRootPath,
      assets_index_name: version.assets || version.assetIndex?.id || 'legacy',
      auth_uuid: auth.uuid,
      auth_access_token: auth.accessToken,
      user_type: 'mojang',
      version_type: opts.version?.type || 'release',
      user_properties: '{}',
      resolution_width: opts.window?.width || 854,
      resolution_height: opts.window?.height || 480,
      clientid: 'unknown',
      xuid: '',
      quickPlayPath: '',
      quickPlaySingleplayer: '',
      quickPlayMultiplayer: '',
      quickPlayRealms: '',
      auth_session: '',
      game_assets: assetsRootPath,
    };

    // Clona opts.mcFlags para no mutar entrada externa
    const mcFlags = Array.isArray(opts.mcFlags) ? [...opts.mcFlags] : [];

    if (assetDir === 'resources') {
      mcFlags.push('--resourcePackDir', path.resolve(opts.root, 'resources'));
    }

    let rawMcArgs = [];

    if (typeof version.minecraftArguments === 'string' && version.minecraftArguments.trim() !== '') {
      rawMcArgs = version.minecraftArguments
        .split(' ')
        .map(arg => replaceVars(arg, vars));
    } else if (version.arguments?.game) {
      for (const arg of version.arguments.game) {
        if (typeof arg === 'string') {
          rawMcArgs.push(replaceVars(arg, vars));
        } else if (arg.rules && isRuleAllowed(arg.rules)) {
          if (Array.isArray(arg.value)) {
            rawMcArgs.push(...arg.value.map(v => replaceVars(v, vars)));
          } else if (typeof arg.value === 'string') {
            rawMcArgs.push(replaceVars(arg.value, vars));
          }
        }
      }
    }

    rawMcArgs.push(...mcFlags);

    // ===== LIMPIEZA DE ARGUMENTOS =====
    const cleanedArgs = [];
    const debugRemoved = [];

    for (let i = 0; i < rawMcArgs.length; i++) {
      const arg = rawMcArgs[i]?.trim();

      if (!arg) {
        debugRemoved.push({ reason: 'Empty or undefined', value: arg });
        continue;
      }

      if (arg.startsWith('--')) {
        const next = rawMcArgs[i + 1]?.trim();
        if (!next || next.startsWith('--')) {
          debugRemoved.push({ reason: 'Flag sin valor', value: arg });
          continue;
        }
        cleanedArgs.push(arg, next);
        i++;
      } else if (!rawMcArgs[i - 1] || !rawMcArgs[i - 1].startsWith('--')) {
        cleanedArgs.push(arg);
      }
    }

    if (opts.debug) {
      console.log(`[Minecraft-Core] ${debugRemoved.length} argumentos eliminados:`);
      for (const r of debugRemoved) {
        console.log(' •', r);
      }
    }

    args.push(...cleanedArgs);

    // Asegurar --gameDir
    const hasGameDir = cleanedArgs.some((arg, i) => arg === '--gameDir' && cleanedArgs[i + 1]);
    if (!hasGameDir) {
      args.push('--gameDir', path.resolve(opts.root));
    }

    return args;
  }
};
