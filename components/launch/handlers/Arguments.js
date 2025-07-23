const path = require('path');
const os = require('os');
const fs = require('fs');

const platformMap = {
  win32: 'windows',
  linux: 'linux',
  darwin: 'osx'
};

function isRuleAllowed(rules) {
  if (!rules || rules.length === 0) return true;

  const platform = platformMap[os.platform()] || os.platform();

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

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative && !relative.startsWith('..') && !path.isAbsolute(relative)
  );
}

/**
 * Crea carpetas estándar de Minecraft dentro de gameRoot si no existen
 */
function ensureMinecraftFolders(gameRoot) {
  const folders = [
    'logs',
    'saves',
    'screenshots',
    'resourcepacks',
    'mods',
    'config',
    'crash-reports',
    'assets',
    'resources',
    'natives'
  ];

  for (const folder of folders) {
    const folderPath = path.resolve(gameRoot, folder);
    try {
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        console.log(`[Minecraft-Core] Carpeta creada: ${folderPath}`);
      }
    } catch (e) {
      console.warn(`[Minecraft-Core] Error creando carpeta ${folderPath}:`, e);
    }
  }
}

module.exports = {
  build({ opts, version, auth, classPath }) {
    const args = [];

    // ===== JVM ARGUMENTS =====
    const memory = opts.memory || {};
    const maxMem = memory.max || '2G';
    const minMem = memory.min || '512M';

    const memPattern = /^[0-9]+[GM]$/i;
    if (!memPattern.test(maxMem)) {
      console.warn(`[Minecraft-Core] Memoria máxima inválida "${maxMem}", usando "2G"`);
      args.push('-Xmx2G');
    } else {
      args.push(`-Xmx${maxMem}`);
    }
    if (!memPattern.test(minMem)) {
      console.warn(`[Minecraft-Core] Memoria mínima inválida "${minMem}", usando "512M"`);
      args.push('-Xms512M');
    } else {
      args.push(`-Xms${minMem}`);
    }

    const gameRoot = path.resolve(opts.root);

    // Crear las carpetas estándar antes de iniciar
    ensureMinecraftFolders(gameRoot);

    const nativesPath = path.resolve(gameRoot, 'natives', version.id);
    args.push(`-Djava.library.path=${nativesPath}`);
    args.push(`-Dorg.lwjgl.librarypath=${nativesPath}`);

    const requiresJava8 = version.javaVersion?.majorVersion === 8;
    if (!requiresJava8) {
      args.push('--enable-native-access=ALL-UNNAMED');
    }

    if (Array.isArray(opts.jvmFlags)) {
      const filteredJvmFlags = opts.jvmFlags.filter(f => typeof f === 'string' && f.trim());
      args.push(...filteredJvmFlags);
    }

    // ===== CLASSPATH =====
    if (!Array.isArray(classPath) || classPath.length === 0) {
      throw new Error('[Minecraft-Core] classPath inválido o vacío');
    }
    args.push('-cp', classPath.join(path.delimiter));

    const mainClass = version.mainClass || 'net.minecraft.client.main.Main';
    if (typeof mainClass !== 'string' || mainClass.trim() === '') {
      throw new Error('[Minecraft-Core] mainClass inválido');
    }
    args.push(mainClass);

    // ===== GAME ARGUMENTS =====
    const assetDir = (version.assets === 'legacy/virtual' || version.assets === 'resources')
      ? 'resources'
      : 'assets';

    const assetsRootPath = path.resolve(gameRoot, assetDir);

    const vars = {
      auth_player_name: auth.name,
      version_name: version.id,
      assets_root: assetsRootPath,
      assets_index_name: version.assets || version.assetIndex?.id || 'legacy',
      auth_uuid: auth.uuid,
      auth_access_token: auth.accessToken,
      user_type: 'mojang',
      version_type: opts.version?.type || 'release',
      user_properties: auth.userProperties?.value || '{}',
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

    const mcFlags = Array.isArray(opts.mcFlags) ? [...opts.mcFlags] : [];

    if (assetDir === 'resources') {
      mcFlags.push('--resourcePackDir', path.resolve(gameRoot, 'resources'));
    }

    let rawMcArgs = [];

    try {
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
    } catch (e) {
      console.error('[Minecraft-Core] Error procesando argumentos de juego:', e);
    }

    rawMcArgs.push(...mcFlags);

    if (auth.userProperties?.value) {
      rawMcArgs.push('--userProperties', auth.userProperties.value);
    }

    rawMcArgs = rawMcArgs.filter((arg, i, arr) => {
      if (arg === '--gameDir') {
        arr[i + 1] = null;
        return false;
      }
      if (arg === null) return false;
      return true;
    });

    rawMcArgs = rawMcArgs.filter(arg => {
      if (!arg) return false;
      if (!arg.startsWith('--') && path.isAbsolute(arg)) {
        if (!isPathInside(gameRoot, arg)) {
          if (opts.debug) console.warn(`[Minecraft-Core] Eliminando ruta fuera de root: ${arg}`);
          return false;
        }
      }
      return true;
    });

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

    args.push('--gameDir', gameRoot);

    return args;
  }
};
