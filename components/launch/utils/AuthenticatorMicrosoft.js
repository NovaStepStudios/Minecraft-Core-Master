const fetch = require('node-fetch');

const MS_OAUTH_URL = 'https://login.live.com/oauth20_token.srf';
const XBL_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTH_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MINECRAFT_AUTH_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox';

class AuthenticatorMicrosoft {
  constructor() {
    this.clientId = '00000000402b5328'; // clientId oficial para Minecraft (puede cambiar)
    this.scope = 'XboxLive.signin offline_access';
    this.redirectUri = 'https://login.live.com/oauth20_desktop.srf';
  }

  /**
   * Login con usuario y contraseña Microsoft (no recomendado para producción)
   * @param {string} username 
   * @param {string} password 
   * @returns {Promise<object>} tokens + perfil
   */
  async login(username, password) {
    if (!username || !password) throw new Error('Usuario y contraseña requeridos');

    // Paso 1: Obtener token de acceso Microsoft vía Resource Owner Password Credentials (no oficial)
    const msToken = await this.getMsTokenROPC(username, password);

    // Paso 2: Autenticar en Xbox Live
    const xblToken = await this.getXBLToken(msToken.access_token);

    // Paso 3: Obtener token XSTS
    const xstsToken = await this.getXSTSToken(xblToken.Token);

    // Paso 4: Login Minecraft con token XSTS
    const mcProfile = await this.loginMinecraft(xstsToken.Token, xstsToken.DisplayClaims.xui[0].uhs);

    return mcProfile;
  }

  async getMsTokenROPC(username, password) {
    // NOTA: este flujo puede no estar siempre disponible o bloquearse por MS
    const params = new URLSearchParams();
    params.append('client_id', this.clientId);
    params.append('grant_type', 'password');
    params.append('scope', this.scope);
    params.append('username', username);
    params.append('password', password);
    params.append('redirect_uri', this.redirectUri);

    const res = await fetch(MS_OAUTH_URL, {
      method: 'POST',
      body: params
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error MS OAuth: ${res.status} ${text}`);
    }

    return res.json();
  }

  async getXBLToken(msAccessToken) {
    const body = {
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    };

    const res = await fetch(XBL_AUTH_URL, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error Xbox Live Auth: ${res.status} ${text}`);
    }

    return res.json();
  }

  async getXSTSToken(xblToken) {
    const body = {
      Properties: {
        SandboxId: 'RETAIL',
        UserTokens: [xblToken]
      },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    };

    const res = await fetch(XSTS_AUTH_URL, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error XSTS Auth: ${res.status} ${text}`);
    }

    return res.json();
  }

  async loginMinecraft(xstsToken, userHash) {
    const body = {
      identityToken: `XBL3.0 x=${userHash};${xstsToken}`
    };

    const res = await fetch(MINECRAFT_AUTH_URL, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error Minecraft Auth: ${res.status} ${text}`);
    }

    return res.json();
  }
}

module.exports = AuthenticatorMicrosoft;
