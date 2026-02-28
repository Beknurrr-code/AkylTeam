/* ════════════════════════════════════════════════════════════════
   AkylTeam — app.js  │  Main application logic
   ════════════════════════════════════════════════════════════════ */

// ── STATE ──────────────────────────────────────────────────────────
let currentTeamId   = null;
let currentMemberId = null;
let allTeams        = [];
let allMembers      = [];
let chatWS          = null;
let burnoutAnswers  = {};
let burnoutQuestions = [];
let selectedTopic   = '';
let onlineUserIds   = new Set();
let heartbeatTimer  = null;
let _dashPoll       = null;
let _kanbanTasks    = [];
let _editTaskId     = null;

// ── ONLINE STATUS HEARTBEAT ───────────────────────────────────────
function startHeartbeat() {
  if (heartbeatTimer) return; // already running
  // Initial ping
  api.heartbeat().catch(() => {});
  // Refresh online users list
  refreshOnlineUsers();
  // Schedule repeating heartbeat every 30s
  heartbeatTimer = setInterval(() => {
    if (AUTH.isLoggedIn()) {
      api.heartbeat().catch(() => {});
    } else {
      stopHeartbeat();
    }
  }, 30000);
}

function stopHeartbeat() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

async function refreshOnlineUsers() {
  try {
    const users = await api.getOnlineUsers();
    onlineUserIds = new Set(users.map(u => u.id));
  } catch (_) { /* silent */ }
}

function isOnline(userId) {
  return onlineUserIds.has(userId);
}

function onlineBadge(userId) {
  return isOnline(userId)
    ? '<span class="online-dot" title="Онлайн"></span>'
    : '<span class="offline-dot" title="Недавно был"></span>';
}

// ── INIT ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadTeamsDropdowns();
  loadTopics();
  await loadAllMembers();
  setupSidebar();
  showPage('personal-chat');
  initTheme();
  if (typeof initOnboarding === 'function') initOnboarding();
  // Start heartbeat if already logged in
  if (typeof AUTH !== 'undefined' && AUTH.isLoggedIn()) {
    startHeartbeat();
    // Restore user info in sidebar
    const savedUser = AUTH.getUser();
    if (savedUser && typeof updateSidebarUser === 'function') updateSidebarUser(savedUser);
  }
  // Init auto-resize textareas
  initAutoResize();
  // Init countdown timer if saved
  initCountdown();
  // Load platform stats on homepage
  loadPlatformStats();
  // Global Esc handler for all modals; Ctrl+Enter to confirm active modal
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      document.querySelectorAll('.modal-overlay[style*="flex"]').forEach(m => { m.style.display = 'none'; });
      _editTaskId = null;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      const openModal = document.querySelector('.modal-overlay[style*="flex"]');
      if (openModal) {
        const primary = openModal.querySelector('.btn-primary');
        if (primary) { ev.preventDefault(); primary.click(); }
      }
    }
  });
});

// ── UTILS ─────────────────────────────────────────────────────────

/** Open any .modal-overlay by id */
function openModal(id) {
  const m = document.getElementById(id);
  if (m) { m.style.display = 'flex'; }
}
/** Close any .modal-overlay by id */
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) { m.style.display = 'none'; }
}

function showLoader(text) {
  document.getElementById('loaderOverlay').style.display = 'flex';
  const loaderText = document.getElementById('loaderText');
  if (loaderText) loaderText.textContent = text || t('ui.thinking');
}

function hideLoader() {
  document.getElementById('loaderOverlay').style.display = 'none';
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toast._tid);
  toast._tid = setTimeout(() => toast.classList.remove('show'), 3500);
}

function copyText(id) {
  const el = document.getElementById(id);
  if (!el) return;
  navigator.clipboard.writeText(el.innerText)
    .then(() => showToast('📋 Скопировано!', 'success'))
    .catch(() => showToast('Ошибка копирования', 'error'));
}

function renderMarkdown(text) {
  if (!text) return '';
  // Use marked.js if loaded
  if (typeof marked !== 'undefined') {
    try {
      marked.setOptions({ breaks: true, gfm: true });
      const html = marked.parse(text);
      // Apply syntax highlighting after render (async via setTimeout)
      setTimeout(() => {
        if (typeof hljs !== 'undefined') {
          document.querySelectorAll('pre code:not(.hljs)').forEach(el => hljs.highlightElement(el));
        }
      }, 50);
      return html;
    } catch (_) { /* fallback below */ }
  }
  // Manual fallback renderer
  return text
    // code blocks
    .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre><code class="lang-$1">$2</code></pre>')
    // inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // headings
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm,  '<h3>$1</h3>')
    .replace(/^# (.+)$/gm,   '<h2>$1</h2>')
    // bold
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // italic
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    // bullet lists
    .replace(/^[-•] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>')
    // numbered lists
    .replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>')
    // line breaks
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>');
}

function showAIResponse(cardId, contentId, content) {
  const card = document.getElementById(cardId);
  const cont = document.getElementById(contentId);
  if (card) card.style.display = 'block';
  if (cont) cont.innerHTML = renderMarkdown(content);
}

// ── SIDEBAR / NAVIGATION ──────────────────────────────────────────
function setupSidebar() {
  const hamburger = document.getElementById('hamburger');
  const sidebar   = document.getElementById('sidebar');
  const main      = document.getElementById('mainContent');
  const backdrop  = document.getElementById('sidebarBackdrop');

  if (hamburger) {
    hamburger.addEventListener('click', () => {
      const isOpen = sidebar.classList.toggle('open');
      main.classList.toggle('sidebar-open', isOpen);
      if (backdrop) backdrop.classList.toggle('visible', isOpen);
    });
  }

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const page = link.dataset.page;
      if (page) showPage(page);
      closeSidebar();
    });
  });
}

function closeSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const main     = document.getElementById('mainContent');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (sidebar)  sidebar.classList.remove('open');
  if (main)     main.classList.remove('sidebar-open');
  if (backdrop) backdrop.classList.remove('visible');
}

function showPage(pageId) {
  // Stop dashboard auto-refresh when navigating away
  if (_dashPoll && pageId !== 'dashboard') { clearInterval(_dashPoll); _dashPoll = null; }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

  const page = document.getElementById(`page-${pageId}`);
  if (page) page.classList.add('active');

  const link = document.querySelector(`.nav-link[data-page="${pageId}"]`);
  if (link) link.classList.add('active');

  // Sync drawer active links
  document.querySelectorAll('.drawer-link').forEach(l => l.classList.remove('active'));
  const drawerLink = document.querySelector(`.drawer-link[data-page="${pageId}"]`);
  if (drawerLink) drawerLink.classList.add('active');

  // Sync bottom nav
  const BNAV_PAGES = ['personal-chat', 'teams', 'learn', 'burnout', 'profile'];
  document.querySelectorAll('.bnav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === pageId);
  });
  // For pages not in bottom nav, clear all bnav highlights
  if (!BNAV_PAGES.includes(pageId)) {
    document.querySelectorAll('.bnav-item').forEach(btn => btn.classList.remove('active'));
  }

  // Close drawer if open
  closeDrawer();

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // lazy loads
  if (pageId === 'teacher') loadTopics();
  if (pageId === 'burnout') loadBurnoutMembers();
  if (pageId === 'tournaments') { if (typeof loadTournaments === 'function') loadTournaments(''); }
  if (pageId === 'leaderboard') { if (typeof loadLeaderboard === 'function') loadLeaderboard(); }
  if (pageId === 'profile') { if (typeof loadProfile === 'function') loadProfile(); }
  if (pageId === 'find-team') { if (typeof searchUsers === 'function') searchUsers(); }
  if (pageId === 'personal-chat') { loadPersonalChatHistory(); }
  if (pageId === 'kanban') { initKanbanPage(); }
  if (pageId === 'dashboard') { initDashboardPage(); }
  if (pageId === 'channels') { initChannelsPage(); }
  if (pageId === 'smart-notes') { loadSmartNotes(); }
  if (pageId === 'moodboard') { loadMoodboards(); }
  if (pageId === 'teams') { initTeamsPage(); }
  if (pageId === 'learn') { initLearnPage(); }
  if (pageId === 'ai-insights') { initInsightsPage(); }
  if (pageId === 'role-test') { initRoleTest(); }
  if (pageId === 'hackathon-catalog') { initCatalogPage(); }
  if (pageId === 'home') { loadDailyChallenge(); }
  if (pageId === 'project') { loadRoadmapList(); }
  if (pageId === 'olympiad') { initOlymPage(); }
  if (pageId === 'codespace') { initCodeSpace(); _initGhTokenFromStorage(); }
  if (pageId === 'project-space') { initProjectSpace(); }
}

// ── TEAMS ─────────────────────────────────────────────────────────
async function loadTeamsDropdowns() {
  try {
    const teams = await api.getTeams().catch(() => []);
    allTeams = teams;
    const selects = ['memberTeamId', 'ideasTeamId', 'pitchTeamId', 'chatTeamId'];
    selects.forEach(sid => {
      const el = document.getElementById(sid);
      if (!el) return;
      el.innerHTML = '<option value="">-- Выбери --</option>';
      allTeams.forEach(team => {
        const opt = document.createElement('option');
        opt.value = team.id;
        opt.textContent = `${team.name} (${team.hackathon_theme || '–'})`;
        el.append(opt);
      });
    });
  } catch (e) {
    console.warn('Teams load error', e);
  }
}

async function createTeam() {
  // Support both old form fields and new modal fields
  const nameEl  = document.getElementById('newTeamName') || document.getElementById('teamName');
  const themeEl = document.getElementById('newTeamTheme') || document.getElementById('hackathonTheme');
  const name  = nameEl?.value.trim()  || '';
  const theme = themeEl?.value.trim() || '';
  if (!name) { showToast('Введи название команды', 'error'); nameEl?.focus(); return; }
  showLoader('Создаю команду...');
  try {
    const team = await api.createTeam(name, theme);
    showToast(`✅ Команда "${team.name}" создана!`, 'success');
    if (nameEl)  nameEl.value  = '';
    if (themeEl) themeEl.value = '';
    closeModal('createTeamModal');
    await loadTeamsDropdowns();
    // Refresh teams hub if visible
    if (document.getElementById('page-teams')?.classList.contains('active')) {
      initTeamsPage();
    }
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

async function addMember() {
  const teamId = document.getElementById('memberTeamId').value;
  const name   = document.getElementById('memberName').value.trim();
  const skills = document.getElementById('memberSkills').value
    .split(',').map(s => s.trim()).filter(Boolean);
  const level  = document.getElementById('memberLevel').value;
  if (!teamId) { showToast('Выбери команду', 'error'); shakeInput('memberTeamId'); return; }
  if (!name)   { showToast('Введи имя участника', 'error'); shakeInput('memberName'); return; }
  showLoader('Добавляю участника...');
  try {
    await api.addMember({ name, team_id: +teamId, skills, experience_level: level, language: currentLang });
    showToast(`✅ ${name} добавлен в команду`, 'success');
    document.getElementById('memberName').value  = '';
    document.getElementById('memberSkills').value = '';
    await loadTeamMembers(teamId);
    await loadAllMembers();
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

async function loadTeamMembers(teamId) {
  if (!teamId) return;
  currentTeamId = +teamId;
  try {
    allMembers = await api.getTeamMembers(teamId);
    const grid = document.getElementById('membersList');
    const display = document.getElementById('teamDisplay');
    if (!grid) return;
    grid.innerHTML = allMembers.map(m => `
      <div class="member-card">
        <div class="member-avatar">${m.name[0]?.toUpperCase() || '?'}</div>
        <div class="member-info">
          <strong>${m.name}</strong>
          <span class="member-role">${m.role || '—'}</span>
          <span class="member-skills">${(m.skills || []).join(', ') || '—'}</span>
          <span class="member-level">${m.experience_level}</span>
        </div>
        <div class="member-energy" title="Энергия">
          ${energyBar(m.energy_level || 5)}
        </div>
      </div>`).join('');
    if (display) display.style.display = allMembers.length ? 'block' : 'none';

    // Show invite code
    try {
      const teamData = await api.getTeam(teamId);
      const codeEl = document.getElementById('teamInviteCode');
      const codeRow = document.getElementById('inviteCodeRow');
      if (codeEl && teamData.invite_code) {
        codeEl.textContent = teamData.invite_code;
        if (codeRow) codeRow.style.display = 'flex';
      }
    } catch (_) { /* silent */ }
  } catch (e) {
    showToast('Ошибка загрузки участников', 'error');
  }
}

function energyBar(level) {
  const pct = (level / 10) * 100;
  const col = pct < 30 ? '#ef4444' : pct < 60 ? '#f59e0b' : '#22c55e';
  return `<div class="energy-bar"><div class="energy-fill" style="width:${pct}%;background:${col}"></div></div>`;
}

function copyInviteCode() {
  const code = document.getElementById('teamInviteCode')?.textContent;
  if (!code) return;
  navigator.clipboard.writeText(code)
    .then(() => showToast('🔗 Инвайт-код скопирован!', 'success'))
    .catch(() => showToast('Ошибка копирования', 'error'));
}

async function regenerateCode() {
  if (!currentTeamId) return;
  try {
    const team = await api.regenerateInviteCode(currentTeamId);
    const codeEl = document.getElementById('teamInviteCode');
    if (codeEl) codeEl.textContent = team.invite_code;
    showToast('🔄 Новый код создан: ' + team.invite_code, 'success');
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  }
}

async function joinTeamByCode() {
  const code = document.getElementById('joinCode')?.value?.trim().toUpperCase();
  const name = document.getElementById('joinName')?.value?.trim();
  const skills = (document.getElementById('joinSkills')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!code) { showToast('Введи инвайт-код', 'error'); return; }
  if (!name) { showToast('Введи своё имя', 'error'); return; }
  showLoader('Вступаю в команду...');
  try {
    const res = await api.joinTeamByCode(code, name, skills, 'beginner', currentLang);
    showToast(`✅ Ты в команде "${res.team.name}"!`, 'success');
    document.getElementById('joinCode').value = '';
    document.getElementById('joinName').value = '';
    document.getElementById('joinSkills').value = '';
    await loadTeamsDropdowns();
    // Auto-select the joined team
    const sel = document.getElementById('memberTeamId');
    if (sel) { sel.value = res.team.id; loadTeamMembers(res.team.id); }
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

async function loadAllMembers() {
  try {
    if (!allTeams.length) return;
    const all = [];
    for (const t of allTeams) {
      const ms = await api.getTeamMembers(t.id).catch(() => []);
      ms.forEach(m => all.push({ ...m, teamName: t.name }));
    }
    allMembers = all;
    // populate burnout member select
    const sel = document.getElementById('burnoutMemberId');
    if (sel) {
      sel.innerHTML = '<option value="">-- Выбери --</option>';
      all.forEach(m => {
        const o = document.createElement('option');
        o.value = m.id;
        o.textContent = `${m.name} (${m.teamName})`;
        sel.append(o);
      });
    }
  } catch (e) { /* silent */ }
}

async function analyzeTeam() {
  if (!currentTeamId) { showToast('Выбери команду', 'error'); return; }
  showLoader('🔬 Анализирую команду...');
  try {
    const res = await api.analyzeTeam(currentTeamId, currentLang);
    showAIResponse('teamAIResponse', 'teamAIContent', res.content);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

function openAssignTasks() {
  const c = document.getElementById('assignTasksCard');
  if (c) c.style.display = c.style.display === 'none' ? 'block' : 'none';
}

async function assignTasks() {
  if (!currentTeamId) { showToast('Выбери команду', 'error'); return; }
  const desc = document.getElementById('projectDesc').value.trim();
  if (!desc) { showToast('Опиши проект', 'error'); return; }
  showLoader('📋 Распределяю задачи...');
  try {
    const res = await api.assignTasks(currentTeamId, desc, currentLang);
    showAIResponse('teamAIResponse', 'teamAIContent', res.content);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

function openAgentDiscussion() {
  const c = document.getElementById('agentDiscussionCard');
  if (c) c.style.display = c.style.display === 'none' ? 'block' : 'none';
}

async function runAgentDiscussion() {
  const topic = document.getElementById('discussionTopic').value.trim();
  if (!topic) { showToast('Введи тему для обсуждения', 'error'); return; }
  showLoader('🤖 Агенты обсуждают...');
  try {
    const res = await api.agentDiscussion(topic, currentLang);
    showAIResponse('teamAIResponse', 'teamAIContent', res.content);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

// ── BURNOUT ───────────────────────────────────────────────────────
function loadBurnoutMembers() {
  loadAllMembers();
}

async function loadBurnoutQuestions() {
  const memberId = document.getElementById('burnoutMemberId').value;
  if (!memberId) { showToast('Выбери участника', 'error'); return; }
  currentMemberId = +memberId;
  showLoader(t('ui.loading'));
  try {
    const res = await api.getBurnoutQuestions(currentLang);
    burnoutQuestions = res.questions;
    burnoutAnswers   = {};
    const container  = document.getElementById('burnoutQuestions');
    container.innerHTML = burnoutQuestions.map((q, i) => buildQuestionHTML(q, i)).join('');
    document.getElementById('burnoutQuestionsCard').style.display = 'block';
  } catch (e) {
    showToast('Ошибка загрузки вопросов: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

function buildQuestionHTML(q, i) {
  const name = `bq_${q.id}`;
  if (q.type === 'scale') {
    return `<div class="burnout-question">
      <label>${i + 1}. ${q.q}</label>
      <div class="scale-row">
        <span>1</span>
        <input type="range" id="${name}" name="${name}" min="1" max="10" value="5"
               oninput="document.getElementById('${name}_val').textContent=this.value"
               onchange="burnoutAnswers['${q.id}']=+this.value" />
        <span>10</span>
        <strong id="${name}_val">5</strong>
      </div>
    </div>`;
  }
  if (q.type === 'number') {
    return `<div class="burnout-question">
      <label>${i + 1}. ${q.q}</label>
      <input type="number" id="${name}" class="input" style="max-width:120px;" min="0" max="72" value="7"
             onchange="burnoutAnswers['${q.id}']=+this.value" />
    </div>`;
  }
  if (q.type === 'bool') {
    return `<div class="burnout-question">
      <label>${i + 1}. ${q.q}</label>
      <div class="bool-row">
        <label><input type="radio" name="${name}" value="yes" onchange="burnoutAnswers['${q.id}']=true" /> ✅ Да</label>
        <label><input type="radio" name="${name}" value="no"  onchange="burnoutAnswers['${q.id}']=false" /> ❌ Нет</label>
      </div>
    </div>`;
  }
  if (q.type === 'choice') {
    const opts = q.options.map(o => `<option value="${o}">${o}</option>`).join('');
    return `<div class="burnout-question">
      <label>${i + 1}. ${q.q}</label>
      <select class="input" onchange="burnoutAnswers['${q.id}']=this.value"><option value="">-- Выбери --</option>${opts}</select>
    </div>`;
  }
  return '';
}

async function submitBurnout() {
  if (!currentMemberId) { showToast('Выбери участника', 'error'); return; }
  // collect any unanswered scales
  burnoutQuestions.forEach(q => {
    if (q.type === 'scale' && burnoutAnswers[q.id] === undefined) {
      const el = document.getElementById(`bq_${q.id}`);
      if (el) burnoutAnswers[q.id] = +el.value;
    }
  });
  showLoader('🔬 Анализирую состояние...');
  try {
    const res = await api.checkBurnout(currentMemberId, burnoutAnswers, currentLang);
    const score = res.metadata?.burnout_score ?? 0;
    updateBurnoutGauge(score);
    document.getElementById('burnoutScoreCard').style.display = 'block';
    showAIResponse('burnoutAIResponse', 'burnoutAIContent', res.content);
    document.getElementById('scheduleOptCard').style.display = 'block';
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

function updateBurnoutGauge(score) {
  const gauge = document.getElementById('burnoutGauge');
  const text  = document.getElementById('burnoutGaugeText');
  const level = document.getElementById('burnoutLevel');
  if (!gauge) return;
  const pct   = Math.min(100, score);
  const color = pct < 30 ? '#22c55e' : pct < 60 ? '#f59e0b' : '#ef4444';
  const deg   = pct * 3.6;
  gauge.style.background = `conic-gradient(${color} ${deg}deg, var(--bg3) ${deg}deg)`;
  if (text) text.textContent = Math.round(pct);
  const labels = {
    ru: ['🟢 Отлично', '🟡 Умеренно', '🔴 Выгорание'],
    en: ['🟢 Great', '🟡 Moderate', '🔴 Burnout'],
    kz: ['🟢 Жақсы', '🟡 Орташа', '🔴 Жану'],
  };
  const lang = currentLang || 'ru';
  const set  = labels[lang] || labels.ru;
  if (level) level.textContent = pct < 30 ? set[0] : pct < 60 ? set[1] : set[2];
}

async function optimizeSchedule() {
  if (!currentMemberId) { showToast('Выбери участника', 'error'); return; }
  const hours = document.getElementById('remainingHours').value;
  const tasks = document.getElementById('scheduleTasks').value
    .split('\n').map(s => s.trim()).filter(Boolean);
  if (!tasks.length) { showToast('Добавь задачи', 'error'); return; }
  showLoader('⚡ Оптимизирую расписание...');
  try {
    const tasksQuery = tasks.map(t => `tasks=${encodeURIComponent(t)}`).join('&');
    const url = `/api/burnout/schedule-optimizer?member_id=${currentMemberId}&remaining_hours=${hours}&language=${currentLang}&${tasksQuery}`;
    const res = await apiCall('POST', url);
    showAIResponse('burnoutAIResponse', 'burnoutAIContent', res.content);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

// ── TEACHER ───────────────────────────────────────────────────────
async function loadTopics() {
  try {
    const res  = await api.getTopics(currentLang);
    const list = document.getElementById('topicList');
    if (!list) return;
    list.innerHTML = res.topics.map(topic => `
      <button class="topic-chip ${selectedTopic === topic ? 'active' : ''}"
              onclick="selectTopic('${topic.replace(/'/g, "\\'")}')">${topic}</button>
    `).join('');
  } catch (e) { /* silent */ }
}

function selectTopic(topic) {
  selectedTopic = topic;
  document.getElementById('customTopic').value = topic;
  document.querySelectorAll('.topic-chip').forEach(c =>
    c.classList.toggle('active', c.textContent === topic));
}

function showTeacherTab(tab) {
  document.querySelectorAll('.teacher-tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  const content = document.getElementById(`tab-${tab}`);
  if (content) content.classList.add('active');
  event.target.classList.add('active');
}

async function explainTopic() {
  const topic = document.getElementById('customTopic').value.trim() || selectedTopic;
  if (!topic) { showToast('Выбери или введи тему', 'error'); return; }
  const level = document.getElementById('teacherLevel').value;
  showLoader('📚 Генерирую урок...');
  try {
    const res = await api.explain({ topic, level, language: currentLang, member_id: currentMemberId || null });
    showAIResponse('teacherExplainResponse', 'teacherExplainContent', res.content);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

async function generateQuiz() {
  const topic = document.getElementById('quizTopic').value.trim();
  if (!topic) { showToast('Введи тему теста', 'error'); return; }
  const count = document.getElementById('quizCount').value;
  const level = document.getElementById('teacherLevel')?.value || 'beginner';
  showLoader('🧩 Создаю тест...');
  try {
    const res = await api.generateQuiz(topic, level, currentLang, count);
    showAIResponse('quizResponse', 'quizContent', res.content);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

async function debugHelp() {
  const code  = document.getElementById('debugCode').value.trim();
  const error = document.getElementById('debugError').value.trim();
  if (!code) { showToast('Вставь код', 'error'); return; }
  showLoader('🐛 Ищу проблему...');
  try {
    const url = `/api/teacher/debug-helper?code=${encodeURIComponent(code)}&error=${encodeURIComponent(error || '')}&language=${currentLang}`;
    const res = await apiCall('POST', url);
    showAIResponse('debugResponse', 'debugContent', res.content);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

async function generateRoadmap() {
  const goal   = document.getElementById('roadmapGoal').value.trim();
  const skills = document.getElementById('roadmapSkills').value
    .split(',').map(s => s.trim()).filter(Boolean);
  const hours  = document.getElementById('roadmapHours').value;
  if (!goal) { showToast('Введи цель', 'error'); return; }
  showLoader('🗺️ Строю роадмап...');
  try {
    const skillsQuery = skills.map(s => `current_skills=${encodeURIComponent(s)}`).join('&');
    const url = `/api/teacher/roadmap?goal=${encodeURIComponent(goal)}&available_hours=${hours}&language=${currentLang}${skillsQuery ? '&' + skillsQuery : ''}`;
    const res = await apiCall('POST', url);
    showAIResponse('roadmapResponse', 'roadmapContent', res.content);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

// ── IDEAS ─────────────────────────────────────────────────────────
async function generateIdeas() {
  const theme       = document.getElementById('ideasTheme').value.trim();
  const teamId      = document.getElementById('ideasTeamId').value;
  const constraints = document.getElementById('ideasConstraints').value.trim();
  if (!theme)  { showToast('Введи тему хакатона', 'error'); return; }
  if (!teamId) { showToast('Выбери команду', 'error'); return; }
  showLoader('✨ Генерирую идеи...');
  try {
    const res = await api.generateIdeas({ theme, team_id: +teamId, constraints: constraints || null, language: currentLang });
    showAIResponse('ideasAIResponse', 'ideasAIContent', res.content);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

async function validateIdea() {
  const idea   = document.getElementById('validateIdea').value.trim();
  const skills = document.getElementById('validateSkills').value.trim();
  if (!idea) { showToast('Опиши идею', 'error'); return; }
  showLoader('🔬 Оцениваю идею...');
  try {
    const res = await api.validateIdea(idea, skills || 'general', currentLang);
    showAIResponse('ideasAIResponse', 'ideasAIContent', res.content);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

// ── CODE REVIEW ───────────────────────────────────────────────────
async function reviewCode() {
  const code    = document.getElementById('codeInput').value.trim();
  const lang    = document.getElementById('codeLanguage').value;
  const context = document.getElementById('codeContext').value.trim();
  if (!code) { showToast('Вставь код для проверки', 'error'); return; }
  showLoader('🔍 Анализирую код...');
  try {
    const res = await api.codeReview({ code, language_code: lang, context: context || null, review_lang: currentLang });
    showAIResponse('codeAIResponse', 'codeAIContent', res.content);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

function toggleVoiceInput() {
  const btn = document.getElementById('voiceInputBtn');
  startRecording('codeContext', btn);
}

// ── PITCH ─────────────────────────────────────────────────────────
async function buildPitch() {
  const name    = document.getElementById('pitchName').value.trim();
  const desc    = document.getElementById('pitchDesc').value.trim();
  const problem = document.getElementById('pitchProblem').value.trim();
  const solution= document.getElementById('pitchSolution').value.trim();
  const teamId  = document.getElementById('pitchTeamId').value;
  if (!name || !desc || !problem) {
    showToast('Заполни название, описание и проблему', 'error'); return;
  }
  showLoader('🎤 Создаю питч...');
  try {
    const res = await api.buildPitch({
      project_name: name,
      description: desc,
      problem,
      solution: solution || '',
      team_id: teamId ? +teamId : 1,
      language: currentLang,
    });
    showAIResponse('pitchAIResponse', 'pitchAIContent', res.content);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

// ── CHAT ──────────────────────────────────────────────────────────
async function loadChatHistory() {
  const teamId = document.getElementById('chatTeamId').value;
  if (!teamId) return;
  currentTeamId = +teamId;
  connectChatWS(teamId);
  try {
    const messages = await api.getChatMessages(teamId);
    const box = document.getElementById('chatMessages');
    box.innerHTML = '';
    messages.reverse().forEach(m => addChatMessage(m.content, m.sender_type, m.sender, m.id, m.is_pinned));
    // Load pinned messages panel
    loadPinnedMessages(+teamId);
  } catch (e) {
    console.warn('Chat history error', e);
  }
}

function connectChatWS(teamId) {
  if (chatWS) { chatWS.close(); chatWS = null; }
  const wsUrl = `ws://${location.host}/api/chat/ws/${teamId}`;
  try {
    chatWS = new WebSocket(wsUrl);
    chatWS.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'message' || data.type === 'system') {
        addChatMessage(data.content, data.sender_type || 'human', data.sender || 'System');
      }
    };
    chatWS.onerror = () => showToast('WebSocket ошибка', 'error');
  } catch (e) {
    console.warn('WS not available, using HTTP fallback');
  }
}

function addChatMessage(content, senderType = 'human', sender = 'Unknown', msgId = null, isPinned = false) {
  const box = document.getElementById('chatMessages');
  const welcome = box.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  // Highlight @mentions
  const myName = document.getElementById('chatUsername')?.value || '';
  let renderedContent = renderMarkdown(content);
  if (myName && content.includes('@' + myName)) {
    renderedContent = renderedContent.replace(new RegExp('@' + myName, 'g'), `<span class="mention mention-me">@${myName}</span>`);
  }
  // General highlight any @word
  renderedContent = renderedContent.replace(/@(\w+)/g, '<span class="mention">@$1</span>');

  const el = document.createElement('div');
  el.className = `chat-msg ${senderType === 'human' ? 'msg-human' : senderType === 'agent' ? 'msg-agent' : 'msg-system'}${isPinned ? ' msg-pinned' : ''}`;
  if (msgId) el.dataset.msgId = msgId;

  const pinBtn = msgId ? `<button class="msg-action-btn" onclick="togglePinMessage(${msgId})" title="${isPinned ? 'Открепить' : 'Закрепить'}">${isPinned ? '📌' : '📍'}</button>` : '';
  const reactionsHtml = msgId ? `
    <div class="msg-reactions" id="reactions-${msgId}">
      ${['👍','❤️','😂','🔥','🎉','💡'].map(e => `<button class="reaction-btn" onclick="sendReaction(${msgId}, '${e}')">${e}</button>`).join('')}
    </div>` : '';

  el.innerHTML = `
    <div class="msg-meta">
      ${senderType === 'agent' ? '🤖' : senderType === 'system' ? '⚙️' : '👤'}
      <strong>${sender}</strong>
      <span class="msg-time">${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
      <span class="msg-actions">${pinBtn}</span>
    </div>
    <div class="msg-body">${renderedContent}</div>
    ${reactionsHtml}`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

async function sendChatMessage() {
  const teamId   = document.getElementById('chatTeamId').value;
  const username = document.getElementById('chatUsername').value.trim() || 'Участник';
  const input    = document.getElementById('chatInput');
  const text     = input.value.trim();
  if (!teamId) { showToast('Выбери команду', 'error'); return; }
  if (!text)   return;

  input.value = '';
  const msg = { team_id: +teamId, sender: username, content: text };

  if (chatWS && chatWS.readyState === WebSocket.OPEN) {
    chatWS.send(JSON.stringify({ ...msg, timestamp: new Date().toISOString() }));
  } else {
    addChatMessage(text, 'human', username);
  }
  try {
    await api.sendMessage(msg);
  } catch (e) { /* ignore */ }
}

async function sendAIMessage() {
  const teamId = document.getElementById('chatTeamId').value;
  const input  = document.getElementById('chatInput');
  const text   = input.value.trim();
  if (!teamId) { showToast('Выбери команду', 'error'); shakeInput('chatTeamId'); return; }
  if (!text)   { showToast('Введи вопрос для AI', 'error'); shakeInput('chatInput'); return; }
  input.value = '';
  addChatMessage(text, 'human', document.getElementById('chatUsername').value || 'Я');
  showChatTyping('🧠 Акыл');
  try {
    const res = await api.sendAIMessage(+teamId, text, currentLang);
    hideChatTyping();
    addChatMessage(res.content, 'agent', '🧠 Акыл');
  } catch (e) {
    hideChatTyping();
    showToast('AI ошибка: ' + e.message, 'error');
  }
}

async function getAgentFeedback() {
  const teamId   = document.getElementById('chatTeamId').value;
  const situation= document.getElementById('chatInput').value.trim() || 'Оцени текущий прогресс нашей команды';
  if (!teamId) { showToast('Выбери команду', 'error'); return; }
  showChatTyping('🤖 Агенты');
  try {
    const res = await api.quickFeedback(situation, currentLang);
    hideChatTyping();
    addChatMessage(res.content, 'agent', '🤖 Агенты');
  } catch (e) {
    hideChatTyping();
    showToast('Ошибка: ' + e.message, 'error');
  }
}

function chatKeyDown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendChatMessage();
  }
}

function toggleVoiceChat() {
  const btn = document.getElementById('voiceChatBtn');
  startRecording('chatInput', btn);
}

// ── THEME SYSTEM (10 themes) ────────────────────────────────────
const THEMES = [
  { id: 'dark',     icon: '🌙', name: 'Тёмная',     swatches: ['#080810','#7c6ff7','#3ecfcf'] },
  { id: 'light',    icon: '☀️', name: 'Светлая',    swatches: ['#f0f2f5','#7c3aed','#0ea5e9'] },
  { id: 'ocean',    icon: '🌊', name: 'Океан',       swatches: ['#010a14','#06b6d4','#38bdf8'] },
  { id: 'forest',   icon: '🌿', name: 'Лес',         swatches: ['#020d06','#22c55e','#10b981'] },
  { id: 'sunset',   icon: '🌅', name: 'Закат',       swatches: ['#0f0500','#f97316','#ec4899'] },
  { id: 'neon',     icon: '⚡', name: 'Неон',        swatches: ['#000005','#00ffe0','#bf00ff'] },
  { id: 'aurora',   icon: '🌌', name: 'Аврора',      swatches: ['#03021a','#00ffb4','#7800ff'] },
  { id: 'space',    icon: '🚀', name: 'Космос',      swatches: ['#000010','#c084fc','#818cf8'] },
  { id: 'retro',    icon: '✨', name: 'Ретро',       swatches: ['#fce4ff','#9333ea','#ec4899'] },
  { id: 'midnight', icon: '🖤', name: 'Полночь',     swatches: ['#000000','#e5e5e5','#888888'] },
];

function initTheme() {
  const saved = localStorage.getItem('akyl_theme') || 'dark';
  applyTheme(saved);
}

function openThemePicker() {
  const overlay = document.getElementById('themePickerOverlay');
  const grid = document.getElementById('themesGrid');
  if (!overlay || !grid) return;
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  grid.innerHTML = THEMES.map(t => `
    <div class="theme-card ${t.id === current ? 'active' : ''}" onclick="applyTheme('${t.id}');renderThemeCards()">
      <span class="theme-card-icon">${t.icon}</span>
      <div class="theme-swatches">
        ${t.swatches.map(c => `<div class="theme-swatch" style="background:${c}"></div>`).join('')}
      </div>
      <div class="theme-card-name">${t.name}</div>
      <div class="theme-card-desc">${t.desc}</div>
    </div>
  `).join('');
  overlay.classList.add('open');
}

function renderThemeCards() {
  const grid = document.getElementById('themesGrid');
  if (!grid) return;
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  grid.querySelectorAll('.theme-card').forEach(card => {
    const id = card.getAttribute('onclick').match(/'([^']+)'/)[1];
    card.classList.toggle('active', id === current);
  });
}

function closeThemePicker() {
  const overlay = document.getElementById('themePickerOverlay');
  if (overlay) overlay.classList.remove('open');
}

// Legacy alias for command palette
function toggleTheme() { openThemePicker(); }

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('akyl_theme', theme);
  // Update sidebar button label
  const t = THEMES.find(x => x.id === theme);
  const lbl = document.getElementById('themeLabel');
  const drawerBtn = document.getElementById('drawerThemeBtn');
  if (lbl && t) lbl.textContent = `${t.icon} ${t.name}`;
  if (drawerBtn && t) drawerBtn.textContent = `🎨 ${t.name}`;
}

// ── MEMBER LIVE SEARCH ─────────────────────────────────────────
let _memberSearchTimer = null;

function searchMembersLive(q) {
  const dropdown = document.getElementById('memberSearchDropdown');
  if (!dropdown) return;
  clearTimeout(_memberSearchTimer);
  if (!q || q.length < 1) {
    dropdown.classList.add('hidden');
    return;
  }
  _memberSearchTimer = setTimeout(async () => {
    try {
      const users = await api.searchUsersByName(q);
      if (!users.length) {
        dropdown.innerHTML = `<div style="padding:10px 14px;font-size:13px;color:var(--text-dim)">${t('team.noUsersFound') || 'Никто не найден'}</div>`;
      } else {
        dropdown.innerHTML = users.slice(0, 8).map(u => `
          <div class="user-search-item" onclick="selectMemberFromSearch('${u.username.replace(/'/g,"\\'")}', '${(u.full_name||'').replace(/'/g,"\\'")}', '${(u.skills||[]).join(',')}')">
            <div class="user-search-avatar">${u.username[0].toUpperCase()}</div>
            <div class="user-search-info">
              <div class="user-search-name">${u.username}${u.full_name ? ' — ' + u.full_name : ''}</div>
              <div class="user-search-meta">${u.rank_title || ''} · ${u.xp || 0} XP${(u.skills || []).length ? ' · ' + u.skills.slice(0, 3).join(', ') : ''}</div>
            </div>
          </div>`).join('');
      }
      dropdown.classList.remove('hidden');
    } catch (e) {
      dropdown.classList.add('hidden');
    }
  }, 300);
}

function selectMemberFromSearch(username, fullName, skillsStr) {
  const nameInput   = document.getElementById('memberName');
  const skillsInput = document.getElementById('memberSkills');
  const searchInput = document.getElementById('memberSearchInput');
  const dropdown    = document.getElementById('memberSearchDropdown');
  if (nameInput)   nameInput.value   = fullName || username;
  if (skillsInput && skillsStr) skillsInput.value = skillsStr;
  if (searchInput) searchInput.value = '';
  if (dropdown)    dropdown.classList.add('hidden');
}

// Close dropdown on outside click
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('memberSearchInput')?.closest('.user-search-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('memberSearchDropdown')?.classList.add('hidden');
  }
});

// ── PERSONAL AI CHAT ────────────────────────────────────────────
let pchatMode = 'assistant';

const PCHAT_MODE_DESCS = {
  assistant: { ru: 'Умный помощник для любых вопросов: код, учёба, идеи, планирование.', en: 'Smart assistant for any question: code, study, ideas, planning.', kz: 'Кез-келген сұраққа ақылды ассистент.' },
  mentor: { ru: 'Сократовский метод: направляет к решению через вопросы, не дает готовых ответов.', en: 'Socratic mentor: guides you through questions, no ready answers.', kz: 'Сұрақтар арқылы ментор.' },
  teacher: { ru: 'Терпеливый преподаватель с примерами и мини-тестами.', en: 'Patient teacher with examples and mini-quizzes.', kz: 'Мысалдар мен мини-тесттермен шыдамды мұғалім.' },
  motivator: { ru: 'Мотивационный коуч: энергия, вдохновение, помощь при прокрастинации.', en: 'Motivational coach: energy, inspiration, battling procrastination.', kz: 'Мотивациялық коуч: энергия, прокрастинациямен күрес.' },
};

function setPchatMode(mode) {
  pchatMode = mode;
  document.querySelectorAll('.pchat-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
  const desc = document.getElementById('pchatModeDesc');
  if (desc) desc.textContent = (PCHAT_MODE_DESCS[mode] || {})[currentLang] || (PCHAT_MODE_DESCS[mode] || {}).ru || '';
}

function addPchatMessage(content, role) {
  const box = document.getElementById('pchatMessages');
  const welcome = box.querySelector('#pchatWelcome');
  if (welcome) welcome.remove();
  const el = document.createElement('div');
  el.className = `chat-msg ${role === 'user' ? 'msg-human' : 'msg-agent'}`;
  el.innerHTML = `
    <div class="msg-meta">${role === 'user' ? '👤 ' + t('personalChat.you') : '🤖 AI'}</div>
    <div class="msg-body">${renderMarkdown(content)}</div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

async function sendPersonalMessage() {
  const input = document.getElementById('pchatInput');
  const text  = input?.value?.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';

  addPchatMessage(text, 'user');

  const user = AUTH.getUser();
  const box  = document.getElementById('pchatMessages');

  // Create AI bubble immediately for streaming
  const el = document.createElement('div');
  el.className = 'chat-msg msg-agent streaming';
  el.innerHTML = `
    <div class="msg-meta">🤖 AI</div>
    <div class="msg-body" id="streamTarget"><span class="stream-cursor">▋</span></div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;

  const target = document.getElementById('streamTarget');
  let tokens = '';

  const params = new URLSearchParams({
    message: text,
    language: currentLang,
    mode: pchatMode,
  });
  if (user?.id) params.set('user_id', user.id);

  const evtSrc = new EventSource(`/api/personal-chat/stream?${params.toString()}`);

  evtSrc.onmessage = evt => {
    const data = JSON.parse(evt.data);
    if (data.error) {
      target.innerHTML = `<em style="color:var(--error)">Ошибка: ${data.error}</em>`;
      evtSrc.close();
      el.classList.remove('streaming');
      return;
    }
    if (data.done) {
      evtSrc.close();
      el.classList.remove('streaming');
      target.innerHTML = renderMarkdown(tokens);
      box.scrollTop = box.scrollHeight;
      return;
    }
    if (data.token) {
      tokens += data.token;
      target.innerHTML = tokens.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + '<span class="stream-cursor">▋</span>';
      box.scrollTop = box.scrollHeight;
    }
  };

  evtSrc.onerror = () => {
    evtSrc.close();
    el.classList.remove('streaming');
    if (!tokens) {
      target.innerHTML = '<em style="color:var(--error)">Ошибка соединения</em>';
    } else {
      target.innerHTML = renderMarkdown(tokens);
    }
  };
}

async function loadPersonalChatHistory() {
  const user = AUTH.getUser();
  if (!user) return;
  const box = document.getElementById('pchatMessages');
  if (!box) return;
  try {
    const history = await api.getPersonalHistory(user.id);
    if (!history.length) return;
    box.innerHTML = '';
    history.forEach(m => addPchatMessage(m.content, m.role));
  } catch (e) { /* silent */ }
  // init mode desc
  setPchatMode(pchatMode);
}

async function clearPchatHistory() {
  const user = AUTH.getUser();
  if (!user) return;
  try {
    await api.clearPersonalHistory(user.id);
    const box = document.getElementById('pchatMessages');
    if (box) box.innerHTML = `<div class="chat-welcome" id="pchatWelcome"><span>🤖</span><p>История очищена!</p></div>`;
    showToast('✅ История очищена', 'success');
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

function pchatKeyDown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendPersonalMessage();
  }
}

function toggleVoicePchat() {
  const btn = document.getElementById('voicePchatBtn');
  startRecording('pchatInput', btn);
}


// ── VOICE HELPER ──────────────────────────────────────────────────
function stopRecording(btnEl) {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  if (btnEl) btnEl.classList.remove('voice-recording');
}

// ── COMMAND PALETTE Ctrl+K ────────────────────────────────────────
const CMD_ITEMS = [
  { icon: '🏠', label: 'Главная',            labelEn: 'Home',            page: 'home',          category: 'Страницы' },
  { icon: '👥', label: 'Команда',            labelEn: 'Team',            page: 'team',          category: 'Страницы' },
  { icon: '💤', label: 'Выгорание',          labelEn: 'Burnout',         page: 'burnout',       category: 'Страницы' },
  { icon: '📚', label: 'Учитель',            labelEn: 'Teacher',         page: 'teacher',       category: 'Страницы' },
  { icon: '💡', label: 'Идеи',              labelEn: 'Ideas',           page: 'ideas',         category: 'Страницы' },
  { icon: '🔍', label: 'Код-ревью',         labelEn: 'Code Review',     page: 'codereview',    category: 'Страницы' },
  { icon: '🎤', label: 'Питч',              labelEn: 'Pitch',           page: 'pitch',         category: 'Страницы' },
  { icon: '💬', label: 'Чат команды',       labelEn: 'Team Chat',       page: 'chat',          category: 'Страницы' },
  { icon: '🤖', label: 'Личный AI',         labelEn: 'Personal AI',     page: 'personal-chat', category: 'Страницы' },
  { icon: '📋', label: 'Канбан-доска',      labelEn: 'Kanban Board',    page: 'kanban',        category: 'Страницы' },
  { icon: '📈', label: 'Дашборд',           labelEn: 'Dashboard',       page: 'dashboard',     category: 'Страницы' },
  { icon: '🏆', label: 'Турниры',           labelEn: 'Tournaments',     page: 'tournaments',   category: 'Страницы' },
  { icon: '🔎', label: 'Найти команду',     labelEn: 'Find Team',       page: 'find-team',     category: 'Страницы' },
  { icon: '📊', label: 'Лидерборд',         labelEn: 'Leaderboard',     page: 'leaderboard',   category: 'Страницы' },
  { icon: '👤', label: 'Профиль',           labelEn: 'Profile',         page: 'profile',       category: 'Страницы' },
  { icon: '🗒️', label: 'Заметки',          labelEn: 'Notes',           page: 'notes',         category: 'Страницы' },
  { icon: '🌙', label: 'Сменить тему',      labelEn: 'Toggle Theme',    action: 'toggleTheme', category: 'Действия' },
  { icon: '🔗', label: 'Создать команду',   labelEn: 'Create Team',     action: 'createTeamFocus', category: 'Действия' },
  { icon: '🚀', label: 'Добавить задачу',   labelEn: 'Add Kanban Task', action: 'openKanbanTask', category: 'Действия' },
];

let cmdSelectedIndex = 0;
let cmdFilteredItems = [...CMD_ITEMS];

function openCmdPalette() {
  const overlay = document.getElementById('cmdPalette');
  overlay.style.display = 'flex';
  const input = document.getElementById('cmdInput');
  input.value = '';
  renderCmdItems('');
  setTimeout(() => input.focus(), 50);
}

function closeCmdPalette(e) {
  if (e && e.target !== document.getElementById('cmdPalette')) return;
  document.getElementById('cmdPalette').style.display = 'none';
}

function renderCmdItems(query) {
  const q = query.toLowerCase();
  cmdFilteredItems = CMD_ITEMS.filter(item =>
    item.label.toLowerCase().includes(q) || item.labelEn.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
  );
  cmdSelectedIndex = 0;
  const list = document.getElementById('cmdList');
  if (!cmdFilteredItems.length) {
    list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-dimmer);font-size:13px;">Ничего не найдено</div>`;
    return;
  }
  list.innerHTML = cmdFilteredItems.map((item, i) => `
    <div class="cmd-item${i === 0 ? ' selected' : ''}" onclick="executeCmdItem(${i})">
      <span class="cmd-item-icon">${item.icon}</span>
      <span class="cmd-item-label">${item.label}</span>
      <span class="cmd-item-category">${item.category}</span>
    </div>`).join('');
}

function filterCmdItems(query) {
  renderCmdItems(query);
}

function cmdKeyDown(event) {
  if (event.key === 'Escape') { document.getElementById('cmdPalette').style.display = 'none'; return; }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    cmdSelectedIndex = Math.min(cmdSelectedIndex + 1, cmdFilteredItems.length - 1);
    updateCmdSelection();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    cmdSelectedIndex = Math.max(cmdSelectedIndex - 1, 0);
    updateCmdSelection();
  } else if (event.key === 'Enter') {
    executeCmdItem(cmdSelectedIndex);
  }
}

function updateCmdSelection() {
  document.querySelectorAll('.cmd-item').forEach((el, i) => {
    el.classList.toggle('selected', i === cmdSelectedIndex);
    if (i === cmdSelectedIndex) el.scrollIntoView({ block: 'nearest' });
  });
}

function executeCmdItem(index) {
  const item = cmdFilteredItems[index];
  if (!item) return;
  document.getElementById('cmdPalette').style.display = 'none';
  if (item.page) { showPage(item.page); return; }
  if (item.action === 'toggleTheme') { toggleTheme(); return; }
  if (item.action === 'createTeamFocus') { showPage('team'); setTimeout(() => document.getElementById('teamName')?.focus(), 200); return; }
  if (item.action === 'openKanbanTask') { showPage('kanban'); setTimeout(() => openAddKanbanTask(), 300); return; }
}

// Global keyboard shortcut
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const palette = document.getElementById('cmdPalette');
    if (palette.style.display === 'none') openCmdPalette();
    else palette.style.display = 'none';
  }
  if (e.key === 'Escape') {
    if (document.getElementById('cmdPalette').style.display !== 'none')
      document.getElementById('cmdPalette').style.display = 'none';
    closeThemePicker();
  }
});

// ── KANBAN BOARD ──────────────────────────────────────────────────
let ktColor = '#7c3aed';
let dragTaskId = null;

const PRIORITY_LABELS = { low: '🟢 Низкий', medium: '🟡 Средний', high: '🔴 Высокий', critical: '🚨 Крит.' };
const PRIORITY_CLASS   = { low: 'priority-low', medium: 'priority-medium', high: 'priority-high', critical: 'priority-critical' };

async function initKanbanPage() {
  const sel = document.getElementById('kanbanTeamFilter');
  if (sel && allTeams.length) {
    sel.innerHTML = '<option value="">— Личные задачи —</option>';
    allTeams.forEach(t => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.name;
      sel.appendChild(o);
    });
    // Restore saved filter
    const saved = localStorage.getItem('akyl_kanban_team');
    if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved;
    sel.addEventListener('change', () => localStorage.setItem('akyl_kanban_team', sel.value), { once: false });
  }
  await loadKanban();
  // Init real-time WebSocket sync
  const user = AUTH.getUser();
  const teamId = document.getElementById('kanbanTeamFilter')?.value || '';
  const roomId = teamId ? `team_${teamId}` : (user?.id ? `user_${user.id}` : null);
  if (roomId) initKanbanWS(roomId);
  // Remove duplicate change listeners from re-init calls
  if (sel) sel.onchange = () => { localStorage.setItem('akyl_kanban_team', sel.value); loadKanban(); };
}

async function loadKanban() {
  const user = AUTH.getUser();
  const teamId = document.getElementById('kanbanTeamFilter')?.value || '';
  const params = new URLSearchParams();
  if (teamId) params.set('team_id', teamId);
  else if (user?.id) params.set('user_id', user.id);

  try {
    const tasks = await api.kanbanTasks(params.toString());
    _kanbanTasks = tasks;  // cache for inline editing
    // Clear all columns
    ['backlog','todo','doing','review','done'].forEach(s => {
      const col = document.getElementById('col-' + s);
      if (col) col.innerHTML = '';
      const cnt = document.getElementById('count-' + s);
      if (cnt) cnt.textContent = '0';
    });
    // Render tasks
    tasks.forEach(t => renderKanbanCard(t));
    ['backlog','todo','doing','review','done'].forEach(s => {
      const col = document.getElementById('col-' + s);
      const cnt = document.getElementById('count-' + s);
      if (cnt && col) cnt.textContent = col.children.length;
    });
  } catch (e) {
    showToast('Ошибка загрузки канбана: ' + e.message, 'error');
  }
}

function renderKanbanCard(task) {
  const col = document.getElementById('col-' + task.status);
  if (!col) return;
  const card = document.createElement('div');
  card.className = 'kanban-card';
  card.dataset.id = task.id;
  card.style.borderLeftColor = task.color || '#7c3aed';
  card.draggable = true;
  card.innerHTML = `
    <div class="kanban-card-title" onclick="openEditKanbanTask(${task.id})" style="cursor:pointer;" title="Нажми для редактирования">${escapeHtml(task.title)}</div>
    ${task.description ? `<div style="font-size:11px;color:var(--text-dim);margin-bottom:6px;cursor:pointer;" onclick="openEditKanbanTask(${task.id})">${escapeHtml(task.description.slice(0,80))}${task.description.length > 80 ? '…' : ''}</div>` : ''}
    <div class="kanban-card-meta">
      <span class="kanban-priority ${PRIORITY_CLASS[task.priority] || 'priority-medium'}">${PRIORITY_LABELS[task.priority] || task.priority}</span>
      ${task.assignee_name ? `<span class="kanban-assignee">👤 ${escapeHtml(task.assignee_name)}</span>` : ''}
    </div>
    ${task.due_date ? renderDueDateBadge(task.due_date) : ''}
    <button class="kanban-delete" onclick="deleteKanbanTask(${task.id})" title="Удалить">✕</button>`;
  card.addEventListener('dragstart', () => {
    dragTaskId = task.id;
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.kanban-tasks').forEach(c => c.classList.remove('drag-over'));
  });
  col.appendChild(card);
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderDueDateBadge(dueDateStr) {
  const due = new Date(dueDateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const diff = Math.ceil((dueDay - today) / 86400000); // days
  let cls, label;
  if (diff < 0)      { cls = 'due-overdue';  label = `🔴 Просрочено (${-diff}д)`; }
  else if (diff === 0){ cls = 'due-today';    label = '🟡 Сегодня'; }
  else if (diff <= 2) { cls = 'due-soon';     label = `⏳ Через ${diff}д`; }
  else                { cls = 'due-ok';       label = `📅 ${dueDay.toLocaleDateString('ru-RU', {day:'numeric',month:'short'})}`; }
  return `<div class="kanban-due ${cls}">${label}</div>`;
}

function kanbanDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add('drag-over');
}

async function kanbanDrop(event, newStatus) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  if (!dragTaskId) return;
  try {
    await api.kanbanMoveTask(dragTaskId, newStatus);
    if (newStatus === 'done') {
      if (typeof confetti === 'function') {
        confetti({ particleCount: 90, spread: 70, origin: { y: 0.6 }, colors: ['#7c3aed','#3ecfcf','#f59e0b','#22c55e'] });
      }
      showToast('✅ Задача выполнена!', 'success');
    }
    await loadKanban();
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  }
}

function openAddKanbanTask() {
  _editTaskId = null;  // reset edit mode
  document.querySelector('#addKanbanTaskModal h3').innerHTML = '📋 <span data-i18n="kanban.addTask">Новая задача</span>';
  document.getElementById('ktSubmitBtn').textContent = '✅ Создать';
  document.getElementById('ktTitle').value = '';
  document.getElementById('ktDesc').value = '';
  document.getElementById('ktAssignee').value = '';
  document.getElementById('ktPriority').value = 'medium';
  const dd = document.getElementById('ktDueDate');
  if (dd) dd.value = '';
  ktColor = '#7c3aed';
  document.querySelectorAll('.color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === ktColor));
  document.getElementById('addKanbanTaskModal').style.display = 'flex';
}

function selectKtColor(el, color) {
  ktColor = color;
  document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
  el.classList.add('active');
}

function openEditKanbanTask(taskId) {
  const task = _kanbanTasks.find(t => t.id === taskId);
  if (!task) { showToast('Задача не найдена', 'error'); return; }
  _editTaskId = taskId;
  document.querySelector('#addKanbanTaskModal h3').innerHTML = '✏️ Редактировать задачу';
  document.getElementById('ktSubmitBtn').textContent = '💾 Сохранить';
  document.getElementById('ktTitle').value = task.title || '';
  document.getElementById('ktDesc').value = task.description || '';
  document.getElementById('ktAssignee').value = task.assignee_name || '';
  document.getElementById('ktPriority').value = task.priority || 'medium';
  const dd = document.getElementById('ktDueDate');
  if (dd) dd.value = task.due_date ? task.due_date.slice(0, 10) : '';
  ktColor = task.color || '#7c3aed';
  document.querySelectorAll('.color-dot').forEach(d => d.classList.toggle('active', d.dataset.color === ktColor));
  document.getElementById('addKanbanTaskModal').style.display = 'flex';
}

async function submitKanbanTask() {
  const title = document.getElementById('ktTitle')?.value?.trim();
  if (!title) { showToast('Введи название задачи', 'error'); shakeInput('ktTitle'); return; }
  const data = {
    title,
    description: document.getElementById('ktDesc')?.value?.trim() || null,
    priority: document.getElementById('ktPriority')?.value || 'medium',
    assignee_name: document.getElementById('ktAssignee')?.value?.trim() || null,
    color: ktColor,
    due_date: document.getElementById('ktDueDate')?.value || null,
  };
  try {
    if (_editTaskId) {
      await api.kanbanUpdateTask(_editTaskId, data);
      showToast('✏️ Задача обновлена', 'success');
    } else {
      const user = AUTH.getUser();
      const teamId = document.getElementById('kanbanTeamFilter')?.value || null;
      data.team_id = teamId ? +teamId : null;
      data.user_id = user?.id || null;
      data.status = 'backlog';
      await api.kanbanCreate(data);
      showToast('✅ Задача создана', 'success');
    }
    closeModal('addKanbanTaskModal');
    _editTaskId = null;
    await loadKanban();
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  }
}

async function addKanbanTask() {
  return submitKanbanTask();
}

async function deleteKanbanTask(taskId) {
  if (!confirm('Удалить задачу?')) return;
  try {
    await api.kanbanDelete(taskId);
    await loadKanban();
    showToast('🗑️ Задача удалена', 'success');
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  }
}

function exportKanbanCSV() {
  if (!_kanbanTasks.length) { showToast('Нет задач для экспорта', 'error'); return; }
  const headers = ['ID', 'Название', 'Описание', 'Статус', 'Приоритет', 'Исполнитель', 'Дедлайн', 'Создано'];
  const STATUS_LABELS_RU = { backlog:'Бэклог', todo:'К выполнению', doing:'В работе', review:'Ревью', done:'Готово' };
  const rows = _kanbanTasks.map(t => [
    t.id,
    `"${(t.title || '').replace(/"/g,'""')}"`,
    `"${(t.description || '').replace(/"/g,'""')}"`,
    STATUS_LABELS_RU[t.status] || t.status,
    PRIORITY_LABELS[t.priority] || t.priority,
    t.assignee_name || '',
    t.due_date ? t.due_date.slice(0, 10) : '',
    t.created_at ? t.created_at.slice(0, 10) : '',
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `kanban_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast('📥 CSV экспортирован', 'success');
}

// ── AI INSIGHTS ───────────────────────────────────────────────────
async function predictFailure() {
  const teamId = currentTeamId;
  if (!teamId) return showToast('Выбери команду сначала', 'error');
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Анализирую...'; }
  const box = document.getElementById('insightsResult');
  box.style.display = 'none';
  try {
    const res = await api.predictFailure(teamId, currentLang);
    showInsightResult(res.prediction || res.result || JSON.stringify(res), box);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⚠️ Предсказать риски'; }
  }
}

function showInsightResult(text, box) {
  const html = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(text) : text;
  box.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
      <button class="btn" style="font-size:12px;padding:4px 10px;" onclick="navigator.clipboard.writeText(${JSON.stringify(text)}).then(()=>showToast('\ud83d\udccb Скопировано','success'))">📋 Копировать</button>
    </div>
    <div class="ai-content-body">${html}</div>`;
  box.style.display = 'block';
  if (window.hljs) box.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openSkillMatch() {
  const card = document.getElementById('skillMatchCard');
  if (!card) return;
  card.style.display = card.style.display === 'none' ? 'block' : 'none';
}

async function runSkillMatch() {
  const teamId = currentTeamId;
  const needs = document.getElementById('skillMatchNeeds')?.value.trim();
  if (!needs) return showToast('Опишите, что нужно команде', 'error');
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Анализирую...'; }
  const box = document.getElementById('insightsResult');
  box.style.display = 'none';
  try {
    const res = await api.skillMatch({ team_id: teamId, requirements: needs, language: currentLang });
    showInsightResult(res.analysis || res.result || JSON.stringify(res), box);
    document.getElementById('skillMatchCard').style.display = 'none';
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🤖 Найти совместимость'; }
  }
}

async function generateTeamInsightsReport() {
  const teamId = currentTeamId;
  if (!teamId) return showToast('Выбери команду сначала', 'error');
  const summary = await showInputModal('📊 Итоговый отчёт', 'Кратко опишите результат проекта (необязательно)', '');
  if (summary === null) return; // user cancelled
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерирую...'; }
  const box = document.getElementById('insightsResult');
  box.style.display = 'none';
  try {
    const res = await api.postHackathonReport(teamId, summary, currentLang);
    showInsightResult(res.report || res.result || JSON.stringify(res), box);
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📊 Итоговый отчёт'; }
  }
}

// ── PWA SERVICE WORKER ──────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        console.log('[PWA] Service Worker registered, scope:', reg.scope);
        // Listen for updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('🔄 Доступно обновление! Перезагрузите страницу.', 'info');
            }
          });
        });
      })
      .catch(err => console.warn('[PWA] SW registration failed:', err));
  });
}

async function loadPinnedMessages(teamId) {
  try {
    const pins = await api.getPinnedMessages(teamId);
    let panel = document.getElementById('pinnedMsgPanel');
    if (!panel) {
      const sidebar = document.querySelector('#page-chat .chat-sidebar');
      if (!sidebar) return;
      panel = document.createElement('div');
      panel.id = 'pinnedMsgPanel';
      panel.className = 'card';
      panel.style.marginBottom = '12px';
      sidebar.prepend(panel);
    }
    if (!pins.length) { panel.style.display = 'none'; return; }
    panel.style.display = '';
    panel.innerHTML = `<h4>📌 Закреплённые (${pins.length})</h4>` +
      pins.map(m => `<div class="pinned-item"><strong>${m.sender}</strong>: ${escapeHtml(m.content.slice(0, 80))}${m.content.length > 80 ? '…' : ''}</div>`).join('');
  } catch (e) { /* silent */ }
}

// ── TEAM DASHBOARD ────────────────────────────────────────────────
async function initDashboardPage() {
  // Populate team select
  const sel = document.getElementById('dashboardTeamSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Выберите команду —</option>';
  (allTeams || []).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  });
  // Auto-select current team
  if (currentTeamId) {
    sel.value = currentTeamId;
    loadDashboard();
  }
  // Start 30-second auto-refresh
  if (_dashPoll) clearInterval(_dashPoll);
  _dashPoll = setInterval(() => {
    if (document.getElementById('page-dashboard')?.classList.contains('active')) {
      loadDashboard();
    } else {
      clearInterval(_dashPoll); _dashPoll = null;
    }
  }, 30000);
}

async function loadDashboard() {
  const teamId = document.getElementById('dashboardTeamSelect')?.value;
  if (!teamId) return;

  try {
    // Fetch data in parallel
    const [members, tasks, messages, onlineUsers] = await Promise.all([
      api.getTeamMembers(+teamId).catch(() => []),
      api.kanbanTasks(`team_id=${teamId}`).catch(() => []),
      api.getChatMessages(+teamId).catch(() => []),
      api.getOnlineUsers().catch(() => []),
    ]);

    // Online count
    const teamMemberNames = new Set(members.map(m => m.name));
    const onlineInTeam = onlineUsers.filter(u => teamMemberNames.has(u.username)).length;

    // Stats (animated)
    animateCounter('dashMembersCount', members.length);
    animateCounter('dashOnlineCount', onlineInTeam);
    animateCounter('dashTasksDone', tasks.filter(t => t.status === 'done').length);
    const burnoutAvg = members.length ? (members.reduce((s, m) => s + (m.burnout_score || 0), 0) / members.length).toFixed(1) : '—';
    document.getElementById('dashBurnoutAvg').textContent = burnoutAvg;

    // Kanban breakdown
    const statuses = { backlog: 0, todo: 0, doing: 0, review: 0, done: 0 };
    tasks.forEach(t => { if (statuses[t.status] !== undefined) statuses[t.status]++; });
    const kbEl = document.getElementById('dashKanbanBreakdown');
    kbEl.innerHTML = Object.entries(statuses).map(([s, c]) => `
      <div class="dash-kb-row">
        <span class="dash-kb-label">${s.charAt(0).toUpperCase() + s.slice(1)}</span>
        <div class="dash-kb-bar"><div class="dash-kb-fill" style="width:${tasks.length ? Math.round(c / tasks.length * 100) : 0}%"></div></div>
        <span class="dash-kb-count">${c}</span>
      </div>`).join('');

    // Members list
    const mlEl = document.getElementById('dashMembersList');
    mlEl.innerHTML = members.length ? members.map(m => {
      const avatarColor = `hsl(${(m.name||'?').charCodeAt(0) * 3 % 360}, 60%, 45%)`;
      return `
      <div class="dash-member-row">
        <span class="dash-member-avatar" style="background:${avatarColor}">${(m.name || '?')[0].toUpperCase()}</span>
        <div>
          <div class="dash-member-name">${escapeHtml(m.name)} <span style="opacity:.6;font-size:12px;">${m.role || ''}</span></div>
          <div class="dash-member-skills">${(m.skills || []).slice(0, 4).join(', ')}</div>
        </div>
        <div class="dash-burnout-pill ${m.burnout_score > 70 ? 'pill-danger' : m.burnout_score > 40 ? 'pill-warn' : 'pill-ok'}" title="\u0412\u044b\u0433\u043e\u0440\u0430\u043d\u0438\u0435">${m.burnout_score?.toFixed(0) ?? 0}%</div>
      </div>`;
    }).join('') : '<div class="empty-state">Нет участников</div>';

    // Recent messages
    const rmEl = document.getElementById('dashRecentMessages');
    const recent = messages.slice(-8).reverse();
    rmEl.innerHTML = recent.length ? recent.map(m => `
      <div class="dash-msg-row">
        <span class="dash-msg-sender">${escapeHtml(m.sender)}</span>
        <span class="dash-msg-content">${escapeHtml((m.content || '').slice(0, 100))}</span>
      </div>`).join('') : '<div class="empty-state">Нет сообщений</div>';

  } catch (e) {
    showToast('Ошибка загрузки дашборда: ' + e.message, 'error');
  }
}

// ── GUEST LOGIN ───────────────────────────────────────────────────
async function doGuestLogin() {
  try {
    const res = await api.guestLogin();
    AUTH.setToken(res.access_token);
    AUTH.setUser(res.user);
    if (typeof updateSidebarUser === 'function') updateSidebarUser(res.user);
    if (typeof closeAuth === 'function') closeAuth();
    showToast(`\ud83d\udc7b \u0412\u044b \u0432\u043e\u0448\u043b\u0438 \u043a\u0430\u043a \u0433\u043e\u0441\u0442\u044c: ${res.user.username}`, 'success');
    if (typeof startHeartbeat === 'function') startHeartbeat();
  } catch (e) {
    showToast('\u041e\u0448\u0438\u0431\u043a\u0430: ' + e.message, 'error');
  }
}

// ── CHAT REACTIONS ────────────────────────────────────────────────
async function sendReaction(msgId, emoji) {
  const username = document.getElementById('chatUsername')?.value || AUTH.getUser()?.username || '\u0410\u043d\u043e\u043d\u0438\u043c';
  try {
    const res = await api.reactToMessage(msgId, emoji, username);
    updateReactionsUI(msgId, res.reactions);
  } catch (e) { /* silent */ }
}

function updateReactionsUI(msgId, reactions) {
  const bar = document.getElementById(`reactions-${msgId}`);
  if (!bar) return;
  const emojis = ['\ud83d\udc4d','\u2764\ufe0f','\ud83d\ude02','\ud83d\udd25','\ud83c\udf89','\ud83d\udca1'];
  bar.innerHTML = emojis.map(e => {
    const count = reactions[e] || 0;
    return `<button class="reaction-btn${count ? ' reaction-active' : ''}" onclick="sendReaction(${msgId}, '${e}')">${e}${count ? ' <span class="reaction-count">' + count + '</span>' : ''}</button>`;
  }).join('');
}

// ── PIN MESSAGES ──────────────────────────────────────────────────
async function togglePinMessage(msgId) {
  try {
    const res = await api.togglePin(msgId);
    showToast(res.pinned ? '\ud83d\udccc \u0421\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u0437\u0430\u043a\u0440\u0435\u043f\u043b\u0435\u043d\u043e!' : '\ud83d\udccd \u041e\u0442\u043a\u0440\u0435\u043f\u043b\u0435\u043d\u043e', 'success');
    const el = document.querySelector(`[data-msg-id="${msgId}"]`);
    if (el) {
      el.classList.toggle('msg-pinned', res.pinned);
      const btn = el.querySelector('.msg-action-btn');
      if (btn) btn.textContent = res.pinned ? '\ud83d\udccc' : '\ud83d\udccd';
    }
    if (currentTeamId) loadPinnedMessages(currentTeamId);
  } catch (e) { /* silent */ }
}

async function loadPinnedMessages(teamId) {
  try {
    const pins = await api.getPinnedMessages(teamId);
    let panel = document.getElementById('pinnedMsgPanel');
    if (!panel) {
      const sidebar = document.querySelector('#page-chat .chat-sidebar');
      if (!sidebar) return;
      panel = document.createElement('div');
      panel.id = 'pinnedMsgPanel';
      panel.className = 'card';
      panel.style.marginBottom = '12px';
      sidebar.prepend(panel);
    }
    if (!pins.length) { panel.style.display = 'none'; return; }
    panel.style.display = '';
    panel.innerHTML = `<h4>\ud83d\udccc \u0417\u0430\u043a\u0440\u0435\u043f\u043b\u0451\u043d\u043d\u044b\u0435 (${pins.length})</h4>` +
      pins.map(m => `<div class="pinned-item"><strong>${escapeHtml(m.sender)}</strong>: ${escapeHtml(m.content.slice(0, 80))}${m.content.length > 80 ? '\u2026' : ''}</div>`).join('');
  } catch (e) { /* silent */ }
}

// ── CHANNELS ──────────────────────────────────────────────────────
let currentChannelId = null;
let currentChannelAiEnabled = true;

async function initChannelsPage() {
  const sel = document.getElementById('channelTeamSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">\u2014 \u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u043e\u043c\u0430\u043d\u0434\u0443 \u2014</option>';
  (allTeams || []).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  });
  if (currentTeamId) { sel.value = currentTeamId; loadChannels(); }
}

async function loadChannels() {
  const teamId = document.getElementById('channelTeamSelect')?.value;
  if (!teamId) return;
  try {
    const channels = await api.getChannels(+teamId);
    const list = document.getElementById('channelsList');
    list.innerHTML = '';
    channels.forEach(ch => {
      const item = document.createElement('div');
      item.className = 'channel-item' + (ch.id === currentChannelId ? ' active' : '');
      item.dataset.id = ch.id;
      item.innerHTML = `<span>${ch.name}</span><span class="channel-ai-dot${ch.is_ai_enabled ? '' : ' off'}" title="AI ${ch.is_ai_enabled ? '\u0432\u043a\u043b' : '\u0432\u044b\u043a\u043b'}"></span>`;
      item.onclick = () => openChannel(ch);
      list.appendChild(item);
    });
    if (channels.length && !currentChannelId) openChannel(channels[0]);
  } catch (e) {
    showToast('\u041e\u0448\u0438\u0431\u043a\u0430: ' + e.message, 'error');
  }
}

async function openChannel(ch) {
  currentChannelId = ch.id;
  currentChannelAiEnabled = ch.is_ai_enabled;
  document.querySelectorAll('.channel-item').forEach(el => el.classList.toggle('active', +el.dataset.id === ch.id));
  document.getElementById('channelHeader').style.display = '';
  document.getElementById('channelTitle').textContent = ch.name;
  document.getElementById('channelDesc').textContent = ch.description || '';
  updateChannelAIButton(ch.is_ai_enabled);
  const box = document.getElementById('channelMessages');
  box.innerHTML = '';
  try {
    const msgs = await api.getChannelMessages(ch.id);
    msgs.forEach(m => addChannelMessage(m.sender, m.content, m.sender_type));
  } catch (e) { /* silent */ }
  box.scrollTop = box.scrollHeight;
}

function addChannelMessage(sender, content, senderType = 'human') {
  const box = document.getElementById('channelMessages');
  box.querySelector('.chat-welcome')?.remove();
  const el = document.createElement('div');
  el.className = `chat-msg ${senderType === 'human' ? 'msg-human' : 'msg-agent'}`;
  el.innerHTML = `<div class="msg-meta">${senderType === 'agent' ? '\ud83e\udd16' : '\ud83d\udc64'} <strong>${escapeHtml(sender)}</strong></div><div class="msg-body">${renderMarkdown(content)}</div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

async function sendChannelMessage() {
  if (!currentChannelId) return showToast('\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u0430\u043d\u0430\u043b', 'error');
  const sender = document.getElementById('channelSender').value.trim() || '\u0423\u0447\u0430\u0441\u0442\u043d\u0438\u043a';
  const input = document.getElementById('channelInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addChannelMessage(sender, text, 'human');
  try { await api.sendChannelMessage(currentChannelId, { sender, content: text }); } catch (e) { /* silent */ }
}

async function askChannelAI() {
  if (!currentChannelId) return showToast('\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u0430\u043d\u0430\u043b', 'error');
  if (!currentChannelAiEnabled) return showToast('AI \u043e\u0442\u043a\u043b\u044e\u0447\u0451\u043d \u0432 \u044d\u0442\u043e\u043c \u043a\u0430\u043d\u0430\u043b\u0435', 'error');
  const msg = document.getElementById('channelInput').value.trim();
  if (!msg) return showToast('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0432\u043e\u043f\u0440\u043e\u0441', 'error');
  document.getElementById('channelInput').value = '';
  addChannelMessage(document.getElementById('channelSender').value || '\u042f', msg, 'human');
  const btn = document.getElementById('channelAskAIBtn');
  if (btn) { btn.disabled = true; btn.textContent = '\u23f3'; }
  try {
    const res = await api.channelAIReply(currentChannelId, msg, currentLang);
    addChannelMessage('\ud83e\udd16 \u0410\u043a\u044b\u043b', res.reply || res.error || '\u041e\u0448\u0438\u0431\u043a\u0430', 'agent');
  } catch (e) {
    showToast('\u041e\u0448\u0438\u0431\u043a\u0430: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '\ud83e\udd16'; }
  }
}

async function toggleChannelAI() {
  if (!currentChannelId) return;
  try {
    const res = await api.toggleChannelAI(currentChannelId);
    currentChannelAiEnabled = res.is_ai_enabled;
    updateChannelAIButton(res.is_ai_enabled);
    showToast(`AI ${res.is_ai_enabled ? '\u0432\u043a\u043b\u044e\u0447\u0451\u043d' : '\u043e\u0442\u043a\u043b\u044e\u0447\u0451\u043d'}`, 'success');
    loadChannels();
  } catch (e) { /* silent */ }
}

function updateChannelAIButton(enabled) {
  const btn = document.getElementById('channelAiToggleBtn');
  if (!btn) return;
  btn.textContent = `\ud83e\udd16 AI: ${enabled ? '\u0412\u043a\u043b' : '\u0412\u044b\u043a\u043b'}`;
  btn.className = `btn btn-sm${enabled ? '' : ' btn-secondary'}`;
}

async function requestChannelSummary() {
  if (!currentChannelId) return;
  const card = document.getElementById('channelSummaryCard');
  const content = document.getElementById('channelSummaryContent');
  card.style.display = '';
  content.innerHTML = '\u23f3 \u0413\u0435\u043d\u0435\u0440\u0438\u0440\u0443\u044e \u0440\u0435\u0437\u044e\u043c\u0435...';
  try {
    const res = await api.channelSummary(currentChannelId, currentLang);
    content.innerHTML = marked.parse ? marked.parse(res.summary) : res.summary;
  } catch (e) {
    content.innerHTML = '\u041e\u0448\u0438\u0431\u043a\u0430: ' + e.message;
  }
}

function channelKeyDown(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChannelMessage(); }
}

function openCreateChannel() {
  document.getElementById('newChannelName').value = '';
  document.getElementById('newChannelDesc').value = '';
  document.getElementById('newChannelAI').checked = true;
  document.getElementById('createChannelModal').style.display = 'flex';
}

async function createChannel() {
  const teamId = document.getElementById('channelTeamSelect')?.value;
  if (!teamId) return showToast('\u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u043a\u043e\u043c\u0430\u043d\u0434\u0443', 'error');
  const name = document.getElementById('newChannelName').value.trim();
  if (!name) return showToast('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435', 'error');
  const desc = document.getElementById('newChannelDesc').value.trim();
  const ai = document.getElementById('newChannelAI').checked;
  try {
    await api.createChannel({ team_id: +teamId, name, description: desc, is_ai_enabled: ai });
    closeModal('createChannelModal');
    showToast(`# ${name} \u0441\u043e\u0437\u0434\u0430\u043d!`, 'success');
    currentChannelId = null;
    loadChannels();
  } catch (e) {
    showToast('\u041e\u0448\u0438\u0431\u043a\u0430: ' + e.message, 'error');
  }
}

// ── IDEAS ROADMAP ──────────────────────────────────────────────────
function toggleIdeasRoadmap(btn) {
  const content = document.getElementById('ideasContent');
  const chevron = btn.querySelector('.ideas-chevron');
  const open = content.style.display === 'none';
  content.style.display = open ? '' : 'none';
  chevron.classList.toggle('open', open);
}

// ── AUTO-RESIZE TEXTAREAS ─────────────────────────────────────────
function initAutoResize() {
  document.querySelectorAll('textarea.input').forEach(ta => {
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 400) + 'px';
    });
  });
}

// ── COUNTDOWN TIMER ───────────────────────────────────────────────
let _cdInterval = null;

function initCountdown() {
  const saved = localStorage.getItem('akyl_countdown');
  const fab = document.getElementById('countdownFab');
  if (saved) {
    if (fab) fab.style.display = 'flex';
    startCountdownInterval();
  }
}

function toggleCountdown() {
  const widget = document.getElementById('countdownWidget');
  if (!widget) return;
  const saved = localStorage.getItem('akyl_countdown');
  if (!saved) {
    openCountdownSettings();
    return;
  }
  const visible = widget.style.display !== 'none';
  widget.style.display = visible ? 'none' : '';
}

function hideCountdown() {
  const widget = document.getElementById('countdownWidget');
  if (widget) widget.style.display = 'none';
}

function openCountdownSettings() {
  const modal = document.getElementById('countdownModal');
  if (!modal) return;
  const saved = JSON.parse(localStorage.getItem('akyl_countdown') || '{}');
  if (saved.deadline) {
    const dt = new Date(saved.deadline);
    const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('cdDeadlineInput').value = local;
  }
  if (saved.name) document.getElementById('cdEventName').value = saved.name;
  modal.style.display = 'flex';
}

function setCountdown() {
  const deadline = document.getElementById('cdwDate')?.value;
  const name = document.getElementById('cdwNameInput')?.value?.trim() || 'Хакатон';
  if (!deadline) return showToast('Выбери дату и время', 'error');
  const ts = new Date(deadline).getTime();
  if (ts <= Date.now()) return showToast('Дата должна быть в будущем', 'error');
  localStorage.setItem('akyl_countdown', JSON.stringify({ deadline: ts, name }));
  const nameEl = document.getElementById('cdwName');
  if (nameEl) nameEl.textContent = name;
  const widget = document.getElementById('countdownWidget');
  if (widget) widget.style.display = '';
  startCountdownInterval();
  showToast('⏳ Таймер запущен!', 'success');
}

function clearCountdown() {
  localStorage.removeItem('akyl_countdown');
  if (_cdInterval) { clearInterval(_cdInterval); _cdInterval = null; }
  const widget = document.getElementById('countdownWidget');
  if (widget) widget.style.display = 'none';
  showToast('Таймер сброшен', 'success');
}

function closeCountdown() {
  const w = document.getElementById('countdownWidget');
  if (w) w.style.display = 'none';
}

function openCountdown() {
  const w = document.getElementById('countdownWidget');
  if (w) w.style.display = '';
}

// ── CRISIS MODE ──
let _crisisMode = false;
function toggleCrisisMode() {
  _crisisMode = !_crisisMode;
  document.body.classList.toggle('crisis-mode', _crisisMode);
  const btn = document.getElementById('crisisModeBtn');
  if (btn) btn.textContent = _crisisMode ? '✅ Выйти из Crisis Mode' : '🚨 Crisis Mode';
  showToast(_crisisMode ? '🚨 Crisis Mode активирован!' : '✅ Обычный режим', _crisisMode ? 'error' : 'success');
}

// ── POMODORO TIMER ──────────────────────────────────────────────────────
const _pomo = { work: 25, shortBreak: 5, longBreak: 15 };
let _pomoState = { phase: 'work', left: 25*60, cycles: 0, running: false, interval: null };

function openPomodoro() {
  const fabMenu = document.getElementById('fabMenu');
  if (fabMenu) fabMenu.style.display = 'none';
  const w = document.getElementById('pomodoroWidget');
  if (!w) return;
  w.style.display = w.style.display === 'none' || !w.style.display ? 'block' : 'none';
  _renderPomodoro();
}

function _renderPomodoro() {
  const m = Math.floor(_pomoState.left / 60);
  const s = _pomoState.left % 60;
  const timerEl = document.getElementById('pomoTime');
  const phaseEl = document.getElementById('pomoPhase');
  const btnEl   = document.getElementById('pomoStartBtn');
  const barEl   = document.getElementById('pomoProgressBar');
  const cyclesEl = document.getElementById('pomoCycles');
  if (!timerEl) return;
  timerEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  timerEl.className = 'pomo-time' + (_pomoState.phase !== 'work' ? ' pomo-break' : '') + (_pomoState.left < 60 && _pomoState.phase === 'work' ? ' urgent' : '');
  const phaseNames = { work: '🍅 Фокус', shortBreak: '☕ Короткий перерыв', longBreak: '🛋️ Длинный перерыв' };
  if (phaseEl) phaseEl.textContent = phaseNames[_pomoState.phase] || _pomoState.phase;
  if (btnEl) btnEl.textContent = _pomoState.running ? '⏸ Пауза' : '▶ Старт';
  const totalSec = (_pomoState.phase === 'work' ? _pomo.work : _pomoState.phase === 'shortBreak' ? _pomo.shortBreak : _pomo.longBreak) * 60;
  if (barEl) barEl.style.width = (_pomoState.left / totalSec * 100) + '%';
  if (cyclesEl) cyclesEl.textContent = `🍅 Циклов: ${_pomoState.cycles}`;
}

function togglePomodoro() {
  if (_pomoState.running) {
    clearInterval(_pomoState.interval);
    _pomoState.interval = null;
    _pomoState.running = false;
  } else {
    _pomoState.running = true;
    _pomoState.interval = setInterval(() => {
      _pomoState.left--;
      if (_pomoState.left <= 0) {
        clearInterval(_pomoState.interval);
        _pomoState.interval = null;
        _pomoState.running = false;
        _pomoPlaySound();
        _pomoNextPhase();
      }
      _renderPomodoro();
    }, 1000);
  }
  _renderPomodoro();
}

function resetPomodoro() {
  clearInterval(_pomoState.interval);
  _pomoState.interval = null;
  _pomoState.running = false;
  _pomoState.left = _pomo.work * 60;
  _pomoState.phase = 'work';
  _renderPomodoro();
}

function _pomoNextPhase() {
  if (_pomoState.phase === 'work') {
    _pomoState.cycles++;
    _pomoState.phase = _pomoState.cycles % 4 === 0 ? 'longBreak' : 'shortBreak';
    _pomoState.left = (_pomoState.cycles % 4 === 0 ? _pomo.longBreak : _pomo.shortBreak) * 60;
    showToast(_pomoState.cycles % 4 === 0 ? '🛋️ Длинный перерыв!' : '☕ Короткий перерыв!', 'success');
  } else {
    _pomoState.phase = 'work';
    _pomoState.left = _pomo.work * 60;
    showToast('🍅 Время фокуса!', 'info');
  }
  const w = document.getElementById('pomodoroWidget');
  if (w) w.style.display = 'block';
  _renderPomodoro();
}

function _pomoPlaySound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.8);
  } catch(e) {}
}

function setPomoWork(min) {
  _pomo.work = parseInt(min);
  if (_pomoState.phase === 'work' && !_pomoState.running) {
    _pomoState.left = _pomo.work * 60;
  }
  _renderPomodoro();
}

// ── PROJECT NAME GENERATOR ─────────────────────────────────────────
async function generateProjectName() {
  const keywords = document.getElementById('nameKeywords')?.value.trim();
  if (!keywords) return showToast('Введи ключевые слова', 'error');
  showLoader('Генерирую названия...');
  try {
    const params = new URLSearchParams({ keywords, language: 'ru' });
    const res = await fetch('/api/tools/project-names?' + params, { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json();
    showAIResponse('nameAIResponse', 'nameAIContent', data.content);
  } catch(e) { showToast('Ошибка: ' + e.message, 'error'); }
  finally { hideLoader(); }
}

// ── AI SLIDE DECK ─────────────────────────────────────────────────
async function generateSlidesDeck() {
  const project = document.getElementById('slidesProject')?.value.trim();
  const problem = document.getElementById('slidesProblem')?.value.trim();
  if (!project || !problem) return showToast('Введи название и проблему', 'error');
  const solution = document.getElementById('slidesSolution')?.value || '';
  const tech = document.getElementById('slidesTech')?.value || '';
  showLoader('Генерирую структуру слайдов...');
  try {
    const params = new URLSearchParams({ project_name: project, problem, solution, tech_stack: tech, language: 'ru' });
    const res = await fetch('/api/tools/slide-deck?' + params, { method: 'POST', headers: getAuthHeaders() });
    const data = await res.json();
    showAIResponse('slidesAIResponse', 'slidesAIContent', data.content);
  } catch(e) { showToast('Ошибка: ' + e.message, 'error'); }
  finally { hideLoader(); }
}
let _pitchTimerInterval = null;
let _pitchTimerTotal = 0;
let _pitchTimerLeft = 0;
function startPitchTimer(minutes) {
  stopPitchTimer();
  _pitchTimerTotal = minutes * 60;
  _pitchTimerLeft = _pitchTimerTotal;
  const wrap = document.getElementById('pitchTimerBarWrap');
  if (wrap) wrap.style.display = '';
  const status = document.getElementById('pitchTimerStatus');
  if (status) status.textContent = '⏱ Идёт отсчёт...';
  _pitchTimerInterval = setInterval(() => {
    _pitchTimerLeft--;
    updatePitchTimerDisplay();
    if (_pitchTimerLeft <= 0) {
      clearInterval(_pitchTimerInterval);
      _pitchTimerInterval = null;
      const s = document.getElementById('pitchTimerStatus');
      if (s) s.textContent = '⏰ Время вышло!';
      showToast('⏰ Время питча истекло!', 'error');
    }
  }, 1000);
  updatePitchTimerDisplay();
}
function stopPitchTimer() {
  if (_pitchTimerInterval) { clearInterval(_pitchTimerInterval); _pitchTimerInterval = null; }
  const disp = document.getElementById('pitchTimerDisplay');
  if (disp) { disp.textContent = '00:00'; disp.style.color = ''; }
  const bar = document.getElementById('pitchTimerBar');
  if (bar) bar.style.width = '100%';
  const status = document.getElementById('pitchTimerStatus');
  if (status) status.textContent = '';
}
function updatePitchTimerDisplay() {
  const m = Math.floor(_pitchTimerLeft / 60);
  const s = _pitchTimerLeft % 60;
  const disp = document.getElementById('pitchTimerDisplay');
  if (disp) {
    disp.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    disp.style.color = _pitchTimerLeft < 30 ? 'var(--danger, #ef4444)' : 'var(--primary)';
  }
  const bar = document.getElementById('pitchTimerBar');
  if (bar) bar.style.width = (_pitchTimerTotal > 0 ? (_pitchTimerLeft / _pitchTimerTotal * 100) : 100) + '%';
}

// ── IDEA SCORING BOARD ──
const _scores = { originality: 0, feasibility: 0, market: 0, tech: 0, wow: 0 };
function setStar(btn, criterion, val) {
  _scores[criterion] = val;
  const container = btn.closest('.scoring-stars');
  if (container) {
    container.querySelectorAll('.star-btn').forEach((s, i) => {
      s.style.color = i < val ? '#f59e0b' : '';
    });
  }
  const valEl = document.getElementById('val-' + criterion);
  if (valEl) valEl.textContent = val;
  updateScoringTotal();
}
function updateScoringTotal() {
  const total = Object.values(_scores).reduce((a, b) => a + b, 0);
  const scoreEl = document.getElementById('scoringTotalScore');
  if (scoreEl) scoreEl.textContent = total;
  const grade = document.getElementById('scoringGrade');
  if (grade) {
    if (total >= 22) grade.textContent = '🏆 Отличная идея!';
    else if (total >= 16) grade.textContent = '✅ Хорошая идея';
    else if (total >= 10) grade.textContent = '⚠️ Нужна доработка';
    else grade.textContent = '❌ Слабая идея';
  }
}
function resetScoring() {
  Object.keys(_scores).forEach(k => _scores[k] = 0);
  document.querySelectorAll('.star-btn').forEach(s => s.style.color = '');
  document.querySelectorAll('.scoring-val').forEach(v => v.textContent = '0');
  const scoreEl = document.getElementById('scoringTotalScore');
  if (scoreEl) scoreEl.textContent = '0';
  const grade = document.getElementById('scoringGrade');
  if (grade) grade.textContent = '';
  const res = document.getElementById('scoringAIResult');
  if (res) res.style.display = 'none';
}
async function aiScoreIdea() {
  const idea = document.getElementById('scoreIdeaText')?.value.trim();
  if (!idea) return showToast('Введи описание идеи', 'error');
  showLoader('AI оценивает идею...');
  try {
    const params = new URLSearchParams({ idea, team_skills: '', language: 'ru' });
    const res = await fetch('/api/tools/validate-idea?' + params, { method: 'POST' });
    const data = await res.json();
    showAIResponse('scoringAIResult', 'scoringAIContent', data.content);
  } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
  finally { hideLoader(); }
}

// ── TECH STACK ADVISOR ──
async function techStackAdvisor() {
  const description = document.getElementById('stackDesc')?.value.trim();
  if (!description) return showToast('Опиши проект', 'error');
  const team_skills = document.getElementById('stackSkills')?.value || '';
  const time_hours = parseInt(document.getElementById('stackHours')?.value || '24');
  const team_size = parseInt(document.getElementById('stackTeamSize')?.value || '3');
  showLoader('Подбираю стек...');
  try {
    const params = new URLSearchParams({ description, time_hours, team_size, team_skills, language: 'ru' });
    const res = await fetch('/api/tools/tech-stack?' + params, { method: 'POST' });
    const data = await res.json();
    showAIResponse('stackAIResponse', 'stackAIContent', data.content);
  } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
  finally { hideLoader(); }
}

// ── POST-HACKATHON REPORT ──
async function generateHackathonReport() {
  const project_name = document.getElementById('reportProjectName')?.value.trim();
  const what_was_done = document.getElementById('reportWhatDone')?.value.trim();
  if (!project_name || !what_was_done) return showToast('Заполни название и описание', 'error');
  const duration_hours = parseInt(document.getElementById('reportDuration')?.value || '24');
  const team_names = document.getElementById('reportTeamNames')?.value || '';
  const challenges = document.getElementById('reportChallenges')?.value || '';
  const tech_stack = document.getElementById('reportTechStack')?.value || '';
  showLoader('Генерирую отчёт...');
  try {
    const params = new URLSearchParams({ project_name, what_was_done, duration_hours, team_names, challenges, tech_stack, language: 'ru' });
    const res = await fetch('/api/tools/hackathon-report?' + params, { method: 'POST' });
    const data = await res.json();
    showAIResponse('reportAIResponse', 'reportAIContent', data.content);
  } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
  finally { hideLoader(); }
}

// ── GITHUB REPO AUTO-CREATE ──
function _initGhTokenFromStorage() {
  const saved = localStorage.getItem('gh_token');
  const el = document.getElementById('ghToken');
  if (saved && el && !el.value) el.value = saved;
}

async function githubCreateRepo() {
  _initGhTokenFromStorage();
  const token = document.getElementById('ghToken')?.value.trim();
  const repo_name = document.getElementById('ghRepoName')?.value.trim();
  const description = document.getElementById('ghRepoDesc')?.value.trim() || '';
  const private_repo = document.getElementById('ghPrivate')?.checked || false;
  const push_code = document.getElementById('ghPushCode')?.checked ?? true;

  if (!token) return showToast('Введи GitHub токен', 'error');
  if (!repo_name) return showToast('Введи название репозитория', 'error');
  if (!/^[a-zA-Z0-9_.-]+$/.test(repo_name)) return showToast('Название репо: только латиница, цифры, _ - .', 'error');

  localStorage.setItem('gh_token', token);

  const initial_code = push_code ? (csGetCode() || '') : '';
  const lang_select = document.getElementById('csLang');
  const lang = lang_select?.value || 'python';
  const ext_map = { python:'py', javascript:'js', typescript:'ts', java:'java', cpp:'cpp', c:'c', go:'go', rust:'rs', ruby:'rb', php:'php' };
  const code_filename = `main.${ext_map[lang] || 'txt'}`;

  showLoader('Создаю репозиторий и генерирую README...');
  try {
    const params = new URLSearchParams({
      token, repo_name, description,
      private: private_repo,
      initial_code, code_filename,
      project_description: description,
      language: 'ru'
    });
    const res = await fetch('/api/tools/github-create-repo?' + params, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.content || 'Ошибка');
    showAIResponse('ghResult', 'ghResultContent', data.content);
    showToast('🐙 Репозиторий создан!', 'success');
    // Extract URL and open it
    const urlMatch = data.content.match(/https:\/\/github\.com\/[^\)]+/);
    if (urlMatch) {
      setTimeout(() => {
        if (confirm('Открыть репозиторий на GitHub?')) window.open(urlMatch[0], '_blank');
      }, 800);
    }
  } catch (e) { showToast('Ошибка: ' + e.message, 'error'); }
  finally { hideLoader(); }
}

function startCountdownInterval() {
  if (_cdInterval) clearInterval(_cdInterval);
  updateCountdownDisplay();
  _cdInterval = setInterval(updateCountdownDisplay, 1000);
}

function updateCountdownDisplay() {
  const saved = JSON.parse(localStorage.getItem('akyl_countdown') || '{}');
  if (!saved.deadline) return;
  const now = Date.now();
  const diff = saved.deadline - now;
  const display = document.getElementById('countdownDisplay');
  const done = document.getElementById('countdownDone');
  const widget = document.getElementById('countdownWidget');
  if (!display) return;
  if (diff <= 0) {
    display.style.display = 'none';
    if (done) done.style.display = '';
    if (_cdInterval) { clearInterval(_cdInterval); _cdInterval = null; }
    return;
  }
  const days    = Math.floor(diff / 86400000);
  const hours   = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  const cd = id => document.getElementById(id);
  if (cd('cdDays'))    cd('cdDays').textContent    = String(days).padStart(2, '0');
  if (cd('cdHours'))   cd('cdHours').textContent   = String(hours).padStart(2, '0');
  if (cd('cdMinutes')) cd('cdMinutes').textContent = String(minutes).padStart(2, '0');
  if (cd('cdSeconds')) cd('cdSeconds').textContent = String(seconds).padStart(2, '0');
  // Urgent pulse when < 1 hour
  if (widget) widget.classList.toggle('countdown-urgent', diff < 3600000);
}

// ── TEAM NOTES (localStorage) ─────────────────────────────────────
function getNotesKey(teamId) { return `akyl_notes_${teamId || 'personal'}`; }

function loadNotesData(teamId) {
  try { return JSON.parse(localStorage.getItem(getNotesKey(teamId)) || '[]'); } catch { return []; }
}

function saveNotesData(teamId, notes) {
  localStorage.setItem(getNotesKey(teamId), JSON.stringify(notes));
}

function initNotesPage() {
  const sel = document.getElementById('notesTeamSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Личные заметки —</option>';
  (allTeams || []).forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  });
  if (currentTeamId) sel.value = currentTeamId;
  renderNotesGrid();
}

function renderNotesGrid() {
  const teamId = document.getElementById('notesTeamSelect')?.value || '';
  const notes  = loadNotesData(teamId);
  const grid   = document.getElementById('notesGrid');
  if (!grid) return;
  if (!notes.length) {
    grid.innerHTML = `<div class="notes-empty"><div style="font-size:48px;margin-bottom:12px;">🗒️</div><p>Нет заметок. Добавь первую!</p></div>`;
    return;
  }
  grid.innerHTML = notes.map((n, i) => `
    <div class="note-card" style="border-left-color:${n.color || '#7c3aed'}">
      <div class="note-card-title">${escapeHtml(n.title || 'Без названия')}</div>
      <div class="note-card-body">${renderMarkdown(n.content || '')}</div>
      <div class="note-card-footer">
        <span>${new Date(n.createdAt).toLocaleDateString('ru', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
        <div class="note-card-actions">
          <button class="note-del-btn" onclick="deleteNote(${i})" title="Удалить">🗑️</button>
        </div>
      </div>
    </div>`).join('');
  // Highlight code blocks inside notes
  setTimeout(() => { if (typeof hljs !== 'undefined') document.querySelectorAll('.note-card-body pre code:not(.hljs)').forEach(el => hljs.highlightElement(el)); }, 50);
}

function addNote() {
  const card = document.getElementById('addNoteCard');
  if (!card) return;
  card.style.display = card.style.display === 'none' ? '' : 'none';
  if (card.style.display !== 'none') {
    document.getElementById('noteTitle')?.focus();
  }
}

function saveNote() {
  const teamId  = document.getElementById('notesTeamSelect')?.value || '';
  const title   = document.getElementById('noteTitle')?.value?.trim();
  const content = document.getElementById('noteContent')?.value?.trim();
  const color   = document.getElementById('noteColor')?.value || '#7c3aed';
  if (!title && !content) return showToast('Введи заголовок или текст', 'error');
  const notes = loadNotesData(teamId);
  notes.unshift({ title, content, color, createdAt: Date.now() });
  saveNotesData(teamId, notes);
  document.getElementById('noteTitle').value   = '';
  document.getElementById('noteContent').value = '';
  document.getElementById('addNoteCard').style.display = 'none';
  renderNotesGrid();
  showToast('📝 Заметка сохранена!', 'success');
}

function deleteNote(index) {
  if (!confirm('Удалить заметку?')) return;
  const teamId = document.getElementById('notesTeamSelect')?.value || '';
  const notes = loadNotesData(teamId);
  notes.splice(index, 1);
  saveNotesData(teamId, notes);
  renderNotesGrid();
  showToast('🗑️ Удалено', 'success');
}

function exportNotesMarkdown() {
  const teamId = document.getElementById('notesTeamSelect')?.value || '';
  const notes  = loadNotesData(teamId);
  if (!notes.length) return showToast('Нет заметок для экспорта', 'error');
  const md = notes.map(n =>
    `# ${n.title || 'Без названия'}\n*${new Date(n.createdAt).toLocaleString('ru')}*\n\n${n.content || ''}`
  ).join('\n\n---\n\n');
  const blob = new Blob([md], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `akyl-notes-${new Date().toISOString().slice(0,10)}.md`;
  a.click();
  showToast('📤 Экспортировано!', 'success');
}

// ── KANBAN SEARCH / FILTER ────────────────────────────────────────
function filterKanban(query) {
  const q = (query || '').toLowerCase().trim();
  document.querySelectorAll('.kanban-card').forEach(card => {
    const title = card.querySelector('.kanban-card-title')?.textContent?.toLowerCase() || '';
    const desc  = card.querySelector('[style*="font-size:11px"]')?.textContent?.toLowerCase() || '';
    const match = !q || title.includes(q) || desc.includes(q);
    card.classList.toggle('filtered-out', !match);
  });
  // Update column counts
  ['backlog','todo','doing','review','done'].forEach(s => {
    const col = document.getElementById('col-' + s);
    const cnt = document.getElementById('count-' + s);
    if (cnt && col) {
      const visible = col.querySelectorAll('.kanban-card:not(.filtered-out)').length;
      cnt.textContent = visible;
    }
  });
}

// ── CLOSE ALL MODALS HELPER ──────────────────────────────────────
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ── ANIMATED COUNTER ─────────────────────────────────────────────
function animateCounter(elId, target, duration = 600) {
  const el = document.getElementById(elId);
  if (!el) return;
  const start = parseInt(el.textContent) || 0;
  const diff = target - start;
  if (diff === 0) { el.textContent = target; return; }
  const startTime = performance.now();
  const step = (now) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // ease-out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + diff * eased);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ── INPUT SHAKE VALIDATION ────────────────────────────────────────
function shakeInput(idOrEl) {
  const el = typeof idOrEl === 'string' ? document.getElementById(idOrEl) : idOrEl;
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth; // reflow to restart animation
  el.classList.add('shake');
  el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
  el.focus();
}

// ── CUSTOM INPUT MODAL (replaces native prompt()) ─────────────────
function showInputModal(title, placeholder, defaultValue = '') {
  return new Promise(resolve => {
    let modal = document.getElementById('genericInputModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'genericInputModal';
      modal.className = 'modal-overlay';
      modal.style.display = 'none';
      modal.innerHTML = `
        <div class="modal-box" style="max-width:460px">
          <div class="modal-header">
            <h3 id="gimTitle"></h3>
            <button class="modal-close" onclick="document.getElementById('genericInputModal').style.display='none'">&#10005;</button>
          </div>
          <div class="form-group">
            <textarea id="gimInput" class="input" rows="3" style="resize:vertical;min-height:72px;"></textarea>
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" id="gimOk">\u2705 \u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c</button>
            <button class="btn btn-secondary" id="gimCancel">\u041e\u0442\u043c\u0435\u043d\u0430</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
    }
    document.getElementById('gimTitle').textContent = title;
    const input = document.getElementById('gimInput');
    input.placeholder = placeholder;
    input.value = defaultValue;
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 100);
    const ok = document.getElementById('gimOk');
    const cancel = document.getElementById('gimCancel');
    const cleanup = (val) => {
      modal.style.display = 'none';
      ok.onclick = null; cancel.onclick = null;
      resolve(val);
    };
    ok.onclick = () => cleanup(input.value);
    cancel.onclick = () => cleanup(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) cleanup(input.value);
      if (e.key === 'Escape') cleanup(null);
    };
  });
}

// ── PLATFORM STATS LOADER ─────────────────────────────────────────
async function loadPlatformStats() {
  try {
    const res = await fetch('/api/stats').then(r => r.json());
    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('statUsers',       (res.total_users       || 0).toLocaleString());
    setEl('statTournaments', (res.total_tournaments || 0).toLocaleString());
    setEl('statProjects',    (res.total_projects    || 0).toLocaleString());
  } catch (_) { /* silent */ }
}

// ── CHAT TYPING INDICATOR ─────────────────────────────────────────
function showChatTyping(senderLabel = 'AI') {
  hideChatTyping();
  const box = document.getElementById('chatMessages');
  if (!box) return;
  const el = document.createElement('div');
  el.id = 'chatTypingIndicator';
  el.className = 'chat-msg msg-agent';
  el.innerHTML = `
    <div class="msg-meta">🤖 <strong>${senderLabel}</strong></div>
    <div class="typing-indicator">
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    </div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

function hideChatTyping() {
  const el = document.getElementById('chatTypingIndicator');
  if (el) el.remove();
}

/* ── XP Float badge ───────────────────────────────────────────────── */
function showXPFloat(amount, anchorEl) {
  const badge = document.createElement('div');
  badge.className = 'xp-float-badge';
  badge.textContent = `⚡ +${amount} XP`;
  const rect = (anchorEl || document.getElementById('topBarXP'))?.getBoundingClientRect() || { left: window.innerWidth / 2 - 40, top: window.innerHeight / 2 };
  badge.style.cssText = `left:${rect.left}px;top:${rect.top}px;`;
  document.body.appendChild(badge);
  setTimeout(() => badge.remove(), 1700);
}

/* ── DRAWER NAV ────────────────────────────────────────────────────── */
function openDrawer() {
  document.getElementById('sideDrawer')?.classList.add('open');
  document.getElementById('drawerOverlay')?.classList.add('open');
}
function closeDrawer() {
  // On desktop the drawer is a permanent sidebar — never close it
  if (window.innerWidth >= 768) return;
  document.getElementById('sideDrawer')?.classList.remove('open');
  document.getElementById('drawerOverlay')?.classList.remove('open');
}
function goPage(pageId) {
  closeDrawer();
  showPage(pageId);
}

/* ═══════════════════════════════════════════════════════════════════
   TOP BAR USER SYNC
   ═══════════════════════════════════════════════════════════════════ */
const _TOPBAR_RANKS = [
  [5000, '\u041b\u0435\u0433\u0435\u043d\u0434\u0430',     '\ud83d\udc51'],
  [2000, '\u041c\u0435\u043d\u0442\u043e\u0440',       '\ud83e\udde0'],
  [1000, '\u0425\u0430\u043a\u0435\u0440',        '\ud83d\udd25'],
  [500,  '\u0420\u0430\u0437\u0440\u0430\u0431\u043e\u0442\u0447\u0438\u043a',  '\ud83d\udcbb'],
  [200,  '\u0421\u0442\u0430\u0436\u0451\u0440',       '\u26a1'],
  [0,    '\u041d\u043e\u0432\u0438\u0447\u043e\u043a',      '\ud83c\udf31'],
];
function _getTopbarRank(xp) {
  for (const [thr, title, icon] of _TOPBAR_RANKS) {
    if (xp >= thr) return { title, icon };
  }
  return { title: '\u041d\u043e\u0432\u0438\u0447\u043e\u043a', icon: '\ud83c\udf31' };
}

function updateTopBar(user) {
  const av  = document.getElementById('topBarAvatar');
  const xpEl = document.getElementById('topBarXP');
  if (!av) return;
  if (!user) {
    av.textContent = '?'; av.style.background = '';
    if (xpEl) xpEl.style.display = 'none';
    return;
  }
  const letter = (user.username || 'U')[0].toUpperCase();
  const color  = `hsl(${(user.username || '').charCodeAt(0) * 3 % 360},60%,45%)`;
  av.textContent = letter;
  av.style.background = color;
  if (xpEl) {
    xpEl.style.display = 'flex';
    const xp = user.xp || 0;
    const XP_PER_LVL = 200;
    const lvl = Math.max(1, Math.floor(xp / XP_PER_LVL) + 1);
    const progress = Math.round((xp % XP_PER_LVL) / XP_PER_LVL * 100);
    const rank = _getTopbarRank(xp);
    const iconEl  = document.getElementById('tbxpIcon');
    const titleEl = document.getElementById('tbxpTitle');
    const lvlEl   = document.getElementById('tbxpLvl');
    const valEl   = document.getElementById('tbxpVal');
    const fillEl  = document.getElementById('tbxpFill');
    if (iconEl)  iconEl.textContent  = rank.icon;
    if (titleEl) titleEl.textContent = user.rank_title || rank.title;
    if (lvlEl)   lvlEl.textContent   = lvl;
    if (valEl)   valEl.textContent   = xp.toLocaleString();
    if (fillEl)  fillEl.style.width  = progress + '%';
  }
}

/* ═══════════════════════════════════════════════════════════════════
   TEAMS HUB
   ═══════════════════════════════════════════════════════════════════ */
let _teamsHubCurrent = null;  // current team object in inner view

async function initTeamsPage() {
  document.getElementById('teamsListView').style.display = '';
  document.getElementById('teamInnerView').style.display = 'none';
  const grid = document.getElementById('myTeamsGrid');
  grid.innerHTML = '<div class="teams-empty"><span class="empty-icon" style="font-size:36px;display:block;margin-bottom:8px;">⏳</span><p>Загрузка...</p></div>';
  try {
    const teams = await api.getTeams();
    allTeams = teams;
    if (!teams.length) {
      grid.innerHTML = `<div class="teams-empty">
        <span class="empty-icon">👥</span>
        <p style="margin-bottom:16px;">Пока нет команд. Создай первую!</p>
        <button class="btn btn-primary" onclick="openModal('createTeamModal')">+ Создать команду</button>
      </div>`;
      return;
    }
    const COLORS = ['#7c3aed','#3ecfcf','#f59e0b','#ef4444','#22c55e','#f97316','#ec4899'];
    grid.innerHTML = teams.map((t, i) => `
      <div class="team-hub-card" onclick="openTeam(${t.id})">
        <div class="team-hub-icon">${t.hackathon_theme ? '🚀' : '👥'}</div>
        <div class="team-hub-name">${escapeHtml(t.name)}</div>
        <div class="team-hub-theme">${escapeHtml(t.hackathon_theme || 'Без темы')}</div>
        <div class="team-hub-meta">
          <span>📅 ${t.created_at ? new Date(t.created_at).toLocaleDateString('ru') : '—'}</span>
        </div>
        ${t.invite_code ? `<div class="team-hub-code" onclick="event.stopPropagation();copyInviteCode('${t.invite_code}',this)" title="Нажми чтобы скопировать" style="cursor:pointer;">🔗 ${t.invite_code} ⎘</div>` : ''}
      </div>`).join('');
  } catch (e) {
    grid.innerHTML = `<div class="teams-empty"><span class="empty-icon">⚠️</span><p>${e.message}</p></div>`;
  }
}

async function openTeam(teamId) {
  const team = allTeams.find(t => t.id === teamId);
  if (!team) return;
  _teamsHubCurrent = team;
  currentTeamId = teamId;

  document.getElementById('teamsListView').style.display = 'none';
  document.getElementById('teamInnerView').style.display = '';
  document.getElementById('teamInnerName').textContent = team.name;
  const codeEl = document.getElementById('teamInnerCode');
  if (team.invite_code) {
    codeEl.textContent = `🔗 ${team.invite_code} ⎘`;
    codeEl.title = 'Нажми чтобы скопировать';
    codeEl.style.cursor = 'pointer';
    codeEl.onclick = () => copyInviteCode(team.invite_code, codeEl);
  } else {
    codeEl.textContent = '';
    codeEl.onclick = null;
  }

  // Reset tabs
  document.querySelectorAll('.team-tab-btn').forEach((b, i) => b.classList.toggle('active', i === 0));
  switchTeamTab('overview', document.querySelector('.team-tab-btn'));
}

function backToTeamsList() {
  document.getElementById('teamsListView').style.display = '';
  document.getElementById('teamInnerView').style.display = 'none';
  _teamsHubCurrent = null;
}

async function switchTeamTab(tab, btn) {
  if (btn) {
    document.querySelectorAll('.team-tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const content = document.getElementById('teamTabContent');
  const teamId = _teamsHubCurrent?.id;

  switch (tab) {
    case 'overview':
      renderTeamOverviewTab(content, teamId);
      break;
    case 'chat':
      currentTeamId = teamId;
      showPage('chat');
      break;
    case 'kanban':
      currentTeamId = teamId;
      showPage('kanban');
      break;
    case 'notes':
      showPage('notes');
      setTimeout(() => {
        const sel = document.getElementById('notesTeamSelect');
        if (sel) { sel.value = teamId; initNotesPage(); }
      }, 100);
      break;
    case 'files':
      renderTeamFilesTab(content, teamId);
      break;
    case 'council':
      renderTeamCouncilTab(content, teamId);
      break;
    case 'plan':
      renderTeamPlanTab(content, teamId);
      break;
    default:
      renderTeamOverviewTab(content, teamId);
  }
}

async function renderTeamOverviewTab(container, teamId) {
  container.innerHTML = '<div style="padding:20px 0;color:var(--text-dim);">⏳ Загрузка...</div>';
  try {
    const [members, tasks] = await Promise.all([
      api.getTeamMembers(teamId).catch(() => []),
      api.kanbanTasks(`team_id=${teamId}`).catch(() => []),
    ]);
    const done = tasks.filter(t => t.status === 'done').length;
    const total = tasks.length;
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-bottom:24px;">
        ${[['👤','Участников', members.length],['📋','Задач', total],['✅','Выполнено', done],['🔥','В работе', tasks.filter(t=>t.status==='doing').length]].map(([icon,lbl,val])=>`
        <div style="background:var(--card);border:1px solid var(--card-border);border-radius:var(--radius);padding:16px;text-align:center;">
          <div style="font-size:24px;margin-bottom:4px;">${icon}</div>
          <div style="font-size:22px;font-weight:800;color:var(--primary);">${val}</div>
          <div style="font-size:11px;color:var(--text-dim);">${lbl}</div>
        </div>`).join('')}
      </div>
      <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;">👥 Участники</h3>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px;">
        ${members.length ? members.map(m => {
          const color = `hsl(${(m.name||'?').charCodeAt(0)*3%360},60%,45%)`;
          return `<div style="display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--card-border);border-radius:10px;padding:10px 14px;">
            <div style="width:32px;height:32px;border-radius:50%;background:${color};color:#fff;font-weight:700;display:flex;align-items:center;justify-content:center;font-size:13px;">${(m.name||'?')[0].toUpperCase()}</div>
            <div><div style="font-size:13px;font-weight:600;">${escapeHtml(m.name)}</div><div style="font-size:11px;color:var(--text-dim);">${m.role||''} ${(m.skills||[]).slice(0,2).join(', ')}</div></div>
          </div>`;
        }).join('') : '<p style="color:var(--text-dim);font-size:13px;">Нет участников</p>'}
      </div>
      <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;">🚀 Быстрый доступ</h3>
      <div class="team-actions-grid">
        <div class="team-action-card" onclick="switchTeamTab('chat')"><span class="team-action-icon">💬</span><div class="team-action-label">Чат команды</div></div>
        <div class="team-action-card" onclick="switchTeamTab('kanban')"><span class="team-action-icon">📋</span><div class="team-action-label">Канбан-доска</div></div>
        <div class="team-action-card" onclick="switchTeamTab('notes')"><span class="team-action-icon">🗒️</span><div class="team-action-label">Заметки</div></div>
        <div class="team-action-card" onclick="switchTeamTab('files')"><span class="team-action-icon">📁</span><div class="team-action-label">Файлы</div></div>
        <div class="team-action-card" onclick="goPage('ai-insights')"><span class="team-action-icon">🤖</span><div class="team-action-label">AI-аналитика</div></div>
        <div class="team-action-card" onclick="goPage('burnout')"><span class="team-action-icon">🔥</span><div class="team-action-label">Выгорание</div></div>
      </div>`;
  } catch (e) {
    container.innerHTML = `<p style="color:var(--danger);">Ошибка: ${e.message}</p>`;
  }
}

function renderTeamFilesTab(container, teamId) {
  const key = `akyl_files_team_${teamId}`;
  const loadFiles = () => JSON.parse(localStorage.getItem(key) || '[]');
  const saveFiles = (files) => localStorage.setItem(key, JSON.stringify(files));

  const render = () => {
    const files = loadFiles();
    container.innerHTML = `
      <div class="files-dropzone" id="filesDropzone" onclick="document.getElementById('fileInput').click()">
        📁 Нажми или перетащи файлы сюда<br>
        <small style="color:var(--text-dimmer);font-size:11px;">Хранится в браузере (localStorage)</small>
      </div>
      <input type="file" id="fileInput" multiple style="display:none" onchange="handleFileUpload(event,${teamId})" />
      <div class="files-list" id="filesList">
        ${files.length ? files.map((f, i) => `
          <div class="file-item">
            <span class="file-icon">${getFileIcon(f.name)}</span>
            <div class="file-info">
              <div class="file-name">${escapeHtml(f.name)}</div>
              <div class="file-size">${formatFileSize(f.size)} · ${new Date(f.date).toLocaleDateString('ru')}</div>
            </div>
            <button class="file-del" onclick="deleteTeamFile(${teamId},${i})" title="Удалить">🗑️</button>
          </div>`).join('') : '<p style="color:var(--text-dim);font-size:13px;text-align:center;padding:20px;">Нет файлов</p>'}
      </div>`;
    setupFileDrop(teamId);
  };
  render();
}

function getFileIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  const map = { pdf:'📄', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊', ppt:'📌', pptx:'📌',
    jpg:'🖼️', jpeg:'🖼️', png:'🖼️', gif:'🖼️', svg:'🖼️',
    mp4:'🎬', mp3:'🎵', wav:'🎵', zip:'🗜️', rar:'🗜️', json:'📋', js:'💻', py:'🐍',
    ts:'💻', html:'🌐', css:'🎨', md:'📑' };
  return map[ext] || '📎';
}
function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`;
  return `${(bytes/1048576).toFixed(1)} MB`;
}
function setupFileDrop(teamId) {
  const dz = document.getElementById('filesDropzone');
  if (!dz) return;
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('drag-over');
    handleFilesUpload(Array.from(e.dataTransfer.files), teamId);
  });
}
function handleFileUpload(evt, teamId) {
  handleFilesUpload(Array.from(evt.target.files), teamId);
}
function handleFilesUpload(files, teamId) {
  const key = `akyl_files_team_${teamId}`;
  const existing = JSON.parse(localStorage.getItem(key) || '[]');
  const readers = files.map(file => new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve({ name: file.name, size: file.size, date: Date.now(), data: e.target.result.split(',')[1] });
    reader.readAsDataURL(file);
  }));
  Promise.all(readers).then(newFiles => {
    localStorage.setItem(key, JSON.stringify([...existing, ...newFiles]));
    renderTeamFilesTab(document.getElementById('teamTabContent'), teamId);
    showToast(`✅ Загружено ${files.length} файл(ов)`, 'success');
  });
}
function deleteTeamFile(teamId, idx) {
  if (!confirm('Удалить файл?')) return;
  const key = `akyl_files_team_${teamId}`;
  const files = JSON.parse(localStorage.getItem(key) || '[]');
  files.splice(idx, 1);
  localStorage.setItem(key, JSON.stringify(files));
  renderTeamFilesTab(document.getElementById('teamTabContent'), teamId);
}

/* ═══════════════════════════════════════════════════════════════════
   AI COUNCIL TAB — multi-agent team discussion
   ═══════════════════════════════════════════════════════════════════ */
async function renderTeamCouncilTab(container, teamId) {
  const team = _teamsHubCurrent;
  container.innerHTML = `
    <div style="max-width:700px;">
      <p style="color:var(--text-dim);font-size:13px;margin-bottom:16px;">
        🤖 Совет AI-агентов анализирует вашу команду и даёт рекомендации. Каждый агент — отдельный эксперт.
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px;">
        <button class="btn btn-primary" onclick="runCouncilDiscussion('team_analysis')">🔍 Анализ команды</button>
        <button class="btn btn-secondary" onclick="runCouncilDiscussion('strategy')">🗺️ Стратегия победы</button>
        <button class="btn btn-outline" onclick="runCouncilDiscussion('risks')">⚠️ Риски проекта</button>
        <button class="btn btn-outline" onclick="runCouncilDiscussion('motivation')">🔥 Мотивация</button>
      </div>
      <div id="councilResult"></div>
    </div>`;
}

async function runCouncilDiscussion(type) {
  const team = _teamsHubCurrent;
  if (!team) return;
  const topics = {
    team_analysis: `Команда "${team.name}" работает над темой: ${team.hackathon_theme || 'не указана'}. Проанализируй состав и распредели роли.`,
    strategy: `Команда "${team.name}" тема: ${team.hackathon_theme || 'не указана'}. Разработайте стратегию победы в хакатоне. Что делать в первые 2 часа, 6 часов, 24 часа?`,
    risks: `Команда "${team.name}" тема: ${team.hackathon_theme || 'не указана'}. Определите главные риски и угрозы для проекта и предложите решения.`,
    motivation: `Команда "${team.name}" тема: ${team.hackathon_theme || 'не указана'}. Как сохранить мотивацию и продуктивность? Дайте конкретные советы.`,
  };
  const topic = topics[type] || topics['team_analysis'];
  const out = document.getElementById('councilResult');
  out.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;">
      <div class="typing-card" style="display:flex;align-items:center;gap:12px;padding:16px;background:var(--card);border:1px solid var(--card-border);border-radius:var(--radius);">
        <div class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>
        <span style="color:var(--text-dim);font-size:13px;">Агенты собираются на совещание...</span>
      </div>
    </div>`;
  try {
    const res = await api.agentDiscussion(topic, currentLang || 'ru');
    const agents = res.metadata?.agents || [];
    if (agents.length) {
      out.innerHTML = agents.map(a => `
        <div style="background:var(--card);border:1px solid var(--card-border);border-radius:var(--radius);padding:16px;margin-bottom:12px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
            <span style="font-size:22px;">${a.emoji}</span>
            <div>
              <div style="font-weight:700;font-size:14px;">${a.agent}</div>
              <div style="font-size:11px;color:var(--text-dim);">${a.role}</div>
            </div>
          </div>
          <div style="font-size:13px;line-height:1.7;color:var(--text);">${(a.content || '').replace(/\n/g,'<br>')}</div>
        </div>`).join('');
    } else {
      const html = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(res.content || '') : (res.content || '');
      out.innerHTML = `<div style="background:var(--card);border:1px solid var(--card-border);border-radius:var(--radius);padding:20px;font-size:13px;line-height:1.7;">${html}</div>`;
    }
  } catch (e) {
    out.innerHTML = `<p style="color:var(--danger)">Ошибка: ${e.message}</p>`;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   HACKATHON EXECUTION PLAN TAB
   ═══════════════════════════════════════════════════════════════════ */
async function renderTeamPlanTab(container, teamId) {
  const team = _teamsHubCurrent;
  const savedPlan = localStorage.getItem(`akyl_plan_team_${teamId}`);
  container.innerHTML = `
    <div style="max-width:700px;">
      <p style="color:var(--text-dim);font-size:13px;margin-bottom:16px;">
        🗺️ AI строит полный план выполнения хакатона: этапы, дедлайны, задачи для каждого участника.
      </p>
      <div style="background:var(--card);border:1px solid var(--card-border);border-radius:var(--radius);padding:20px;margin-bottom:16px;">
        <div class="form-group" style="margin-bottom:14px;">
          <label style="font-size:13px;font-weight:600;margin-bottom:6px;display:block;">⏱️ Сколько часов на хакатон?</label>
          <input type="number" id="planHours" class="input" value="24" min="4" max="96" style="width:120px;" />
        </div>
        <div class="form-group" style="margin-bottom:14px;">
          <label style="font-size:13px;font-weight:600;margin-bottom:6px;display:block;">🎯 Цель / идея проекта (необязательно)</label>
          <textarea id="planIdea" class="input textarea" rows="2" placeholder="Мы хотим сделать AI-сервис для..."></textarea>
        </div>
        <button class="btn btn-primary" onclick="generateExecutionPlan(${teamId})">🚀 Построить план</button>
      </div>
      <div id="planResult">${savedPlan ? `<div style="background:var(--card);border:1px solid var(--card-border);border-radius:var(--radius);padding:20px;font-size:13px;line-height:1.7;">${savedPlan}</div>` : ''}</div>
    </div>`;
}

async function generateExecutionPlan(teamId) {
  const team = _teamsHubCurrent;
  if (!team) return;
  const hours = document.getElementById('planHours')?.value || 24;
  const idea  = document.getElementById('planIdea')?.value?.trim() || '';
  const out   = document.getElementById('planResult');
  out.innerHTML = `<div class="typing-indicator" style="padding:20px;"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
  try {
    const members = await api.getTeamMembers(teamId).catch(() => []);
    const membersList = members.length
      ? members.map(m => `${m.name} (${m.role || 'нет роли'}, навыки: ${(m.skills||[]).join(', ')||'—'})`).join('\n')
      : 'участники не указаны';
    const prompt = `Ты — опытный хакатон-ментор и проектный менеджер.
Команда: ${team.name}
Тема хакатона: ${team.hackathon_theme || 'не указана'}
Идея проекта: ${idea || 'не определена — предложи лучшую'}
Время: ${hours} часов
Состав команды:
${membersList}

Создай ДЕТАЛЬНЫЙ план выполнения хакатона по структуре:
## 🚀 Фаза 1: Старт (первые 2 часа)
## 💡 Фаза 2: Проектирование (до ${Math.round(hours * 0.2)} ч)
## ⚙️ Фаза 3: Разработка (до ${Math.round(hours * 0.6)} ч)
## 🎨 Фаза 4: Финализация (до ${Math.round(hours * 0.85)} ч)
## 🎤 Фаза 5: Презентация (последние ${Math.round(hours * 0.15)} ч)

Для каждой фазы укажи:
- Конкретные задачи для каждого участника по именам
- Чекпоинты и критерии готовности
- На что обратить особое внимание

Будь конкретным и практичным!`;
    const res  = await api.hackathonChat({ message: prompt, team_id: teamId, language: currentLang || 'ru' });
    const text = res.content || res.response || JSON.stringify(res);
    const html = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(text) : text.replace(/\n/g,'<br>');
    out.innerHTML = `<div style="background:var(--card);border:1px solid var(--card-border);border-radius:var(--radius);padding:20px;font-size:13px;line-height:1.7;">${html}</div>
      <button class="btn btn-secondary" style="margin-top:12px;" onclick="regeneratePlan(${teamId})">🔄 Перегенерировать</button>`;
    localStorage.setItem(`akyl_plan_team_${teamId}`, html);
  } catch (e) {
    out.innerHTML = `<p style="color:var(--danger)">Ошибка: ${e.message}</p>`;
  }
}

function regeneratePlan(teamId) {
  localStorage.removeItem(`akyl_plan_team_${teamId}`);
  generateExecutionPlan(teamId);
}

function openJoinModal() {
  document.getElementById('joinInviteCode').value = '';
  document.getElementById('joinMemberName').value = '';
  document.getElementById('joinTeamModal').style.display = 'flex';
}

async function joinTeamByCode() {
  const code = document.getElementById('joinInviteCode')?.value?.trim().toUpperCase();
  const name = document.getElementById('joinMemberName')?.value?.trim();
  if (!code || code.length < 4) { showToast('Введи код приглашения', 'error'); shakeInput('joinInviteCode'); return; }
  if (!name) { showToast('Введи своё имя', 'error'); shakeInput('joinMemberName'); return; }
  try {
    await api.joinTeamByCode(code, name, [], 'beginner', currentLang || 'ru');
    closeModal('joinTeamModal');
    showToast('✅ Вступил в команду!', 'success');
    if (typeof confetti === 'function') confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 } });
    // Award XP for joining a team
    if (AUTH.isLoggedIn()) {
      api.awardXp(75, 'join_team').then(res => {
        if (res.ok) {
          const cached = AUTH.getUser();
          if (cached) { cached.xp = res.xp; cached.rank_title = res.rank_title; AUTH.setUser(cached); updateTopBar(cached); }
          showXPFloat(75);
          if (res.leveled_up) showToast(`🎉 Новый уровень! ${res.rank_title}`, 'success');
        }
      }).catch(() => {});
    }
    initTeamsPage();
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   LEARNING MODULE
   ═══════════════════════════════════════════════════════════════════ */
const _learnState = {
  topic: '', level: 'intermediate', lang: 'ru',
  lessons: [], doneSet: new Set(),
  currentLesson: -1, quiz: [], answers: {}
};

function initLearnPage() {
  const history = JSON.parse(localStorage.getItem('akyl_learn_history') || '[]');
  const wrap = document.getElementById('pastCoursesWrap');
  const list = document.getElementById('pastCoursesList');
  if (!wrap || !list) return;
  if (history.length) {
    wrap.style.display = '';
    list.innerHTML = history.slice(-5).reverse().map((c, i) => `
      <div class="past-course-item" onclick="restoreCourse(${i})">
        <span style="font-size:20px;">${c.emoji || '📚'}</span>
        <div class="past-course-info">
          <div class="past-course-title">${escapeHtml(c.title)}</div>
          <div class="past-course-meta">${c.level} · ${c.lessons.length} уроков · ${new Date(c.date).toLocaleDateString('ru')}</div>
        </div>
        <span style="color:var(--text-dimmer);">→</span>
      </div>`).join('');
  } else {
    wrap.style.display = 'none';
  }
}

function showLearnView(id) {
  ['learnSetupView','learnCourseView','learnLessonView','learnQuizView','learnResultsView']
    .forEach(v => { const el = document.getElementById(v); if (el) el.style.display = v === id ? '' : 'none'; });
}

async function startLearning() {
  const topic = document.getElementById('learnTopic')?.value?.trim();
  const level = document.getElementById('learnLevel')?.value || 'intermediate';
  const lang  = document.getElementById('learnLang')?.value || 'ru';
  if (!topic) { showToast('Укажи тему обучения', 'error'); shakeInput('learnTopic'); return; }

  _learnState.topic = topic; _learnState.level = level; _learnState.lang = lang;
  _learnState.lessons = []; _learnState.doneSet.clear();

  const btn = document.getElementById('startLearnBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерирую курс...'; }

  const levelMap = { beginner: 'начинающего (объясни с нуля)', intermediate: 'среднего уровня', advanced: 'продвинутого' };
  const langMap = { ru: 'на русском языке', kz: 'на казахском языке', en: 'in English' };
  const prompt = `Ты опытный преподаватель. Создай программу курса из 5 уроков по теме "${topic}" для учащегося ${levelMap[level]}, ${langMap[lang]}.
Верни ТОЛЬКО валидный JSON (без markdown-блоков):
{"title":"Название курса","emoji":"📚","description":"Короткое описание курса","lessons":[{"title":"Тема урока","emoji":"📖","duration":"15 мин","summary":"1-2 предложения о чём урок"}]}`;

  try {
    const user = AUTH.getUser();
    const res = await api.personalChat(prompt, user?.id || null, lang, 'teacher');
    const raw = res.response || res.message || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('AI вернул неожиданный ответ. Попробуй снова.');
    const course = JSON.parse(jsonMatch[0]);
    if (!course.lessons?.length) throw new Error('Курс пустой. Попробуй другую тему.');

    _learnState.lessons = course.lessons;

    // Save to history
    const history = JSON.parse(localStorage.getItem('akyl_learn_history') || '[]');
    history.push({ title: course.title, emoji: course.emoji, level, lessons: course.lessons, date: Date.now(), topic });
    if (history.length > 20) history.splice(0, history.length - 20);
    localStorage.setItem('akyl_learn_history', JSON.stringify(history));

    // Render course
    document.getElementById('learnCourseTitle').textContent = `${course.emoji || '📚'} ${course.title}`;
    document.getElementById('learnCourseDesc').textContent = course.description || '';
    renderLessonsList();
    showLearnView('learnCourseView');
  } catch (e) {
    showToast('Ошибка генерации курса: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Начать обучение'; }
  }
}

function renderLessonsList() {
  const ul = document.getElementById('learnLessonsList');
  if (!ul) return;
  ul.innerHTML = _learnState.lessons.map((l, i) => {
    const done = _learnState.doneSet.has(i);
    return `<div class="learn-lesson-card ${done ? 'done' : ''}" onclick="openLesson(${i})">
      <div class="lesson-num ${done ? 'done-num' : ''}">${done ? '✓' : i + 1}</div>
      <div class="lesson-info">
        <div class="lesson-title">${l.emoji || '📖'} ${escapeHtml(l.title)}</div>
        <div class="lesson-meta">⏱ ${l.duration || '~15 мин'} · ${escapeHtml(l.summary || '')}</div>
      </div>
      <span class="lesson-arrow">→</span>
    </div>`;
  }).join('');
}

function restoreCourse(idx) {
  const history = JSON.parse(localStorage.getItem('akyl_learn_history') || '[]').reverse();
  const course = history[idx];
  if (!course) return;
  _learnState.topic = course.topic || course.title;
  _learnState.level = course.level;
  _learnState.lessons = course.lessons;
  _learnState.doneSet.clear();

  document.getElementById('learnTopic').value = course.topic || '';
  document.getElementById('learnLevel').value = course.level;
  const title = `${course.emoji || '📚'} ${course.title}`;
  document.getElementById('learnCourseTitle').textContent = title;
  document.getElementById('learnCourseDesc').textContent = '';
  renderLessonsList();
  showLearnView('learnCourseView');
}

async function openLesson(idx) {
  const lesson = _learnState.lessons[idx];
  if (!lesson) return;
  _learnState.currentLesson = idx;
  _learnState.quiz = []; _learnState.answers = {};

  document.getElementById('learnLessonTitle').textContent = `${lesson.emoji || '📖'} ${lesson.title}`;
  document.getElementById('learnLessonContent').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;color:var(--text-dim);padding:20px 0;">
      <div class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>
      AI генерирует материал ...
    </div>`;
  document.getElementById('startQuizBtn').disabled = false;
  showLearnView('learnLessonView');

  const levelMap = { beginner: 'новичку (без лишних терминов, с аналогиями)', intermediate: 'учащемуся среднего уровня', advanced: 'продвинутому разработчику (глубоко и детально)' };
  const langMap = { ru: 'русском', kz: 'казахском', en: 'English' };
  const prompt = `Ты преподаватель. Объясни тему "${lesson.title}" (курс: "${_learnState.topic}") ${levelMap[_learnState.level]} на ${langMap[_learnState.lang]} языке.

Структура:
1. Введение — зачем это нужно
2. Основные концепции — ключевые идеи с примерами
3. Практика — пример кода или задача (если применимо)
4. Ключевые выводы — 3-5 пунктов

Используй Markdown для форматирования. Пиши живо и понятно.`;

  try {
    const user = AUTH.getUser();
    const res = await api.personalChat(prompt, user?.id || null, _learnState.lang, 'teacher');
    const text = res.response || res.message || '';
    const html = typeof marked !== 'undefined' && marked.parse ? marked.parse(text) : text;
    const wrap = document.getElementById('learnLessonContent');
    wrap.innerHTML = html;
    if (typeof hljs !== 'undefined') {
      wrap.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
    }
  } catch (e) {
    document.getElementById('learnLessonContent').innerHTML = `<p style="color:var(--danger)">Ошибка загрузки урока: ${e.message}</p>`;
  }
}

async function startQuiz() {
  const btn = document.getElementById('startQuizBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерирую тест...'; }

  const lesson = _learnState.lessons[_learnState.currentLesson];
  const levelMap = { beginner: 'новичка', intermediate: 'среднего уровня', advanced: 'продвинутого' };
  const langMap = { ru: 'на русском', kz: 'на казахском', en: 'in English' };
  const prompt = `Создай 5 вопросов для проверки знаний по теме "${lesson.title}" (курс: "${_learnState.topic}") для ${levelMap[_learnState.level]} ${langMap[_learnState.lang]}.
Верни ТОЛЬКО JSON без markdown-блоков:
{"questions":[{"q":"Вопрос?","options":["A. ...","B. ...","C. ...","D. ..."],"answer":0,"explanation":"Объяснение ответа"}]}
answer — индекс (0-3) правильного варианта.`;

  try {
    const user = AUTH.getUser();
    const res = await api.personalChat(prompt, user?.id || null, _learnState.lang, 'teacher');
    const raw = res.response || res.message || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Не удалось создать тест');
    const data = JSON.parse(match[0]);
    _learnState.quiz = data.questions || [];
    _learnState.answers = {};

    document.getElementById('quizProgress').textContent = `${_learnState.quiz.length} вопросов · ${lesson.title}`;
    document.getElementById('quizQuestions').innerHTML = _learnState.quiz.map((q, qi) => `
      <div class="quiz-q-card" id="qq-${qi}">
        <div class="quiz-q-text">${qi + 1}. ${escapeHtml(q.q)}</div>
        <div class="quiz-options">
          ${q.options.map((opt, oi) => `
            <label class="quiz-option" id="qopt-${qi}-${oi}" onclick="selectQuizAnswer(${qi},${oi})">
              <input type="radio" name="q${qi}" value="${oi}" />
              ${escapeHtml(opt)}
            </label>`).join('')}
        </div>
      </div>`).join('');

    showLearnView('learnQuizView');
  } catch (e) {
    showToast('Ошибка создания теста: ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '📝 Пройти тест (5 вопросов)'; }
  }
}

function selectQuizAnswer(qi, oi) {
  _learnState.answers[qi] = oi;
  document.querySelectorAll(`#qq-${qi} .quiz-option`).forEach(el => el.classList.remove('selected'));
  document.getElementById(`qopt-${qi}-${oi}`)?.classList.add('selected');
}

async function submitQuiz() {
  const total = _learnState.quiz.length;
  const lesson = _learnState.lessons[_learnState.currentLesson];
  if (Object.keys(_learnState.answers).length < total) {
    showToast('Ответь на все вопросы!', 'error');
    _learnState.quiz.forEach((_, qi) => {
      if (_learnState.answers[qi] === undefined) {
        const card = document.getElementById(`qq-${qi}`);
        if (card) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); }
      }
    });
    return;
  }
  let correct = 0;
  _learnState.quiz.forEach((q, i) => {
    const userAns = _learnState.answers[i];
    const isRight = userAns === q.answer;
    if (isRight) correct++;
    const correctEl = document.getElementById(`qopt-${i}-${q.answer}`);
    const wrongEl   = document.getElementById(`qopt-${i}-${userAns}`);
    document.querySelectorAll(`#qq-${i} .quiz-option`).forEach(el => { el.style.pointerEvents = 'none'; });
    if (correctEl) correctEl.classList.add('correct');
    if (wrongEl && !isRight) wrongEl.classList.add('wrong');
  });

  const pct = Math.round(correct / total * 100);
  const xp  = correct * 10;
  const cls  = pct >= 80 ? 'result-pass' : pct >= 60 ? 'result-ok' : 'result-fail';
  const msg  = pct >= 80 ? '🎉 Отлично! Урок пройден.' : pct >= 60 ? '👍 Неплохо! Можно лучше.' : '💪 Повтори материал и попробуй снова.';

  document.getElementById('learnResultContent').innerHTML = `
    <div class="result-circle ${cls}">${pct}%</div>
    <h2 style="margin-bottom:6px;">${correct} из ${total} правильно</h2>
    <div class="result-xp">⚡ +${xp} XP</div>
    <p class="result-msg">${msg}</p>`;

  if (pct >= 60) {
    _learnState.doneSet.add(_learnState.currentLesson);
    renderLessonsList();
    // Award real XP via API
    if (AUTH.isLoggedIn()) {
      try {
        const res = await api.awardXp(xp, `lesson:${_learnState.topic}:${lesson?.title || ''}`);
        if (res.ok) {
          // Update cached user data with new XP
          const cached = AUTH.getUser();
          if (cached) { cached.xp = res.xp; cached.rank_title = res.rank_title; AUTH.setUser(cached); updateTopBar(cached); }
          showXPFloat(xp);
          if (res.leveled_up) showToast(`🎉 Новый уровень! Ты теперь: ${res.rank_title}`, 'success');
        }
      } catch (_) {}
    }
  }
  if (pct >= 80 && typeof confetti !== 'undefined') {
    confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 }, colors: ['#7c6ff7','#3ecfcf','#f59e0b','#22c55e'] });
  }
  showLearnView('learnResultsView');
}

function retryQuiz() {
  _learnState.answers = {};
  _learnState.quiz.forEach((_, qi) => {
    _learnState.quiz[qi].options.forEach((_, oi) => {
      const el = document.getElementById(`qopt-${qi}-${oi}`);
      if (el) { el.classList.remove('correct','wrong','selected'); el.style.pointerEvents = ''; }
      document.querySelectorAll(`#qq-${qi} input[type=radio]`).forEach(r => r.checked = false);
    });
  });
  showLearnView('learnQuizView');
}
function backToLearnSetup() {
  document.getElementById('learnTopic').value = '';
  showLearnView('learnSetupView');
  initLearnPage();
}
function backToCourse() { showLearnView('learnCourseView'); renderLessonsList(); }
function backToLesson() { showLearnView('learnLessonView'); }

/* ═══════════════════════════════════════════════════════════════════
   AI INSIGHTS PAGE
   ═══════════════════════════════════════════════════════════════════ */
function initInsightsPage() {
  const sel = document.getElementById('insightsTeamSelect');
  if (!sel) return;
  const populate = (teams) => {
    sel.innerHTML = '<option value="">— Выбрать команду —</option>';
    (teams || []).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.name;
      sel.appendChild(opt);
    });
    if (currentTeamId) sel.value = currentTeamId;
  };
  if (allTeams.length) {
    populate(allTeams);
  } else {
    api.getTeams().then(teams => { allTeams = teams; populate(teams); }).catch(() => {});
  }
  document.getElementById('insightsResult').innerHTML = '';
}

async function runInsights(type) {
  const teamId = document.getElementById('insightsTeamSelect')?.value;
  if (!teamId) { showToast('Выбери команду', 'error'); return; }
  const out = document.getElementById('insightsResult');
  out.innerHTML = '<div class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div><p style="color:var(--text-dim);font-size:13px;">AI анализирует...</p>';
  try {
    let res;
    if (type === 'failure') {
      res = await api.predictFailure(teamId, currentLang || 'ru');
    } else if (type === 'skills') {
      res = await api.skillMatch({ team_id: parseInt(teamId), language: currentLang || 'ru' });
    } else {
      const summary = prompt('Кратко опиши ваш проект (1-2 предложения):');
      if (!summary) { out.innerHTML = ''; return; }
      res = await api.postHackathonReport(teamId, summary, currentLang || 'ru');
    }
    const text = res.analysis || res.report || res.insights || res.result || JSON.stringify(res, null, 2);
    const html = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(text) : text;
    out.innerHTML = html;
    if (typeof hljs !== 'undefined') out.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  } catch (e) {
    out.innerHTML = `<p style="color:var(--danger)">Ошибка: ${e.message}</p>`;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   ROLE DETERMINATION TEST
   ═══════════════════════════════════════════════════════════════════ */
const ROLE_QUESTIONS = [
  {
    q: 'Что тебя пугает больше всего на хакатоне?',
    opts: [
      { text: '😰 "Нам надо питч через 2 часа, а слайды не готовы!"', role: 'PM' },
      { text: '😱 "Код не компилируется за 30 минут до сдачи!"',       role: 'DEV' },
      { text: '😬 "Дизайн выглядит ужасно, жюри смотрит на UI!"',      role: 'DESIGN' },
      { text: '🤯 "Данных нет, а модель надо обучить за ночь!"',        role: 'ML' },
    ],
  },
  {
    q: 'Ты получил задачу. Что делаешь первым делом?',
    opts: [
      { text: '📋 Разбиваю на подзадачи, делаю план с дедлайнами',  role: 'PM' },
      { text: '💻 Сразу открываю редактор и начинаю кодить',          role: 'DEV' },
      { text: '🎨 Смотрю референсы и набрасываю скетч',               role: 'DESIGN' },
      { text: '🔍 Изучаю данные и исследую возможные подходы',        role: 'ML' },
    ],
  },
  {
    q: 'Что ты находишь самым захватывающим?',
    opts: [
      { text: '🤝 Когда вся команда слаженно работает вместе',        role: 'PM' },
      { text: '✅ Когда сложный баг наконец исправлен',                role: 'DEV' },
      { text: '✨ Когда красивый UI вызывает вау-эффект у людей',      role: 'DESIGN' },
      { text: '📈 Когда модель достигает высокой точности',            role: 'ML' },
    ],
  },
  {
    q: 'Какой инструмент ты используешь чаще всего?',
    opts: [
      { text: '📊 Notion / Trello / Jira — таск-менеджеры',           role: 'PM' },
      { text: '⌨️ VS Code / GitHub / Terminal',                        role: 'DEV' },
      { text: '🖌️ Figma / Adobe / Sketch',                            role: 'DESIGN' },
      { text: '🐍 Jupyter / Python / TensorFlow / PyTorch',           role: 'ML' },
    ],
  },
  {
    q: 'Как твои друзья/коллеги тебя описывают?',
    opts: [
      { text: '🗣️ "Дипломат — умеет слушать и договариваться"',       role: 'PM' },
      { text: '🔧 "Перфекционист — код должен быть чистым"',           role: 'DEV' },
      { text: '💭 "Визионер — думает картинками и образами"',           role: 'DESIGN' },
      { text: '📐 "Аналитик — всё проверяет на цифрах и данных"',      role: 'ML' },
    ],
  },
  {
    q: 'Какую суперсилу ты бы выбрал для хакатона?',
    opts: [
      { text: '🧠 Читать мысли всех участников и жюри',               role: 'PM' },
      { text: '⚡ Печатать код со скоростью мысли без ошибок',          role: 'DEV' },
      { text: '🎯 Создавать идеальный UI за секунды',                  role: 'DESIGN' },
      { text: '🔮 Предсказывать будущее по любым данным',              role: 'ML' },
    ],
  },
];

const ROLE_DATA = {
  PM: {
    title: 'Project Manager',
    icon: '👑',
    sub: 'Лидер и организатор команды',
    desc: 'Ты — клей, который держит команду вместе. Ты контролируешь дедлайны, коммуницируешь с жюри, мотивируешь команду и следишь, чтобы проект двигался в правильном направлении. Без тебя команда потеряется.',
    skills: ['Управление проектом', 'Коммуникация', 'Notion/Jira', 'Питч-презентации', 'Тайм-менеджмент'],
    color: '#7c3aed',
  },
  DEV: {
    title: 'Full-Stack Developer',
    icon: '💻',
    sub: 'Технический хребет команды',
    desc: 'Ты строишь продукт от фронтенда до бэкенда. Ты решаешь технические проблемы, выбираешь архитектуру и пишешь код, который реально работает. На тебе держится MVP хакатона.',
    skills: ['React / Vue', 'Python / Node.js', 'REST API', 'Git', 'Databases'],
    color: '#3ecfcf',
  },
  DESIGN: {
    title: 'UX/UI Designer',
    icon: '🎨',
    sub: 'Визионер и архитектор опыта',
    desc: 'Ты создаёшь то, что люди видят и чувствуют. Твой UI — первое впечатление на жюри. Ты делаешь из сложного продукта понятный и красивый пользовательский опыт, который запоминается.',
    skills: ['Figma', 'UX-исследования', 'Прототипирование', 'Дизайн-системы', 'Анимация'],
    color: '#ec4899',
  },
  ML: {
    title: 'ML / Data Engineer',
    icon: '🤖',
    sub: 'Учёный данных и AI-инженер',
    desc: 'Ты добавляешь интеллект в продукт. Ты обучаешь модели, анализируешь данные и находишь инсайты, которые делают проект уникальным. Именно ты превращаешь идею в настоящее AI-решение.',
    skills: ['Python', 'TensorFlow/PyTorch', 'Pandas / NumPy', 'ML алгоритмы', 'API интеграция'],
    color: '#f59e0b',
  },
};

let _roleScores = { PM: 0, DEV: 0, DESIGN: 0, ML: 0 };
let _roleCurrentQ = 0;
let _roleAnswers  = [];

function initRoleTest() {
  _roleScores  = { PM: 0, DEV: 0, DESIGN: 0, ML: 0 };
  _roleCurrentQ = 0;
  _roleAnswers  = new Array(ROLE_QUESTIONS.length).fill(null);
  document.getElementById('roleQuizView').style.display   = '';
  document.getElementById('roleResultView').style.display = 'none';
  renderRoleQuestion();
}

function renderRoleQuestion() {
  const q   = ROLE_QUESTIONS[_roleCurrentQ];
  const pct = ((_roleCurrentQ) / ROLE_QUESTIONS.length) * 100;
  document.getElementById('roleProgressBar').style.width = pct + '%';
  document.getElementById('rolePrevBtn').style.display   = _roleCurrentQ > 0 ? '' : 'none';
  document.getElementById('roleNextBtn').textContent =
    _roleCurrentQ === ROLE_QUESTIONS.length - 1 ? '🏁 Узнать мою роль' : 'Далее →';

  const saved = _roleAnswers[_roleCurrentQ];
  document.getElementById('roleQuestionWrap').innerHTML = `
    <p style="color:var(--text-dim);font-size:12px;margin-bottom:8px;">Вопрос ${_roleCurrentQ + 1} из ${ROLE_QUESTIONS.length}</p>
    <h3 style="font-size:16px;font-weight:700;margin-bottom:18px;line-height:1.5;">${q.q}</h3>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${q.opts.map((opt, i) => `
        <label class="quiz-option${saved === i ? ' selected' : ''}" style="cursor:pointer;padding:14px 16px;" onclick="selectRoleAnswer(${i})">
          <input type="radio" name="rq" value="${i}" ${saved === i ? 'checked' : ''} style="display:none;">
          <span style="font-size:14px;">${opt.text}</span>
        </label>`).join('')}
    </div>`;
}

function selectRoleAnswer(idx) {
  _roleAnswers[_roleCurrentQ] = idx;
  document.querySelectorAll('#roleQuestionWrap .quiz-option').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
  });
}

function roleNavQ(dir) {
  if (dir === 1 && _roleAnswers[_roleCurrentQ] === null) {
    showToast('Выбери ответ', 'error'); return;
  }
  if (dir === 1 && _roleCurrentQ === ROLE_QUESTIONS.length - 1) {
    showRoleResult(); return;
  }
  _roleCurrentQ = Math.max(0, Math.min(ROLE_QUESTIONS.length - 1, _roleCurrentQ + dir));
  renderRoleQuestion();
}

function showRoleResult() {
  // Tally scores
  const scores = { PM: 0, DEV: 0, DESIGN: 0, ML: 0 };
  ROLE_QUESTIONS.forEach((q, qi) => {
    const ansIdx = _roleAnswers[qi];
    if (ansIdx !== null) scores[q.opts[ansIdx].role]++;
  });
  // Find winner
  const winner = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0];
  const data   = ROLE_DATA[winner];

  document.getElementById('roleProgressBar').style.width = '100%';
  document.getElementById('roleQuizView').style.display   = 'none';
  document.getElementById('roleResultView').style.display = '';

  document.getElementById('roleResultIcon').textContent    = data.icon;
  document.getElementById('roleResultTitle').textContent   = data.title;
  document.getElementById('roleResultSubtitle').textContent = data.sub;
  document.getElementById('roleResultDesc').textContent    = data.desc;
  document.getElementById('roleResultSkills').innerHTML    =
    data.skills.map(s => `<span style="background:rgba(124,111,247,.12);color:var(--primary);padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;">${s}</span>`).join('');

  // Save to profile
  localStorage.setItem('akyl_my_role', JSON.stringify({ role: winner, ...data }));
  showToast(`🎉 Твоя роль: ${data.title}!`, 'success');

  // Award XP
  api.awardXp(50, `Прошёл тест на роль: ${data.title}`).catch(() => {});
}

/* ═══════════════════════════════════════════════════════════════════
   SOLO MODE
   ═══════════════════════════════════════════════════════════════════ */
async function startSoloMode() {
  const compName = document.getElementById('soloCompName')?.value.trim();
  const deadline = document.getElementById('soloDeadline')?.value;
  const skills   = document.getElementById('soloSkills')?.value.trim();
  const goal     = document.getElementById('soloGoal')?.value.trim();
  if (!compName) { showToast('Введи название соревнования', 'error'); return; }

  const days = deadline
    ? Math.ceil((new Date(deadline) - new Date()) / 86400000)
    : null;
  const daysText = days !== null ? `${days} дней до дедлайна` : 'дедлайн не указан';

  const soloContext = `Ты — личный AI-ментор для подготовки к соревнованию.
Соревнование: ${compName}
Дедлайн: ${daysText}
Навыки участника: ${skills || 'не указаны'}
Цель: ${goal || 'не указана'}

Составь детальный персональный план подготовки:
1. **Анализ задачи** — что обычно требуется на ${compName}
2. **Оценка пробелов** — что нужно изучить исходя из навыков
3. **Учебный план** — по дням/неделям до дедлайна
4. **Ресурсы** — конкретные курсы, статьи, датасеты
5. **Стратегия** — как выступить лучше всего

Будь конкретным и вдохновляющим!`;

  closeModal('soloModeModal');
  showPage('personal-chat');

  // Store solo context so personal chat uses it
  localStorage.setItem('akyl_solo_context', JSON.stringify({ compName, deadline, skills, goal, daysText }));

  // Wait for page to activate then send the planning prompt
  setTimeout(() => {
    const input = document.getElementById('pchatInput');
    if (input) {
      input.value = soloContext;
      if (typeof sendPersonalMessage === 'function') sendPersonalMessage();
    }
  }, 450);
  showToast(`🧑 Режим соло активирован для: ${compName}`, 'success');
  api.awardXp(20, `Запустил соло-режим: ${compName}`).catch(() => {});
}

/* ═══════════════════════════════════════════════════════════════════
   HACKATHON CATALOG
   ═══════════════════════════════════════════════════════════════════ */

let _catalogData    = [];    // cached list
let _catalogDetail  = null;  // currently open hackathon
let _catalogDebounce = null;

async function initCatalogPage() {
  document.getElementById('catalogMatchResult').style.display = 'none';
  await loadAllCatalog();
}

async function loadAllCatalog() {
  const grid = document.getElementById('catalogGrid');
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim);">⏳ Загрузка...</div>';
  try {
    const res = await api.catalogSearch({ query: '', skills: [], language: currentLang || 'ru' });
    _catalogData = res.hackathons || [];
    renderCatalogGrid(_catalogData);
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--danger);">⚠️ ${e.message}</div>`;
  }
}

function debounceSearch() {
  clearTimeout(_catalogDebounce);
  _catalogDebounce = setTimeout(searchCatalog, 420);
}

async function searchCatalog() {
  const q    = document.getElementById('catalogSearch')?.value.trim() || '';
  const cat  = document.getElementById('catalogCategory')?.value || '';
  const grid = document.getElementById('catalogGrid');
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--text-dim);">⏳</div>';
  try {
    const myRole = JSON.parse(localStorage.getItem('akyl_my_role') || '{}');
    const skills = myRole.skills || [];
    const res = await api.catalogSearch({
      query: q, category: cat, skills, language: currentLang || 'ru'
    });
    _catalogData = res.hackathons || [];
    renderCatalogGrid(_catalogData);
  } catch (e) {
    grid.innerHTML = `<div style="grid-column:1/-1;color:var(--danger);">${e.message}</div>`;
  }
}

function renderCatalogGrid(hackathons) {
  const grid = document.getElementById('catalogGrid');
  if (!hackathons.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-dim);">🔎 Ничего не найдено. Попробуй другой запрос.</div>';
    return;
  }
  const maxScore = Math.max(...hackathons.map(h => h.match_score || 0), 1);
  grid.innerHTML = hackathons.map(h => {
    const score = h.match_score || 0;
    const pct   = Math.round((score / maxScore) * 100);
    const diffDots = Array(5).fill(0).map((_, i) =>
      `<div class="catalog-difficulty-dot${i < h.difficulty ? ' filled' : ''}"></div>`
    ).join('');
    const tags = (h.tags || []).slice(0, 4).map(t => `<span class="catalog-tag">${t}</span>`).join('');
    return `
      <div class="catalog-card" onclick="openCatalogEntry('${h.id}')">
        <div class="catalog-card-top">
          <span class="catalog-emoji">${h.emoji}</span>
          <div>
            <div class="catalog-name">${escapeHtml(h.name)}</div>
            <div class="catalog-org">${escapeHtml(h.org)}</div>
          </div>
        </div>
        <div class="catalog-desc">${escapeHtml(h.desc)}</div>
        <div class="catalog-tags">${tags}</div>
        <div class="catalog-meta">
          <span>⏱️ ${h.duration}</span>
          <span>${h.format === 'online' ? '🌐 Онлайн' : h.format === 'offline' ? '📍 Офлайн' : '🌐📍 Гибрид'}</span>
          <span>🏆 ${escapeHtml(h.prize)}</span>
        </div>
        <div class="catalog-difficulty-dots" style="margin-top:8px;">${diffDots}</div>
        ${score > 0 ? `
        <div class="catalog-match-bar"><div class="catalog-match-fill" style="width:${pct}%"></div></div>
        <div class="catalog-match-label">${pct >= 80 ? '🔥 Отличное совпадение' : pct >= 50 ? '✅ Хорошее совпадение' : '📊 Частичное совпадение'}</div>` : ''}
        <div class="catalog-action-row">
          <button class="btn btn-primary" style="flex:1;font-size:12px;" onclick="event.stopPropagation();openCatalogIdeas('${h.id}','${escapeHtml(h.name).replace(/'/g,"\\'").replace(/"/g,'\\"')}')">💡 Идеи для этого</button>
          ${h.link ? `<a class="btn btn-secondary" style="font-size:12px;text-decoration:none;" href="${h.link}" target="_blank" onclick="event.stopPropagation()">🔗 Сайт</a>` : ''}
        </div>
      </div>`;
  }).join('');
}

function openCatalogEntry(id) {
  const h = _catalogData.find(x => x.id === id);
  if (!h) return;
  _catalogDetail = h;
  const diffDots = Array(5).fill(0).map((_, i) =>
    `<div class="catalog-difficulty-dot${i < h.difficulty ? ' filled' : ''}" style="width:12px;height:12px;"></div>`
  ).join('');
  document.getElementById('catalogDetailContent').innerHTML = `
    <button onclick="closeCatalogDetail()" style="background:none;border:none;color:var(--text-dim);font-size:20px;cursor:pointer;margin-bottom:16px;">✕ Закрыть</button>
    <div class="catalog-detail-header">
      <span class="catalog-detail-emoji">${h.emoji}</span>
      <div class="catalog-detail-info">
        <div class="catalog-detail-name">${escapeHtml(h.name)}</div>
        <div class="catalog-detail-org">от ${escapeHtml(h.org)}</div>
        <div class="catalog-difficulty-dots" style="margin-top:8px;">${diffDots}</div>
      </div>
    </div>
    <p style="font-size:13px;line-height:1.7;color:var(--text-dim);margin-bottom:16px;">${escapeHtml(h.desc)}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;font-size:12px;">
      <div style="background:var(--card);border:1px solid var(--card-border);border-radius:10px;padding:12px;">
        <div style="color:var(--text-dimmer);margin-bottom:4px;">⏱️ Длительность</div>
        <div style="font-weight:600;">${h.duration}</div>
      </div>
      <div style="background:var(--card);border:1px solid var(--card-border);border-radius:10px;padding:12px;">
        <div style="color:var(--text-dimmer);margin-bottom:4px;">📍 Формат</div>
        <div style="font-weight:600;">${h.format}</div>
      </div>
      <div style="background:var(--card);border:1px solid var(--card-border);border-radius:10px;padding:12px;">
        <div style="color:var(--text-dimmer);margin-bottom:4px;">🏆 Призы</div>
        <div style="font-weight:600;">${escapeHtml(h.prize)}</div>
      </div>
      <div style="background:var(--card);border:1px solid var(--card-border);border-radius:10px;padding:12px;">
        <div style="color:var(--text-dimmer);margin-bottom:4px;">📅 Дедлайн</div>
        <div style="font-weight:600;">${h.deadline_pattern}</div>
      </div>
    </div>
    <div style="margin-bottom:16px;">
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;font-weight:600;">НАВЫКИ</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${(h.skills_match || []).map(s => `<span class="catalog-tag">${s}</span>`).join('')}
      </div>
    </div>
    <div style="margin-bottom:20px;">
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:8px;font-weight:600;">ТЕГИ</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        ${(h.tags || []).map(t => `<span class="catalog-tag">${t}</span>`).join('')}
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;">
      <button class="btn btn-primary" onclick="openCatalogIdeas('${h.id}','${escapeHtml(h.name).replace(/'/g,"\\'").replace(/"/g,'\\"')}')">
        💡 Генерировать идеи для этого хакатона
      </button>
      ${h.link ? `<a class="btn btn-secondary" href="${h.link}" target="_blank" style="text-decoration:none;text-align:center;">🔗 Открыть сайт хакатона</a>` : ''}
      <button class="btn btn-outline" onclick="closeCatalogDetail();showPage('solo-mode');openModal('soloModeModal')">
        🧑 Подготовиться к нему (Solo mode)
      </button>
    </div>
    <div id="catalogDetailIdeasArea" style="margin-top:24px;"></div>`;

  document.getElementById('catalogDetailOverlay').classList.add('open');
  document.getElementById('catalogDetailPanel').classList.add('open');
}

function closeCatalogDetail() {
  document.getElementById('catalogDetailOverlay').classList.remove('open');
  document.getElementById('catalogDetailPanel').classList.remove('open');
}

async function openCatalogIdeas(id, name) {
  // Show ideas inline in the card list or inside detail panel
  const inDetailPanel = document.getElementById('catalogDetailPanel').classList.contains('open');
  let container;
  if (inDetailPanel) {
    container = document.getElementById('catalogDetailIdeasArea');
  } else {
    // Navigate to detail panel and show ideas
    openCatalogEntry(id);
    await new Promise(r => setTimeout(r, 100));
    container = document.getElementById('catalogDetailIdeasArea');
  }
  if (!container) return;

  const myRole = JSON.parse(localStorage.getItem('akyl_my_role') || '{}');
  const skills = myRole.skills || [];

  container.innerHTML = `
    <div style="border-top:1px solid var(--card-border);padding-top:20px;">
      <h3 style="font-size:15px;font-weight:700;margin-bottom:8px;">💡 AI генерирует идеи</h3>
      <p style="font-size:12px;color:var(--text-dim);margin-bottom:12px;">
        На основе истории хакатона, трендов 2025-2026 и твоих навыков
      </p>
      <div class="form-group">
        <label style="font-size:12px;">Тема / подтема (если есть)</label>
        <input type="text" id="catalogIdeasTheme" class="input" style="font-size:13px;" placeholder="AI for Health, Web3 Finance..." />
      </div>
      <div class="form-group">
        <label style="font-size:12px;">Ограничения / стек</label>
        <input type="text" id="catalogIdeasConstraints" class="input" style="font-size:13px;" placeholder="Только Python, без мобилки..." />
      </div>
      <button class="btn btn-primary" style="width:100%;margin-bottom:16px;" onclick="generateCatalogIdeas('${id}','${name.replace(/'/g,"\\'").replace(/"/g,'\\"')}')">
        🚀 Генерировать 5 идей с учётом трендов
      </button>
      <div id="catalogIdeasResult"></div>
    </div>`;
}

async function generateCatalogIdeas(id, name) {
  const theme       = document.getElementById('catalogIdeasTheme')?.value.trim() || '';
  const constraints = document.getElementById('catalogIdeasConstraints')?.value.trim() || '';
  const myRole      = JSON.parse(localStorage.getItem('akyl_my_role') || '{}');
  const skills      = myRole.skills || [];
  const out         = document.getElementById('catalogIdeasResult');
  out.innerHTML     = `<div class="typing-indicator" style="padding:16px;"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div><p style="color:var(--text-dim);font-size:12px;padding:0 0 8px;">AI анализирует тренды и генерирует идеи...</p>`;
  try {
    const res = await api.catalogIdeas({
      hackathon_id: id,
      hackathon_name: name,
      hackathon_theme: theme,
      team_skills: skills,
      constraints,
      language: currentLang || 'ru',
    });
    const html = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(res.content || '') : (res.content || '').replace(/\n/g,'<br>');
    out.innerHTML = `<div class="markdown-content" style="font-size:13px;line-height:1.7;">${html}</div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button class="btn btn-secondary" style="font-size:12px;" onclick="generateCatalogIdeas('${id}','${name.replace(/'/g,"\\'").replace(/"/g,'\\"')}')">🔄 Ещё идеи</button>
        <button class="btn btn-outline" style="font-size:12px;" onclick="takeIdeaToTeam()">👥 Взять в команду</button>
      </div>`;
    if (typeof hljs !== 'undefined') out.querySelectorAll('pre code').forEach(el => hljs.highlightElement(el));
  } catch (e) {
    out.innerHTML = `<p style="color:var(--danger)">Ошибка: ${e.message}</p>`;
  }
}

function takeIdeaToTeam() {
  closeCatalogDetail();
  showPage('teams');
  showToast('Выбери команду и открой вкладку "AI Совет" чтобы обсудить идею!', 'info');
}

function openCatalogMatch() {
  // Pre-fill skills from profile
  const myRole = JSON.parse(localStorage.getItem('akyl_my_role') || '{}');
  if (myRole.skills) {
    const el = document.getElementById('matchSkills');
    if (el && !el.value) el.value = (myRole.skills || []).join(', ');
  }
  openModal('catalogMatchModal');
}

async function runCatalogMatch() {
  const skills   = (document.getElementById('matchSkills')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
  const interest = document.getElementById('matchInterest')?.value.trim() || '';
  const teamName = document.getElementById('matchTeamName')?.value.trim() || '';
  closeModal('catalogMatchModal');
  const resultDiv = document.getElementById('catalogMatchResult');
  const contentDiv = document.getElementById('catalogMatchContent');
  resultDiv.style.display = '';
  contentDiv.innerHTML = '<div class="typing-indicator"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div><p style="color:var(--text-dim);font-size:13px;">AI анализирует все хакатоны каталога...</p>';
  resultDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const res = await api.catalogMatch({
      skills,
      team_name: teamName,
      hackathon_theme: interest,
      language: currentLang || 'ru',
    });
    const html = (typeof marked !== 'undefined' && marked.parse) ? marked.parse(res.content || '') : (res.content || '').replace(/\n/g,'<br>');
    contentDiv.innerHTML = html;
    showToast('✅ AI рекомендации готовы!', 'success');
  } catch (e) {
    contentDiv.innerHTML = `<p style="color:var(--danger)">Ошибка: ${e.message}</p>`;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   DAILY CHALLENGE
   ═══════════════════════════════════════════════════════════════════ */

async function loadDailyChallenge() {
  const wrap = document.getElementById('dailyChallengeWrap');
  if (!wrap) return;
  const token = localStorage.getItem('akyl_token');
  if (!token) { wrap.style.display = 'none'; return; }
  try {
    const [ch, hist] = await Promise.all([api.getChallenge(), api.challengeHistory()]);
    document.getElementById('dcEmoji').textContent = ch.emoji;
    document.getElementById('dcTitle').textContent = ch.title;
    document.getElementById('dcDesc').textContent  = ch.desc;
    document.getElementById('dcXp').textContent    = `+${ch.xp} XP за выполнение`;
    document.getElementById('dcStreak').textContent = `🔥 ${hist.streak} день`;
    const btn      = document.getElementById('dcBtn');
    const doneBtn  = document.getElementById('dcDoneBtn');
    const doneBadge= document.getElementById('dcDoneBadge');
    if (ch.completed) {
      btn.style.display      = 'none';
      doneBtn.style.display  = 'none';
      doneBadge.style.display = '';
    } else {
      btn.style.display      = '';
      doneBtn.style.display  = '';
      doneBadge.style.display = 'none';
    }
    // Store action for navigation
    btn._action = ch.action;
  } catch (e) {
    wrap.style.display = 'none';
  }
}

function goToDailyChallenge() {
  const btn = document.getElementById('dcBtn');
  const action = btn._action || 'personal-chat';
  showPage(action);
}

async function markChallengeComplete() {
  try {
    const res = await api.completeChallenge();
    if (res.success) {
      showToast(`✅ Задание выполнено! +${res.xp} XP`, 'success');
      loadDailyChallenge();
      if (typeof loadUserProfile === 'function') loadUserProfile();
    } else if (res.already_done) {
      showToast('Это задание уже выполнено сегодня!', 'info');
    }
  } catch (e) {
    showToast('Сначала выполни задание!', 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   HACKATHON COUNTDOWN
   ═══════════════════════════════════════════════════════════════════ */

let _cdwTimer = null;

function openCountdown() {
  document.getElementById('countdownWidget').style.display = '';
  document.getElementById('fabMenu').style.display = 'none';
  const saved = localStorage.getItem('akyl_countdown');
  if (saved) {
    const { name, date } = JSON.parse(saved);
    document.getElementById('cdwNameInput').value = name;
    document.getElementById('cdwDate').value = date;
    _startCountdown(name, date);
  }
}
function closeCountdown() {
  document.getElementById('countdownWidget').style.display = 'none';
  clearInterval(_cdwTimer);
}
/* ═══════════════════════════════════════════════════════════════════
   FAB + QUICK NOTE
   ═══════════════════════════════════════════════════════════════════ */

function toggleFab() {
  const menu = document.getElementById('fabMenu');
  const visible = menu.style.display !== 'none';
  menu.style.display = visible ? 'none' : '';
  document.getElementById('fabMain').textContent = visible ? '⭐' : '✕';
}

function openQuickNote() {
  document.getElementById('fabMenu').style.display = 'none';
  document.getElementById('fabMain').textContent = '⭐';
  // populate team select
  const sel = document.getElementById('qnTeam');
  sel.innerHTML = '<option value="">— Команда (опционально) —</option>';
  api.getTeams().then(teams => {
    (teams || []).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id; opt.textContent = t.name;
      sel.appendChild(opt);
    });
  }).catch(() => {});
  openModal('quickNoteModal');
}

async function saveQuickNote() {
  const title   = document.getElementById('qnTitle').value.trim();
  const content = document.getElementById('qnContent').value.trim();
  if (!content) { showToast('Напиши заметку!', 'error'); return; }
  // Save to localStorage scratchpad (client-side store)
  const notes = JSON.parse(localStorage.getItem('akyl_quick_notes') || '[]');
  notes.unshift({ id: Date.now(), title: title || 'Быстрая заметка', content, date: new Date().toISOString() });
  localStorage.setItem('akyl_quick_notes', JSON.stringify(notes.slice(0, 50)));
  closeModal('quickNoteModal');
  document.getElementById('qnTitle').value = '';
  document.getElementById('qnContent').value = '';
  showToast('📝 Заметка сохранена! +5 XP', 'success');
  api.awardXp(5, 'Быстрая заметка').catch(() => {});
}

/* ═══════════════════════════════════════════════════════════════════
   NOTIFICATION CENTRE
   ═══════════════════════════════════════════════════════════════════ */
function _getNotifs() { return JSON.parse(localStorage.getItem('akyl_notifs') || '[]'); }
function _saveNotifs(a) { localStorage.setItem('akyl_notifs', JSON.stringify(a.slice(0, 30))); }
function _pushNotif(icon, text) {
  const notifs = _getNotifs();
  const today = new Date().toDateString();
  if (notifs.some(n => n.text === text && new Date(n.ts).toDateString() === today)) return;
  notifs.unshift({ id: Date.now(), icon, text, ts: new Date().toISOString(), read: false });
  _saveNotifs(notifs);
  renderNotifs();
}
function _relTime(iso) {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин. назад`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} ч. назад` : `${Math.floor(h/24)} дн. назад`;
}
function renderNotifs() {
  const notifs = _getNotifs();
  const unread = notifs.filter(n => !n.read).length;
  const badge = document.getElementById('notifBadge');
  if (badge) { badge.style.display = unread ? 'flex' : 'none'; badge.textContent = unread > 9 ? '9+' : unread; }
  const list = document.getElementById('notifList');
  if (!list) return;
  list.innerHTML = notifs.length
    ? notifs.map(n => `<div class="notif-item${n.read ? ' notif-read' : ''}" onclick="markNotifRead(${n.id})">
        <span class="notif-item-icon">${n.icon}</span>
        <div class="notif-item-body"><div class="notif-item-text">${n.text}</div><div class="notif-item-time">${_relTime(n.ts)}</div></div>
      </div>`).join('')
    : '<div class="notif-empty">Нет новых уведомлений</div>';
}
function markNotifRead(id) {
  _saveNotifs(_getNotifs().map(n => n.id === id ? { ...n, read: true } : n));
  renderNotifs();
}
function clearNotifs() {
  _saveNotifs([]);
  renderNotifs();
  document.getElementById('notifPanel')?.classList.remove('open');
}
function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  const isOpen = panel.classList.toggle('open');
  if (isOpen) { _saveNotifs(_getNotifs().map(n => ({ ...n, read: true }))); renderNotifs(); }
}
function _checkAutoNotifs() {
  const today = new Date().toDateString();
  if (localStorage.getItem('akyl_chall_notif_day') !== today) {
    _pushNotif('⚡', 'Новое задание дня готово! Выполни челлендж и заработай XP.');
    localStorage.setItem('akyl_chall_notif_day', today);
  }
  if (new Date().getHours() >= 20 && localStorage.getItem('akyl_streak_warned') !== today) {
    _pushNotif('🔥', 'Стрик под угрозой! Не забудь выполнить задание дня до полуночи.');
    localStorage.setItem('akyl_streak_warned', today);
  }
  // Hackathon deadline warnings
  const hacks = [
    { key: 'alem', name: 'alem.ai battle', iso: '2026-02-22', link: 'https://astanahub.com/account/service/alem_ai_battle/request/510/create/' },
    { key: 'nb',   name: 'Next Byte Hacks', iso: '2026-02-24', link: 'https://next-byte-january-2026.devpost.com/' },
    { key: 'cc',   name: 'Creator Colosseum', iso: '2026-03-26', link: 'https://creatorcolosseumcompetition26.devpost.com/' },
  ];
  hacks.forEach(h => {
    const daysLeft = Math.ceil((new Date(h.iso + 'T23:59:59') - Date.now()) / 86400000);
    if (daysLeft >= 0 && daysLeft <= 3 && localStorage.getItem(`akyl_hack_warn_${h.key}`) !== today) {
      _pushNotif('⏰', daysLeft === 0
        ? `🚨 Сегодня дедлайн: ${h.name}! Успей подать заявку.`
        : `⏰ До дедлайна ${h.name} — ${daysLeft} дн.! Не пропусти.`);
      localStorage.setItem(`akyl_hack_warn_${h.key}`, today);
    }
  });
  const user = AUTH.getUser();
  if (user) {
    const wk = `akyl_welcome_${user.username}`;
    if (!localStorage.getItem(wk)) {
      _pushNotif('👋', `Добро пожаловать, ${user.full_name || user.username}! Начни с дневного задания — кликни ⚡.`);
      localStorage.setItem(wk, '1');
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════
   COMMAND PALETTE (Ctrl+K)
   ═══════════════════════════════════════════════════════════════════ */
const CMD_PAGES = [
  { id: 'home',             icon: '🏠', label: 'Главная' },
  { id: 'dashboard',        icon: '📈', label: 'Дашборд — статистика и аналитика' },
  { id: 'kanban',           icon: '📋', label: 'Канбан-доска — задачи команды' },
  { id: 'project',          icon: '🗺️', label: 'Планировщик AI — пошаговый план проекта + поиск' },
  { id: 'notes',            icon: '🗒️', label: 'Заметки' },
  { id: 'channels',         icon: '#',   label: 'Каналы — общение по темам' },
  { id: 'chat',             icon: '💬', label: 'Командный чат' },
  { id: 'personal-chat',    icon: '🤖', label: 'Личный AI-ментор' },
  { id: 'teacher',          icon: '📚', label: 'AI-учитель — объяснения и квизы' },
  { id: 'ideas',            icon: '💡', label: 'Генератор идей для хакатона' },
  { id: 'codereview',       icon: '🔍', label: 'AI Код-ревью' },
  { id: 'pitch',            icon: '🎤', label: 'Питч-тренер — подготовка презентации' },
  { id: 'burnout',          icon: '💤', label: 'Детектор выгорания' },
  { id: 'tournaments',      icon: '🏆', label: 'Хакатоны и турниры' },
  { id: 'find-team',        icon: '🔎', label: 'Найти команду или участника' },
  { id: 'leaderboard',      icon: '📊', label: 'Лидерборд — рейтинг XP' },
  { id: 'hackathon-catalog',icon: '🗂️', label: 'Каталог хакатонов — AI-подбор' },
  { id: 'ai-insights',      icon: '🔮', label: 'AI-аналитика — риски и отчёты' },
  { id: 'role-test',        icon: '🧭', label: 'Тест на роль в команде' },
  { id: 'profile',          icon: '👤', label: 'Мой профиль и настройки' },
  { id: 'teams',            icon: '👥', label: 'Мои команды' },
  { id: 'olympiad',         icon: '📐', label: 'Олимпиадный тренажёр — алгоритмы, задачи, AI-разбор' },
];
let _cmdActive = 0;
function openCmdPalette() {
  const ov = document.getElementById('cmdOverlay');
  if (!ov) return;
  ov.classList.add('open');
  const inp = document.getElementById('cmdInput');
  if (inp) { inp.value = ''; inp.focus(); }
  filterCmd();
}
function closeCmdPalette() { document.getElementById('cmdOverlay')?.classList.remove('open'); }
function filterCmd() {
  const q = (document.getElementById('cmdInput')?.value || '').toLowerCase().trim();
  const filtered = q ? CMD_PAGES.filter(p => p.label.toLowerCase().includes(q) || p.id.includes(q)) : CMD_PAGES;
  _cmdActive = 0;
  const list = document.getElementById('cmdList');
  if (!list) return;
  list.innerHTML = filtered.length
    ? filtered.map((p, i) => `<div class="cmd-item${i===0?' cmd-active':''}" data-page="${p.id}" onclick="goPage('${p.id}');closeCmdPalette()">
        <span class="cmd-item-icon">${p.icon}</span>
        <span class="cmd-item-label">${p.label}</span>
      </div>`).join('')
    : '<div class="cmd-empty">Ничего не найдено</div>';
}
function cmdKeyDown(e) {
  const items = document.querySelectorAll('#cmdList .cmd-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    items[_cmdActive]?.classList.remove('cmd-active');
    _cmdActive = (_cmdActive + 1) % items.length;
    items[_cmdActive]?.classList.add('cmd-active');
    items[_cmdActive]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    items[_cmdActive]?.classList.remove('cmd-active');
    _cmdActive = (_cmdActive - 1 + items.length) % items.length;
    items[_cmdActive]?.classList.add('cmd-active');
    items[_cmdActive]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const active = document.querySelector('#cmdList .cmd-item.cmd-active');
    if (active) { goPage(active.dataset.page); closeCmdPalette(); }
  } else if (e.key === 'Escape') {
    closeCmdPalette();
  }
}
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openCmdPalette(); }
});

/* ═══════════════════════════════════════════════════════════════════
   QUOTE OF THE DAY
   ═══════════════════════════════════════════════════════════════════ */
const QOTD_LIST = [
  { text: 'Лучший способ предсказать будущее — его создать.', author: 'Питер Друкер' },
  { text: 'Любой дурак может написать код, понятный компьютеру. Хороший программист пишет код, понятный человеку.', author: 'Мартин Фаулер' },
  { text: 'Сначала решите проблему, а потом пишите код.', author: 'Джон Джонсон' },
  { text: 'Хакатон — это марафон для мозга. Побеждает тот, кто дойдёт, а не тот, кто самый быстрый.', author: 'Хакатон-мудрость' },
  { text: 'Простота — это предпосылка надёжности.', author: 'Эдсгер Дейкстра' },
  { text: 'Не оптимизируй преждевременно. Сначала заставь работать, потом — быстро.', author: 'Дональд Кнут' },
  { text: 'Команда без цели — толпа. Команда с целью — сила.', author: 'Хакатон-мудрость' },
  { text: 'Ошибки — это данные. Неудача — это информация.', author: 'AkylTeam' },
  { text: '48 часов на хакатоне равны 2 неделям обычной разработки. Это не про скорость — про фокус.', author: 'AkylTeam' },
  { text: 'MVP — минимально жизнеспособный продукт. Но он должен быть жизнеспособным!', author: 'Eric Ries' },
  { text: 'Идея без исполнения — просто мечта.', author: 'Thomas Edison (перефраз)' },
  { text: 'Не бойся провалиться. Бойся не попробовать.', author: 'Хакатон-мудрость' },
  { text: 'Git commit early, git commit often.', author: 'Традиция разработчиков' },
  { text: 'Ваш pitch — это продукт. Сделайте его таким же хорошим, как ваш код.', author: 'Startup-мудрость' },
  { text: 'Данные побеждают мнения.', author: 'Jim Barksdale' },
  { text: 'Функция должна делать одну вещь и делать её хорошо.', author: 'Философия Unix' },
  { text: 'Лучший код — код, который не нужно писать.', author: 'Разработческий Дзен' },
  { text: 'Судьба хакатона решается не в финале, а в первый час — когда выбираешь идею.', author: 'AkylTeam' },
  { text: 'AI не заменит программистов. AI-программисты заменят обычных программистов.', author: 'GitHub Copilot era' },
  { text: 'Командная синергия важнее индивидуального гения.', author: 'Agile-мудрость' },
  { text: 'Рефакторинг — не роскошь, а гигиена кода.', author: 'Мартин Фаулер' },
  { text: 'Пользователь не думает. Пользователь кликает. Делай интерфейс очевидным.', author: 'Steve Krug' },
  { text: 'Каждый великий разработчик начинал с: Hello, World.', author: 'Традиция программирования' },
  { text: 'Без тестов нет рабочего приложения — только приложение, которое пока не падало.', author: 'Тестировщики-мудрецы' },
  { text: 'Хороший дизайн решает проблему. Плохой создаёт новую.', author: 'Dieter Rams' },
  { text: 'Документируй сегодня — поблагодари себя завтра.', author: 'Дев-мудрость' },
  { text: 'Лучший проект — тот, который решает реальную проблему.', author: 'Y Combinator' },
  { text: 'Напиши работающий код за выходные — ты способен на большее, чем думаешь.', author: 'AkylTeam' },
  { text: 'AkylTeam: платформа, созданная хакатонщиками — для хакатонщиков.', author: 'AkylTeam Team' },
  { text: 'Если ты единственный, кто понимает свой код — это плохой код.', author: 'Дев-мудрость' },
];
function renderQuoteOfDay() {
  const textEl   = document.getElementById('qotdText');
  const authorEl = document.getElementById('qotdAuthor');
  if (!textEl) return;
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const q = QOTD_LIST[dayOfYear % QOTD_LIST.length];
  textEl.textContent   = `"${q.text}"`;
  if (authorEl) authorEl.textContent = `— ${q.author}`;
}

/* ═══════════════════════════════════════════════════════════════════
   PROJECT AI PLANNER
   ═══════════════════════════════════════════════════════════════════ */
let _activeRoadmapId = null;
let _selectedProjType = 'personal';

function _projGetUser() {
  try { return JSON.parse(localStorage.getItem('akyl_user') || 'null'); } catch { return null; }
}

function selectProjType(btn) {
  document.querySelectorAll('.proj-type-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _selectedProjType = btn.dataset.type;
}

async function generateRoadmap() {
  const title = document.getElementById('projTitle').value.trim();
  const desc  = document.getElementById('projDesc').value.trim();
  const tech  = document.getElementById('projTech').value.trim();
  const days  = parseInt(document.getElementById('projDays').value) || 30;

  if (!title) { alert('Введи название проекта'); return; }
  if (!desc)  { alert('Введи описание / цель проекта'); return; }

  const btn = document.getElementById('projGenBtn');
  btn.textContent = '⏳ AI генерирует план...';
  btn.disabled = true;

  const techStack = tech ? tech.split(',').map(s => s.trim()).filter(Boolean) : [];
  const user = _projGetUser();

  try {
    const res = await fetch('/api/project/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title, description: desc,
        project_type: _selectedProjType,
        tech_stack: techStack,
        timeline_days: days,
        language: 'ru',
        user_id: user?.id || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Ошибка');

    _activeRoadmapId = data.id;
    _renderRoadmap(data);
    loadRoadmapList();

    // Award notification
    _pushNotif('🗺️', `План "${data.title}" создан — ${data.total_steps} шагов!`);
  } catch (e) {
    alert('Ошибка: ' + e.message);
  } finally {
    btn.textContent = '🤖 Сгенерировать план проекта';
    btn.disabled = false;
  }
}

function _renderRoadmap(data) {
  const wrap  = document.getElementById('projRoadmapWrap');
  const title = document.getElementById('projRoadmapTitle');
  const badge = document.getElementById('projRoadmapBadge');

  const typeLabels = { hackathon: '🏆 Хакатон', olympiad: '📐 Олимпиада', personal: '💻 Личный', work: '💼 Работа' };
  title.textContent = data.title;
  badge.textContent = typeLabels[data.project_type] || data.project_type;

  _updateRoadmapProgress(data.done_steps || 0, data.total_steps || 0);
  _renderSteps(data.steps || [], data.id);
  wrap.style.display = 'block';
  wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _updateRoadmapProgress(done, total) {
  const pct = total ? Math.round(done / total * 100) : 0;
  document.getElementById('projProgressText').textContent = `${done} / ${total} шагов`;
  document.getElementById('projProgressFill').style.width = pct + '%';
}

function _renderSteps(steps, roadmapId) {
  const list = document.getElementById('projStepsList');
  if (!steps.length) { list.innerHTML = '<p style="color:var(--text-dim);text-align:center;">Шаги не найдены</p>'; return; }

  list.innerHTML = steps.map((step, idx) => {
    const isDone = step.status === 'done';
    const timeTag = step.estimated_hours ? `<span class="proj-step-time">⏱ ${step.estimated_hours} ч.</span>` : '';
    const resLinks = (step.resources || []).filter(r => r && r.length > 3).slice(0, 3).map(r => {
      const href = r.startsWith('http') ? r : '#';
      const label = r.startsWith('http') ? new URL(r).hostname : r;
      return `<a class="proj-step-res-link" href="${href}" target="_blank" rel="noopener">${label}</a>`;
    }).join('');

    return `<div class="proj-step${isDone ? ' done' : ''}" id="proj-step-${idx}">
      <div class="proj-step-num" onclick="toggleStep(${roadmapId}, ${idx})" title="${isDone ? 'Отметить невыполненным' : 'Отметить выполненным'}">
        ${isDone ? '✓' : idx + 1}
      </div>
      <div class="proj-step-body">
        <div class="proj-step-title">${step.title}</div>
        ${step.description ? `<div class="proj-step-desc">${step.description}</div>` : ''}
        <div class="proj-step-meta">
          ${timeTag}
          <div class="proj-step-resources">${resLinks}</div>
          <button class="proj-hint-btn" data-title="${step.title.replace(/"/g, '&quot;')}" onclick="openStepHint(${roadmapId}, ${idx}, this.dataset.title)">💡 Подсказка AI</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function toggleStep(roadmapId, stepIdx) {
  const el = document.getElementById(`proj-step-${stepIdx}`);
  const wasDone = el.classList.contains('done');
  const user = _projGetUser();

  try {
    const res = await fetch(`/api/project/${roadmapId}/step/${stepIdx}?user_id=${user?.id || ''}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !wasDone }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail);

    // Reload roadmap to get fresh steps
    const rmRes = await fetch(`/api/project/${roadmapId}`);
    const rm = await rmRes.json();
    _renderSteps(rm.steps, roadmapId);
    _updateRoadmapProgress(rm.done_steps, rm.total_steps);

    if (!wasDone) _pushNotif('✅', `Шаг выполнен! +15 XP`);
    if (rm.done_steps === rm.total_steps && rm.total_steps > 0) {
      _pushNotif('🏆', `Все шаги выполнены! Проект "${rm.title}" завершён!`);
    }
  } catch(e) {
    console.error('toggleStep error', e);
  }
}

async function openStepHint(roadmapId, stepIdx, stepTitle) {
  const modal = document.getElementById('projHintModal');
  document.getElementById('projHintTitle').textContent = `💡 ${stepTitle}`;
  document.getElementById('projHintBody').innerHTML = '<div class="ai-typing">⏳ AI анализирует шаг и ищет ресурсы в интернете...</div>';
  document.getElementById('projHintSources').style.display = 'none';
  modal.style.display = 'flex';

  try {
    const res = await fetch(`/api/project/${roadmapId}/hint/${stepIdx}?language=ru`);
    const data = await res.json();
    document.getElementById('projHintBody').textContent = data.hint || 'Подсказка недоступна';

    if (data.search && data.search.results && data.search.results.length) {
      const srcWrap = document.getElementById('projHintSources');
      const srcList = document.getElementById('projHintSourceList');
      srcList.innerHTML = data.search.results.slice(0, 4).map(r => `
        <div class="proj-source-item">
          <span class="proj-source-title">${r.title || ''}</span>
          <span class="proj-source-snippet">${(r.snippet || '').slice(0, 120)}</span>
          ${r.url ? `<a class="proj-source-url" href="${r.url}" target="_blank" rel="noopener">${r.url.slice(0, 60)}...</a>` : ''}
        </div>`).join('');
      srcWrap.style.display = 'block';
    }
  } catch(e) {
    document.getElementById('projHintBody').textContent = 'Ошибка загрузки подсказки: ' + e.message;
  }
}

async function projSearch() {
  const query = document.getElementById('projSearchInput').value.trim();
  if (!query) return;

  const btn = document.getElementById('projSearchBtn');
  const resultWrap = document.getElementById('projSearchResult');
  btn.textContent = '⏳';
  btn.disabled = true;
  resultWrap.style.display = 'block';
  resultWrap.innerHTML = '<div class="ai-typing">🔍 Ищем в интернете...</div>';

  const user = _projGetUser();
  try {
    const res = await fetch('/api/project/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, language: 'ru', user_id: user?.id || null }),
    });
    const data = await res.json();

    let html = `<div class="proj-search-answer">${(data.answer || '').replace(/\n/g, '<br>')}</div>`;
    if (data.sources && data.sources.length) {
      html += `<div class="proj-search-sources">`;
      for (const s of data.sources.slice(0, 4)) {
        html += `<div class="proj-source-item">
          <span class="proj-source-title">${s.title || ''}</span>
          <span class="proj-source-snippet">${(s.snippet || '').slice(0, 130)}</span>
          ${s.url ? `<a class="proj-source-url" href="${s.url}" target="_blank" rel="noopener">${s.url}</a>` : ''}
        </div>`;
      }
      html += '</div>';
    }
    resultWrap.innerHTML = html;
  } catch(e) {
    resultWrap.innerHTML = `<p style="color:var(--danger)">Ошибка поиска: ${e.message}</p>`;
  } finally {
    btn.textContent = 'Найти';
    btn.disabled = false;
  }
}

async function loadRoadmapList() {
  const user = _projGetUser();
  const savedWrap = document.getElementById('projSavedWrap');
  const list = document.getElementById('projSavedList');
  try {
    const url = user?.id ? `/api/project/list?user_id=${user.id}` : '/api/project/list';
    const res = await fetch(url);
    const items = await res.json();
    if (!items.length) { savedWrap.style.display = 'none'; return; }
    savedWrap.style.display = 'block';
    const typeLabels = { hackathon: '🏆', olympiad: '📐', personal: '💻', work: '💼' };
    list.innerHTML = items.map(r => `
      <div class="proj-saved-item" onclick="loadRoadmap(${r.id})">
        <span style="font-size:20px;">${typeLabels[r.project_type] || '📁'}</span>
        <span class="proj-saved-name">${r.title}</span>
        <span class="proj-saved-meta">${r.total_steps} шагов</span>
        <span class="proj-saved-pct">${r.progress_pct}%</span>
        <button class="btn btn-outline" style="font-size:11px;padding:3px 10px;"
          onclick="event.stopPropagation();deleteRoadmap(${r.id})">🗑</button>
      </div>`).join('');
  } catch(e) {
    savedWrap.style.display = 'none';
  }
}

async function loadRoadmap(id) {
  try {
    const res = await fetch(`/api/project/${id}`);
    const data = await res.json();
    _activeRoadmapId = id;
    _renderRoadmap(data);
  } catch(e) {
    alert('Ошибка загрузки: ' + e.message);
  }
}

async function deleteRoadmap(id) {
  if (!confirm('Удалить этот план?')) return;
  await fetch(`/api/project/${id}`, { method: 'DELETE' });
  if (_activeRoadmapId === id) {
    document.getElementById('projRoadmapWrap').style.display = 'none';
    _activeRoadmapId = null;
  }
  loadRoadmapList();
}

/* ═══════════════════════════════════════════════════════════════════
   PLAN TEMPLATES
   ═══════════════════════════════════════════════════════════════════ */
const _PLAN_TEMPLATES = {
  'mvp-48h':        { project_type: 'hackathon', title: 'Хакатонный MVP', description: 'Быстрая разработка минимально жизнеспособного продукта на хакатоне за 24-48 часов', tech: 'Python, FastAPI, React', days: 2 },
  'olympiad-1month':{ project_type: 'olympiad',  title: 'Подготовка к олимпиаде', description: 'Систематическое изучение алгоритмов и структур данных для участия в олимпиаде по программированию', tech: 'Python, C++', days: 30 },
  'fullstack-app':  { project_type: 'personal',  title: 'Полноценное веб-приложение', description: 'Разработка full-stack приложения с бэкендом, базой данных и фронтендом', tech: 'FastAPI, PostgreSQL, React, Docker', days: 45 },
  'ml-project':     { project_type: 'personal',  title: 'ML-проект с обучением модели', description: 'Сбор данных, обучение модели машинного обучения, создание API и деплой', tech: 'Python, scikit-learn, FastAPI, Docker', days: 30 },
  'mobile-app':     { project_type: 'personal',  title: 'Мобильное приложение', description: 'Разработка кроссплатформенного мобильного приложения от идеи до публикации', tech: 'Flutter, Firebase', days: 60 },
  'work-feature':   { project_type: 'work',      title: 'Новая функциональность', description: 'Разработка новой фичи: требования, дизайн, реализация, тестирование, деплой', tech: '', days: 14 },
};

function applyTemplate(id) {
  const t = _PLAN_TEMPLATES[id];
  if (!t) return;
  document.getElementById('projTitle').value = t.title;
  document.getElementById('projDesc').value  = t.description;
  document.getElementById('projTech').value  = t.tech;
  document.getElementById('projDays').value  = t.days;
  // Activate the right type tab
  document.querySelectorAll('.proj-type-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.type === t.project_type);
  });
  _selectedProjType = t.project_type;
  // Scroll to form
  document.getElementById('projTitle').scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('projTitle').focus();
}

async function pushRoadmapToKanban() {
  if (!_activeRoadmapId) return;
  const btn = document.getElementById('pushKanbanBtn');
  btn.textContent = '⏳ Добавляю...';
  btn.disabled = true;
  const user = _projGetUser();
  try {
    const url = `/api/project/${_activeRoadmapId}/push-to-kanban?user_id=${user?.id || ''}&team_id=`;
    const res = await fetch(url, { method: 'POST' });
    const data = await res.json();
    btn.textContent = `✅ +${data.pushed} задач в Kanban`;
    _pushNotif('📋', `${data.pushed} задач добавлено в Kanban из плана!`);
    setTimeout(() => { btn.textContent = '📋 Добавить в Kanban'; btn.disabled = false; }, 3000);
  } catch(e) {
    btn.textContent = '📋 Добавить в Kanban';
    btn.disabled = false;
    alert('Ошибка: ' + e.message);
  }
}

/* ═══════════════════════════════════════════════════════════════════
   OLYMPIAD MODULE
   ═══════════════════════════════════════════════════════════════════ */
let _olymTopics = null;
let _olymActiveTopic = null;
let _olymLevel = 'beginner';

function selectOlymLevel(btn) {
  document.querySelectorAll('#olymLevelTabs .proj-type-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _olymLevel = btn.dataset.level;
}

async function initOlymPage() {
  if (_olymTopics) { _renderOlymTopics(); return; }
  const grid = document.getElementById('olymTopicGrid');
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:30px;color:var(--text-dim);">⏳ Загрузка тем...</div>';
  try {
    const res = await fetch('/api/olympiad/topics');
    const data = await res.json();
    _olymTopics = data.categories;
    _renderOlymTopics();
  } catch(e) {
    grid.innerHTML = '<div style="grid-column:1/-1;color:var(--danger)">Ошибка загрузки тем</div>';
  }
}

function _renderOlymTopics() {
  const grid = document.getElementById('olymTopicGrid');
  if (!_olymTopics) return;
  let html = '';
  for (const [cat, topics] of Object.entries(_olymTopics)) {
    html += `<div class="olym-cat-label">${cat}</div>`;
    for (const t of topics) {
      html += `<div class="olym-topic-card" data-id="${t.id}" data-name="${t.name.replace(/"/g, '&quot;')}" onclick="openOlymTopic(this.dataset.id, this.dataset.name)">
        <span class="olym-topic-icon">${t.icon}</span>
        <span class="olym-topic-name">${t.name}</span>
        <span class="olym-topic-desc">${t.desc}</span>
        <span class="olym-topic-badge">${cat}</span>
      </div>`;
    }
  }
  grid.innerHTML = html;
}

function openOlymTopic(topicId, topicName) {
  _olymActiveTopic = topicId;
  document.getElementById('olymModalTitle').textContent = `📚 ${topicName}`;
  document.getElementById('olymModalBody').innerHTML = `<div class="olym-placeholder">
    <div style="font-size:48px;margin-bottom:8px;">📐</div>
    <p style="color:var(--text-dim);">Нажми «Объяснить» или выбери уровень сложности задачи</p>
  </div>`;
  document.getElementById('olymTopicModal').style.display = 'flex';
}

async function olymExplain() {
  if (!_olymActiveTopic) return;
  const body = document.getElementById('olymModalBody');
  body.innerHTML = '<div class="ai-typing">🧠 AI изучает тему и готовит объяснение...</div>';
  const withCode = document.getElementById('olymWithCode')?.checked ?? true;
  try {
    const res = await fetch('/api/olympiad/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_id: _olymActiveTopic, level: _olymLevel, language: 'ru', with_code: withCode }),
    });
    const data = await res.json();
    body.innerHTML = `<div class="olym-solve-result">${(data.explanation || '').replace(/\n/g, '<br>').replace(/##\s(.+)/g, '<h3 style="margin:14px 0 6px;font-size:15px;">$1</h3>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div>`;
  } catch(e) {
    body.innerHTML = `<p style="color:var(--danger)">Ошибка: ${e.message}</p>`;
  }
}

async function olymGenerateProblem(difficulty) {
  if (!_olymActiveTopic) return;
  const body = document.getElementById('olymModalBody');
  const diffLabel = { easy: '🟢 Лёгкая', medium: '🟡 Средняя', hard: '🔴 Сложная' }[difficulty] || '';
  body.innerHTML = `<div class="ai-typing">📝 AI генерирует ${diffLabel} задачу...</div>`;
  try {
    const res = await fetch('/api/olympiad/generate-problem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic_id: _olymActiveTopic, difficulty, language: 'ru' }),
    });
    const data = await res.json();
    body.innerHTML = `<div class="olym-solve-result">${(data.problem || '').replace(/\n/g, '<br>').replace(/##\s(.+)/g, '<h3 style="margin:14px 0 6px;font-size:15px;">$1</h3>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')}</div>`;
  } catch(e) {
    body.innerHTML = `<p style="color:var(--danger)">Ошибка: ${e.message}</p>`;
  }
}

async function olymSolveProblem(hintLevel) {
  const problem = document.getElementById('olymUserProblem').value.trim();
  if (!problem) { alert('Вставь условие задачи!'); return; }
  const result = document.getElementById('olymSolveResult');
  result.style.display = 'block';
  result.innerHTML = '<div class="ai-typing">🤖 AI анализирует задачу и ищет подходы...</div>';
  try {
    const res = await fetch('/api/olympiad/solve-hint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem, language: 'ru', hint_level: hintLevel }),
    });
    const data = await res.json();
    const text = (data.response || '').replace(/\n/g, '<br>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    result.innerHTML = `<div class="olym-solve-result">${text}</div>`;
    if (data.search && data.search.length) {
      result.innerHTML += '<p style="font-size:12px;color:var(--text-dim);margin-top:10px;">🔍 Найдено в интернете:</p>';
      result.innerHTML += data.search.slice(0, 3).map(s => `
        <div class="proj-source-item">
          <span class="proj-source-title">${s.title||''}</span>
          <span class="proj-source-snippet">${(s.snippet||'').slice(0,120)}</span>
          ${s.url ? `<a class="proj-source-url" href="${s.url}" target="_blank" rel="noopener">${s.url.slice(0,60)}</a>` : ''}
        </div>`).join('');
    }
  } catch(e) {
    result.innerHTML = `<p style="color:var(--danger)">Ошибка: ${e.message}</p>`;
  }
}

/* ═══════════════════════════════════════════════════════════════════
   APP STARTUP (runs after all scripts loaded)
   ═══════════════════════════════════════════════════════════════════ */
(function appStartup() {
  loadDailyChallenge();
  _renderPomodoro();
  renderQuoteOfDay();
  renderNotifs();
  _checkAutoNotifs();
  // Restore countdown if saved
  const saved = localStorage.getItem('akyl_countdown');
  if (saved) {
    try {
      const { name, date } = JSON.parse(saved);
      const nameEl = document.getElementById('cdwNameInput');
      const dateEl = document.getElementById('cdwDate');
      if (nameEl) nameEl.value = name;
      if (dateEl) dateEl.value = date;
    } catch (_) {}
  }
  // Close notif panel on outside click
  document.addEventListener('click', e => {
    const wrap = document.getElementById('notifWrap');
    if (wrap && !wrap.contains(e.target)) {
      document.getElementById('notifPanel')?.classList.remove('open');
    }
  });
  // Hackathon deadline countdowns
  function _hackDeadline(isoDate, valElId) {
    const el = document.getElementById(valElId);
    if (!el) return;
    function tick() {
      const diff = new Date(isoDate + 'T23:59:59+05:00') - Date.now();
      if (diff <= 0) { el.textContent = '🔴 Дедлайн прошёл'; return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      el.textContent = d > 0 ? `${d} дн. ${h} ч. ${m} мин.` : `${h} ч. ${m} мин.`;
    }
    tick();
    setInterval(tick, 60000);
  }
  _hackDeadline('2026-02-22', 'mhd-alem-val');
  _hackDeadline('2026-02-24', 'mhd-nb-val');
  _hackDeadline('2026-03-26', 'mhd-cc-val');
})();


/* ═══════════════════════════════════════════════════════════════════
   README GENERATOR
   ═══════════════════════════════════════════════════════════════════ */
let _rmLang = 'ru';
let _rmReadme = '';
let _rmShowRaw = false;

function rmSetLang(lang) {
  _rmLang = lang;
  document.querySelectorAll('.rm-lang-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.lang === lang));
}

async function generateReadme() {
  const name = document.getElementById('rmProjectName')?.value.trim() || '';
  const desc = document.getElementById('rmDescription')?.value.trim() || '';
  if (!name || !desc) { showToast('Введи название и описание', 'error'); return; }
  const tech  = document.getElementById('rmTechStack')?.value.split(',').map(s => s.trim()).filter(Boolean) || [];
  const feats = document.getElementById('rmFeatures')?.value.split('\n').map(s => s.trim()).filter(Boolean) || [];
  const team  = document.getElementById('rmTeamMembers')?.value.split(',').map(s => s.trim()).filter(Boolean) || [];
  const type  = document.getElementById('rmProjectType')?.value || 'hackathon';
  const github = document.getElementById('rmGithubUrl')?.value.trim() || '';
  const demo   = document.getElementById('rmDemoUrl')?.value.trim()   || '';

  showLoader('🤖 AI пишет README...');
  try {
    const res = await fetch('/api/readme/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_name: name, description: desc, tech_stack: tech,
        features: feats, team_members: team, language: _rmLang, project_type: type,
        github_url: github, demo_url: demo }),
    });
    const data = await res.json();
    _rmReadme = data.readme || '';
    _rmShowRaw = false;
    const preview = document.getElementById('rmPreview');
    const raw     = document.getElementById('rmRaw');
    if (preview) { preview.innerHTML = marked.parse(_rmReadme); preview.style.display = 'block'; }
    if (raw)     { raw.value = _rmReadme; raw.style.display = 'none'; }
    document.getElementById('rmViewBtn').textContent = '🔡 Raw';
    showToast('✅ README сгенерирован!', 'success');
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

function rmToggleView() {
  _rmShowRaw = !_rmShowRaw;
  const preview = document.getElementById('rmPreview');
  const raw     = document.getElementById('rmRaw');
  if (preview) preview.style.display = _rmShowRaw ? 'none'  : 'block';
  if (raw)     raw.style.display     = _rmShowRaw ? 'block' : 'none';
  document.getElementById('rmViewBtn').textContent = _rmShowRaw ? '👁️ Preview' : '🔡 Raw';
}

function rmCopy() {
  if (!_rmReadme) { showToast('Сначала сгенерируй README', 'error'); return; }
  navigator.clipboard.writeText(_rmReadme).then(() => showToast('📋 Скопировано!', 'success'));
}

function rmDownload() {
  if (!_rmReadme) { showToast('Сначала сгенерируй README', 'error'); return; }
  const blob = new Blob([_rmReadme], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'README.md';
  a.click();
  showToast('⬇️ README.md скачан', 'success');
}


/* ═══════════════════════════════════════════════════════════════════
   CODESPACE — Monaco Editor + AI + Piston Runner
   ═══════════════════════════════════════════════════════════════════ */
let _csMonaco = null;
let _csLangId = 'python';
let _csMonacoLoaded = false;

function initCodeSpace() {
  if (_csMonacoLoaded) return;
  _csMonacoLoaded = true;

  if (typeof require === 'undefined') {
    // No requirejs — fallback textarea
    document.getElementById('csMonacoEditor').style.display = 'none';
    document.getElementById('csFallbackEditor').style.display = 'block';
    document.getElementById('csFallbackEditor').value = '# Напиши свой код здесь\nprint("Hello, AkylTeam!")';
    return;
  }

  require.config({
    paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.50.0/min/vs' },
  });
  require(['vs/editor/editor.main'], function () {
    const container = document.getElementById('csMonacoEditor');
    if (!container) return;
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    _csMonaco = monaco.editor.create(container, {
      value: '# Напиши свой код здесь\nprint("Hello, AkylTeam!")',
      language: 'python',
      theme: isDark ? 'vs-dark' : 'vs',
      fontSize: 13,
      minimap: { enabled: false },
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      automaticLayout: true,
    });
    _csMonaco.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, csRunCode);
    document.getElementById('csFallbackEditor').style.display = 'none';
  }, function (err) {
    console.warn('Monaco failed to load:', err);
    document.getElementById('csMonacoEditor').style.display = 'none';
    document.getElementById('csFallbackEditor').style.display = 'block';
    document.getElementById('csFallbackEditor').value = '# Редактор\nprint("Hello!")';
  });
}

function csGetCode() {
  if (_csMonaco) return _csMonaco.getValue();
  return document.getElementById('csFallbackEditor')?.value || '';
}
function csSetCode(code) {
  if (_csMonaco) _csMonaco.setValue(code);
  else if (document.getElementById('csFallbackEditor')) document.getElementById('csFallbackEditor').value = code;
}
function csLangChanged() {
  _csLangId = document.getElementById('csLang')?.value || 'python';
  if (_csMonaco && typeof monaco !== 'undefined') {
    const model = _csMonaco.getModel();
    if (model) monaco.editor.setModelLanguage(model, _csLangId === 'cpp' ? 'cpp' : _csLangId);
  }
}

async function csRunCode() {
  const code  = csGetCode();
  const stdin = document.getElementById('csStdin')?.value || '';
  const out   = document.getElementById('csOutput');
  if (out) { out.textContent = '⏳ Запускаю...'; out.style.color = 'var(--text-dim)'; }
  try {
    const res  = await fetch('/api/codespace/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language: _csLangId, stdin }),
    });
    const data = await res.json();
    if (!out) return;
    if (data.success) {
      out.textContent = data.output || '(нет вывода)';
      out.style.color = 'var(--text)';
    } else {
      out.textContent = data.stderr || data.output || 'Ошибка выполнения';
      out.style.color = '#f87171';
    }
  } catch (e) {
    if (out) { out.textContent = 'Ошибка: ' + e.message; out.style.color = '#f87171'; }
  }
}

async function csAiComplete() {
  const code     = csGetCode();
  const prompt   = document.getElementById('csPrompt')?.value.trim() || '';
  const aiOut    = document.getElementById('csAiOutput');
  const lang     = (typeof currentLang !== 'undefined') ? currentLang : 'ru';
  if (aiOut) aiOut.innerHTML = '<span style="color:var(--text-dim)">⏳ AI думает...</span>';
  try {
    const res  = await fetch('/api/codespace/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language: _csLangId, prompt, ui_language: lang }),
    });
    const data = await res.json();
    if (!aiOut) return;
    aiOut.innerHTML = marked.parse(data.result || '');
    // Offer to inject first code block into editor
    const codeMatch = (data.result || '').match(/```[\w]*\n([\s\S]*?)```/);
    if (codeMatch && prompt) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-primary btn-sm';
      btn.style.marginTop = '8px';
      btn.textContent = '⬆️ Вставить в редактор';
      btn.onclick = () => { csSetCode(codeMatch[1]); showToast('Код вставлен!', 'success'); btn.remove(); };
      aiOut.appendChild(btn);
    }
  } catch (e) { if (aiOut) aiOut.textContent = 'Ошибка: ' + e.message; }
}

async function csAiExplain() {
  const code  = csGetCode();
  const aiOut = document.getElementById('csAiOutput');
  const lang  = (typeof currentLang !== 'undefined') ? currentLang : 'ru';
  if (aiOut) aiOut.innerHTML = '<span style="color:var(--text-dim)">⏳ AI анализирует...</span>';
  try {
    const res  = await fetch('/api/codespace/explain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language: _csLangId, ui_language: lang }),
    });
    const data = await res.json();
    if (aiOut) aiOut.innerHTML = marked.parse(data.explanation || '');
  } catch (e) { if (aiOut) aiOut.textContent = 'Ошибка: ' + e.message; }
}

async function csAiFormat() {
  const code = csGetCode();
  const lang = (typeof currentLang !== 'undefined') ? currentLang : 'ru';
  const aiOut = document.getElementById('csAiOutput');
  if (aiOut) aiOut.innerHTML = '<span style="color:var(--text-dim)">⏳ Форматирую...</span>';
  try {
    const res  = await fetch('/api/codespace/complete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, language: _csLangId,
        prompt: 'Format and clean up this code following best practices. Return ONLY the formatted code, nothing else.',
        ui_language: lang }),
    });
    const data = await res.json();
    const match = (data.result || '').match(/```[\w]*\n([\s\S]*?)```/);
    if (match) {
      csSetCode(match[1]);
      if (aiOut) aiOut.textContent = '✅ Код отформатирован!';
      showToast('✅ Код отформатирован', 'success');
    } else {
      if (aiOut) aiOut.innerHTML = marked.parse(data.result || '');
    }
  } catch (e) { if (aiOut) aiOut.textContent = 'Ошибка: ' + e.message; }
}

function csClearOutput() {
  const out   = document.getElementById('csOutput');
  const aiOut = document.getElementById('csAiOutput');
  if (out)   { out.textContent = 'Нажми ▶ Запустить чтобы увидеть результат'; out.style.color = 'var(--text)'; }
  if (aiOut) aiOut.textContent = 'AI-ответ появится здесь';
}


/* ═══════════════════════════════════════════════════════════════════
   PROJECT SPACE — Visual Sticky-Note Board
   ═══════════════════════════════════════════════════════════════════ */
let _psNotes   = [];
let _psDragId  = null;
let _psDragOX  = 0;
let _psDragOY  = 0;
const PS_TYPES = {
  note:    { icon: '📝', cls: 'pnote-note',    label: 'Заметка'  },
  idea:    { icon: '💡', cls: 'pnote-idea',    label: 'Идея'     },
  task:    { icon: '✅', cls: 'pnote-task',    label: 'Задача'   },
  warning: { icon: '⚠️', cls: 'pnote-warning', label: 'Риск'     },
};

function initProjectSpace() {
  const board = document.getElementById('psBoard');
  if (!board || board._psInited) return;
  board._psInited = true;

  const saved = localStorage.getItem('pspace_notes');
  if (saved) {
    try { _psNotes = JSON.parse(saved); _psNotes.forEach(_psRenderNote); } catch (_) { _psNotes = []; }
  }

  board.addEventListener('mousemove', _psBoardMove);
  board.addEventListener('mouseup',   _psBoardUp);
  _psHint();
}

function psAddNote(type = 'note') {
  const note = { id: Date.now(), type, text: PS_TYPES[type]?.label || 'Заметка',
    x: 60 + Math.random() * 300, y: 60 + Math.random() * 200, w: 190 };
  _psNotes.push(note);
  _psRenderNote(note);
  _psSave();
  _psHint();
}

function _psRenderNote(note) {
  const board = document.getElementById('psBoard');
  if (!board) return;
  const t = PS_TYPES[note.type] || PS_TYPES.note;
  const el = document.createElement('div');
  el.className = `pspace-note ${t.cls}`;
  el.id = `psnote-${note.id}`;
  el.style.cssText = `left:${note.x}px;top:${note.y}px;width:${note.w}px;`;
  el.innerHTML = `<div class="pspace-note-header" style="cursor:move;">
    <span class="pspace-note-type">${t.icon}</span>
    <span class="pspace-note-del" onclick="psDeleteNote(${note.id})">✕</span>
  </div>
  <div contenteditable="true" class="pspace-note-content"
       oninput="_psTextChange(${note.id},this)"
       style="min-height:60px;outline:none;">${note.text}</div>`;
  el.querySelector('.pspace-note-header').addEventListener('mousedown', ev => {
    if (ev.target.classList.contains('pspace-note-del')) return;
    _psDragId = note.id;
    const r = el.getBoundingClientRect();
    _psDragOX = ev.clientX - r.left;
    _psDragOY = ev.clientY - r.top;
    el.style.zIndex = 999;
    ev.preventDefault();
  });
  board.appendChild(el);
  document.getElementById('psEmptyHint')?.remove();
}

function _psBoardMove(ev) {
  if (!_psDragId) return;
  const board = document.getElementById('psBoard');
  const wrap  = board.parentElement;
  const rect  = board.getBoundingClientRect();
  const x = Math.max(0, ev.clientX - rect.left + wrap.scrollLeft - _psDragOX);
  const y = Math.max(0, ev.clientY - rect.top  + wrap.scrollTop  - _psDragOY);
  const el = document.getElementById(`psnote-${_psDragId}`);
  if (el) { el.style.left = x + 'px'; el.style.top = y + 'px'; }
  const note = _psNotes.find(n => n.id === _psDragId);
  if (note) { note.x = x; note.y = y; }
}

function _psBoardUp() {
  if (_psDragId) {
    const el = document.getElementById(`psnote-${_psDragId}`);
    if (el) el.style.zIndex = '';
    _psDragId = null;
    _psSave();
  }
}

function _psTextChange(id, el) {
  const note = _psNotes.find(n => n.id === id);
  if (note) note.text = el.textContent;
  clearTimeout(el._st);
  el._st = setTimeout(_psSave, 800);
}

function psDeleteNote(id) {
  _psNotes = _psNotes.filter(n => n.id !== id);
  document.getElementById(`psnote-${id}`)?.remove();
  _psHint();
  _psSave();
}

function _psSave() {
  localStorage.setItem('pspace_notes', JSON.stringify(_psNotes));
}

function _psHint() {
  const board = document.getElementById('psBoard');
  if (!board) return;
  if (_psNotes.length === 0 && !document.getElementById('psEmptyHint')) {
    const h = document.createElement('div');
    h.className = 'pspace-empty-hint'; h.id = 'psEmptyHint';
    h.innerHTML = '<div style="font-size:48px">🗂️</div><p style="color:var(--text-dim);margin-top:8px">Нажми «➕ Стикер» чтобы добавить первую карточку</p>';
    board.appendChild(h);
  } else if (_psNotes.length > 0) {
    document.getElementById('psEmptyHint')?.remove();
  }
}

function psClearBoard() {
  if (!confirm('Очистить всю доску?')) return;
  _psNotes = [];
  const board = document.getElementById('psBoard');
  if (board) {
    board.querySelectorAll('.pspace-note').forEach(el => el.remove());
    board._psInited = false;
    _psHint();
    board._psInited = true;
  }
  _psSave();
}

async function psAskAI() {
  const ctx  = document.getElementById('psContext')?.value.trim() || '';
  if (!ctx) { showToast('Введи тему или описание хакатона', 'error'); document.getElementById('psContext')?.focus(); return; }
  const lang = (typeof currentLang !== 'undefined') ? currentLang : 'ru';
  showLoader('🤖 AI генерирует идеи...');
  try {
    const res = await fetch('/api/personal-chat/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Мозговой штурм для: "${ctx}". Дай 6-8 конкретных идей, функций или рисков хакатонного проекта. Каждая идея — одно короткое предложение, на новой строке.`,
        language: lang, mode: 'assistant',
      }),
    });
    const data = await res.json();
    const text  = data.response || data.content || '';
    const lines = text.split('\n').filter(l => l.trim() && l.trim().length > 5).slice(0, 8);
    const types = ['idea','idea','task','note','warning','idea','task','note'];
    lines.forEach((line, i) => {
      const clean = line.replace(/^[\d\.\-\*•]+\s*/, '').trim();
      const note  = {
        id: Date.now() + i, type: types[i] || 'idea', text: clean,
        x: 60 + (i % 3) * 230, y: 40 + Math.floor(i / 3) * 200, w: 200,
      };
      _psNotes.push(note);
      _psRenderNote(note);
    });
    _psSave();
    showToast(`✅ ${lines.length} идей добавлено на доску!`, 'success');
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

function psExportPNG() {
  showToast('Используй Ctrl+Shift+S (ShareX) или Win+Shift+S для скриншота', 'info');
}


/* ═══════════════════════════════════════════════════════════════════
   KANBAN — Real-time WebSocket Sync
   ═══════════════════════════════════════════════════════════════════ */
let _kanbanWS     = null;
let _kanbanWSRoom = null;
let _kanbanWSPing = null;

function initKanbanWS(roomId) {
  if (_kanbanWS && _kanbanWSRoom === roomId && _kanbanWS.readyState < 2) return;
  if (_kanbanWS) { _kanbanWS.close(); _kanbanWS = null; }
  if (_kanbanWSPing) { clearInterval(_kanbanWSPing); _kanbanWSPing = null; }

  _kanbanWSRoom = roomId;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  _kanbanWS = new WebSocket(`${proto}://${location.host}/api/kanban/ws/${roomId}`);

  _kanbanWS.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'pong') return;
      const isVisible = document.getElementById('page-kanban')?.classList.contains('active');
      if (isVisible) initKanbanPage();
      if (msg.type !== 'pong') showToast('🔄 Канбан обновлён', 'info');
    } catch (_) {}
  };

  _kanbanWS.onclose = () => {
    _kanbanWS = null;
    setTimeout(() => { if (_kanbanWSRoom) initKanbanWS(_kanbanWSRoom); }, 5000);
  };

  _kanbanWSPing = setInterval(() => {
    if (_kanbanWS?.readyState === WebSocket.OPEN) {
      _kanbanWS.send(JSON.stringify({ type: 'ping' }));
    }
  }, 25000);
}


/* ═══════════════════════════════════════════════════════════════════
   PDF EXPORT
   ═══════════════════════════════════════════════════════════════════ */
function exportRoadmapPDF() {
  const title = document.getElementById('projRoadmapTitle')?.textContent || 'Roadmap';
  const stepEls = document.querySelectorAll('#projStepsList .proj-step');
  if (!stepEls.length) { showToast('Нет шагов для экспорта', 'error'); return; }

  if (!window.jspdf) { showToast('jsPDF не загружен', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

  let y = 20;
  doc.setFontSize(18);
  doc.setFont(undefined, 'bold');
  doc.text(title, 15, y); y += 12;

  stepEls.forEach((step, i) => {
    const stepTitle = step.querySelector('.proj-step-title')?.textContent?.trim() || '';
    const stepDesc  = step.querySelector('.proj-step-desc')?.textContent?.trim()  || '';
    if (y > 265) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    const titleLines = doc.splitTextToSize(`${i + 1}. ${stepTitle}`, 175);
    doc.text(titleLines, 15, y); y += titleLines.length * 6;
    if (stepDesc) {
      doc.setFont(undefined, 'normal');
      doc.setFontSize(10);
      const descLines = doc.splitTextToSize(stepDesc, 170);
      doc.text(descLines, 20, y); y += descLines.length * 5 + 4;
    }
  });

  doc.save(`${title.replace(/[^\w\s]/g, '').trim().replace(/\s+/g, '_')}_roadmap.pdf`);
  showToast('⬇️ PDF скачан!', 'success');
}

function exportKanbanPDF() {
  if (!window.jspdf) { showToast('jsPDF не загружен', 'error'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'l', unit: 'mm', format: 'a4' });

  const COLS   = ['backlog','todo','doing','review','done'];
  const LABELS = ['📥 Backlog','📋 To Do','⚙️ In Progress','🔍 Review','✅ Done'];
  const colW = 53;

  doc.setFontSize(16); doc.setFont(undefined, 'bold');
  doc.text('Kanban Board', 15, 14);
  doc.setFont(undefined, 'normal');

  COLS.forEach((col, i) => {
    const x = 15 + i * colW;
    doc.setFontSize(11); doc.setFont(undefined, 'bold');
    doc.text(LABELS[i], x, 25);
    doc.setFont(undefined, 'normal'); doc.setFontSize(9);
    let ty = 33;
    (_kanbanTasks || []).filter(t => t.status === col).forEach(t => {
      const lines = doc.splitTextToSize(`• ${t.title}`, colW - 5);
      doc.text(lines, x, ty); ty += lines.length * 4.5 + 2;
    });
  });

  doc.save('kanban_board.pdf');
  showToast('⬇️ Канбан PDF скачан!', 'success');
}


/* ═══════════════════════════════════════════════════════════════════
   SHARE LINKS — Project Roadmap
   ═══════════════════════════════════════════════════════════════════ */
async function shareRoadmap() {
  const id = (typeof _activeRoadmapId !== 'undefined') ? _activeRoadmapId : null;
  if (!id) { showToast('Нет открытого плана для публикации', 'error'); return; }
  showLoader('Создаю ссылку...');
  try {
    const res  = await fetch(`/api/project/${id}/share`, { method: 'POST' });
    const data = await res.json();
    const url  = `${location.origin}/api/project/share/${data.share_token}`;
    navigator.clipboard.writeText(url)
      .then(() => showToast('🔗 Ссылка скопирована в буфер! Поделись с командой.', 'success'))
      .catch(() => { prompt('Скопируй ссылку для шаринга:', url); });
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  } finally {
    hideLoader();
  }
}

/* ═══════════════════════════════════════════════════════════════════
   SMART NOTES MODULE
   ═══════════════════════════════════════════════════════════════════ */

let _mediaStream = null;
let _mediaRecorder = null;
let _photoData = null;

// Initialize notes page
async function loadSmartNotes() {
  try {
    const response = await fetch('/api/notes/list');
    if (!response.ok) throw new Error('Failed to load notes');
    const notes = await response.json();
    
    // Render recent notes in #notesRecentList
    const recentList = document.getElementById('notesRecentList');
    if (recentList && notes.length) {
      recentList.innerHTML = notes.slice(0, 5).map(n => `
        <div class="note-preview-card" onclick="loadNoteDetail(${n.id})">
          <div class="note-preview-title">${escapeHtml((n.content || '').slice(0, 50))}</div>
          <div class="note-preview-meta">
            ${n.has_photo ? '📸' : ''} ${new Date(n.created_at).toLocaleDateString('ru')}
          </div>
        </div>`).join('');
    }

    // Render all notes in archive grid
    const archive = document.getElementById('notesArchive');
    if (archive) {
      archive.innerHTML = notes.length ? notes.map(n => `
        <div class="note-card" onclick="loadNoteDetail(${n.id})">
          <div class="note-card-header">
            ${n.has_photo ? '<span class="note-has-photo">📸</span>' : ''}
            <span class="note-date">${new Date(n.created_at).toLocaleDateString('ru', {month: 'short', day: 'numeric'})}</span>
          </div>
          <div class="note-card-content">${escapeHtml((n.content || '').slice(0, 100))}</div>
          ${n.tags && n.tags.length ? `<div class="note-tags">${n.tags.slice(0, 2).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
          ${n.extracted_tasks && n.extracted_tasks.length ? `<div class="note-tasks">✓ ${n.extracted_tasks.length} задач</div>` : ''}
        </div>`).join('') : '<div class="empty-state">📝 Ещё нет заметок. Добавь первую!</div>';
    }
  } catch (e) {
    console.warn('Error loading notes:', e);
    showToast('Ошибка загрузки заметок', 'error');
  }
}

// Open camera for photo capture
async function notesOpenCamera() {
  const btn = document.getElementById('notesCameraBtn');
  const preview = document.getElementById('notesPhotoPreview');
  
  try {
    if (!_mediaStream) {
      _mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = document.createElement('video');
      video.id = 'notesVideoPreview';
      video.srcObject = _mediaStream;
      video.autoplay = true;
      video.playsinline = true;
      video.style.cssText = 'width:100%;max-height:300px;border-radius:10px;margin-bottom:10px;';
      
      // Remove old video if exists
      const oldVideo = document.getElementById('notesVideoPreview');
      if (oldVideo) oldVideo.remove();
      
      preview.parentElement.insertBefore(video, preview);
      
      // Add capture button
      if (btn) btn.innerHTML = '📷 Снять фото';
    } else {
      // Stop camera
      _mediaStream.getTracks().forEach(track => track.stop());
      _mediaStream = null;
      const video = document.getElementById('notesVideoPreview');
      if (video) video.remove();
      if (btn) btn.innerHTML = '📷 Открыть камеру';
    }
  } catch (e) {
    showToast('Нет доступа к камере: ' + e.message, 'error');
    if (btn) btn.innerHTML = '📷 Камера недоступна';
  }
}

// Capture photo from video stream
async function captureNotePhoto() {
  const video = document.getElementById('notesVideoPreview');
  if (!video) return showToast('Откройте камеру сначала', 'error');
  
  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    
    _photoData = canvas.toDataURL('image/jpeg', 0.8);
    
    // Show preview of captured photo
    const preview = document.getElementById('notesPhotoPreview');
    preview.innerHTML = `
      <div style="position:relative;">
        <img src="${_photoData}" style="width:100%;max-height:300px;border-radius:10px;margin-bottom:10px;" />
        <button class="btn btn-secondary" onclick="notesRemovePhoto()" style="position:absolute;top:5px;right:5px;">✕ Удалить</button>
      </div>`;
    
    // Stop camera
    _mediaStream.getTracks().forEach(track => track.stop());
    _mediaStream = null;
    const video = document.getElementById('notesVideoPreview');
    if (video) video.remove();
    
    const btn = document.getElementById('notesCameraBtn');
    if (btn) btn.innerHTML = '📷 Открыть камеру';
    
    showToast('📷 Фото захвачено!', 'success');
  } catch (e) {
    showToast('Ошибка захвата фото: ' + e.message, 'error');
  }
}

// Remove captured photo
function notesRemovePhoto() {
  _photoData = null;
  const preview = document.getElementById('notesPhotoPreview');
  if (preview) preview.innerHTML = '';
}

// Capture (save) the note
async function captureNote() {
  const content = document.getElementById('notesContent')?.value?.trim();
  const tagsText = document.getElementById('notesTags')?.value?.trim() || '';
  const tags = tagsText ? tagsText.split(',').map(t => t.trim()).filter(Boolean) : [];
  
  if (!content && !_photoData) {
    showToast('Напиши заметку или сделай фото', 'error');
    return;
  }
  
  const btn = document.getElementById('notesSaveBtn');
  if (btn) btn.disabled = true;
  
  try {
    const formData = new FormData();
    formData.append('content', content);
    formData.append('tags', JSON.stringify(tags));
    
    // Add photo if captured
    if (_photoData) {
      const blob = await (await fetch(_photoData)).blob();
      formData.append('photo', blob, 'note-photo.jpg');
    }
    
    const response = await fetch('/api/notes/capture', {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) throw new Error(response.statusText);
    const result = await response.json();
    
    showToast('✅ Заметка сохранена!', 'success');
    
    // Clear form
    document.getElementById('notesContent').value = '';
    document.getElementById('notesTags').value = '';
    notesRemovePhoto();
    _photoData = null;
    
    // Update extracted tasks display
    if (result.extracted_tasks && result.extracted_tasks.length) {
      const tasksArea = document.getElementById('notesExtractedTasks');
      if (tasksArea) {
        tasksArea.innerHTML = `
          <h4 style="font-size:13px;font-weight:600;margin-bottom:10px;">📋 Извлечённые задачи:</h4>
          <ul style="list-style:none;padding:0;margin:0;">
            ${result.extracted_tasks.map(task => `
              <li style="padding:6px 0;display:flex;align-items:center;gap:8px;">
                <input type="checkbox" /> ${escapeHtml(task)}
              </li>`).join('')}
          </ul>`;
      }
    }
    
    // Reload notes list
    await loadSmartNotes();
  } catch (e) {
    showToast('Ошибка сохранения: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Load and display full note details
async function loadNoteDetail(noteId) {
  try {
    const response = await fetch(`/api/notes/${noteId}`);
    if (!response.ok) throw new Error('Failed to load note');
    const note = await response.json();
    
    // Show detail modal or navigate to detail view
    const modal = document.getElementById('noteDetailModal') || createNoteDetailModal();
    
    modal.innerHTML = `
      <div class="modal-box" style="max-width:600px;max-height:80vh;overflow-y:auto;">
        <div class="modal-header">
          <h3>📝 Заметка</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').style.display='none'">✕</button>
        </div>
        <div class="modal-body" style="padding:20px;">
          ${note.photo_data ? `
            <div style="margin-bottom:16px;">
              <img src="${note.photo_data}" style="width:100%;max-height:300px;border-radius:10px;object-fit:cover;" />
              ${note.photo_analysis ? `<p style="font-size:12px;color:var(--text-dim);margin-top:8px;">📸 ${note.photo_analysis}</p>` : ''}
            </div>` : ''}
          
          <div style="margin-bottom:16px;">
            <div style="font-size:12px;color:var(--text-dim);margin-bottom:4px;">${new Date(note.created_at).toLocaleString('ru')}</div>
            <p style="font-size:14px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(note.content)}</p>
          </div>
          
          ${note.ai_summary ? `
            <div style="background:var(--card-dim);border-left:3px solid var(--primary);padding:12px;border-radius:6px;margin-bottom:16px;">
              <div style="font-size:12px;font-weight:600;margin-bottom:6px;">✨ AI Резюме:</div>
              <div style="font-size:13px;color:var(--text-dim);">${escapeHtml(note.ai_summary)}</div>
            </div>` : ''}
          
          ${note.extracted_tasks && note.extracted_tasks.length ? `
            <div style="margin-bottom:16px;">
              <div style="font-size:12px;font-weight:600;margin-bottom:8px;">📋 Задачи:</div>
              <ul style="list-style:none;padding:0;margin:0;">
                ${note.extracted_tasks.map(task => `
                  <li style="padding:6px 0;display:flex;align-items:center;gap:8px;cursor:pointer;" onclick="createTaskFromNote(${note.id},'${task.replace(/'/g,"\\'").replace(/"/g,'\\"')}')">
                    <span style="width:18px;height:18px;border:2px solid var(--primary);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;">+</span>
                    <span>${escapeHtml(task)}</span>
                  </li>`).join('')}
              </ul>
            </div>` : ''}
          
          ${note.tags && note.tags.length ? `
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${note.tags.map(tag => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}
            </div>` : ''}
        </div>
      </div>`;
    
    modal.style.display = 'flex';
  } catch (e) {
    showToast('Ошибка загрузки заметки: ' + e.message, 'error');
  }
}

function createNoteDetailModal() {
  const modal = document.createElement('div');
  modal.id = 'noteDetailModal';
  modal.className = 'modal-overlay';
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = 'none';
  };
  document.body.appendChild(modal);
  return modal;
}

// Create Kanban task from note
async function createTaskFromNote(noteId, taskText) {
  try {
    const response = await fetch(`/api/notes/${noteId}/create-task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_text: taskText || '' }),
    });
    
    if (!response.ok) throw new Error(response.statusText);
    const task = await response.json();
    
    showToast(`✅ Задача добавлена в Канбан: "${taskText.slice(0, 50)}"`, 'success');
  } catch (e) {
    showToast('Ошибка создания задачи: ' + e.message, 'error');
  }
}

/* ═══════════════════════════════════════════════════════════════════
   MOOD BOARD MODULE
   ═══════════════════════════════════════════════════════════════════ */

let _moodboardPhotos = [];
let _currentMoodboard = null;

// Load and display mood boards
async function loadMoodboards() {
  try {
    const response = await fetch('/api/media/moodboard');
    if (!response.ok) throw new Error('Failed to load mood boards');
    const boards = await response.json();
    
    // Render boards list
    const list = document.getElementById('mbBoardsList');
    if (list) {
      list.innerHTML = boards.length ? boards.map(board => `
        <div class="moodboard-card" onclick="loadMoodboardDetail(${board.id})">
          ${board.images && board.images.length ? `
            <div class="moodboard-thumbnail">
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px;width:100%;height:120px;">
                ${board.images.slice(0, 4).map((img, i) => `
                  <img src="${img.data}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;" />
                `).join('')}
              </div>
            </div>` : '<div style="width:100%;height:120px;background:var(--card-dim);border-radius:10px;"></div>'}
          
          <div style="padding:10px 0;">
            <div style="font-weight:600;font-size:13px;">${escapeHtml(board.title)}</div>
            <div style="font-size:11px;color:var(--text-dim);">${board.images ? board.images.length : 0} фото</div>
            ${board.color_palette && board.color_palette.length ? `
              <div style="display:flex;gap:4px;margin-top:6px;">
                ${board.color_palette.slice(0, 5).map(color => `
                  <div style="width:20px;height:20px;background:${color};border-radius:50%;border:1px solid var(--card-border);cursor:pointer;" title="${color}" onclick="event.stopPropagation();copyColor('${color}')"></div>
                `).join('')}
              </div>` : ''}
          </div>
        </div>`).join('') : '<div class="empty-state">🎨 Ещё нет mood boards. Создай первый!</div>';
    }
  } catch (e) {
    console.warn('Error loading mood boards:', e);
  }
}

// Load full mood board details
async function loadMoodboardDetail(boardId) {
  try {
    const response = await fetch(`/api/media/moodboard/${boardId}`);
    if (!response.ok) throw new Error('Failed to load mood board');
    const board = await response.json();
    
    _currentMoodboard = board;
    
    // Update palette display
    const palette = document.getElementById('mbColorPalette');
    if (palette && board.color_palette) {
      palette.innerHTML = board.color_palette.map(color => `
        <div class="color-swatch" style="background:${color};cursor:pointer;" onclick="copyColor('${color}')" title="Нажми чтобы скопировать">
          <span class="color-hex">${color}</span>
        </div>`).join('');
    }
    
    // Update mood description
    const mood = document.getElementById('mbMood');
    if (mood) mood.textContent = board.mood_description || 'AI анализирует...';
    
    // Update style tags
    const tags = document.getElementById('mbStyleTags');
    if (tags && board.style_tags) {
      tags.innerHTML = board.style_tags.map(tag => `<span class="style-tag">${escapeHtml(tag)}</span>`).join('');
    }
    
    // Update photo gallery
    const gallery = document.getElementById('mbPhotoGallery');
    if (gallery && board.images) {
      gallery.innerHTML = board.images.map((img, i) => `
        <div class="photo-thumbnail" style="position:relative;">
          <img src="${img.data}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" />
          <button class="btn btn-sm" style="position:absolute;top:4px;right:4px;font-size:10px;" onclick="event.stopPropagation();removeMoodboardPhoto(${i})">✕</button>
        </div>`).join('');
    }
  } catch (e) {
    showToast('Ошибка загрузки mood board: ' + e.message, 'error');
  }
}

// Trigger file upload
function mbUploadPhoto() {
  const input = document.getElementById('mbPhotoInput');
  if (input) input.click();
}

// Handle photo selection
function mbPhotoSelected(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  
  const readers = files.map(file => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      _moodboardPhotos.push({ name: file.name, data: reader.result });
      resolve();
    };
    reader.readAsDataURL(file);
  }));
  
  Promise.all(readers).then(() => {
    // Update gallery preview
    const gallery = document.getElementById('mbPhotoGallery');
    if (gallery) {
      gallery.innerHTML = _moodboardPhotos.map((photo, i) => `
        <div class="photo-thumbnail" style="position:relative;">
          <img src="${photo.data}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" />
          <button class="btn btn-sm" style="position:absolute;top:4px;right:4px;font-size:10px;" onclick="removeMoodboardPhoto(${i})">✕</button>
        </div>`).join('');
    }
    showToast(`📷 Добавлено ${files.length} фото`, 'success');
  });
}

// Remove photo from mood board
function removeMoodboardPhoto(index) {
  _moodboardPhotos.splice(index, 1);
  const gallery = document.getElementById('mbPhotoGallery');
  if (gallery) {
    gallery.innerHTML = _moodboardPhotos.map((photo, i) => `
      <div class="photo-thumbnail" style="position:relative;">
        <img src="${photo.data}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;" />
        <button class="btn btn-sm" style="position:absolute;top:4px;right:4px;font-size:10px;" onclick="removeMoodboardPhoto(${i})">✕</button>
      </div>`).join('');
  }
}

// Create mood board
async function createMoodboard() {
  const title = document.getElementById('mbTitle')?.value?.trim();
  const desc = document.getElementById('mbDescription')?.value?.trim();
  
  if (!title) {
    showToast('Введи название mood board', 'error');
    return;
  }
  
  if (!_moodboardPhotos.length) {
    showToast('Добавь хотя бы одно фото', 'error');
    return;
  }
  
  const btn = document.getElementById('mbCreateBtn');
  if (btn) btn.disabled = true;
  
  try {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('description', desc || '');
    
    // Add photos
    _moodboardPhotos.forEach((photo, index) => {
      const blob = dataURLtoBlob(photo.data);
      formData.append(`photo_${index}`, blob, `photo-${index}.jpg`);
    });
    
    const response = await fetch('/api/media/create-moodboard', {
      method: 'POST',
      body: formData,
    });
    
    if (!response.ok) throw new Error(response.statusText);
    const result = await response.json();
    
    showToast('✅ Mood board создан!', 'success');
    
    // Clear form
    document.getElementById('mbTitle').value = '';
    document.getElementById('mbDescription').value = '';
    _moodboardPhotos = [];
    document.getElementById('mbPhotoGallery').innerHTML = '';
    
    // Load updated list
    await loadMoodboards();
    
    // If we have AI results, display them
    if (result.color_palette) {
      const palette = document.getElementById('mbColorPalette');
      if (palette) {
        palette.innerHTML = result.color_palette.map(color => `
          <div class="color-swatch" style="background:${color};cursor:pointer;" onclick="copyColor('${color}')" title="Скопировать">
            <span class="color-hex">${color}</span>
          </div>`).join('');
      }
    }
    
    if (result.style_tags) {
      const tags = document.getElementById('mbStyleTags');
      if (tags) {
        tags.innerHTML = result.style_tags.map(tag => `<span class="style-tag">${escapeHtml(tag)}</span>`).join('');
      }
    }
    
    if (result.mood_description) {
      const mood = document.getElementById('mbMood');
      if (mood) mood.textContent = result.mood_description;
    }
  } catch (e) {
    showToast('Ошибка создания: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Copy color to clipboard
function copyColor(hex) {
  navigator.clipboard.writeText(hex).then(() => {
    showToast(`📋 ${hex} скопирован!`, 'success');
  }).catch(() => {
    showToast('Ошибка копирования', 'error');
  });
}

// Helper function: convert data URL to Blob
function dataURLtoBlob(dataURL) {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}
