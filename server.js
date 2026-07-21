require('dotenv').config();

// Read and normalize important environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ? String(process.env.GEMINI_API_KEY).trim() : null;
const GEMINI_MODEL = process.env.GEMINI_MODEL ? String(process.env.GEMINI_MODEL).trim() : 'gemini-flash-latest';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ? String(process.env.GOOGLE_CLIENT_ID).trim() : null;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ? String(process.env.GOOGLE_CLIENT_SECRET).trim() : null;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ? String(process.env.GOOGLE_REDIRECT_URI).trim() : null;


const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Busboy = require('busboy');

const { createStore, passwordHash, id, now, defaultDb } = require('./lib/store');
const { createFileStorage } = require('./lib/storage');
const { extractText, chunkText } = require('./lib/document');
const { generateStudyAid } = require('./lib/ai');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 4173);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MIME_TYPES = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const SUPPORTED_EXTENSIONS = new Map([
  ['pdf', 'application/pdf'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['txt', 'text/plain'], ['md', 'text/markdown'], ['markdown', 'text/markdown'], ['csv', 'text/csv']
]);

let store;
let fileStorage;
let initialized = false;
let initializePromise = null;
let pendingIndexingPromise = null;

async function initialize() {


  if (initialized) return;

  if (!initializePromise) {
    initializePromise = (async () => {
      try {
        

        store = await createStore({
          mongoUri: process.env.MONGODB_URI,
          databaseName: process.env.MONGODB_DATABASE,
          dataFile: path.join(DATA_DIR, "db.json")
        });

        

        fileStorage = await createFileStorage({
          storageProvider: process.env.STORAGE_PROVIDER,
          localRoot: path.join(DATA_DIR, "uploads"),
          s3Bucket: process.env.S3_BUCKET || process.env.AWS_S3_BUCKET,
          s3Key: process.env.S3_KEY || process.env.AWS_ACCESS_KEY_ID,
          s3Secret: process.env.S3_SECRET || process.env.AWS_SECRET_ACCESS_KEY,
          s3Endpoint: process.env.S3_ENDPOINT,
          s3Region: process.env.S3_REGION || process.env.AWS_REGION
        });

        initialized = true;
        void indexPendingResources();

        
      } catch (err) {
    console.error("========== INITIALIZATION FAILED ==========");
    console.error(err);
    console.error(err.stack);

    if (err.cause) {
        console.error("CAUSE:");
        console.error(err.cause);
    }

    throw err;
}
    })();
  }

  return initializePromise;
}
function clampText(value, max) { return String(value || '').trim().slice(0, max); }
function safeUser(user) { if (!user) return null; const { passwordHash: _passwordHash, ...safe } = user; return safe; }
function verifyPassword(password, stored) {
  const [salt, storedHash] = String(stored || '').split(':');
  if (!salt || !storedHash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return candidate.length === storedHash.length && crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(storedHash, 'hex'));
}
function getCookie(req, name) { const hit = String(req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`)); return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null; }
function isSecureRequest(req) { return process.env.VERCEL === '1' || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https'; }
function cookieOptions(req, { maxAge = 604800, httpOnly = true } = {}) { return `Path=/; ${httpOnly ? 'HttpOnly; ' : ''}SameSite=Lax; ${isSecureRequest(req) ? 'Secure; ' : ''}Max-Age=${maxAge}`; }
function sessionCookie(req, token) { return `studyhub_session=${encodeURIComponent(token)}; ${cookieOptions(req)}`; }
function oauthRedirectUri(req) { if (GOOGLE_REDIRECT_URI) return GOOGLE_REDIRECT_URI; return `${isSecureRequest(req) ? 'https' : 'http'}://${req.headers.host}/api/auth/google/callback`; }
function oauthState(value) { return crypto.createHmac('sha256', GOOGLE_CLIENT_SECRET || 'studyhub-google-oauth').update(value).digest('base64url'); }
function redirect(res, location, headers = {}) { res.writeHead(302, { Location: location, ...headers }); res.end(); }
async function sessionUser(req) {

    const token = getCookie(req, "studyhub_session");

    if (!token) return null;

    const session = await store.getSession(token);

    if (!session) return null;

    return await store.findUserById(session.userId);
}
async function requireUser(req, res) { const user = await sessionUser(req); if (!user) { sendError(res, 401, 'Please sign in to continue.'); return null; } return user; }
function sendJson(res, status, body, headers = {}) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(body)); }
function sendError(res, status, error) { sendJson(res, status, { error }); }

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 1_000_000) reject(new Error('Request body is too large.')); });
    req.on('end', () => { if (!body) return resolve({}); try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON body.')); } });
    req.on('error', reject);
  });
}

function readMultipart(req) {
  return new Promise((resolve, reject) => {
    let file = null; let tooLarge = false;
    const fields = {};
    const parser = Busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_FILE_BYTES, fields: 16 } });
    parser.on('field', (name, value) => { fields[name] = value; });
    parser.on('file', (name, stream, info) => {
      if (name !== 'file' || file) { stream.resume(); return; }
      const buffers = [];
      stream.on('data', (chunk) => buffers.push(chunk));
      stream.on('limit', () => { tooLarge = true; });
      stream.on('end', () => { file = { name: info.filename, mimeType: info.mimeType || 'application/octet-stream', buffer: Buffer.concat(buffers) }; });
    });
    parser.on('error', reject);
    parser.on('close', () => { if (tooLarge) return reject(new Error('Files must be 20 MB or smaller.')); if (!file?.name || !file.buffer.length) return reject(new Error('Choose a non-empty supported study file.')); resolve({ fields, file }); });
    req.pipe(parser);
  });
}

function fileDetails(file) {
  const extension = String(file.name).split('.').pop().toLowerCase();
  const canonicalMimeType = SUPPORTED_EXTENSIONS.get(extension);
  if (!canonicalMimeType) throw new Error('Supported formats: PDF, DOCX, PPTX, TXT, Markdown, and CSV.');
  return { extension, canonicalMimeType, displayType: extension.toUpperCase() };
}

async function groupAccess(req, res, groupId, user) {
  const access = await store.groupAccess(groupId, user.id);
  if (!access) { sendError(res, 403, 'You do not have access to this group.'); return null; }
  return access;
}

async function indexResource(resource, buffer) {
  try {
    await store.updateResourceIndexStatus(resource.id, 'indexing', null);
    const text = await extractText({ buffer, mimeType: resource.mimeType, fileName: resource.fileName });
    if (text.length < 20) {
      const updatedResource = await store.updateResourceIndexStatus(resource.id, 'needs_ai', 'No usable text was found in this file.');
      return { resource: updatedResource, indexedChunks: 0 };
    }
    const chunks = chunkText(text).map((content, position) => ({
      id: id('chunk'), groupId: resource.groupId, resourceId: resource.id, resourceTitle: resource.title, position, content, createdAt: now()
    }));
    await store.addChunks(resource.id, chunks);
    const updatedResource = await store.updateResource(resource.id, { indexStatus: 'indexed', indexError: null, textLength: text.length });
    return { resource: updatedResource, indexedChunks: chunks.length };
  } catch (error) {
    const updatedResource = await store.updateResourceIndexStatus(resource.id, 'failed', String(error.message || error));
    return { resource: updatedResource, indexedChunks: 0 };
  }
}

async function indexPendingResources() {
  if (pendingIndexingPromise) return pendingIndexingPromise;
  pendingIndexingPromise = (async () => {
    while (true) {
      const pendingResources = await store.getResourcesByIndexStatus('pending', 10);
      if (!pendingResources.length) return;
      for (const resource of pendingResources) {
        try {
          const buffer = await fileStorage.download(resource.storagePath);
          await indexResource(resource, buffer);
        } catch (error) {
          await store.updateResourceIndexStatus(resource.id, 'failed', String(error.message || error));
        }
      }
    }
  })().catch((error) => console.error('Failed to index pending resources:', error)).finally(() => { pendingIndexingPromise = null; });
  return pendingIndexingPromise;
}

async function addUploadedResource(req, res, groupId, user) {
  const access = await groupAccess(req, res, groupId, user); if (!access) return;
  const { fields, file } = await readMultipart(req);
  const { canonicalMimeType, displayType } = fileDetails(file);
  const title = clampText(fields.title, 120);
  if (title.length < 3) return sendError(res, 400, 'A resource title of at least 3 characters is required.');
  const storage = await fileStorage.upload({ groupId, fileName: file.name, buffer: file.buffer, mimeType: canonicalMimeType });
  const resource = {
    id: id('res'), groupId, title, fileName: file.name, type: displayType, mimeType: canonicalMimeType, storagePath: storage.storagePath,
    subject: clampText(fields.subject, 80) || access.group.subject, unit: clampText(fields.unit, 40) || 'General', tags: String(fields.tags || '').split(',').map((tag) => clampText(tag, 24)).filter(Boolean).slice(0, 8), description: clampText(fields.description, 400), size: file.buffer.length, uploaderId: user.id, downloads: 0, indexStatus: 'indexing', indexError: null, textLength: 0, createdAt: now()
  };
  await store.addResource(resource, []);
  const result = await indexResource(resource, file.buffer);
  return sendJson(res, 201, result);
}

async function serveDownload(req, res, resourceId, user) {
  const resource = await store.findResource(resourceId);
  if (!resource) return sendError(res, 404, 'Resource not found.');
  const access = await groupAccess(req, res, resource.groupId, user); if (!access) return;
  if (!resource.storagePath) return sendError(res, 404);
  // Increment download counter (persisted in the store)
  if (typeof store.incrementResourceDownloads === 'function') {
    try { await store.incrementResourceDownloads(resourceId); } catch (err) { /* ignore tracking errors */ }
  }
  const signedUrl = await fileStorage.signedDownload(resource.storagePath);
  if (signedUrl) { res.writeHead(302, { Location: signedUrl }); return res.end(); }
  const buffer = await fileStorage.download(resource.storagePath);
  res.writeHead(200, { 'Content-Type': resource.mimeType || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${String(resource.fileName).replace(/["\\]/g, '_')}"`, 'Content-Length': buffer.length }); res.end(buffer);
}

async function handleApi(req, res, pathname) {
  await initialize();
  const { method } = req;
  if (method === 'GET' && pathname === '/api/health') return sendJson(res, 200, { status: 'ok', database: store.kind, storage: fileStorage.kind, aiConfigured: Boolean(GEMINI_API_KEY) });
  if (method === 'GET' && pathname === '/api/session') return sendJson(res, 200, { user: safeUser(await sessionUser(req)) });
  if (method === 'GET' && pathname === '/api/auth/google') {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return sendError(res, 503, 'Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
    const state = crypto.randomBytes(32).toString('base64url');
    const params = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: oauthRedirectUri(req), response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account' });
    return redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params}`, { 'Set-Cookie': `studyhub_google_state=${state}.${oauthState(state)}; ${cookieOptions(req, { maxAge: 600 })}` });
  }
  if (method === 'GET' && pathname === '/api/auth/google/callback') {
    const url = new URL(req.url, `http://${req.headers.host}`); const error = url.searchParams.get('error'); const code = url.searchParams.get('code'); const state = url.searchParams.get('state');
    const [storedValue, storedSignature] = String(getCookie(req, 'studyhub_google_state') || '').split('.');
    const safeEqual = (left, right) => left && right && left.length === right.length && crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
    const validState = safeEqual(oauthState(storedValue), storedSignature) && safeEqual(state, storedValue);
    const clearState = `studyhub_google_state=; ${cookieOptions(req, { maxAge: 0 })}`;
    if (error || !code || !validState) return redirect(res, '/?auth_error=google', { 'Set-Cookie': clearState });
    try {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: oauthRedirectUri(req), grant_type: 'authorization_code' }) });
      const tokens = await tokenResponse.json(); if (!tokenResponse.ok || !tokens.access_token) throw new Error('Google did not return an access token.');
      const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } }); const profile = await profileResponse.json(); const email = String(profile.email || '').trim().toLowerCase();
      if (!profileResponse.ok || !profile.email_verified || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('Google did not provide a verified email address.');
      let user = await store.findUserByEmail(email);
      if (!user) { const name = clampText(profile.name, 80) || email.split('@')[0]; user = await store.createUser({ name, email, passwordHash: null, avatar: name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase(), authProvider: 'google', googleId: clampText(profile.sub, 120) || null }); }
      const token = await store.createSession(user.id); return redirect(res, '/', { 'Set-Cookie': [clearState, sessionCookie(req, token)] });
    } catch (error) { console.error('Google OAuth callback failed:', error.message); return redirect(res, '/?auth_error=google', { 'Set-Cookie': clearState }); }
  }
  if (method === 'POST' && pathname === '/api/auth/register') {
    const input = await readJson(req); const name = clampText(input.name, 80); const email = clampText(input.email, 120).toLowerCase(); const password = String(input.password || '');
    if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return sendError(res, 400, 'Enter a name, valid email, and password of at least 8 characters.');
    if (await store.findUserByEmail(email)) return sendError(res, 409, 'An account already uses this email.');
    const user = await store.createUser({ name, email, passwordHash: passwordHash(password), avatar: name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() });
    const token = await store.createSession(user.id); return sendJson(res, 201, { user: safeUser(user) }, { 'Set-Cookie': sessionCookie(req, token) });
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    const input = await readJson(req); const user = await store.findUserByEmail(String(input.email || '').trim().toLowerCase());
    if (!user || !verifyPassword(String(input.password || ''), user.passwordHash)) return sendError(res, 401, 'Incorrect email or password.');
    const token = await store.createSession(user.id); return sendJson(res, 200, { user: safeUser(user) }, { 'Set-Cookie': sessionCookie(req, token) });
  }
  if (method === "POST" && pathname === "/api/auth/logout") {
    const token = getCookie(req, "studyhub_session");

    if (token) {
        await store.deleteSession(token);
    }

    return sendJson(
        res,
        200,
        { ok: true },
        {
            "Set-Cookie":
                `studyhub_session=; ${cookieOptions(req, { maxAge: 0 })}`
        }
    );
}
  // Public API: list discoverable public groups (no auth required)
  if (method === 'GET' && pathname === '/api/public-groups') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const q = url.searchParams.get('q') || '';
      const groups = await store.listPublicGroups(q);
      return sendJson(res, 200, { groups });
    }catch (error) {
    console.error("========== REQUEST FAILED ==========");
    console.error(error);
    console.error(error.stack);

    if (error.cause) {
        console.error("CAUSE:");
        console.error(error.cause);
    }

    return sendError(
        res,
        500,
        error.message || "Unexpected server error."
    );
}
  }

  const user = await requireUser(req, res); if (!user) return;
if (method === 'GET' && pathname === '/api/dashboard') {
    try {
        const dashboard = await store.dashboard(user.id);
        return sendJson(res, 200, dashboard);
    } catch (err) {
        console.error("DASHBOARD ERROR");
        console.error(err);
        console.error(err.stack);

        return sendJson(res, 500, {
            error: err.message
        });
    }
}
  if (method === 'GET' && pathname === '/api/groups') return sendJson(res, 200, { groups: (await store.userGroups(user.id)).filter(Boolean) });
  if (method === 'POST' && pathname === '/api/groups') {
    const input = await readJson(req); const name = clampText(input.name, 100); const subject = clampText(input.subject, 80); const description = clampText(input.description, 400);
    if (name.length < 3 || subject.length < 2) return sendError(res, 400, 'Group name and subject are required.');
    return sendJson(res, 201, { group: await store.createGroup({ name, subject, description, privacy: input.privacy === 'public' ? 'public' : 'private' }, user.id) });
  }
  if (method === 'POST' && pathname === '/api/groups/join') {

    const input = await readJson(req); const group = await store.joinGroup(clampText(input.inviteCode, 30).toUpperCase(), user.id); if (!group) return sendError(res, 404, 'No group matches that invite code.'); return sendJson(res, 200, { group });
  }
const publicJoinMatch = pathname.match(/^\/api\/groups\/([^/]+)\/join$/);

if (publicJoinMatch && method === "POST") {

    const group = await store.joinPublicGroup(
        publicJoinMatch[1],
        user.id
    );

    if (!group) {
        return sendError(res, 404, "Public group not found.");
    }

    return sendJson(res, 200, { group });
}
  const groupMatch = pathname.match(/^\/api\/groups\/([^/]+)$/); const resourceMatch = pathname.match(/^\/api\/groups\/([^/]+)\/resources$/); const assignmentMatch = pathname.match(/^\/api\/groups\/([^/]+)\/assignments$/); const discussionMatch = pathname.match(/^\/api\/groups\/([^/]+)\/discussions$/); const replyMatch = pathname.match(/^\/api\/discussions\/([^/]+)\/replies$/); const downloadMatch = pathname.match(/^\/api\/resources\/([^/]+)\/download$/); const resourceDeleteMatch = pathname.match(/^\/api\/resources\/([^/]+)$/); const assignmentDeleteMatch = pathname.match(/^\/api\/assignments\/([^/]+)$/);
  if (downloadMatch && method === 'GET') return serveDownload(req, res, downloadMatch[1], user);
  if (groupMatch && method === 'DELETE') {
    const access = await groupAccess(req, res, groupMatch[1], user); if (!access) return;
    const deletedGroup = await store.deleteGroup(groupMatch[1], user.id);
    if (!deletedGroup) return sendError(res, 403, 'Only the group owner can delete this group.');
    return sendJson(res, 200, { group: deletedGroup, deleted: true });
  }
  if (groupMatch && method === 'GET') { const workspace = await store.workspace(groupMatch[1], user.id); if (!workspace) return sendError(res, 403, 'You do not have access to this group.'); return sendJson(res, 200, workspace); }
  if (resourceDeleteMatch && method === 'DELETE') {
    const resource = await store.findResource(resourceDeleteMatch[1]);
    if (!resource) return sendError(res, 404, 'Resource not found.');
    const access = await groupAccess(req, res, resource.groupId, user); if (!access) return;
    const deletedResource = await store.deleteResource(resourceDeleteMatch[1], user.id);
    if (!deletedResource) return sendError(res, 403, 'You can only remove resources you uploaded or manage in this group.');
    if (typeof fileStorage.remove === 'function') { try { await fileStorage.remove(deletedResource.storagePath); } catch (_) { /* ignore best-effort cleanup */ } }
    return sendJson(res, 200, { resource: deletedResource, deleted: true });
  }
  if (resourceMatch) {
    const access = await groupAccess(req, res, resourceMatch[1], user); if (!access) return;
    if (method === 'GET') { const workspace = await store.workspace(resourceMatch[1], user.id); return sendJson(res, 200, { resources: workspace.resources }); }
    if (method === 'POST') return addUploadedResource(req, res, resourceMatch[1], user);
  }
  if (assignmentDeleteMatch && method === 'DELETE') {
    const assignment = await store.findAssignment ? await store.findAssignment(assignmentDeleteMatch[1]) : null;
    if (!assignment) return sendError(res, 404, 'Assignment not found.');
    const access = await groupAccess(req, res, assignment.groupId, user); if (!access) return;
    const deletedAssignment = await store.deleteAssignment(assignmentDeleteMatch[1], user.id);
    if (!deletedAssignment) return sendError(res, 403, 'You can only remove assignments you created or manage in this group.');
    return sendJson(res, 200, { assignment: deletedAssignment, deleted: true });
  }
  if (assignmentMatch) {
    const access = await groupAccess(req, res, assignmentMatch[1], user); if (!access) return;
    if (method === 'GET') { const workspace = await store.workspace(assignmentMatch[1], user.id); return sendJson(res, 200, { assignments: workspace.assignments }); }
    if (method === 'POST') {
      const input = await readJson(req);
      const title = clampText(input.title, 120);
      if (title.length < 3) return sendError(res, 400, 'Assignment title is required.');
      const assignmentPayload = { id: id('asg'), groupId: assignmentMatch[1], title, description: clampText(input.description, 600), createdBy: user.id, submissions: 0, createdAt: now() };
      // preserve dueDate if callers still send one, but it's no longer required
      if (input.dueDate) assignmentPayload.dueDate = input.dueDate;
      const assignment = await store.addAssignment(assignmentPayload);
      return sendJson(res, 201, { assignment });
    }
  }
  if (replyMatch && method === 'POST') {
    const discussion = await store.findDiscussion(replyMatch[1]);
    if (!discussion) return sendError(res, 404, 'Discussion not found.');
    const access = await groupAccess(req, res, discussion.groupId, user); if (!access) return;
    const input = await readJson(req);
    const body = clampText(input.body, 1200);
    if (body.length < 1) return sendError(res, 400, 'Write a reply before posting it.');
    const updatedDiscussion = await store.addReply(discussion.id, {
      id: id('reply'),
      authorId: user.id,
      authorName: user.name,
      authorAvatar: user.avatar,
      body,
      createdAt: now()
    });
    return sendJson(res, 201, { discussion: updatedDiscussion, reply: updatedDiscussion.replies.at(-1) });
  }
  if (discussionMatch) {
    const access = await groupAccess(req, res, discussionMatch[1], user); if (!access) return;
    if (method === 'GET') { const workspace = await store.workspace(discussionMatch[1], user.id); return sendJson(res, 200, { discussions: workspace.discussions }); }
    if (method === 'POST') { const input = await readJson(req); const title = clampText(input.title, 150); const body = clampText(input.body, 2000); if (title.length < 3 || body.length < 5) return sendError(res, 400, 'Add a meaningful title and message.'); const discussion = await store.addDiscussion({ id: id('dis'), groupId: discussionMatch[1], authorId: user.id, title, body, replies: [], pinned: false, createdAt: now() }); return sendJson(res, 201, { discussion }); }
  }
  if (method === 'POST' && pathname === '/api/study') {
    const input = await readJson(req); const access = await groupAccess(req, res, input.groupId, user); if (!access) return;
    const action = ['answer', 'flashcards', 'quiz', 'plan'].includes(input.action) ? input.action : 'answer'; const question = clampText(input.question, 400);
    const chunks = await store.searchChunks(access.group.id, question); const workspace = await store.workspace(access.group.id, user.id);
    let pdfBuffer = null;
    if (!chunks.length && GEMINI_API_KEY) {
      const pdf = workspace.resources.find((resource) => resource.mimeType === 'application/pdf' && resource.storagePath && resource.size <= 8 * 1024 * 1024);
      if (pdf) pdfBuffer = await fileStorage.download(pdf.storagePath);
    }
    return sendJson(res, 200, await generateStudyAid({ action, question, chunks, pdfBuffer, config: { apiKey: GEMINI_API_KEY, model: GEMINI_MODEL } }));
  }
  return sendError(res, 404, 'Route not found.');
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname; const absolute = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!absolute.startsWith(`${PUBLIC_DIR}${path.sep}`) || !fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) return sendError(res, 404, 'Page not found.');
  res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(absolute)] || 'application/octet-stream' }); fs.createReadStream(absolute).pipe(res);
}

function createServer() {
  return http.createServer(async (req, res) => {
    try { const pathname = new URL(req.url, `http://${req.headers.host}`).pathname; if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname); return serveStatic(req, res, pathname); }
    catch (error) { console.error(error); return sendError(res, error.message === 'Invalid JSON body.' ? 400 : 500, error.message || 'Unexpected server error.'); }
  });
}

//async function start() {
  //store = await createStore({ mongoUri: process.env.MONGODB_URI, databaseName: process.env.MONGODB_DATABASE, dataFile: path.join(DATA_DIR, 'db.json') });
  //fileStorage = await createFileStorage({
   // storageProvider: process.env.STORAGE_PROVIDER,
   // localRoot: path.join(DATA_DIR, 'uploads'),
   // s3Bucket: process.env.S3_BUCKET || process.env.AWS_S3_BUCKET,
   // s3Key: process.env.S3_KEY || process.env.AWS_ACCESS_KEY_ID,
   // s3Secret: process.env.S3_SECRET || process.env.AWS_SECRET_ACCESS_KEY,
    //s3Endpoint: process.env.S3_ENDPOINT,
   // s3Region: process.env.S3_REGION || process.env.AWS_REGION
  //});
  //const server = createServer(); await new Promise((resolve) => server.listen(PORT, resolve)); console.log(`StudyHub AI is running at http://localhost:${PORT} (${store.kind} data, ${fileStorage.kind} files)`); return server;
async function start() {
  await initialize();

  const server = createServer();

  await new Promise((resolve) => server.listen(PORT, resolve));

  

  return server;
}
//}

//if (require.main === module) start().catch((error) => { console.error('StudyHub could not start:', error); process.exitCode = 1; });
if (process.env.VERCEL !== "1") {
    start().catch(console.error);
}
module.exports = createServer();
