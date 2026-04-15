require('dotenv').config();

const crypto = require('crypto');
const http = require('http');
const { URL } = require('url');

function getCliPort() {
  const portArg = process.argv.find((arg) => arg.startsWith('--port='));
  if (!portArg) return null;
  const value = Number(portArg.split('=')[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

const PORT = getCliPort() || Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const sessions = new Map();
const oauthStates = new Map();
const users = new Map();
const groups = new Map();
const inviteTokens = new Map();

function isGoogleConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  return cookieHeader.split(';').reduce((acc, pair) => {
    const [rawKey, ...rawValue] = pair.trim().split('=');
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rawValue.join('='));
    return acc;
  }, {});
}

function getSession(req) {
  const cookies = parseCookies(req);
  if (!cookies.sid) return null;
  return sessions.get(cookies.sid) || null;
}

function setSession(res, userId) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { userId, createdAt: Date.now() });
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
}

function clearSession(req, res) {
  const cookies = parseCookies(req);
  if (cookies.sid) sessions.delete(cookies.sid);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function sendHtml(res, html, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function appLayout(title, content) {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; }
    main { max-width: 800px; margin: 2rem auto; padding: 1.2rem; }
    .card { background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 1rem; margin-bottom: 1rem; }
    .btn { display: inline-block; text-decoration: none; background: #2563eb; color: #fff; border: 0; border-radius: 8px; padding: .65rem 1rem; cursor: pointer; }
    input { width: 100%; margin: .4rem 0 .8rem; background: #0b1220; border: 1px solid #334155; color: #e2e8f0; border-radius: 8px; padding: .55rem; }
    ul { padding-left: 1.2rem; }
    .muted { color: #94a3b8; }
    .warn { color: #fbbf24; }
  </style>
</head>
<body><main>${content}</main></body>
</html>`;
}

function readFormBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(new URLSearchParams(body)));
  });
}

function currentUser(req) {
  const session = getSession(req);
  if (!session) return null;
  return users.get(session.userId) || null;
}

function requireAuth(req, res) {
  if (currentUser(req)) return true;
  redirect(res, '/');
  return false;
}

function renderLoginPage() {
  const content = `<section class="card">
    <h1>JDR Notebook</h1>
    <p class="muted">Connexion Google uniquement. Ensuite tu crées un groupe et tu partages un lien d'invitation (comme Tricount).</p>
    ${
      isGoogleConfigured()
        ? '<a class="btn" href="/auth/google">Se connecter avec Google</a>'
        : '<p class="warn">Google OAuth non configuré. Renseigne GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET.</p>'
    }
  </section>`;
  return appLayout('Login - JDR Notebook', content);
}

function renderDashboardPage(user) {
  const myGroups = Array.from(groups.values()).filter((group) => group.members.includes(user.id));
  const groupsHtml =
    myGroups.length === 0
      ? '<p class="muted">Aucun groupe pour le moment.</p>'
      : `<ul>${myGroups
          .map((group) => `<li><a href="/groups/${group.id}">${group.name}</a> (${group.members.length} membre(s))</li>`)
          .join('')}</ul>`;

  const content = `<section class="card">
    <h1>Salut ${user.name} 👋</h1>
    <p class="muted">Crée une campagne, puis partage le lien pour que tes amis la rejoignent.</p>
    <a class="btn" href="/logout">Se déconnecter</a>
  </section>
  <section class="card">
    <h2>Créer un groupe</h2>
    <form method="POST" action="/groups">
      <label for="groupName">Nom du groupe</label>
      <input id="groupName" name="groupName" required placeholder="Ex: Campagne Dragonlance" />
      <button class="btn" type="submit">Créer</button>
    </form>
  </section>
  <section class="card"><h2>Mes groupes</h2>${groupsHtml}</section>`;

  return appLayout('App - JDR Notebook', content);
}

function renderGroupPage(group, user) {
  const inviteEntry = Array.from(inviteTokens.entries()).find(([, groupId]) => groupId === group.id);
  const inviteLink = inviteEntry ? `${BASE_URL}/join/${inviteEntry[0]}` : 'Lien indisponible';
  const membersHtml = group.members.map((id) => `<li>${users.get(id)?.name || id}</li>`).join('');

  const content = `<section class="card">
    <h1>${group.name}</h1>
    <p class="muted">Lien à partager :</p>
    <input value="${inviteLink}" readonly />
    <a class="btn" href="/app">Retour</a>
  </section>
  <section class="card">
    <h2>Membres</h2>
    <ul>${membersHtml}</ul>
  </section>`;

  return appLayout(`Groupe - ${group.name}`, content);
}

function renderMessage(title, message, status = 200) {
  return [status, appLayout(title, `<section class="card"><p>${message}</p><p><a class="btn" href="/">Retour</a></p></section>`)];
}

async function startGoogleAuth(res) {
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, Date.now());

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', `${BASE_URL}/auth/google/callback`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'online');
  redirect(res, authUrl.toString());
}

async function finishGoogleAuth(reqUrl, res) {
  const code = reqUrl.searchParams.get('code');
  const state = reqUrl.searchParams.get('state');

  if (!code || !state || !oauthStates.has(state)) {
    const [status, html] = renderMessage('Erreur OAuth', 'Connexion Google invalide.', 400);
    sendHtml(res, html, status);
    return;
  }

  oauthStates.delete(state);

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: `${BASE_URL}/auth/google/callback`,
      grant_type: 'authorization_code'
    })
  });

  if (!tokenResponse.ok) {
    const [status, html] = renderMessage('Erreur OAuth', 'Impossible de récupérer le token Google.', 502);
    sendHtml(res, html, status);
    return;
  }

  const tokenJson = await tokenResponse.json();
  const userInfoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });

  if (!userInfoResponse.ok) {
    const [status, html] = renderMessage('Erreur OAuth', 'Impossible de récupérer le profil Google.', 502);
    sendHtml(res, html, status);
    return;
  }

  const profile = await userInfoResponse.json();
  const user = {
    id: profile.sub,
    name: profile.name || profile.email || 'Utilisateur',
    email: profile.email || ''
  };

  users.set(user.id, user);
  setSession(res, user.id);
  redirect(res, '/app');
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, BASE_URL);
  const user = currentUser(req);

  try {
    if (req.method === 'GET' && reqUrl.pathname === '/') {
      if (user) return redirect(res, '/app');
      return sendHtml(res, renderLoginPage());
    }

    if (req.method === 'GET' && reqUrl.pathname === '/auth/google') {
      if (!isGoogleConfigured()) {
        const [status, html] = renderMessage('Configuration manquante', 'Google OAuth non configuré sur le serveur.', 500);
        return sendHtml(res, html, status);
      }
      return startGoogleAuth(res);
    }

    if (req.method === 'GET' && reqUrl.pathname === '/auth/google/callback') {
      if (!isGoogleConfigured()) {
        const [status, html] = renderMessage('Configuration manquante', 'Google OAuth non configuré sur le serveur.', 500);
        return sendHtml(res, html, status);
      }
      return finishGoogleAuth(reqUrl, res);
    }

    if (req.method === 'GET' && reqUrl.pathname === '/logout') {
      clearSession(req, res);
      return redirect(res, '/');
    }

    if (req.method === 'GET' && reqUrl.pathname === '/app') {
      if (!requireAuth(req, res)) return;
      return sendHtml(res, renderDashboardPage(user));
    }

    if (req.method === 'POST' && reqUrl.pathname === '/groups') {
      if (!requireAuth(req, res)) return;
      const form = await readFormBody(req);
      const groupName = String(form.get('groupName') || '').trim();
      if (!groupName) return redirect(res, '/app');

      const groupId = crypto.randomUUID();
      const inviteToken = crypto.randomBytes(16).toString('hex');

      groups.set(groupId, {
        id: groupId,
        name: groupName,
        ownerId: user.id,
        members: [user.id],
        sessions: []
      });

      inviteTokens.set(inviteToken, groupId);
      return redirect(res, `/groups/${groupId}`);
    }

    if (req.method === 'GET' && reqUrl.pathname.startsWith('/groups/')) {
      if (!requireAuth(req, res)) return;
      const groupId = reqUrl.pathname.split('/')[2];
      const group = groups.get(groupId);

      if (!group) {
        const [status, html] = renderMessage('Introuvable', 'Groupe introuvable.', 404);
        return sendHtml(res, html, status);
      }

      if (!group.members.includes(user.id)) {
        const [status, html] = renderMessage('Accès refusé', 'Tu ne fais pas partie de ce groupe.', 403);
        return sendHtml(res, html, status);
      }

      return sendHtml(res, renderGroupPage(group, user));
    }

    if (req.method === 'GET' && reqUrl.pathname.startsWith('/join/')) {
      if (!requireAuth(req, res)) return;
      const token = reqUrl.pathname.split('/')[2];
      const groupId = inviteTokens.get(token);
      const group = groupId ? groups.get(groupId) : null;

      if (!group) {
        const [status, html] = renderMessage('Lien invalide', 'Lien d\'invitation invalide.', 404);
        return sendHtml(res, html, status);
      }

      if (!group.members.includes(user.id)) {
        group.members.push(user.id);
      }

      return redirect(res, `/groups/${group.id}`);
    }

    const [status, html] = renderMessage('404', 'Page non trouvée.', 404);
    return sendHtml(res, html, status);
  } catch (error) {
    console.error('Erreur serveur:', error);
    const [status, html] = renderMessage('Erreur', 'Erreur interne du serveur.', 500);
    return sendHtml(res, html, status);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Serveur démarré sur http://${HOST}:${PORT}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} déjà utilisé. Lancez avec PORT=3001 npm start ou npm start -- --port=3001`);
    process.exit(1);
  }

  console.error('Erreur serveur:', error);
  process.exit(1);
});
