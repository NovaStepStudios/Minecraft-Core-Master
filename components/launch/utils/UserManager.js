const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { v3: uuidv3 } = require('uuid');
const { default: fetch } = require('node-fetch');
const AuthenticatorMicrosoft = require('./AuthenticatorMicrosoft');

const MOJANG_AUTH_URL = 'https://authserver.mojang.com';

function parseProps(array) {
  if (!Array.isArray(array)) return '{}';
  const obj = {};
  for (const { name, value } of array) {
    if (!obj[name]) obj[name] = [];
    obj[name].push(value);
  }
  return JSON.stringify(obj);
}

class UserManager {
  constructor(root) {
    this.root = root;
    this.profilesPath = path.join(root, 'launcher_profiles.json');
    this.skinsDir = path.join(root, 'skins');
    this._profilesCache = null;
    this.msAuthenticator = new AuthenticatorMicrosoft();
  }

  async validateAccessToken(profile) {
    if (!profile || !profile.accessToken) return false;
  
    try {
      const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
        headers: {
          Authorization: `Bearer ${profile.accessToken}`,
        },
      });
  
      return res.status === 200;
    } catch {
      return false;
    }
  }
  
  async refreshAccessToken(profile) {
    if (!profile || !profile.type || !profile.accessToken) return null;
  
    if (profile.type === 'microsoft') {
      if (this.msAuthenticator && this.msAuthenticator.refresh) {
        try {
          const newProfile = await this.msAuthenticator.refresh(profile);
          if (newProfile) {
            await this._saveOrUpdateUserProfile(newProfile);
            console.log('[✔] Token Microsoft refrescado');
            return newProfile;
          }
        } catch {
          return null;
        }
      }
    }
  
    // Mojang no permite refresh desde 2021 (tokens permanentes por sesión)
    return null;
  }
  
  async _loadProfiles() {
    if (this._profilesCache) return this._profilesCache;

    try {
      const data = await fs.readFile(this.profilesPath, 'utf-8');
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || !parsed.profiles) {
        // Si no tiene estructura correcta, crear base
        this._profilesCache = {
          clientToken: crypto.randomUUID(),
          profiles: {},
          authenticationDatabase: {},
          selectedUser: null,
        };
      } else {
        this._profilesCache = parsed;
      }
    } catch {
      this._profilesCache = {
        clientToken: crypto.randomUUID(),
        profiles: {},
        authenticationDatabase: {},
        selectedUser: null,
      };
    }

    return this._profilesCache;
  }

  async _saveProfiles(profiles) {
    this._profilesCache = profiles;
    await fs.writeFile(this.profilesPath, JSON.stringify(profiles, null, 2), 'utf-8');
  }

  async _saveOrUpdateUserProfile(userProfile) {
    const profilesData = await this._loadProfiles();

    if (!profilesData.clientToken) {
      profilesData.clientToken = crypto.randomUUID();
    }

    profilesData.profiles[userProfile.uuid] = {
      name: userProfile.name,
      type: userProfile.type,
    };

    profilesData.authenticationDatabase[userProfile.uuid] = {
      accessToken: userProfile.accessToken,
      uuid: userProfile.uuid,
      userProperties: userProfile.user_properties || '{}',
      displayName: userProfile.name,
      type: userProfile.type,
    };

    profilesData.selectedUser = userProfile.uuid;

    await this._saveProfiles(profilesData);
  }

  async resolve(user) {
    if (user?.uuid && user?.accessToken) return user;

    const profilesData = await this._loadProfiles();
    const legacyUuid = Object.keys(profilesData.profiles).find(uuid => profilesData.profiles[uuid].type === 'legacy');
    if (legacyUuid) {
      const p = profilesData.profiles[legacyUuid];
      return {
        uuid: legacyUuid,
        name: p.name,
        type: 'legacy',
        accessToken: '',
      };
    }

    const newUuid = crypto.randomUUID();
    const newUser = {
      type: 'legacy',
      name: 'Player',
      uuid: newUuid,
      accessToken: '',
      user_properties: '{}',
    };

    // Añadir nuevo perfil
    profilesData.profiles[newUuid] = {
      name: newUser.name,
      type: newUser.type,
    };

    profilesData.authenticationDatabase[newUuid] = {
      accessToken: '',
      uuid: newUuid,
      userProperties: '{}',
      displayName: newUser.name,
      type: newUser.type,
    };

    profilesData.selectedUser = newUuid;

    await this._saveProfiles(profilesData);

    return newUser;
  }

  async loginMojang(username, password) {
    if (!username || !password) throw new Error('[✖] Username y password requeridos para Mojang');
  
    console.log(`[Auth] Iniciando sesión Mojang para ${username}...`);
  
    const profilesData = await this._loadProfiles();
    let existingProfile = Object.entries(profilesData.profiles)
      .find(([, p]) => p.name === username && p.type === 'mojang');

    let clientToken = profilesData.clientToken || crypto.randomUUID();
    if (existingProfile) {
      const [uuid] = existingProfile;
      const authData = profilesData.authenticationDatabase[uuid];
      if (authData && authData.accessToken) clientToken = authData.accessToken;
    }

    const res = await fetch(MOJANG_AUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'minecraft-core-authenticator'
      },
      body: JSON.stringify({
        agent: { name: 'Minecraft', version: 1 },
        username,
        password,
        clientToken,
        requestUser: true
      })
    });

    const text = await res.text();
    if (!text) throw new Error('[✖] Respuesta vacía de Mojang');

    let json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error(`[✖] Error parseando respuesta Mojang: ${err.message}`);
    }

    if (json.error) throw new Error(`[✖] ${json.errorMessage || json.error}`);

    const userProfile = {
      uuid: json.selectedProfile?.id,
      name: json.selectedProfile?.name,
      accessToken: json.accessToken,
      clientToken: json.clientToken || clientToken,
      user_properties: parseProps(json.user?.properties),
      type: 'mojang'
    };

    await this._saveOrUpdateUserProfile(userProfile);
    console.log(`[✔] Login exitoso Mojang: ${userProfile.name}`);
    return userProfile;
  }  

  async loginMicrosoft(username, password, email) {
    if (!username || !password || !email) 
      throw new Error('[✖] Username, password y email requeridos para Microsoft');
  
    console.log(`[Auth] Iniciando sesión Microsoft para ${username} (email: ${email})...`);
    const msProfile = await this.msAuthenticator.login(username, password, email);

    const userProfile = {
      uuid: msProfile.id,
      name: msProfile.name || username,
      email,
      accessToken: msProfile.access_token,
      clientToken: msProfile.access_token,
      user_properties: '{}',
      type: 'microsoft'
    };

    await this._saveOrUpdateUserProfile(userProfile);
    console.log(`[✔] Login exitoso Microsoft: ${userProfile.name}`);
    return userProfile;
  }

  async loginLegacy(username) {
    if (!username) throw new Error('[✖] Username requerido para cuenta legacy');

    console.log(`[Auth] Usando cuenta legacy offline: ${username}`);
    const uuid = uuidv3(username, uuidv3.DNS);

    const userProfile = {
      uuid,
      name: username,
      accessToken: '',
      clientToken: '',
      user_properties: '{}',
      type: 'legacy'
    };

    await this._saveOrUpdateUserProfile(userProfile);
    console.log(`[✔] Perfil offline creado: ${username}`);
    return userProfile;
  }

  async login(username, password, provider = 'legacy', email = null) {
    switch (provider) {
      case 'microsoft':
        return this.loginMicrosoft(username, password, email);
      case 'mojang':
        console.log('[✖] Las cuentas Mojang ya no son soportadas.');
        return this.loginMojang(username, password);
      case 'legacy':
        return this.loginLegacy(username);
      default:
        throw new Error(`[✖] Provider inválido: ${provider}`);
    }
  }

  async getSkin(uuid) {
    return this._fileExists(`${uuid}_skin.png`);
  }

  async getCape(uuid) {
    return this._fileExists(`${uuid}_cape.png`);
  }

  async _fileExists(filename) {
    const filePath = path.join(this.skinsDir, filename);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      return null;
    }
  }
}

module.exports = UserManager;
