const fetch = require('node-fetch').default;
const crypto = require('crypto');
const http = require('http');
const open = require('open').default;

const MS_AUTH_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';
const XBL_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTH_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MINECRAFT_AUTH_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox';

class AuthenticatorMicrosoft {
  constructor() {
    this.clientId = 'c3b7b1ee-a7ed-40ef-b6b1-48483b2de93c';
    this.scope = 'XboxLive.signin offline_access';
    this.redirectUri = 'https://localhost:3000/outh';
  }

  generatePKCE() {
    const verifier = crypto.randomBytes(32).toString('hex');
    const challenge = this.base64URLEncode(
      crypto.createHash('sha256').update(verifier).digest()
    );
    return { verifier, challenge };
  }

  base64URLEncode(buffer) {
    return buffer.toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  async login() {
    const { verifier, challenge } = this.generatePKCE();

    const authUrl = `${MS_AUTH_URL}?client_id=${this.clientId}&response_type=code&redirect_uri=${encodeURIComponent(this.redirectUri)}&scope=${encodeURIComponent(this.scope)}&code_challenge=${challenge}&code_challenge_method=S256&response_mode=query`;

    // Abrir navegador
    open(authUrl);

    const code = await new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        // Escuchar la ruta /outh que definiste en redirectUri
        if (req.url.startsWith('/outh')) {
          const url = new URL(`http://localhost:3000${req.url}`);
          const authCode = url.searchParams.get('code');
          res.writeHead(200, {'Content-Type': 'text/html'});
          res.end('<h2>Login completado! Podés cerrar esta ventana.</h2>');
          server.close();
          if (authCode) resolve(authCode);
          else reject(new Error('No se recibió código de autorización'));
        }
      }).listen(3000);
    });

    const tokenResponse = await this.getTokens(code, verifier);

    const xblToken = await this.getXBLToken(tokenResponse.access_token);
    const xstsToken = await this.getXSTSToken(xblToken.Token);
    const mcAuth = await this.loginMinecraft(xstsToken.Token, xstsToken.DisplayClaims.xui[0].uhs);

    const profileRes = await fetch('https://api.minecraftservices.com/minecraft/profile', {
      headers: {
        Authorization: `Bearer ${mcAuth.access_token}`
      }
    });

    if (!profileRes.ok) throw new Error(`Error obteniendo perfil de Minecraft: ${profileRes.statusText}`);
    const profile = await profileRes.json();

    return {
      uuid: profile.id,
      name: profile.name,
      accessToken: mcAuth.access_token,
      refreshToken: tokenResponse.refresh_token,
      type: 'microsoft',
      user_properties: '{}',
    };
  }

  async getTokens(code, verifier) {
    const params = new URLSearchParams();
    params.append('client_id', this.clientId);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', this.redirectUri);
    params.append('code_verifier', verifier);

    const res = await fetch(MS_TOKEN_URL, {
      method: 'POST',
      body: params,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error obteniendo tokens MS: ${res.status} ${text}`);
    }

    return res.json();
  }

  async getXBLToken(msAccessToken) {
    const body = {
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `d=${msAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    };

    const res = await fetch(XBL_AUTH_URL, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
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
        UserTokens: [xblToken],
      },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    };

    const res = await fetch(XSTS_AUTH_URL, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error XSTS Auth: ${res.status} ${text}`);
    }

    return res.json();
  }

  async loginMinecraft(xstsToken, userHash) {
    const body = {
      identityToken: `XBL3.0 x=${userHash};${xstsToken}`,
    };

    const res = await fetch(MINECRAFT_AUTH_URL, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Error Minecraft Auth: ${res.status} ${text}`);
    }

    return res.json();
  }
}

module.exports = AuthenticatorMicrosoft;
