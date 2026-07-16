const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MongoClient, ServerApiVersion } = require('mongodb');

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const withoutMongoId = (document) => {
  if (!document) return document;
  const { _id, ...result } = document;
  return result;
};

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function computeStreak(values) {
  const uniqueDays = new Set(values.map(dayKey).filter(Boolean));
  let streak = 0;
  const current = new Date();
  current.setUTCHours(0, 0, 0, 0);
  while (uniqueDays.has(current.toISOString().slice(0, 10))) {
    streak += 1;
    current.setUTCDate(current.getUTCDate() - 1);
  }
  return streak;
}

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function defaultDb() {
  const demoId = 'usr_demo';
  const groupId = 'grp_os';
  return {
    users: [{ id: demoId, name: 'Aarav Patel', email: 'demo@studyhub.ai', passwordHash: passwordHash('demo1234'), avatar: 'AP', createdAt: now() }],
    groups: [
      { id: groupId, name: 'Operating Systems • Semester 4', description: 'A focused space for notes, assignments, revision and peer discussions.', subject: 'Operating Systems', privacy: 'private', inviteCode: 'OS4-LEARN', ownerId: demoId, cover: 'violet', createdAt: now() },
      { id: 'grp_dbms', name: 'DBMS Exam Lab', description: 'Practice resources and quick doubts for DBMS.', subject: 'Database Management Systems', privacy: 'public', inviteCode: 'DBMS-2026', ownerId: demoId, cover: 'teal', createdAt: now() }
    ],
    memberships: [{ id: 'mem_os', groupId, userId: demoId, role: 'owner', joinedAt: now() }, { id: 'mem_dbms', groupId: 'grp_dbms', userId: demoId, role: 'owner', joinedAt: now() }],
    resources: [
      { id: 'res_deadlocks', groupId, title: 'Unit 4 — Deadlocks & Scheduling', type: 'PDF', subject: 'Operating Systems', unit: 'Unit 4', tags: ['deadlock', 'scheduling', 'exam'], description: 'Class notes covering deadlock conditions, prevention and scheduling algorithms.', uploaderId: demoId, fileName: 'os-unit-4-notes.pdf', size: 1420000, downloads: 18, indexStatus: 'demo', createdAt: now() },
      { id: 'res_memory', groupId, title: 'Memory Management Cheatsheet', type: 'DOCX', subject: 'Operating Systems', unit: 'Unit 3', tags: ['paging', 'segmentation', 'revision'], description: 'One-page revision reference for paging, segmentation and virtual memory.', uploaderId: demoId, fileName: 'memory-management-cheatsheet.docx', size: 320000, downloads: 9, indexStatus: 'demo', createdAt: now() }
    ],
    assignments: [{ id: 'asg_banker', groupId, title: "Banker's Algorithm Walkthrough", description: 'Solve the supplied safe-sequence problem and explain each allocation decision.', createdBy: demoId, submissions: 3, createdAt: now() }],
    discussions: [{ id: 'dis_prevention', groupId, authorId: demoId, title: 'Deadlock prevention vs avoidance — a simple distinction?', body: 'I keep mixing these up during revision. Can someone share an easy way to remember the difference?', replies: [{ id: 'reply_seed', authorId: 'usr_maya', authorName: 'Maya', authorAvatar: 'MY', body: 'Prevention breaks one necessary condition. Avoidance checks whether the next allocation keeps the system safe.', createdAt: now() }], pinned: true, createdAt: now() }],
    activity: [{ id: 'act_seed', userId: demoId, groupId, kind: 'resource_uploaded', text: 'uploaded Unit 4 — Deadlocks & Scheduling', createdAt: now() }],
    resourceChunks: [
      { id: 'chunk_deadlocks_1', groupId, resourceId: 'res_deadlocks', resourceTitle: 'Unit 4 — Deadlocks & Scheduling', position: 0, content: 'A deadlock occurs when a set of processes wait indefinitely because each process holds a resource and waits for a resource held by another process. The four necessary conditions are mutual exclusion, hold and wait, no preemption, and circular wait.' },
      { id: 'chunk_deadlocks_2', groupId, resourceId: 'res_deadlocks', resourceTitle: 'Unit 4 — Deadlocks & Scheduling', position: 1, content: 'Deadlock prevention deliberately breaks at least one necessary condition. Deadlock avoidance evaluates each allocation request and grants it only if the system stays in a safe state. The Banker algorithm is a classic avoidance method.' }
    ]
  };
}



class LocalStore {
  constructor(dataFile) { this.dataFile = dataFile; this.data = null; this.kind = 'local'; }
  async init() {
    fs.mkdirSync(path.dirname(this.dataFile), { recursive: true });
    if (!fs.existsSync(this.dataFile)) fs.writeFileSync(this.dataFile, JSON.stringify(defaultDb(), null, 2));
    this.data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
    this.data.resourceChunks ||= [];
    if (!this.data.resourceChunks.length && this.data.resources?.some((resource) => resource.id === 'res_deadlocks')) {
      this.data.resourceChunks = defaultDb().resourceChunks;
      this.save();
    }
  }
  save() { fs.writeFileSync(`${this.dataFile}.tmp`, JSON.stringify(this.data, null, 2)); fs.renameSync(`${this.dataFile}.tmp`, this.dataFile); }
  async findUserByEmail(email) { return this.data.users.find((user) => user.email === email) || null; }
  async findUserById(userId) { return this.data.users.find((user) => user.id === userId) || null; }
  async createUser(input) { const user = { id: id('usr'), ...input, createdAt: now() }; this.data.users.push(user); this.save(); return user; }
  async userGroups(userId) { return Promise.all(this.data.memberships.filter((membership) => membership.userId === userId).map((membership) => this.decorateGroup(this.data.groups.find((group) => group.id === membership.groupId), userId))); }
  async listPublicGroups(query) {
    const q = String(query || '').trim().toLowerCase();
    let groups = this.data.groups.filter((g) => g.privacy === 'public');
    if (q) groups = groups.filter((g) => (g.name || '').toLowerCase().includes(q) || (g.subject || '').toLowerCase().includes(q) || (g.description || '').toLowerCase().includes(q));
    return Promise.all(groups.map((g) => this.decorateGroup(g, null)));
  }
  async decorateGroup(group, userId) {
    if (!group) return null;
    const membership = this.data.memberships.find((item) => item.groupId === group.id && item.userId === userId);
    return { ...group, memberCount: this.data.memberships.filter((item) => item.groupId === group.id).length, resourceCount: this.data.resources.filter((item) => item.groupId === group.id).length, assignmentCount: this.data.assignments.filter((item) => item.groupId === group.id).length, role: membership?.role || null };
  }
  async dashboard(userId) {
    const groups = (await this.userGroups(userId)).filter(Boolean);
    const groupIds = groups.map((group) => group.id);
    const userActivities = this.data.activity.filter((item) => item.userId === userId && groupIds.includes(item.groupId));
    return {
      groups,
      metrics: {
        groups: groupIds.length,
        resources: this.data.resources.filter((item) => groupIds.includes(item.groupId)).length,
        assignments: this.data.assignments.filter((item) => groupIds.includes(item.groupId)).length,
        streak: computeStreak(userActivities.map((item) => item.createdAt))
      },
      activities: this.data.activity.filter((item) => groupIds.includes(item.groupId)).slice(0, 8)
    };
  }
  async groupAccess(groupId, userId) {
    const group = this.data.groups.find((item) => item.id === groupId);
    const membership = this.data.memberships.find((item) => item.groupId === groupId && item.userId === userId);
    return group && membership ? { group, membership } : null;
  }
  async workspace(groupId, userId) {
    const access = await this.groupAccess(groupId, userId); if (!access) return null;
    return { group: await this.decorateGroup(access.group, userId), resources: this.data.resources.filter((item) => item.groupId === groupId), assignments: this.data.assignments.filter((item) => item.groupId === groupId), discussions: this.data.discussions.filter((item) => item.groupId === groupId) };
  }
  async createGroup(input, userId) {
    const group = { id: id('grp'), ...input, inviteCode: crypto.randomBytes(3).toString('hex').toUpperCase(), ownerId: userId, cover: ['violet', 'teal', 'orange'][this.data.groups.length % 3], createdAt: now() };
    this.data.groups.push(group); this.data.memberships.push({ id: id('mem'), groupId: group.id, userId, role: 'owner', joinedAt: now() }); this.addActivity(userId, group.id, 'group_created', `created ${group.name}`); this.save(); return this.decorateGroup(group, userId);
  }
  async deleteGroup(groupId, userId) {
    const group = this.data.groups.find((item) => item.id === groupId);
    if (!group || group.ownerId !== userId) return null;
    this.data.groups = this.data.groups.filter((item) => item.id !== groupId);
    this.data.memberships = this.data.memberships.filter((item) => item.groupId !== groupId);
    this.data.resources = this.data.resources.filter((item) => item.groupId !== groupId);
    this.data.assignments = this.data.assignments.filter((item) => item.groupId !== groupId);
    this.data.discussions = this.data.discussions.filter((item) => item.groupId !== groupId);
    this.data.activity = this.data.activity.filter((item) => item.groupId !== groupId);
    this.data.resourceChunks = this.data.resourceChunks.filter((item) => item.groupId !== groupId);
    this.save();
    return group;
  }
  async joinGroup(inviteCode, userId) {
    const group = this.data.groups.find((item) => item.inviteCode === inviteCode); if (!group) return null;
    if (!this.data.memberships.some((item) => item.groupId === group.id && item.userId === userId)) { this.data.memberships.push({ id: id('mem'), groupId: group.id, userId, role: 'member', joinedAt: now() }); this.addActivity(userId, group.id, 'group_joined', `joined ${group.name}`); this.save(); }
    return this.decorateGroup(group, userId);
  }
  addActivity(userId, groupId, kind, text) { this.data.activity.unshift({ id: id('act'), userId, groupId, kind, text, createdAt: now() }); }
  async addResource(resource, chunks) { this.data.resources.unshift(resource); this.data.resourceChunks.push(...chunks); this.addActivity(resource.uploaderId, resource.groupId, 'resource_uploaded', `uploaded ${resource.title}`); this.save(); return resource; }
  async deleteResource(resourceId, userId) {
    const resource = this.data.resources.find((item) => item.id === resourceId);
    if (!resource) return null;
    const access = await this.groupAccess(resource.groupId, userId);
    if (!access) return null;
    const canManage = access.membership.role === 'owner' || resource.uploaderId === userId || access.group.ownerId === userId;
    if (!canManage) return null;
    this.data.resources = this.data.resources.filter((item) => item.id !== resourceId);
    this.data.resourceChunks = this.data.resourceChunks.filter((item) => item.resourceId !== resourceId);
    this.save();
    return resource;
  }
  async addAssignment(assignment) { this.data.assignments.unshift(assignment); this.addActivity(assignment.createdBy, assignment.groupId, 'assignment_created', `added ${assignment.title}`); this.save(); return assignment; }
  async deleteAssignment(assignmentId, userId) {
    const assignment = this.data.assignments.find((item) => item.id === assignmentId);
    if (!assignment) return null;
    const access = await this.groupAccess(assignment.groupId, userId);
    if (!access) return null;
    const canManage = access.membership.role === 'owner' || assignment.createdBy === userId || access.group.ownerId === userId;
    if (!canManage) return null;
    this.data.assignments = this.data.assignments.filter((item) => item.id !== assignmentId);
    this.save();
    return assignment;
  }
  async addDiscussion(discussion) { this.data.discussions.unshift(discussion); this.addActivity(discussion.authorId, discussion.groupId, 'discussion_created', `started a discussion: ${discussion.title}`); this.save(); return discussion; }
  async findDiscussion(discussionId) { return this.data.discussions.find((item) => item.id === discussionId) || null; }
  async addReply(discussionId, reply) {
    const discussion = await this.findDiscussion(discussionId);
    if (!discussion) return null;
    discussion.replies ||= [];
    discussion.replies.push(reply);
    this.addActivity(reply.authorId, discussion.groupId, 'discussion_replied', `replied to ${discussion.title}`);
    this.save();
    return discussion;
  }
  async findResource(resourceId) { return this.data.resources.find((item) => item.id === resourceId) || null; }
  async incrementResourceDownloads(resourceId) {
    const r = this.data.resources.find((item) => item.id === resourceId);
    if (!r) return null;
    r.downloads = (r.downloads || 0) + 1;
    this.save();
    return r;
  }
  async searchChunks(groupId, query) { return rankChunks(this.data.resourceChunks.filter((chunk) => chunk.groupId === groupId), query); }

  async getResourcesByIndexStatus(status, limit = 10) { return this.data.resources.filter((r) => r.indexStatus === status).slice(0, limit); }
  async updateResourceIndexStatus(resourceId, status, error = null) { const r = this.data.resources.find((item) => item.id === resourceId); if (!r) return null; r.indexStatus = status; r.indexError = error; this.save(); return r; }
  async addChunks(resourceId, chunks) { if (!chunks || !chunks.length) return; this.data.resourceChunks.push(...chunks); this.save(); }
  async updateResource(resourceId, updates) { const r = this.data.resources.find((item) => item.id === resourceId); if (!r) return null; Object.assign(r, updates); this.save(); return r; }
}

class MongoStore {
  constructor(uri, databaseName) { this.uri = uri; this.databaseName = databaseName; this.kind = 'mongo'; }
  async init() {
    this.client = new MongoClient(this.uri, { serverApi: { version: ServerApiVersion.v1, strict: false, deprecationErrors: true }, maxPoolSize: 20 });
    await this.client.connect();
    await this.client.connect();

console.log("Connected!");

const admin = this.client.db().admin();

console.log(await admin.command({ ping: 1 }));
    this.db = this.client.db(this.databaseName);
    this.users = this.db.collection('users'); this.groups = this.db.collection('groups'); this.memberships = this.db.collection('memberships'); this.resources = this.db.collection('resources'); this.assignments = this.db.collection('assignments'); this.discussions = this.db.collection('discussions'); this.activity = this.db.collection('activity'); this.chunks = this.db.collection('resourceChunks');
    await Promise.all([this.users.createIndex({ email: 1 }, { unique: true }), this.memberships.createIndex({ groupId: 1, userId: 1 }, { unique: true }), this.resources.createIndex({ groupId: 1, createdAt: -1 }), this.assignments.createIndex({ groupId: 1, dueDate: 1 }), this.chunks.createIndex({ groupId: 1, resourceId: 1 }), this.chunks.createIndex({ content: 'text', resourceTitle: 'text' })]);
    if (await this.users.countDocuments() === 0) await this.seed();
  }
  async seed() { const data = defaultDb(); await Promise.all([this.users.insertMany(data.users), this.groups.insertMany(data.groups), this.memberships.insertMany(data.memberships), this.resources.insertMany(data.resources), this.assignments.insertMany(data.assignments), this.discussions.insertMany(data.discussions), this.activity.insertMany(data.activity), this.chunks.insertMany(data.resourceChunks)]); }
  async findUserByEmail(email) { return withoutMongoId(await this.users.findOne({ email })); }
  async findUserById(userId) { return withoutMongoId(await this.users.findOne({ id: userId })); }
  async createUser(input) { const user = { id: id('usr'), ...input, createdAt: now() }; await this.users.insertOne(user); return user; }
  async decorateGroup(group, userId) {
    if (!group) return null;
    const [membership, memberCount, resourceCount, assignmentCount] = await Promise.all([this.memberships.findOne({ groupId: group.id, userId }, { projection: { _id: 0 } }), this.memberships.countDocuments({ groupId: group.id }), this.resources.countDocuments({ groupId: group.id }), this.assignments.countDocuments({ groupId: group.id })]);
    return { ...withoutMongoId(group), memberCount, resourceCount, assignmentCount, role: membership?.role || null };
  }
  async userGroups(userId) { const membership = await this.memberships.find({ userId }, { projection: { _id: 0 } }).toArray(); const groups = await this.groups.find({ id: { $in: membership.map((item) => item.groupId) } }, { projection: { _id: 0 } }).toArray(); return Promise.all(groups.map((group) => this.decorateGroup(group, userId))); }
  async listPublicGroups(query) {
    const q = String(query || '').trim();
    const filter = { privacy: 'public' };
    if (q) {
      const regex = new RegExp(q, 'i');
      filter.$or = [{ name: regex }, { subject: regex }, { description: regex }];
    }
    const groups = await this.groups.find(filter, { projection: { _id: 0 } }).limit(50).toArray();
    return Promise.all(groups.map((g) => this.decorateGroup(g, null)));
  }
  async dashboard(userId) {
    const groups = await this.userGroups(userId);
    const groupIds = groups.map((group) => group.id);
    const [resourceCount, assignmentCount, activities, userActivityDates] = await Promise.all([
      this.resources.countDocuments({ groupId: { $in: groupIds } }),
      this.assignments.countDocuments({ groupId: { $in: groupIds } }),
      this.activity.find({ groupId: { $in: groupIds } }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(8).toArray(),
      this.activity.find({ groupId: { $in: groupIds }, userId }, { projection: { _id: 0, createdAt: 1 } }).toArray()
    ]);
    return {
      groups,
      metrics: {
        groups: groupIds.length,
        resources: resourceCount,
        assignments: assignmentCount,
        streak: computeStreak(userActivityDates.map((item) => item.createdAt))
      },
      activities
    };
  }
  async groupAccess(groupId, userId) { const [group, membership] = await Promise.all([this.groups.findOne({ id: groupId }, { projection: { _id: 0 } }), this.memberships.findOne({ groupId, userId }, { projection: { _id: 0 } })]); return group && membership ? { group, membership } : null; }
  async workspace(groupId, userId) { const access = await this.groupAccess(groupId, userId); if (!access) return null; const [resources, assignments, discussions, group] = await Promise.all([this.resources.find({ groupId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray(), this.assignments.find({ groupId }, { projection: { _id: 0 } }).sort({ dueDate: 1 }).toArray(), this.discussions.find({ groupId }, { projection: { _id: 0 } }).sort({ pinned: -1, createdAt: -1 }).toArray(), this.decorateGroup(access.group, userId)]); return { group, resources, assignments, discussions }; }
  async createGroup(input, userId) { const count = await this.groups.countDocuments(); const group = { id: id('grp'), ...input, inviteCode: crypto.randomBytes(3).toString('hex').toUpperCase(), ownerId: userId, cover: ['violet', 'teal', 'orange'][count % 3], createdAt: now() }; await this.groups.insertOne(group); await this.memberships.insertOne({ id: id('mem'), groupId: group.id, userId, role: 'owner', joinedAt: now() }); await this.addActivity(userId, group.id, 'group_created', `created ${group.name}`); return this.decorateGroup(group, userId); }
  async deleteGroup(groupId, userId) {
    const group = await this.groups.findOne({ id: groupId }, { projection: { _id: 0 } });
    if (!group || group.ownerId !== userId) return null;
    await Promise.all([
      this.groups.deleteOne({ id: groupId }),
      this.memberships.deleteMany({ groupId }),
      this.resources.deleteMany({ groupId }),
      this.assignments.deleteMany({ groupId }),
      this.discussions.deleteMany({ groupId }),
      this.activity.deleteMany({ groupId }),
      this.chunks.deleteMany({ groupId })
    ]);
    return group;
  }
  async joinGroup(inviteCode, userId) { const group = await this.groups.findOne({ inviteCode }, { projection: { _id: 0 } }); if (!group) return null; const result = await this.memberships.updateOne({ groupId: group.id, userId }, { $setOnInsert: { id: id('mem'), groupId: group.id, userId, role: 'member', joinedAt: now() } }, { upsert: true }); if (result.upsertedCount) await this.addActivity(userId, group.id, 'group_joined', `joined ${group.name}`); return this.decorateGroup(group, userId); }
  async addActivity(userId, groupId, kind, text) { await this.activity.insertOne({ id: id('act'), userId, groupId, kind, text, createdAt: now() }); }
  async addResource(resource, chunks) { await this.resources.insertOne(resource); if (chunks.length) await this.chunks.insertMany(chunks); await this.addActivity(resource.uploaderId, resource.groupId, 'resource_uploaded', `uploaded ${resource.title}`); return resource; }
  async deleteResource(resourceId, userId) {
    const resource = await this.findResource(resourceId);
    if (!resource) return null;
    const access = await this.groupAccess(resource.groupId, userId);
    if (!access) return null;
    const canManage = access.membership?.role === 'owner' || resource.uploaderId === userId || access.group.ownerId === userId;
    if (!canManage) return null;
    await Promise.all([this.resources.deleteOne({ id: resourceId }), this.chunks.deleteMany({ resourceId })]);
    return resource;
  }
  async addAssignment(assignment) { await this.assignments.insertOne(assignment); await this.addActivity(assignment.createdBy, assignment.groupId, 'assignment_created', `added ${assignment.title}`); return assignment; }
  async deleteAssignment(assignmentId, userId) {
    const assignment = await this.assignments.findOne({ id: assignmentId }, { projection: { _id: 0 } });
    if (!assignment) return null;
    const access = await this.groupAccess(assignment.groupId, userId);
    if (!access) return null;
    const canManage = access.membership?.role === 'owner' || assignment.createdBy === userId || access.group.ownerId === userId;
    if (!canManage) return null;
    await this.assignments.deleteOne({ id: assignmentId });
    return assignment;
  }
  async addDiscussion(discussion) { await this.discussions.insertOne(discussion); await this.addActivity(discussion.authorId, discussion.groupId, 'discussion_created', `started a discussion: ${discussion.title}`); return discussion; }
  async findDiscussion(discussionId) { return withoutMongoId(await this.discussions.findOne({ id: discussionId })); }
  async addReply(discussionId, reply) {
    const discussion = await this.findDiscussion(discussionId);
    if (!discussion) return null;
    await this.discussions.updateOne({ id: discussionId }, { $push: { replies: reply } });
    await this.addActivity(reply.authorId, discussion.groupId, 'discussion_replied', `replied to ${discussion.title}`);
    return this.findDiscussion(discussionId);
  }
  async findResource(resourceId) { return withoutMongoId(await this.resources.findOne({ id: resourceId })); }
  async incrementResourceDownloads(resourceId) {
    await this.resources.updateOne({ id: resourceId }, { $inc: { downloads: 1 } });
    return this.findResource(resourceId);
  }
  async searchChunks(groupId, query) {
    const text = String(query || '').trim();
    if (!text) return this.chunks.find({ groupId }, { projection: { _id: 0 } }).limit(8).toArray();
    try { const results = await this.chunks.find({ groupId, $text: { $search: text } }, { projection: { _id: 0, score: { $meta: 'textScore' } } }).sort({ score: { $meta: 'textScore' } }).limit(8).toArray(); if (results.length) return results; } catch (_) { /* Fallback keeps dev databases useful before the text index is ready. */ }
    return rankChunks(await this.chunks.find({ groupId }, { projection: { _id: 0 } }).toArray(), text);
  }

  async getResourcesByIndexStatus(status, limit = 10) { return await this.resources.find({ indexStatus: status }, { projection: { _id: 0 } }).limit(limit).toArray(); }
  async updateResourceIndexStatus(resourceId, status, error = null) { await this.resources.updateOne({ id: resourceId }, { $set: { indexStatus: status, indexError: error } }); return this.findResource(resourceId); }
  async addChunks(resourceId, chunks) { if (!chunks || !chunks.length) return; await this.chunks.insertMany(chunks); }
  async updateResource(resourceId, updates) { await this.resources.updateOne({ id: resourceId }, { $set: updates }); return this.findResource(resourceId); }
}

function rankChunks(chunks, query) {
  const terms = String(query || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  return chunks.map((chunk) => ({ ...chunk, score: terms.reduce((score, term) => score + (String(chunk.content).toLowerCase().match(new RegExp(term, 'g')) || []).length, 0) })).sort((a, b) => b.score - a.score).slice(0, 8);
}

async function createStore({ mongoUri, databaseName, dataFile }) {
  const store = mongoUri ? new MongoStore(mongoUri, databaseName || 'studyhub') : new LocalStore(dataFile);
  await store.init();
  return store;
}

module.exports = { createStore, defaultDb, passwordHash, id, now };
