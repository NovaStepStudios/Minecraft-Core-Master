"use strict";
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const AuthenticatorMicrosoft = require('./AuthenticatorMicrosoft');

const MOJANG_AUTH_URL = 'https://authserver.mojang.com/authenticate';
const DEFAULT_LAUNCHER_VERSION = {
  name: 'player',
  format: 1,
  profilesFormat: 1,
};

function nowISO() {
  return new Date().toISOString();
}

function parseProps(array) {
  if (!Array.isArray(array)) return '{}';
  const obj = {};
  for (const { name, value } of array) {
    if (!obj[name]) obj[name] = [];
    obj[name].push(value);
  }
  return JSON.stringify(obj);
}

function buildTextures(username, uuid, skinUrl, capeUrl) {
  const textures = {
    timestamp: Date.now(),
    profileId: uuid.replace(/-/g, ''),
    profileName: username,
    textures: {},
  };
  if (skinUrl) textures.textures.SKIN = { url: skinUrl };
  if (capeUrl) textures.textures.CAPE = { url: capeUrl };
  const value = Buffer.from(JSON.stringify(textures)).toString('base64');
  return { name: 'textures', value };
}

async function readProfiles(filePath) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      profiles: {},
      authenticationDatabase: {},
      selectedUser: null,
      clientToken: crypto.randomUUID(),
      launcherVersion: DEFAULT_LAUNCHER_VERSION,
      settings: {},
    };
  }
}

async function writeProfiles(filePath, data) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function saveOrUpdateUserProfile(root, userProfile) {
  const profilesPath = path.join(root, 'launcher_profiles.json');
  const profilesData = await readProfiles(profilesPath);

  if (!profilesData.clientToken) profilesData.clientToken = crypto.randomUUID();

  profilesData.profiles[userProfile.uuid] = {
    name: userProfile.name,
    type: userProfile.type,
    created: nowISO(),
    lastUsed: nowISO(),
  };

  profilesData.authenticationDatabase[userProfile.uuid] = {
    accessToken: userProfile.accessToken || '',
    username: userProfile.name,
    profiles: { [userProfile.uuid]: { displayName: userProfile.name } },
    userProperties: userProfile.userProperties || '[{}]',
    displayName: userProfile.name,
    type: userProfile.type,
  };

  profilesData.selectedUser = {
    account: userProfile.uuid,
    profile: userProfile.uuid,
  };

  await writeProfiles(profilesPath, profilesData);
}

function postJSON(url, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const { hostname, pathname } = new URL(url);
    const options = {
      hostname,
      path: pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'minecraft-core-master',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => resolve(raw));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

class UserSession {
  constructor(uuid, username, accessToken, type, password = '') {
    this.uuid = uuid;
    this.username = username;
    this.accessToken = accessToken;
    this.type = type;
    this._password = password; // en memoria para usar en /login
  }

  getPassword() {
    return this._password;
  }

  getAuthHeader() {
    return `Bearer ${this.accessToken}`;
  }

  asProfile() {
    return {
      uuid: this.uuid,
      name: this.username,
      accessToken: this.accessToken,
      type: this.type,
    };
  }
}

async function loginMojang(root, username, password) {
  if (!username || !password) throw new Error('Username y password requeridos para Mojang');
  console.log(`[Auth] Iniciando sesión Mojang para ${username}...`);

  const profilesData = await readProfiles(path.join(root, 'launcher_profiles.json'));
  const clientToken = profilesData.clientToken || crypto.randomUUID();

  let raw;
  try {
    raw = await postJSON(MOJANG_AUTH_URL, {
      agent: { name: 'Minecraft', version: 1 },
      username,
      password,
      clientToken,
      requestUser: true,
    });
  } catch (err) {
    throw new Error(`Error al conectar con Mojang: ${err.message}`);
  }

  const json = JSON.parse(raw);
  if (json.error) throw new Error(json.errorMessage || json.error);

  const userProperties = parseProps(json.user?.properties);

  const userProfile = {
    uuid: json.selectedProfile.id,
    name: json.selectedProfile.name,
    accessToken: json.accessToken,
    userProperties: [{ name: 'textures', value: Buffer.from(userProperties).toString('base64') }],
    type: 'mojang',
  };

  await saveOrUpdateUserProfile(root, userProfile);
  console.log(`[✔] Login exitoso Mojang: ${userProfile.name}`);

  return new UserSession(userProfile.uuid, userProfile.name, userProfile.accessToken, 'mojang', password);
}

async function loginMicrosoft(root, username, password, email) {
  if (!username || !password || !email)
    throw new Error('Username, password y email requeridos para Microsoft');
  console.log(`[Auth] Iniciando sesión Microsoft para ${username}...`);

  const msAuthenticator = new AuthenticatorMicrosoft();
  const msProfile = await msAuthenticator.login(username, password, email);

  const userProfile = {
    uuid: msProfile.id,
    name: msProfile.name || username,
    accessToken: msProfile.access_token,
    userProperties: [{ name: 'textures', value: Buffer.from('{}').toString('base64') }],
    type: 'microsoft',
  };

  await saveOrUpdateUserProfile(root, userProfile);
  console.log(`[✔] Login exitoso Microsoft: ${userProfile.name}`);

  return new UserSession(userProfile.uuid, userProfile.name, userProfile.accessToken, 'microsoft', password);
}

function getOfflineUUID(username, password = '') {
  const hash = crypto.createHash('sha1');
  hash.update(`OfflinePlayer:${username.toLowerCase()}:${password}`);
  const fullHash = hash.digest('hex');
  return [
    fullHash.substring(0, 8),
    fullHash.substring(8, 12),
    '3' + fullHash.substring(13, 16),
    fullHash.substring(16, 20),
    fullHash.substring(20, 32),
  ].join('-');
}

async function loginLegacy(root, username, password, skinUrl, capeUrl) {
  if (!username) throw new Error('Username es requerido para cuenta legacy');
  console.log(`[Auth] Usando cuenta legacy offline: ${username}`);

  const uuid = getOfflineUUID(username, password || '');
  const accessToken = crypto.randomUUID();
  const textures = buildTextures(username, uuid, skinUrl, capeUrl);

  const userProfile = {
    uuid,
    name: username,
    accessToken,
    userProperties: [textures],
    type: 'legacy',
  };

  await saveOrUpdateUserProfile(root, userProfile);
  console.log(`[✔] Perfil offline creado: ${username}`);

  return new UserSession(uuid, username, accessToken, 'legacy', password);
}

module.exports = {
  UserSession,
  async login(client, options = {}) {
    const { root = './' } = options;
    const provider = client.provider || 'legacy';

    switch (provider) {
      case 'microsoft':
        return await loginMicrosoft(root, client.username, client.password, client.email);
      case 'mojang':
        return await loginMojang(root, client.username, client.password);
      case 'legacy':
      default:
        return await loginLegacy(root, client.username, client.password, client.skinUrl, client.capeUrl);
    }
  },
  loginMojang,
  loginMicrosoft,
  loginLegacy,
};
