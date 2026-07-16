console.log("APP JS LOADED");
const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');

const state = {
  user: null,
  page: 'dashboard',
  dashboard: null,
  groups: [],
  activeGroup: null,
  groupData: null,
  groupTab: 'overview',
  chatHistory: [],
  isThinking: false,
  mobileSidebarOpen: false
};

const icons = { dashboard: '🏠︎', groups: '👥', study: '✦', notifications: '🔔', settings: '⏣' };

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function renderInlineMarkdown(value) {
  return value
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function renderStructuredText(value = '') {
  const lines = escapeHtml(value).replace(/\r/g, '').split('\n');
  const output = []; let list = null; let inCode = false;
  const closeList = () => { if (list) { output.push(`</${list}>`); list = null; } };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('```')) { closeList(); output.push(inCode ? '</code></pre>' : '<pre><code>'); inCode = !inCode; continue; }
    if (inCode) { output.push(`${rawLine}\n`); continue; }
    if (!line) { closeList(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (heading) { closeList(); const level = Math.min(heading[1].length + 2, 5); output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`); continue; }
    if (numbered) { if (list !== 'ol') { closeList(); list = 'ol'; output.push('<ol>'); } output.push(`<li>${renderInlineMarkdown(numbered[1])}</li>`); continue; }
    if (bullet) { if (list !== 'ul') { closeList(); list = 'ul'; output.push('<ul>'); } output.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`); continue; }
    if (line.startsWith('&gt;')) { closeList(); output.push(`<blockquote>${renderInlineMarkdown(line.slice(4).trim())}</blockquote>`); continue; }
    closeList(); output.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }
  closeList(); if (inCode) output.push('</code></pre>');
  return output.join('') || '<p>No answer was returned.</p>';
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value));
}

function relativeDate(value) {
  const hours = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 3600000));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function getCurrentDate() {
  return new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());
}

function initials(name = 'Member') {
  return String(name).split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'M';
}

async function request(url, options = {}) {
  const isForm = options.body instanceof FormData;
  const response = await fetch(url, {
    headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function notify(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.textContent = message;
  toastRegion.append(toast);
  window.setTimeout(() => toast.remove(), 3200);
}

async function copyToClipboard(value) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
    else {
      const textArea = document.createElement('textarea');
      textArea.value = value;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.append(textArea);
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
    }
    notify('Invite code copied. Share it with your classmates.');
  } catch {
    notify('Could not copy automatically. Please copy the code manually.', true);
  }
}

function button(label, action, extra = '') {
  return `<button class="button ${extra}" data-action="${action}">${label}</button>`;
}

function renderAuth(mode = 'login') {

  const isRegister = mode === 'register';
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-art">
        <div class="brand"><span class="brand-mark">✦</span> StudyHub AI</div>
        <div class="auth-copy">
          <div class="eyebrow">Your learning space</div>
          <h1>Learn together.<br />Study with clarity.</h1>
          <p>Bring your group’s notes, assignments and discussions into one focused workspace—with an AI study chat built into your groups.</p>
          <div class="feature-pills"><span>Shared resources</span><span>Group discussions</span><span>Gemini StudyBot</span></div>
        </div>
      </section>
      <section class="auth-form-wrap">
        <div class="auth-card">
          <div class="brand"><span class="brand-mark">✦</span> StudyHub AI</div>
          <h2>${isRegister ? 'Create your workspace' : 'Welcome back'}</h2>
          <p class="subtext">${isRegister ? 'Start sharing smarter with your study group.' : 'Sign in to continue your learning journey.'}</p>
          <form class="form-stack" data-form="${isRegister ? 'register' : 'login'}">
            ${isRegister ? '<label>Full name<input required name="name" placeholder="e.g. Aarav Patel" maxlength="80" /></label>' : ''}
            <label>Email address<input required type="email" name="email" placeholder="you@example.com" /></label>
            <label>Password<input required type="password" minlength="8" name="password" placeholder="At least 8 characters" /></label>
            <button class="button button-primary wide" type="submit">${isRegister ? 'Create account →' : 'Sign in →'}</button>
          </form>
          <p class="auth-switch">${isRegister ? 'Already have an account?' : 'New to StudyHub?'} <button class="text-link" data-action="auth-${isRegister ? 'login' : 'register'}">${isRegister ? 'Sign in' : 'Create an account'}</button></p>
         
        </div>
      </section>
    </main>`;

}

function navItem(page, label) {
  return `<button class="nav-item ${state.page === page ? 'active' : ''}" data-action="nav" data-page="${page}"><span class="nav-icon">${icons[page]}</span><span>${label}</span></button>`;
}

function renderShell(content, crumb = 'Workspace', primary = '') {
  const isMobile = window.matchMedia('(max-width: 480px)').matches;
  app.innerHTML = `
    <div class="app-shell${isMobile && state.mobileSidebarOpen ? ' mobile-sidebar-open' : ''}">
      <div class="mobile-sidebar-backdrop" data-action="close-mobile-sidebar"></div>
      <aside class="sidebar">
        <div class="sidebar-head">
          <div class="brand"><span class="brand-mark">✦</span> StudyHub AI</div>
          <button class="mobile-sidebar-close" data-action="close-mobile-sidebar" aria-label="Close navigation">✕</button>
        </div>
        <div class="nav-group"><div class="nav-label">Workspace</div>${navItem('dashboard', 'Overview')}${navItem('groups', 'Study groups')}${navItem('study', 'StudyBot')}</div>
        <div class="nav-group"><div class="nav-label">Personal</div>${navItem('notifications', 'Notifications')}${navItem('settings', 'Settings')}</div>
        <div class="sidebar-spacer"></div>
        <div class="help-card"><h3>Need a fresh start?</h3><p>Create a group and invite your classmates with a simple code.</p><button data-action="open-create-group">Create a group</button></div>
        <div class="profile-bar"><div class="avatar">${escapeHtml(state.user.avatar)}</div><div><div class="profile-name">${escapeHtml(state.user.name)}</div><div class="profile-role">Student account</div></div><button class="profile-menu" title="Sign out" data-action="logout">➜]</button></div>
      </aside>
      <main class="main">
        <header class="topbar"><div class="breadcrumbs">StudyHub AI <span> / </span><strong>${escapeHtml(crumb)}</strong></div><div class="top-actions">${isMobile ? '<button class="mobile-nav-toggle" title="Open navigation" data-action="toggle-mobile-sidebar" aria-label="Open navigation">☰</button>' : ''}<button class="icon-button" title="Notifications" data-action="nav" data-page="notifications">🔔</button>${primary}</div></header>
        ${content}
      </main>
    </div>`;
}

function loadingPage() {
  return '<div class="page"><div class="loading"><span class="spinner"></span>Loading your workspace…</div></div>';
}

function groupCover(group) {
  return `<div class="group-cover ${escapeHtml(group.cover || 'violet')}">${escapeHtml(group.subject || group.name).slice(0, 2).toUpperCase()}</div>`;
}

function renderDashboard() {
  const data = state.dashboard;
  if (!data) return renderShell(loadingPage(), 'Overview', button('Create group +', 'open-create-group', 'button-primary'));
  const metrics = data.metrics;
  const activityHtml = data.activities.length ? data.activities.map((activity) => `<div class="activity"><div class="activity-dot">${activity.kind === 'resource_uploaded' ? '➕' : activity.kind === 'assignment_created' ? '📤' : '➕'}</div><div><div class="activity-copy"><strong>You</strong> ${escapeHtml(activity.text)}</div><div class="activity-time" data-timestamp="${activity.createdAt}">${relativeDate(activity.createdAt)}</div></div></div>`).join('') : '<div class="empty">Your group activity will appear here.</div>';
  const groupHtml = data.groups.length ? data.groups.map((group) => `<button class="group-row" data-action="open-group" data-group="${group.id}">${groupCover(group)}<span><span class="group-row-title">${escapeHtml(group.name)}</span><span class="group-row-sub">${group.memberCount} member${group.memberCount === 1 ? '' : 's'} · ${group.resourceCount} resources</span></span><span class="arrow">›</span></button>`).join('') : '<div class="empty">No groups yet. Create your first space for shared learning.</div>';
  renderShell(`<div class="page">
    <section class="page-heading"><div><div class="eyebrow">${getCurrentDate()}</div><h1>Good afternoon, ${escapeHtml(state.user.name.split(' ')[0])} 👋</h1><p>Here's what's happening in your learning spaces.</p></div></section>
    <section class="metric-grid">
      <div class="metric"><div class="metric-row"><div class="metric-icon">👥</div><span class="metric-trend">Active</span></div><div class="metric-label">Study groups</div><div class="metric-value">${metrics.groups}</div></div>
      <div class="metric"><div class="metric-row"><div class="metric-icon teal">📤</div><span class="metric-trend">+2 this week</span></div><div class="metric-label">Shared resources</div><div class="metric-value">${metrics.resources}</div></div>
      <div class="metric"><div class="metric-row"><div class="metric-icon orange">📝</div><span class="metric-trend neutral">Due soon</span></div><div class="metric-label">Open assignments</div><div class="metric-value">${metrics.assignments}</div></div>
      <div class="metric"><div class="metric-row"><div class="metric-icon pink">🎯</div><span class="metric-trend">Keep going</span></div><div class="metric-label">Study streak</div><div class="metric-value">${metrics.streak} <small style="font-size:12px;font-family:DM Sans;color:var(--muted)">days</small></div></div>
    </section>
    <section class="content-grid"><div class="card"><div class="card-head"><h2>Your study groups</h2><button class="small-link" data-action="nav" data-page="groups">View all</button></div><div class="group-list">${groupHtml}</div></div><div class="study-nudge"><div class="eyebrow" style="color:#dcd8ff">Study companion</div><h2>Turn your notes into confidence.</h2><p>Ask StudyBot questions about your group's shared notes and resources, then use the answer to guide your learning.</p>${button('Ask StudyBot →', 'nav-study')}</div></section>
    <section class="content-grid"><div class="card"><div class="card-head"><h2>Recent activity</h2></div><div class="activity-list">${activityHtml}</div></div><div class="card"><div class="card-head"><h2>Quick actions</h2></div><div style="padding:10px 20px 20px;display:grid;gap:8px"><button class="button button-secondary" data-action="open-upload">📤 Upload a resource</button><button class="button button-secondary" data-action="open-assignment">➕ Add assignment</button><button class="button button-secondary" data-action="open-discussion">💬 Start discussion</button></div></div></section>
  </div>`, 'Overview', button('Create group +', 'open-create-group', 'button-primary'));
}

function renderGroups() {
  const groups = state.groups;
  const items = groups.length ? groups.map((group) => `<article class="resource-card" style="padding:20px"><div class="resource-top">${groupCover(group)}<span class="chip">${escapeHtml(group.role)}</span></div><h3 style="font-size:16px">${escapeHtml(group.name)}</h3><p>${escapeHtml(group.description || 'A shared learning space.')}</p><div class="tag-row"><span class="tag">${group.memberCount} members</span><span class="tag">${group.resourceCount} resources</span><span class="tag">${group.assignmentCount} assignments</span></div><div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap"><button class="button button-secondary" data-action="open-group" data-group="${group.id}">Open group →</button>${group.role === 'owner' ? `<button class="button button-danger" data-action="delete-group" data-group="${group.id}">Remove</button>` : ''}</div></article>`).join('') : '<div class="empty">You haven’t joined any study groups yet.</div>';
  renderShell(`<div class="page"><section class="page-heading"><div><div class="eyebrow">Collaborate</div><h1>Study groups</h1><p>Keep notes, assignments and peer learning organized in one place.</p></div><div style="display:flex;gap:10px">${button('Join with code', 'open-join-group', 'button-secondary')}${button('Discover public groups', 'open-discover', 'button-secondary')}${button('Create group +', 'open-create-group', 'button-primary')}</div></section><section class="resource-grid">${items}</section></div>`, 'Study groups', button('Create group +', 'open-create-group', 'button-primary'));
}

function resourceCard(resource) {
  const iconClass = resource.type.toLowerCase() === 'pdf' ? '' : resource.type.toLowerCase() === 'docx' ? 'docx' : 'file';
  const indexLabel = resource.indexStatus === 'indexed' ? '✓ Indexed' : resource.indexStatus === 'failed' ? '⚠ Read issue' : resource.indexStatus === 'needs_ai' ? '◌ AI scan' : '';
  return `<article class="resource-card"><div class="resource-top"><div class="file-icon ${iconClass}">${escapeHtml(resource.type.slice(0, 4).toUpperCase())}</div><span class="resource-menu">•••</span></div><h3>${escapeHtml(resource.title)}</h3><p>${escapeHtml(resource.description || resource.fileName)}</p><div class="tag-row">${(resource.tags || []).slice(0, 3).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div><div class="resource-footer"><span>${escapeHtml(resource.unit || 'General')}</span><span>${indexLabel}</span><span>↧ ${resource.downloads || 0}</span><a class="button button-secondary" href="/api/resources/${resource.id}/download">Download</a>${button('Remove', 'delete-resource', 'button-danger').replace('data-action="delete-resource"', `data-action="delete-resource" data-resource="${resource.id}" data-group="${resource.groupId}"`)}</div></article>`;
}

function assignmentCard(assignment) {
  return `<article class="assignment"><div><div class="assignment-title">${escapeHtml(assignment.title)}</div><div class="assignment-sub">${escapeHtml(assignment.description || 'No additional instructions.').slice(0, 72)}</div></div><div style="display:flex;gap:8px;flex-wrap:wrap">${button('View', 'notify-assignment', 'button-secondary')}${button('Remove', 'delete-assignment', 'button-danger').replace('data-action="delete-assignment"', `data-action="delete-assignment" data-assignment="${assignment.id}" data-group="${assignment.groupId}"`)}</div></article>`;
}

function discussionCard(discussion) {
  const replies = Array.isArray(discussion.replies) ? discussion.replies : [];
  const authorName = discussion.authorId === state.user.id ? 'You' : (discussion.authorName || 'Group member');
  const replyItems = replies.length
    ? `<div class="comment-thread">${replies.map((reply) => {
      const replyName = reply.authorId === state.user.id ? 'You' : (reply.authorName || reply.author || 'Group member');
      const avatar = reply.authorId === state.user.id ? state.user.avatar : (reply.authorAvatar || initials(replyName));
      return `<article class="comment-item"><span class="comment-avatar">${escapeHtml(avatar)}</span><div class="comment-body"><div class="comment-meta"><strong>${escapeHtml(replyName)}</strong><span data-timestamp="${reply.createdAt}">${relativeDate(reply.createdAt)}</span></div><p>${escapeHtml(reply.body)}</p></div></article>`;
    }).join('')}</div>`
    : '<div class="no-comments">Be the first to add a helpful reply.</div>';
  return `<article class="discussion"><div class="discussion-meta"><span class="avatar" style="height:25px;width:25px;font-size:9px">${discussion.authorId === state.user.id ? escapeHtml(state.user.avatar) : initials(authorName)}</span><span>${escapeHtml(authorName)}</span><span>•</span><span data-timestamp="${discussion.createdAt}">${relativeDate(discussion.createdAt)}</span>${discussion.pinned ? '<span class="pinned">Pinned</span>' : ''}</div><h3>${escapeHtml(discussion.title)}</h3><p>${escapeHtml(discussion.body)}</p><div class="discussion-actions"><span class="comment-count">◌ ${replies.length} comment${replies.length === 1 ? '' : 's'}</span><button class="reply-link" data-action="focus-reply" data-discussion="${discussion.id}">Reply</button></div>${replyItems}<form class="inline-reply-form" data-form="reply" data-discussion="${discussion.id}" data-group="${discussion.groupId}"><input id="reply-${discussion.id}" name="body" maxlength="1200" required placeholder="Write a helpful reply…" /><button class="button button-primary" type="submit">Reply</button></form></article>`;
}

function renderGroup() {
  const data = state.groupData;
  if (!data) return renderShell(loadingPage(), 'Study group');
  const { group, resources, assignments, discussions } = data;
  const overview = `<section class="section-heading"><div><h2>Shared resources</h2><p>Notes and references everyone can use.</p></div>${button('Upload resource', 'open-upload', 'button-secondary')}</section><div class="resource-grid">${resources.length ? resources.slice(0, 3).map(resourceCard).join('') : '<div class="empty">No resources yet — upload the first one.</div>'}</div><section class="section-heading"><div><h2>Assignments</h2><p>Keep everyone aligned on upcoming work.</p></div>${button('Add assignment', 'open-assignment', 'button-secondary')}</section><div class="assignment-list">${assignments.length ? assignments.map(assignmentCard).join('') : '<div class="empty">No assignments have been added.</div>'}</div><section class="section-heading"><div><h2>Group discussions</h2><p>Ask a doubt, share insight, help each other.</p></div>${button('New discussion', 'open-discussion', 'button-secondary')}</section><div class="discussion-list">${discussions.length ? discussions.map(discussionCard).join('') : '<div class="empty">Start the conversation for this group.</div>'}</div>`;
  const tabs = { overview, resources: `<section class="section-heading"><div><h2>Resource library</h2><p>${resources.length} shared item${resources.length === 1 ? '' : 's'} in this group.</p></div>${button('Upload resource', 'open-upload', 'button-primary')}</section><div class="resource-grid">${resources.length ? resources.map(resourceCard).join('') : '<div class="empty">No resources yet.</div>'}</div>`, assignments: `<section class="section-heading"><div><h2>Assignments</h2><p>Plan work and share useful answers here.</p></div>${button('Add assignment', 'open-assignment', 'button-primary')}</section><div class="assignment-list">${assignments.length ? assignments.map(assignmentCard).join('') : '<div class="empty">No assignments yet.</div>'}</div>`, discussions: `<section class="section-heading"><div><h2>Discussions</h2><p>Explore questions with your classmates.</p></div>${button('New discussion', 'open-discussion', 'button-primary')}</section><div class="discussion-list">${discussions.length ? discussions.map(discussionCard).join('') : '<div class="empty">Start the first discussion.</div>'}</div>` };
  const inviteControl = `<span class="chip invite-code"><span>Invite code <strong>${escapeHtml(group.inviteCode)}</strong></span><span><button class="copy-btn" type="button" data-action="copy-invite" data-invite="${escapeHtml(group.inviteCode)}" title="Copy invite code">⧉</button></span></span>`;
  const deleteControl = group.role === 'owner' ? `<button class="button button-danger" data-action="delete-group" data-group="${group.id}">Delete group</button>` : '';
  renderShell(`<div class="page"><section class="group-hero"><div class="eyebrow">${escapeHtml(group.subject)}</div><h1>${escapeHtml(group.name)}</h1><p>${escapeHtml(group.description || 'A focused space to learn together.')}</p><div class="hero-meta"><span class="chip">◌ ${group.memberCount} members</span><span class="chip">↥ ${group.resourceCount} resources</span>${inviteControl}</div><div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">${deleteControl}${button('Ask StudyBot ✦', 'nav-study', 'button-primary')}</div></section><nav class="tabs"><button class="tab ${state.groupTab === 'overview' ? 'active' : ''}" data-action="group-tab" data-tab="overview">Overview</button><button class="tab ${state.groupTab === 'resources' ? 'active' : ''}" data-action="group-tab" data-tab="resources">Resources</button><button class="tab ${state.groupTab === 'assignments' ? 'active' : ''}" data-action="group-tab" data-tab="assignments">Assignments</button><button class="tab ${state.groupTab === 'discussions' ? 'active' : ''}" data-action="group-tab" data-tab="discussions">Discussions</button></nav>${tabs[state.groupTab]}</div>`, group.name, button('Ask StudyBot ✦', 'nav-study', 'button-primary'));
}

function renderChatMessages() {
  if ((!state.chatHistory || !state.chatHistory.length) && !state.isThinking) return `<div class="empty-study"><div class="spark">✦</div><h2>Ask StudyBot</h2><p>Ask a question to get an answer grounded in the notes, files, and discussions shared in this group.</p></div>`;
  const messages = state.chatHistory.map((message) => `<div class="message ${message.role}"><div class="message-label">${message.role === 'user' ? 'You' : 'StudyBot'}</div>${message.role === 'assistant' ? `<div class="study-response">${renderStructuredText(message.text)}</div>` : `<p>${escapeHtml(message.text)}</p>`}</div>`).join('');
  const thinking = state.isThinking ? `<div class="message assistant thinking"><div class="message-label">StudyBot</div><div class="thinking-buffer"><span class="spinner-small"></span> Reviewing group materials...</div></div>` : '';
  return `<div class="message-list">${messages}${thinking}</div>`;
}

function renderStudy() {
  const groups = state.groups;
  if (!groups.length) {
    renderShell(`<div class="page"><section class="page-heading"><div><div class="eyebrow">StudyBot</div><h1>StudyBot is ready when your first group is formed</h1><p>Create a group, upload resources, and ask questions backed by your shared notes.</p><div style="margin-top:24px">${button('Create group +', 'open-create-group', 'button-primary')}</div></div></section></div>`, 'StudyBot');
    return;
  }

  const selectedGroupId = state.activeGroup?.id || groups[0]?.id || '';
  renderShell(`<div class="page"><section class="page-heading"><div><div class="eyebrow">StudyBot</div><h1>Ask StudyBot about your group resources</h1><p>Ask a question and get an answer based on the notes, files and discussions shared in your selected group.</p></div></section><section class="study-layout"><aside class="card study-panel"><h2>Start a chat</h2><label>Study group<select id="study-group">${groups.map((group) => `<option value="${group.id}" ${selectedGroupId === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}</select></label><label style="margin-top:14px">Ask a question<textarea id="study-question" placeholder="e.g. What are the key ideas in our latest shared notes?"></textarea></label><button class="button button-primary wide" style="margin-top:16px" data-action="send-chat">Ask StudyBot ✦</button></aside><section class="card study-answer">${renderChatMessages()}</section></section></div>`, 'StudyBot');
}

function renderSimple(page) {
  const content = page === 'notifications' ? `<div class="page"><section class="page-heading"><div><div class="eyebrow">Stay informed</div><h1>Notifications</h1><p>Nothing new right now. New resources, discussions and deadlines will appear here.</p></div></section><div class="empty">You’re all caught up ✦</div></div>` : `<div class="page"><section class="page-heading"><div><div class="eyebrow">Your account</div><h1>Settings</h1><p>Profile settings are ready for a production authentication provider.</p></div></section><div class="card" style="padding:24px"><h2>${escapeHtml(state.user.name)}</h2><p class="subtext">${escapeHtml(state.user.email)}</p><button class="button button-danger" style="margin-top:12px" data-action="logout">Sign out</button></div></div>`;
  renderShell(content, page === 'notifications' ? 'Notifications' : 'Settings');
}

function render() {
  if (!state.user) return renderAuth();
  if (state.page === 'dashboard') return renderDashboard();
  if (state.page === 'groups') return renderGroups();
  if (state.page === 'group') return renderGroup();
  if (state.page === 'study') return renderStudy();
  return renderSimple(state.page);
}

function openModal(kind) {
  const groupOptions = state.groups.map((group) => `<option value="${group.id}" ${state.activeGroup?.id === group.id ? 'selected' : ''}>${escapeHtml(group.name)}</option>`).join('');
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  const forms = {
    'create-group': `<div class="modal"><div class="modal-head"><div><h2>Create study group</h2><p>Make a focused home for your classmates and their materials.</p></div><button class="close" data-action="close-modal">×</button></div><form class="form-stack" data-form="create-group"><label>Group name<input name="name" required minlength="3" placeholder="e.g. Computer Networks — Sem 4" /></label><div class="form-row"><label>Subject<input name="subject" required placeholder="e.g. Computer Networks" /></label><label>Privacy<select name="privacy"><option value="private">Private — invite only</option><option value="public">Public — searchable</option></select></label></div><label>Description<textarea name="description" placeholder="What will your group use this space for?"></textarea></label><div class="modal-actions"><button type="button" class="button button-ghost" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Create group</button></div></form></div>`,
    'join-group': `<div class="modal"><div class="modal-head"><div><h2>Join a study group</h2><p>Ask the group owner for their invite code.</p></div><button class="close" data-action="close-modal">×</button></div><form class="form-stack" data-form="join-group"><label>Invite code<input name="inviteCode" required placeholder="e.g. OS4-LEARN" style="text-transform:uppercase" /></label><div class="modal-actions"><button type="button" class="button button-ghost" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Join group</button></div></form></div>`,
    'discover': `<div class="modal"><div class="modal-head"><div><h2>Discover public groups</h2><p>Find and join public study groups. Click "Join" to pre-fill the join form.</p></div><button class="close" data-action="close-modal">×</button></div><div style="display:grid;gap:10px;margin-top:12px;grid-template-columns:1fr auto"><input id="public-search" placeholder="Search public groups by name or subject" style="padding:10px;border-radius:10px;border:1px solid #e9e6f6;min-width:0;font-size:14px" /><button class="button button-primary" id="public-search-btn" style="white-space:nowrap">Search</button></div><div id="public-results" style="margin-top:14px;max-height:45vh;overflow-y:auto"></div></div>`,

    upload: `<div class="modal"><div class="modal-head"><div><h2>Share a readable resource</h2><p>The file is stored privately and indexed so your group can study from it.</p></div><button class="close" data-action="close-modal">×</button></div><form class="form-stack" data-form="upload"><label>Study group<select name="groupId" required>${groupOptions}</select></label><label>Resource title<input name="title" required minlength="3" placeholder="e.g. Unit 5 revision notes" /></label><div class="form-row"><label>Unit<input name="unit" placeholder="e.g. Unit 5" /></label><label>Tags<input name="tags" placeholder="networks, exam" /></label></div><label>Description<textarea name="description" placeholder="What is inside this resource?"></textarea></label><label class="file-drop">↥ <span id="file-label">Choose PDF, DOCX, PPTX, TXT, MD or CSV</span><input id="resource-file" name="file" required type="file" accept=".pdf,.docx,.pptx,.txt,.md,.markdown,.csv" /></label><div class="modal-actions"><button type="button" class="button button-ghost" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Upload & index</button></div></form></div>`,
    assignment: `<div class="modal"><div class="modal-head"><div><h2>Add an assignment</h2><p>Keep your group aligned on what needs to be completed.</p></div><button class="close" data-action="close-modal">×</button></div><form class="form-stack" data-form="assignment"><label>Study group<select name="groupId" required>${groupOptions}</select></label><label>Assignment title<input name="title" required minlength="3" placeholder="e.g. SQL Normalization worksheet" /></label><label>Instructions<textarea name="description" placeholder="Add a short description or requirements."></textarea></label><div class="modal-actions"><button type="button" class="button button-ghost" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Add assignment</button></div></form></div>`,
    discussion: `<div class="modal"><div class="modal-head"><div><h2>Start a discussion</h2><p>Ask a thoughtful question or share a useful insight.</p></div><button class="close" data-action="close-modal">×</button></div><form class="form-stack" data-form="discussion"><label>Study group<select name="groupId" required>${groupOptions}</select></label><label>Title<input name="title" required minlength="3" placeholder="What do you want to discuss?" /></label><label>Your message<textarea name="body" required minlength="5" placeholder="Give your group enough context to help."></textarea></label><div class="modal-actions"><button type="button" class="button button-ghost" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Post discussion</button></div></form></div>`
  };
  modal.innerHTML = forms[kind]; document.body.append(modal);
}

function closeModal() { document.querySelector('.modal-backdrop')?.remove(); }

async function populatePublicGroups(query) {
  try {
    const q = String(query || '').trim();
    const data = await request(`/api/public-groups${q ? `?q=${encodeURIComponent(q)}` : ''}`);
    const container = document.querySelector('#public-results');
    if (!container) return;
    if (!data.groups || !data.groups.length) { container.innerHTML = '<div class="empty">No public groups found.</div>'; return; }
    container.innerHTML = data.groups.map((g) => {
      return `<div class="resource-card" style="padding:12px;display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;margin-bottom:8px;row-gap:10px"><div class="group-cover ${escapeHtml(g.cover || 'violet')}" style="height:44px;width:44px;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:12px;font-weight:700">${escapeHtml((g.subject || g.name).slice(0,2).toUpperCase())}</div><div style="min-width:0;overflow:hidden"><div style="font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px">${escapeHtml(g.name)}</div><div style="color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(g.subject || '')} · ${g.memberCount || 0} members</div></div><div style="display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0;justify-content:flex-end\"><button class="button" style="font-size:11px;min-height:34px;padding:6px 10px;white-space:nowrap" data-action="prefill-join" data-invite="${escapeHtml(g.inviteCode)}">Join</button><button class="button button-secondary" style="font-size:11px;min-height:34px;padding:6px 10px;white-space:nowrap" data-action="copy-invite" data-invite="${escapeHtml(g.inviteCode)}">Copy</button></div></div>`;
    }).join('');
  } catch (err) {
    notify('Could not load public groups.', true);
  }
}


async function refreshDashboard() {
  const [dashboard, groupsResponse] = await Promise.all([request('/api/dashboard'), request('/api/groups')]);
  state.dashboard = dashboard; state.groups = groupsResponse.groups;
}

async function openGroup(groupId) {
  state.activeGroup = state.groups.find((group) => group.id === groupId) || { id: groupId };
  state.groupData = null; state.groupTab = 'overview'; state.page = 'group'; render();
  const data = await request(`/api/groups/${groupId}`); state.groupData = data; state.activeGroup = data.group; render();
}

async function navigate(page) {
  state.page = page;
  state.mobileSidebarOpen = false;
  if (page === 'dashboard') { state.dashboard = null; render(); await refreshDashboard(); }
  if (page === 'groups' || page === 'study') { render(); }
  if (page !== 'dashboard') render();
  if (page === 'dashboard') render();
}

async function submitForm(form) {
  const type = form.dataset.form;
  const values = Object.fromEntries(new FormData(form).entries());
  try {
    if (type === 'login' || type === 'register') {
      const data = await request(`/api/auth/${type}`, { method: 'POST', body: JSON.stringify(values) }); state.user = data.user; state.page = 'dashboard'; state.dashboard = null; render(); await refreshDashboard(); render(); return;
    }
    if (type === 'create-group') { const data = await request('/api/groups', { method: 'POST', body: JSON.stringify(values) }); closeModal(); await refreshDashboard(); notify(`“${data.group.name}” is ready.`); await openGroup(data.group.id); return; }
    if (type === 'join-group') { const data = await request('/api/groups/join', { method: 'POST', body: JSON.stringify(values) }); closeModal(); await refreshDashboard(); notify(`You joined “${data.group.name}”.`); await openGroup(data.group.id); return; }
    if (type === 'upload') { const file = form.querySelector('#resource-file').files[0]; if (!file) throw new Error('Choose a file to share.'); const upload = new FormData(form); upload.set('file', file); const data = await request(`/api/groups/${values.groupId}/resources`, { method: 'POST', body: upload }); closeModal(); const status = data.resource.indexStatus === 'indexed' ? `indexed into ${data.indexedChunks} study sections` : 'saved, but could not be fully read'; notify(`“${data.resource.title}” is ${status}.`); await refreshDashboard(); if (state.page === 'group' && state.activeGroup.id === values.groupId) await openGroup(values.groupId); else render(); return; }
    if (type === 'assignment') { const data = await request(`/api/groups/${values.groupId}/assignments`, { method: 'POST', body: JSON.stringify(values) }); closeModal(); notify(`Assignment “${data.assignment.title}” was added.`); await refreshDashboard(); if (state.page === 'group' && state.activeGroup.id === values.groupId) await openGroup(values.groupId); else render(); return; }
    if (type === 'discussion') { const data = await request(`/api/groups/${values.groupId}/discussions`, { method: 'POST', body: JSON.stringify(values) }); closeModal(); notify(`Discussion “${data.discussion.title}” was posted.`); await refreshDashboard(); if (state.page === 'group' && state.activeGroup.id === values.groupId) await openGroup(values.groupId); else render(); }
    if (type === 'reply') { const discussionId = form.dataset.discussion; const groupId = form.dataset.group; const data = await request(`/api/discussions/${discussionId}/replies`, { method: 'POST', body: JSON.stringify({ body: values.body }) }); form.reset(); notify(`Reply posted to “${data.discussion.title}”.`); await refreshDashboard(); if (state.page === 'group' && state.activeGroup?.id === groupId) await openGroup(groupId); else render(); }
  } catch (error) { notify(error.message, true); }
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'auth-login') return renderAuth('login');
  if (action === 'auth-register') return renderAuth('register');
  if (action === 'toggle-mobile-sidebar') { state.mobileSidebarOpen = !state.mobileSidebarOpen; return render(); }
  if (action === 'close-mobile-sidebar') { state.mobileSidebarOpen = false; return render(); }
  if (action === 'nav') return navigate(target.dataset.page);
  if (action === 'nav-study') return navigate('study');
  if (action === 'open-group') {
    const id = target.dataset.group || target.querySelector('input')?.value;
    return openGroup(id);
  }
  if (action === 'logout') { await request('/api/auth/logout', { method: 'POST' }); state.user = null; state.dashboard = null; state.groups = []; state.groupData = null; return renderAuth(); }
  if (action === 'open-create-group') return openModal('create-group');
  if (action === 'open-discover') { openModal('discover'); setTimeout(() => { populatePublicGroups(''); document.querySelector('#public-search')?.focus(); const btn = document.querySelector('#public-search-btn'); if (btn) btn.addEventListener('click', () => populatePublicGroups(document.querySelector('#public-search')?.value || '')); }, 40); return; }
  if (action === 'open-join-group') return openModal('join-group');
  if (action === 'open-upload') return openModal('upload');
  if (action === 'open-assignment') return openModal('assignment');
  if (action === 'open-discussion') return openModal('discussion');
  if (action === 'close-modal') return closeModal();
  if (action === 'copy-invite') return copyToClipboard(target.dataset.invite);
  if (action === 'prefill-join') {
    const code = target.dataset.invite; openModal('join-group'); setTimeout(() => { const input = document.querySelector('form[data-form="join-group"] input[name="inviteCode"]'); if (input) { input.value = code; input.focus(); } }, 40); return;
  }
  if (action === 'focus-reply') return document.querySelector(`#reply-${target.dataset.discussion}`)?.focus();
  if (action === 'delete-group') {
    const groupId = target.dataset.group;
    if (!groupId || !window.confirm('Delete this group and its shared resources, assignments, and discussions?')) return;
    try {
      await request(`/api/groups/${groupId}`, { method: 'DELETE' });
      await refreshDashboard();
      notify('Group deleted.');
      state.groupData = null;
      state.activeGroup = null;
      state.page = 'groups';
      render();
    } catch (error) { notify(error.message, true); }
    return;
  }
  if (action === 'delete-resource') {
    const resourceId = target.dataset.resource;
    const groupId = target.dataset.group;
    if (!resourceId || !window.confirm('Remove this resource from the group?')) return;
    try {
      await request(`/api/resources/${resourceId}`, { method: 'DELETE' });
      await refreshDashboard();
      notify('Resource removed.');
      if (state.page === 'group' && state.activeGroup?.id === groupId) await openGroup(groupId); else render();
    } catch (error) { notify(error.message, true); }
    return;
  }
  if (action === 'delete-assignment') {
    const assignmentId = target.dataset.assignment;
    const groupId = target.dataset.group;
    if (!assignmentId || !window.confirm('Remove this assignment from the group?')) return;
    try {
      await request(`/api/assignments/${assignmentId}`, { method: 'DELETE' });
      await refreshDashboard();
      notify('Assignment removed.');
      if (state.page === 'group' && state.activeGroup?.id === groupId) await openGroup(groupId); else render();
    } catch (error) { notify(error.message, true); }
    return;
  }
  if (action === 'group-tab') { state.groupTab = target.dataset.tab; return renderGroup(); }
  if (action === 'send-chat') {
    const groupId = document.querySelector('#study-group').value;
    const question = document.querySelector('#study-question').value.trim();
    if (!question) return notify('Ask a question first.', true);
    target.disabled = true; target.textContent = 'Thinking…';
    try {
      state.chatHistory.push({ role: 'user', text: question });
      state.isThinking = true;
      renderStudy();
      const response = await request('/api/study', { method: 'POST', body: JSON.stringify({ groupId, question }) });
      state.activeGroup = state.groups.find((group) => group.id === groupId) || state.activeGroup;
      state.chatHistory.push({ role: 'assistant', text: response.answer || 'StudyBot couldn’t produce a helpful answer right now. Try again with a clearer question or check your group resources.' });
    } catch (error) {
      notify(error.message, true);
      state.chatHistory.push({ role: 'assistant', text: 'StudyBot could not complete the request at this time. Please try again in a moment.' });
    } finally {
      state.isThinking = false;
      document.querySelector('#study-question').value = '';
      renderStudy();
      target.disabled = false;
      target.textContent = 'Ask StudyBot ✦';
    }
  }
  if (action === 'notify-assignment') notify('Assignment details are available to all group members.');
});

document.addEventListener('change', (event) => {
  if (event.target.id === 'resource-file') document.querySelector('#file-label').textContent = event.target.files[0]?.name || 'Choose a file';
});

document.addEventListener('submit', (event) => { if (event.target.matches('form[data-form]')) { event.preventDefault(); submitForm(event.target); } });

function updateRelativeDates() {
  // Update all elements with data-timestamp attribute
  document.querySelectorAll('[data-timestamp]').forEach((element) => {
    const timestamp = element.dataset.timestamp;
    element.textContent = relativeDate(timestamp);
  });
}

/*async function boot() {
  try {
    const session = await request('/api/session');
    state.user = session.user;
    if (state.user) { render(); await refreshDashboard(); render(); } else renderAuth();
  } catch (error) { renderAuth(); notify('Could not reach the local server.', true); }
  finally{
        loader.classList.add("hide");

setTimeout(()=>{
    loader.remove();
},300);
  }
  
  // Update relative dates every 60 seconds
  setInterval(updateRelativeDates, 60000);
}

boot();*/
async function boot() {
  
    const loader = document.getElementById("startup-loader");

    try {
        

        const session = await request("/api/session");

        

        state.user = session.user;

        if (state.user) {
            

            render();

            

            await refreshDashboard();

            

            render();
        } else {
            

            renderAuth();

            
        }

    } catch (err) {
        console.error("BOOT ERROR", err);

        renderAuth();
    } finally {
        

const loader = document.getElementById("startup-loader");

loader.style.transition = "opacity .45s ease";

loader.style.opacity = "0";

setTimeout(() => {
    loader.remove();
}, 450);
    }
}
boot();
