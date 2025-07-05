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
            await this._saveUpdatedProfile(newProfile);
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
  
  async _saveUpdatedProfile(profile) {
    const profiles = await this._loadProfiles();
    const idx = profiles.findIndex(p => p.uuid === profile.uuid);
    if (idx >= 0) profiles[idx] = profile;
    else profiles.push(profile);
    await this._saveProfiles(profiles);
  }
  
  async _loadProfiles() {
    if (this._profilesCache) return this._profilesCache;

    try {
      const data = await fs.readFile(this.profilesPath, 'utf-8');
      const parsed = JSON.parse(data);
      this._profilesCache = Array.isArray(parsed)
        ? parsed
        : Object.values(parsed.profiles || {});
    } catch {
      this._profilesCache = [];
    }

    return this._profilesCache;
  }

  async _saveProfiles(profiles) {
    this._profilesCache = profiles;
    await fs.writeFile(this.profilesPath, JSON.stringify(profiles, null, 2), 'utf-8');
  }

  async resolve(user) {
    if (user?.uuid && user?.accessToken) return user;

    const profiles = await this._loadProfiles();
    const existingLegacy = profiles.find(p => p.uuid && p.type === 'legacy');
    if (existingLegacy) return existingLegacy;

    const newUser = {
      type: 'legacy',
      name: 'Player',
      uuid: crypto.randomUUID(),
      accessToken: ''
    };

    profiles.push(newUser);
    await this._saveProfiles(profiles);

    return newUser;
  }

  async loginMojang(username, password) {
    if (!username || !password) throw new Error('[✖] Username y password requeridos para Mojang');
  
    console.log(`[Auth] Iniciando sesión Mojang para ${username}...`);
  
    // Intentar cargar perfiles existentes para obtener clientToken guardado
    const profiles = await this._loadProfiles();
    let existingProfile = profiles.find(p => p.name === username && p.type === 'mojang');
    let clientToken;
  
    if (existingProfile && existingProfile.clientToken) {
      clientToken = existingProfile.clientToken;
    } else {
      // Generar nuevo clientToken único y persistente
      clientToken = crypto.randomUUID();
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
      clientToken: json.clientToken || clientToken, // asegurar clientToken guardado
      user_properties: parseProps(json.user?.properties),
      type: 'mojang'
    };
  
    const idx = profiles.findIndex(p => p.uuid === userProfile.uuid);
    if (idx >= 0) profiles[idx] = userProfile;
    else profiles.push(userProfile);
  
    await this._saveProfiles(profiles);
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
      email,  // guardamos el email en el perfil
      accessToken: msProfile.access_token,
      clientToken: msProfile.access_token,
      user_properties: '{}',
      type: 'microsoft'
    };
  
    const profiles = await this._loadProfiles();
    const idx = profiles.findIndex(p => p.uuid === userProfile.uuid);
    if (idx >= 0) profiles[idx] = userProfile;
    else profiles.push(userProfile);
  
    await this._saveProfiles(profiles);
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

    const profiles = await this._loadProfiles();
    const idx = profiles.findIndex(p => p.uuid === uuid);
    if (idx >= 0) profiles[idx] = userProfile;
    else profiles.push(userProfile);

    await this._saveProfiles(profiles);
    console.log(`[✔] Perfil offline creado: ${username}`);
    return userProfile;
  }

  /**
   * Login genérico.
   * @param {string} username 
   * @param {string} password 
   * @param {'microsoft' | 'mojang' | 'legacy'} provider 
   * @returns {Promise<object>} Perfil de usuario autenticado
   */
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
