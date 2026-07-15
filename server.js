require('dotenv').config();

// Read and normalize important environment variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ? String(process.env.GEMINI_API_KEY).trim() : null;
const GEMINI_MODEL = process.env.GEMINI_MODEL ? String(process.env.GEMINI_MODEL).trim() : 'gemini-flash-latest';
console.log("===== GEMINI CONFIG =====");
console.log("API Key Loaded:", !!GEMINI_API_KEY);
console.log("Model:", GEMINI_MODEL);
console.log("=========================");

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
const sessions = new Map();
const MIME_TYPES = { '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const SUPPORTED_EXTENSIONS = new Map([
  ['pdf', 'application/pdf'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['txt', 'text/plain'], ['md', 'text/markdown'], ['markdown', 'text/markdown'], ['csv', 'text/csv']
]);

let store;
let fileStorage;

function clampText(value, max) { return String(value || '').trim().slice(0, max); }
function safeUser(user) { if (!user) return null; const { passwordHash: _passwordHash, ...safe } = user; return safe; }
function verifyPassword(password, stored) {
  const [salt, storedHash] = String(stored || '').split(':');
  if (!salt || !storedHash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString('hex');
  return candidate.length === storedHash.length && crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(storedHash, 'hex'));
}
function getCookie(req, name) { const hit = String(req.headers.cookie || '').split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`)); return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null; }
async function sessionUser(req) { const token = getCookie(req, 'studyhub_session'); return token ? store.findUserById(sessions.get(token)) : null; }
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

async function addUploadedResource(req, res, groupId, user) {
  const access = await groupAccess(req, res, groupId, user); if (!access) return;
  const { fields, file } = await readMultipart(req);
  const { canonicalMimeType, displayType } = fileDetails(file);
  const title = clampText(fields.title, 120);
  if (title.length < 3) return sendError(res, 400, 'A resource title of at least 3 characters is required.');
  const storage = await fileStorage.upload({ groupId, fileName: file.name, buffer: file.buffer, mimeType: canonicalMimeType });
  // Defer text extraction to background worker to avoid blocking uploads.
  let text = ''; let indexStatus = 'pending'; let indexError = null;
  const resource = {
    id: id('res'), groupId, title, fileName: file.name, type: displayType, mimeType: canonicalMimeType, storagePath: storage.storagePath,
    subject: clampText(fields.subject, 80) || access.group.subject, unit: clampText(fields.unit, 40) || 'General', tags: String(fields.tags || '').split(',').map((tag) => clampText(tag, 24)).filter(Boolean).slice(0, 8), description: clampText(fields.description, 400), size: file.buffer.length, uploaderId: user.id, downloads: 0, indexStatus, indexError, textLength: text.length, createdAt: now()
  };
  const chunks = [];
  await store.addResource(resource, chunks);
  return sendJson(res, 201, { resource, indexedChunks: chunks.length });
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
  const { method } = req;
  if (method === 'GET' && pathname === '/api/health') return sendJson(res, 200, { status: 'ok', database: store.kind, storage: fileStorage.kind, aiConfigured: Boolean(GEMINI_API_KEY) });
  if (method === 'GET' && pathname === '/api/session') return sendJson(res, 200, { user: safeUser(await sessionUser(req)) });
  if (method === 'POST' && pathname === '/api/auth/register') {
    const input = await readJson(req); const name = clampText(input.name, 80); const email = clampText(input.email, 120).toLowerCase(); const password = String(input.password || '');
    if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) return sendError(res, 400, 'Enter a name, valid email, and password of at least 8 characters.');
    if (await store.findUserByEmail(email)) return sendError(res, 409, 'An account already uses this email.');
    const user = await store.createUser({ name, email, passwordHash: passwordHash(password), avatar: name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() });
    const token = crypto.randomUUID(); sessions.set(token, user.id); return sendJson(res, 201, { user: safeUser(user) }, { 'Set-Cookie': `studyhub_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800` });
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    const input = await readJson(req); const user = await store.findUserByEmail(String(input.email || '').trim().toLowerCase());
    if (!user || !verifyPassword(String(input.password || ''), user.passwordHash)) return sendError(res, 401, 'Incorrect email or password.');
    const token = crypto.randomUUID(); sessions.set(token, user.id); return sendJson(res, 200, { user: safeUser(user) }, { 'Set-Cookie': `studyhub_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800` });
  }
  if (method === 'POST' && pathname === '/api/auth/logout') { const token = getCookie(req, 'studyhub_session'); if (token) sessions.delete(token); return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'studyhub_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' }); }

  // Public API: list discoverable public groups (no auth required)
  if (method === 'GET' && pathname === '/api/public-groups') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const q = url.searchParams.get('q') || '';
      const groups = await store.listPublicGroups(q);
      return sendJson(res, 200, { groups });
    } catch (err) {
      return sendError(res, 500, 'Could not list public groups.');
    }
  }

  const user = await requireUser(req, res); if (!user) return;
  if (method === 'GET' && pathname === '/api/dashboard') return sendJson(res, 200, await store.dashboard(user.id));
  if (method === 'GET' && pathname === '/api/groups') return sendJson(res, 200, { groups: (await store.userGroups(user.id)).filter(Boolean) });
  if (method === 'POST' && pathname === '/api/groups') {
    const input = await readJson(req); const name = clampText(input.name, 100); const subject = clampText(input.subject, 80); const description = clampText(input.description, 400);
    if (name.length < 3 || subject.length < 2) return sendError(res, 400, 'Group name and subject are required.');
    return sendJson(res, 201, { group: await store.createGroup({ name, subject, description, privacy: input.privacy === 'public' ? 'public' : 'private' }, user.id) });
  }
  if (method === 'POST' && pathname === '/api/groups/join') {
    const input = await readJson(req); const group = await store.joinGroup(clampText(input.inviteCode, 30).toUpperCase(), user.id); if (!group) return sendError(res, 404, 'No group matches that invite code.'); return sendJson(res, 200, { group });
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

async function start() {
  store = await createStore({ mongoUri: process.env.MONGODB_URI, databaseName: process.env.MONGODB_DATABASE, dataFile: path.join(DATA_DIR, 'db.json') });
  fileStorage = await createFileStorage({
    storageProvider: process.env.STORAGE_PROVIDER,
    localRoot: path.join(DATA_DIR, 'uploads'),
    s3Bucket: process.env.S3_BUCKET || process.env.AWS_S3_BUCKET,
    s3Key: process.env.S3_KEY || process.env.AWS_ACCESS_KEY_ID,
    s3Secret: process.env.S3_SECRET || process.env.AWS_SECRET_ACCESS_KEY,
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Region: process.env.S3_REGION || process.env.AWS_REGION
  });
  const server = createServer(); await new Promise((resolve) => server.listen(PORT, resolve)); console.log(`StudyHub AI is running at http://localhost:${PORT} (${store.kind} data, ${fileStorage.kind} files)`); return server;
}

//if (require.main === module) start().catch((error) => { console.error('StudyHub could not start:', error); process.exitCode = 1; });
if (process.env.VERCEL !== "1") {
    start().catch(console.error);
}
module.exports = {
    createServer,
    start,
    defaultDb
};
