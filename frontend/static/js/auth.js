/* ── auth.js — Auth, Profile, Leaderboard, Tournaments, Find Team ── */

/* ═════════════════════════════ TOKEN UTILS ═════════════════════════ */
const AUTH = {
  getToken: () => localStorage.getItem('akyl_token'),
  setToken: (t) => localStorage.setItem('akyl_token', t),
  clear: () => { localStorage.removeItem('akyl_token'); localStorage.removeItem('akyl_user'); },
  getUser: () => { try { return JSON.parse(localStorage.getItem('akyl_user') || 'null'); } catch { return null; } },
  setUser: (u) => localStorage.setItem('akyl_user', JSON.stringify(u)),
  isLoggedIn: () => !!localStorage.getItem('akyl_token'),
};

/* ═════════════════════════════ SIDEBAR ════════════════════════════ */
function updateSidebarUser(user) {
  const widget = document.getElementById('sidebarUser');
  const navLbl = document.getElementById('navProfileLabel');
  if (!widget) return;
  if (!user) {
    widget.style.display = 'none';
    if (navLbl) navLbl.textContent = t('nav.login');
    return;
  }
  widget.style.display = 'flex';
  const av = document.getElementById('sidebarAvatar');
  const un = document.getElementById('sidebarUsername');
  const xp = document.getElementById('sidebarXP');
  const rk = document.getElementById('sidebarRank');
  const xpBar = document.getElementById('sidebarXPBar');
  if (av) { av.textContent = (user.username || 'U')[0].toUpperCase(); av.style.background = `hsl(${(user.username||'').charCodeAt(0) * 3},60%,45%)`; }
  if (un) un.textContent = user.username || '';
  if (xp) xp.textContent = (user.xp || 0).toLocaleString();
  if (rk) rk.textContent = user.rank_title || t('profile.defaultRank');
  if (navLbl) navLbl.textContent = user.username || t('nav.profile');
  // XP progress bar: calculate progress within current level (200 XP per level)
  if (xpBar) {
    const XP_PER_LEVEL = 200;
    const xpInLevel = (user.xp || 0) % XP_PER_LEVEL;
    const pct = Math.round((xpInLevel / XP_PER_LEVEL) * 100);
    xpBar.style.width = pct + '%';
    xpBar.title = `${xpInLevel}/${XP_PER_LEVEL} XP до следующего уровня`;
  }

  // ── Update top bar ────────────────────────────────────────────────
  if (typeof updateTopBar === 'function') updateTopBar(user);
}

/* ═════════════════════════════ AUTH MODAL ══════════════════════════ */
function openAuth(tab = 'login') {
  const overlay = document.getElementById('authOverlay');
  if (overlay) { overlay.style.display = 'flex'; switchAuthTab(tab); }
}

function closeAuth() {
  const overlay = document.getElementById('authOverlay');
  if (overlay) overlay.style.display = 'none';
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  if (loginForm) loginForm.style.display = tab === 'login' ? 'flex' : 'none';
  if (registerForm) registerForm.style.display = tab === 'register' ? 'flex' : 'none';
}

async function doLogin() {
  const username = document.getElementById('loginUsername')?.value?.trim();
  const password = document.getElementById('loginPassword')?.value;
  if (!username || !password) return showToast(t('auth.enterCredentials'), 'error');
  try {
    const data = await api.login(username, password);
    AUTH.setToken(data.access_token);
    AUTH.setUser(data.user);
    updateSidebarUser(data.user);
    closeAuth();
    showToast(t('auth.welcome') + data.user.username + '!', 'success');
    if (typeof startHeartbeat === 'function') startHeartbeat();
    // Refresh current page if it's profile
    const profilePage = document.getElementById('page-profile');
    if (profilePage && profilePage.style.display !== 'none') loadProfile();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function doRegister() {
  const username  = document.getElementById('regUsername')?.value?.trim();
  const email     = document.getElementById('regEmail')?.value?.trim();
  const password  = document.getElementById('regPassword')?.value;
  const fullName  = document.getElementById('regFullName')?.value?.trim();
  const skillsRaw = document.getElementById('regSkills')?.value?.trim();
  const bio       = document.getElementById('regBio')?.value?.trim();
  const looking   = document.getElementById('regLooking')?.checked || false;
  if (!username || !email || !password) return showToast(t('auth.fillRequired'), 'error');
  const skills = skillsRaw ? skillsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  try {
    const data = await api.register({ username, email, password, full_name: fullName, skills, bio, is_looking_for_team: looking });
    AUTH.setToken(data.access_token);
    AUTH.setUser(data.user);
    updateSidebarUser(data.user);
    closeAuth();
    showToast(t('auth.accountCreated'), 'success');
    if (typeof startHeartbeat === 'function') startHeartbeat();
    // Show onboarding for new users (if they didn't fill in skills)
    if (!skills.length) {
      setTimeout(() => {
        const modal = document.getElementById('onboardingModal');
        if (modal) modal.style.display = 'flex';
      }, 600);
    }
  } catch (e) {
    showToast(e.message || t('auth.regError'), 'error');
  }
}

/* ═══════════════════ ONBOARDING ═══════════════════════════════════ */
let _onboardSelectedRole = null;
let _onboardSelectedLevel = 'beginner';

function initOnboarding() {
  // Role button toggle
  document.querySelectorAll('.onboard-role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.onboard-role-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      _onboardSelectedRole = { role: btn.dataset.role, skills: btn.dataset.skills.split(',') };
    });
  });
  // Level button toggle
  document.querySelectorAll('.onboard-level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.onboard-level-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _onboardSelectedLevel = btn.dataset.level;
    });
  });
}

async function submitOnboarding() {
  const modal = document.getElementById('onboardingModal');
  if (!_onboardSelectedRole) {
    showToast('Выбери роль!', 'error');
    return;
  }
  try {
    const user = AUTH.getUser();
    if (user && AUTH.getToken()) {
      // Update user profile with skills and role
      const updated = await api.updateProfile({
        skills: _onboardSelectedRole.skills,
        preferred_roles: [_onboardSelectedRole.role],
      });
      AUTH.setUser(updated);
      updateSidebarUser(updated);
    }
    if (modal) modal.style.display = 'none';
    showToast(`✅ Профиль настроен! Роль: ${_onboardSelectedRole.role}`, 'success');
  } catch (e) {
    // Silent fail — just close
    if (modal) modal.style.display = 'none';
  }
}

function skipOnboarding() {
  const modal = document.getElementById('onboardingModal');
  if (modal) modal.style.display = 'none';
}

function doLogout() {
  AUTH.clear();
  updateSidebarUser(null);
  if (typeof stopHeartbeat === 'function') stopHeartbeat();
  loadProfile();
  showToast(t('auth.loggedOut'), 'info');
  // Show auth landing again on logout
  const landing = document.getElementById('authLanding');
  if (landing) landing.classList.remove('hidden');
}

/* ═════════════════ AUTH LANDING PAGE ══════════════════════════════ */
function initAuthLanding() {
  const landing = document.getElementById('authLanding');
  if (!landing) return;
  if (AUTH.isLoggedIn()) {
    landing.classList.add('hidden');
  }
  // else: landing stays visible (blocks the app)
  // Sync active lang button with current language
  const lang = localStorage.getItem('akyl_lang') || 'ru';
  document.querySelectorAll('.auth-lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
}

function switchLandingTab(tab) {
  const loginPanel = document.getElementById('landingLoginPanel');
  const regPanel   = document.getElementById('landingRegPanel');
  const tabLogin   = document.getElementById('landingTabLogin');
  const tabReg     = document.getElementById('landingTabReg');
  if (loginPanel) loginPanel.classList.toggle('active', tab === 'login');
  if (regPanel)   regPanel.classList.toggle('active', tab === 'register');
  if (tabLogin)   tabLogin.classList.toggle('active', tab === 'login');
  if (tabReg)     tabReg.classList.toggle('active', tab === 'register');
}

async function doLandingLogin() {
  const username = document.getElementById('llUsername')?.value?.trim();
  const password = document.getElementById('llPassword')?.value;
  if (!username || !password) return showToast(t('auth.enterCredentials'), 'error');
  const btn = document.getElementById('ll_btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
  try {
    const data = await api.login(username, password);
    AUTH.setToken(data.access_token);
    AUTH.setUser(data.user);
    updateSidebarUser(data.user);
    document.getElementById('authLanding').classList.add('hidden');
    showToast(t('auth.welcome') + data.user.username + '!', 'success');
    if (typeof startHeartbeat === 'function') startHeartbeat();
    loadProfile();
  } catch (e) {
    showToast(e.message || t('auth.loginError'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('auth.loginBtn') || 'Войти'; }
  }
}

async function doLandingGuestLogin() {
  try {
    const res = await api.guestLogin();
    AUTH.setToken(res.access_token);
    AUTH.setUser(res.user);
    updateSidebarUser(res.user);
    document.getElementById('authLanding').classList.add('hidden');
    showToast(`👻 Вы вошли как гость: ${res.user.username}`, 'success');
    if (typeof startHeartbeat === 'function') startHeartbeat();
  } catch (e) {
    showToast('Ошибка: ' + e.message, 'error');
  }
}

async function doLandingRegister() {
  const username  = document.getElementById('lrUsername')?.value?.trim();
  const email     = document.getElementById('lrEmail')?.value?.trim();
  const password  = document.getElementById('lrPassword')?.value;
  const fullName  = document.getElementById('lrFullName')?.value?.trim();
  const skillsRaw = document.getElementById('lrSkills')?.value?.trim();
  const looking   = document.getElementById('lrLooking')?.checked || false;
  if (!username || !email || !password) return showToast(t('auth.fillRequired'), 'error');
  const skills = skillsRaw ? skillsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const btn = document.getElementById('lr_btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }
  try {
    const data = await api.register({ username, email, password, full_name: fullName, skills, is_looking_for_team: looking });
    AUTH.setToken(data.access_token);
    AUTH.setUser(data.user);
    updateSidebarUser(data.user);
    document.getElementById('authLanding').classList.add('hidden');
    showToast(t('auth.accountCreated'), 'success');
    if (typeof startHeartbeat === 'function') startHeartbeat();
    loadProfile();
    // Show theme picker welcome modal after registration
    setTimeout(() => {
      if (typeof openThemePicker === 'function') openThemePicker();
    }, 900);
    // Show onboarding if no skills provided
    if (!skills.length) {
      setTimeout(() => {
        const modal = document.getElementById('onboardingModal');
        if (modal) modal.style.display = 'flex';
      }, 600);
    }
  } catch (e) {
    showToast(e.message || t('auth.regError'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = t('auth.registerBtn') || 'Зарегистрироваться'; }
  }
}

function setLandingLang(lang) {
  if (typeof loadTranslations === 'function') loadTranslations(lang);
  document.querySelectorAll('.auth-lang-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
}

/* ═════════════════════════════ PROFILE PAGE ════════════════════════ */
async function loadProfile() {
  // HTML uses profileNotLoggedIn / profileLoggedIn
  const notLogged = document.getElementById('profileNotLoggedIn');
  const loggedIn  = document.getElementById('profileLoggedIn');
  if (!notLogged || !loggedIn) return;

  if (!AUTH.isLoggedIn()) {
    notLogged.style.display = '';
    loggedIn.style.display  = 'none';
    return;
  }

  notLogged.style.display = 'none';
  loggedIn.style.display  = '';

  try {
    const user = await api.getMe();
    AUTH.setUser(user);
    updateSidebarUser(user);
    renderProfile(user);
  } catch (e) {
    AUTH.clear();
    updateSidebarUser(null);
    notLogged.style.display = '';
    loggedIn.style.display  = 'none';
  }
}

function renderProfile(user) {
  // Avatar — HTML id: profileAvatarLg
  const avatarEl = document.getElementById('profileAvatarLg');
  if (avatarEl) {
    avatarEl.textContent = (user.username || 'U')[0].toUpperCase();
    avatarEl.style.background = `hsl(${(user.username.charCodeAt(0) * 3) % 360}, 60%, 45%)`;
  }

  // Name / rank / bio — HTML ids: profileName, profileRankBadge, profileBio
  setEl('profileName',      user.full_name || user.username || '');
  setEl('profileRankBadge', (user.rank_icon || '') + ' ' + (user.rank_title || t('profile.defaultRank')));
  setEl('profileBio',       user.bio || '');

  const ghEl = document.getElementById('profileGithub');
  if (ghEl) {
    ghEl.innerHTML = user.github_url
      ? `<a href="${user.github_url}" target="_blank" style="color:var(--accent)">🔗 GitHub</a>`
      : '';
  }

  // Stats — HTML ids: statXP, statLevel, statStreak, statBadges
  setEl('statXP',     (user.xp || 0).toLocaleString());
  setEl('statLevel',  user.level || 1);
  setEl('statStreak', (user.streak_days || 0) + ' 🔥');
  setEl('statBadges', (user.badges || []).length);

  // XP Progress bar
  const xpFill = document.getElementById('xpFill');
  const xpCurrent = document.getElementById('xpCurrent');
  const xpNext = document.getElementById('xpNext');
  const RANKS = [0, 200, 500, 1000, 2000, 5000, Infinity];
  const xp = user.xp || 0;
  let curFloor = 0, nextCeil = 5000;
  for (let i = 0; i < RANKS.length - 1; i++) {
    if (xp >= RANKS[i] && xp < RANKS[i + 1]) { curFloor = RANKS[i]; nextCeil = RANKS[i + 1]; break; }
  }
  const pct = nextCeil === Infinity ? 100 : Math.round(((xp - curFloor) / (nextCeil - curFloor)) * 100);
  if (xpFill) xpFill.style.width = pct + '%';
  if (xpCurrent) xpCurrent.textContent = xp + ' XP';
  if (xpNext) xpNext.textContent = nextCeil === Infinity ? t('profile.legendMax') : nextCeil + ' XP';

  // Skills
  const skillsWrap = document.getElementById('profileSkills');
  if (skillsWrap) {
    const skills = user.skills || [];
    skillsWrap.innerHTML = skills.length
      ? skills.map(s => `<span class="skill-chip">${s}</span>`).join('')
      : `<span class="text-muted">${t('profile.noSkills')}</span>`;
  }

  // Badges
  const badgesGrid = document.getElementById('profileBadges');
  if (badgesGrid) {
    const badges = user.badges || [];
    if (badges.length === 0) {
      badgesGrid.innerHTML = `<div class="empty-state">${t('profile.noBadges')}</div>`;
    } else {
      badgesGrid.innerHTML = badges.map(b => `
        <div class="badge-card ${b.rarity || 'common'}">
          <div class="badge-icon">${b.icon || '🏅'}</div>
          <div class="badge-name">${b.name}</div>
          <div class="badge-desc">${b.description || ''}</div>
          <div class="badge-rarity rarity-${b.rarity || 'common'}">${rarityLabel(b.rarity)}</div>
        </div>`).join('');
    }
  }

  // XP Log — HTML id: xpLog
  const xpLogEl = document.getElementById('xpLog');
  if (xpLogEl) {
    const logs = (user.xp_logs || []).slice().reverse().slice(0, 20);
    xpLogEl.innerHTML = logs.length
      ? logs.map(l => `
        <div class="xp-log-item">
          <span class="xp-log-reason">${l.reason}</span>
          <span class="xp-log-amount">+${l.amount} XP</span>
        </div>`).join('')
      : `<div class="empty-state">${t('profile.emptyXp')}</div>`;
  }

  // Populate edit form
  const ef = { editFullName: user.full_name || '', editBio: user.bio || '',
    editGithub: user.github_url || '', editSkills: (user.skills || []).join(', '),
    editRole: user.role || '', editLooking: user.is_looking_for_team || false };
  Object.entries(ef).forEach(([id, val]) => {
    const el = document.getElementById(id); if (!el) return;
    if (el.type === 'checkbox') el.checked = val; else el.value = val;
  });
}

function rarityLabel(r) {
  return {
    legendary: t('profile.rarityLegendary'),
    epic: t('profile.rarityEpic'),
    rare: t('profile.rarityRare'),
    common: t('profile.rarityCommon')
  }[r] || t('profile.rarityCommon');
}

function setEl(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* ═════════════════════════════ LEADERBOARD ════════════════════════ */
async function loadLeaderboard() {
  const table = document.getElementById('leaderboardTable');
  if (!table) return;
  table.innerHTML = `<div class="empty-state">${t('leaderboard.loading')}</div>`;
  try {
    const users = await api.getLeaderboard(50);
    const me = AUTH.getUser();
    if (!users.length) { table.innerHTML = `<div class="empty-state">${t('leaderboard.empty')}</div>`; return; }
    table.innerHTML = users.map((u, i) => {
      const pos = i + 1;
      const isMe = me && me.username === u.username;
      const posClass = pos <= 3 ? `p${pos}` : '';
      const medals = ['🥇', '🥈', '🥉'];
      const posStr = pos <= 3 ? medals[pos - 1] : pos;
      const avatarColor = `hsl(${(u.username.charCodeAt(0) * 3) % 360}, 60%, 45%)`;
      return `<div class="lb-row${pos <= 3 ? ' top' + pos : ''}${isMe ? ' me' : ''}">
        <div class="lb-pos ${posClass}">${posStr}</div>
        <div class="lb-avatar" style="background:${avatarColor}">${u.username[0].toUpperCase()}</div>
        <div class="lb-info">
          <div class="lb-username">${u.username}${isMe ? ` ${t('findTeam.you')}` : ''}</div>
          <div class="lb-rank">${u.rank_title || t('profile.defaultRank')}</div>
        </div>
        <div class="lb-xp">${u.xp || 0} XP</div>
      </div>`;
    }).join('');
  } catch (e) {
    table.innerHTML = `<div class="empty-state">${t('leaderboard.error')}: ${e.message}</div>`;
  }
}

/* ═════════════════════════════ FIND TEAM ══════════════════════════ */
async function searchUsers() {
  const skillsInput = document.getElementById('searchSkills');
  const roleInput = document.getElementById('searchRole');
  const lookingInput = document.getElementById('searchLooking');
  const grid = document.getElementById('usersGrid');
  if (!grid) return;

  grid.innerHTML = `<div class="empty-state">${t('findTeam.loading')}</div>`;
  const skills = skillsInput?.value?.trim() || '';
  const role = roleInput?.value || '';
  const looking = lookingInput?.checked ? 'true' : 'false';

  try {
    const users = await api.searchUsers(skills, role, looking);
    const me = AUTH.getUser();
    if (!users.length) { grid.innerHTML = `<div class="empty-state">${t('findTeam.noResults')}</div>`; return; }
    grid.innerHTML = users.map(u => {
      const isMe = me && me.username === u.username;
      const avatarColor = `hsl(${(u.username.charCodeAt(0) * 3) % 360}, 60%, 45%)`;
      return `<div class="user-card">
        <div class="user-card-header">
          <div class="user-card-avatar" style="background:${avatarColor}">${u.username[0].toUpperCase()}</div>
          <div>
            <div class="user-card-name">${u.username}${isMe ? ` ${t('findTeam.you')}` : ''}</div>
            <div class="user-card-rank">${u.rank_title || t('profile.defaultRank')} · ${u.xp || 0} XP</div>
          </div>
          ${u.is_looking_for_team ? `<span class="looking-badge">${t('findTeam.lookingBadge')}</span>` : ''}
        </div>
        ${u.full_name ? `<div class="user-card-bio">${u.full_name}</div>` : ''}
        ${u.role ? `<div class="user-card-bio" style="opacity:.6;font-size:.8rem">${u.role}</div>` : ''}
        <div class="user-skills-wrap">
          ${(u.skills || []).map(s => `<span class="skill-tag">${s}</span>`).join('') || `<span style="opacity:.5;font-size:.8rem">${t('findTeam.noSkills')}</span>`}
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    grid.innerHTML = `<div class="empty-state">${t('leaderboard.error')}: ${e.message}</div>`;
  }
}

/* ═════════════════════════════ TOURNAMENTS ════════════════════════ */
let _activeTournamentFilter = '';

async function loadTournaments(status = '') {
  _activeTournamentFilter = status;
  // Update filter button states
  document.querySelectorAll('.filter-btn[data-status]').forEach(b => {
    b.classList.toggle('active', b.dataset.status === status);
  });

  const grid = document.getElementById('tournamentsList');
  if (!grid) return;
  grid.innerHTML = `<div class="empty-state">${t('tournaments.loading')}</div>`;
  try {
    const tournaments = await api.getTournaments(status);
    if (!tournaments.length) { grid.innerHTML = `<div class="empty-state">${t('tournaments.noTournaments')}</div>`; return; }
    grid.innerHTML = tournaments.map(t => tournamentCard(t)).join('');
  } catch (e) {
    grid.innerHTML = `<div class="empty-state">${t('leaderboard.error')}: ${e.message}</div>`;
  }
}

function tournamentCard(tour) {
  const getStatusLabel = (s) => ({
    open: window.t('tournaments.statusOpen'),
    ongoing: window.t('tournaments.statusOngoing'),
    voting: window.t('tournaments.statusVoting'),
    finished: window.t('tournaments.statusFinished')
  }[s] || s);
  const tags = (tour.tags || []).map(tag => `<span class="tag">${tag}</span>`).join('');
  return `<div class="tournament-card" onclick="openTournamentDetail(${tour.id})">
    <div class="tournament-status status-${tour.status}">${getStatusLabel(tour.status)}</div>
    <div class="tournament-title">${tour.title}</div>
    ${tour.theme ? `<div class="tournament-theme">🎯 ${tour.theme}</div>` : ''}
    <div class="tournament-meta">
      <span>👥 ${window.t('tournaments.upTo')} ${tour.max_team_size || 5} ${window.t('tournaments.people')}</span>
      ${tour.start_date ? `<span>📅 ${new Date(tour.start_date).toLocaleDateString()}</span>` : ''}
      <span>🗂 ${tour.projects_count || 0} ${window.t('tournaments.projects')}</span>
    </div>
    ${tags ? `<div class="tournament-tags">${tags}</div>` : ''}
    ${tour.prize ? `<div class="tournament-prize">🏆 ${tour.prize}</div>` : ''}
  </div>`;
}

/* ─── Tournament detail ─── */
async function openTournamentDetail(id) {
  const overlay = document.getElementById('tournamentDetailModal');
  const content = document.getElementById('tournamentDetailContent');
  if (!overlay || !content) return;

  overlay.style.display = 'flex';
  content.innerHTML = `<div class="empty-state">${t('tournaments.loading')}</div>`;

  try {
    const t = await api.getTournament(id);
    const lb = await api.getTournamentLeaderboard(id).catch(() => []);
    const statusLabelMap = { open: 'tournaments.statusOpen', ongoing: 'tournaments.statusOngoing', voting: 'tournaments.statusVoting', finished: 'tournaments.statusFinished' };
    const statusText = window.t(statusLabelMap[t.status] || 'tournaments.statusOpen');
    const me = AUTH.getUser();

    let projectsHtml = '';
    if (lb.length) {
      projectsHtml = lb.map((p, i) => {
        const rankClass = i < 3 ? `rank-${i + 1}` : '';
        const medals = ['🥇', '🥈', '🥉'];
        return `<div class="project-card ${rankClass}">
          ${i < 3 ? `<div class="project-rank">${medals[i]}</div>` : ''}
          <div class="project-header">
            <div class="project-title">${p.title}</div>
            ${p.ai_score ? `<div class="project-score">AI: ${p.ai_score}/10</div>` : ''}
          </div>
          ${p.tagline ? `<div class="project-tagline">${p.tagline}</div>` : ''}
          <div class="project-tech">
            ${(p.tech_stack || []).map(tech => `<span class="tech-badge">${tech}</span>`).join('')}
          </div>
          <div class="tournament-meta">
            <span>⭐ ${p.avg_score ? p.avg_score.toFixed(1) : '—'}/10</span>
            <span>🗳 ${p.vote_count || 0} ${window.t('tournaments.votes')}</span>
          </div>
          ${t.status === 'voting' && me ? `<button class="btn btn-sm" onclick="openVoteModal(${p.id}, '${p.title.replace(/'/g, "\\'")}'">${window.t('tournaments.voteBtn')}</button>` : ''}
        </div>`;
      }).join('');
    } else if ((t.projects || []).length) {
      projectsHtml = (t.projects || []).map(p => `<div class="project-card">
        <div class="project-header"><div class="project-title">${p.title}</div></div>
        ${p.tagline ? `<div class="project-tagline">${p.tagline}</div>` : ''}
      </div>`).join('');
    }

    content.innerHTML = `
      <div class="tournament-status status-${t.status}" style="margin-bottom:12px">${statusText}</div>
      <h2 style="margin:0 0 8px">${t.title}</h2>
      ${t.theme ? `<div class="tournament-theme">🎯 ${t.theme}</div>` : ''}
      ${t.description ? `<p style="opacity:.8;margin:12px 0">${t.description}</p>` : ''}
      ${t.prize ? `<div class="tournament-prize" style="margin-bottom:12px">🏆 ${t.prize}</div>` : ''}
      <div class="tournament-meta" style="margin-bottom:16px">
        <span>👥 ${window.t('tournaments.upTo')} ${t.max_team_size || 5} ${window.t('tournaments.people')}</span>
        ${t.start_date ? `<span>📅 ${new Date(t.start_date).toLocaleDateString()}</span>` : ''}
        ${t.end_date ? `<span>🏁 ${new Date(t.end_date).toLocaleDateString()}</span>` : ''}
      </div>
      ${me && (t.status === 'open' || t.status === 'ongoing') ? `
        <button class="btn btn-primary" style="margin-bottom:20px" onclick="openSubmitProject(${t.id})">
          ${window.t('tournaments.addProject')}
        </button>` : ''}
      ${me && !AUTH.isLoggedIn() ? `<button class="btn" onclick="openAuth()">${window.t('tournaments.joinToParticipate')}</button>` : ''}
      <h3 style="margin:0 0 12px">${window.t('tournaments.projectsSection')} (${lb.length || (t.projects || []).length})</h3>
      <div class="projects-list">${projectsHtml || `<div class="empty-state">${window.t('tournaments.noProjects')}</div>`}</div>
    `;
  } catch (e) {
    content.innerHTML = `<div class="empty-state">${window.t('leaderboard.error')}: ${e.message}</div>`;
  }
}

/* ─── Create Tournament ─── */
function openCreateTournament() {
  if (!AUTH.isLoggedIn()) return openAuth();
  const modal = document.getElementById('createTournamentModal');
  if (modal) modal.style.display = 'flex';
}

async function createTournament() {
  // HTML ids: tTitle, tTheme, tDesc, tPrize, tMaxTeam, tTags, tStartDate, tEndDate
  const title       = document.getElementById('tTitle')?.value?.trim();
  const theme       = document.getElementById('tTheme')?.value?.trim();
  const description = document.getElementById('tDesc')?.value?.trim();
  const prize       = document.getElementById('tPrize')?.value?.trim();
  const maxTeam     = parseInt(document.getElementById('tMaxTeam')?.value) || 5;
  const tagsRaw     = document.getElementById('tTags')?.value?.trim();
  const startDate   = document.getElementById('tStartDate')?.value || null;
  const endDate     = document.getElementById('tEndDate')?.value || null;
  const tags        = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  if (!title) return showToast(t('tournaments.titleRequired'), 'error');
  try {
    await api.createTournament({ title, theme, description, prize, max_team_size: maxTeam, tags, start_date: startDate, end_date: endDate });
    closeModal('createTournamentModal');
    ['tTitle','tTheme','tDesc','tPrize','tTags'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    loadTournaments(_activeTournamentFilter);
    showToast(t('tournaments.created'), 'success');
    if (AUTH.isLoggedIn()) api.getMe().then(u => { AUTH.setUser(u); updateSidebarUser(u); }).catch(() => {});
  } catch (e) {
    showToast(e.message || t('tournaments.createError'), 'error');
  }
}

/* ─── Submit Project ─── */
let _submitTournamentId = null;

function openSubmitProject(tournamentId) {
  if (!AUTH.isLoggedIn()) return openAuth();
  _submitTournamentId = tournamentId;
  const modal = document.getElementById('submitProjectModal');
  if (modal) modal.style.display = 'flex';
}

async function submitProject() {
  // HTML ids: pTitle, pTagline, pProblem, pSolution, pStack, pDemo, pGithub
  const title      = document.getElementById('pTitle')?.value?.trim();
  const tagline    = document.getElementById('pTagline')?.value?.trim();
  const problem    = document.getElementById('pProblem')?.value?.trim();
  const solution   = document.getElementById('pSolution')?.value?.trim();
  const stackRaw   = document.getElementById('pStack')?.value?.trim();
  const demo_url   = document.getElementById('pDemo')?.value?.trim();
  const github_url = document.getElementById('pGithub')?.value?.trim();
  const tech_stack = stackRaw ? stackRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const tid = _submitTournamentId || parseInt(document.getElementById('submitTournamentId')?.value);

  if (!title) return showToast(t('tournaments.projTitleRequired'), 'error');
  if (!tid)   return showToast(t('tournaments.noTournamentSelected'), 'error');
  try {
    showToast(t('tournaments.submitting'), 'info');
    const project = await api.createProject({ tournament_id: tid, title, tagline, problem, solution, tech_stack, demo_url, github_url });
    try {
      await api.submitProject(project.id);
      showToast(t('tournaments.submittedAI'), 'success');
    } catch {
      showToast(t('tournaments.submitted'), 'success');
    }
    closeModal('submitProjectModal');
    ['pTitle','pTagline','pProblem','pSolution','pStack','pDemo','pGithub'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    openTournamentDetail(tid);
    if (AUTH.isLoggedIn()) api.getMe().then(u => { AUTH.setUser(u); updateSidebarUser(u); }).catch(() => {});
  } catch (e) {
    showToast(e.message || t('tournaments.submitError'), 'error');
  }
}

/* ─── Vote Modal ─── */
let _voteProjectId = null;

function openVoteModal(projectId, projectTitle) {
  _voteProjectId = projectId;
  buildVoteModal(projectId, projectTitle);
}

function buildVoteModal(projectId, projectTitle) {
  let modal = document.getElementById('voteModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'voteModal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="modal-box">
      <div class="modal-header">
        <h3>${t('tournaments.voteTitle')}</h3>
        <button class="modal-close" onclick="closeModal('voteModal')">✕</button>
      </div>
      <p id="voteModalTitle" style="opacity:.7;margin:0 0 16px"></p>
      <div class="form-group">
        <label>${t('tournaments.voteScore')}</label>
        <input id="voteScore" type="range" min="1" max="10" value="8" class="input" style="padding:0;cursor:pointer" oninput="document.getElementById('voteScoreDisp').textContent=this.value" />
        <div style="text-align:center;font-size:1.5rem;font-weight:700;color:var(--accent)" id="voteScoreDisp">8</div>
      </div>
      <div class="form-group">
        <label>${t('tournaments.voteCategory')}</label>
        <select id="voteCategory" class="input">
          <option value="overall">${t('tournaments.voteCatOverall')}</option><option value="innovation">${t('tournaments.voteCatInnovation')}</option>
          <option value="tech">${t('tournaments.voteCatTech')}</option><option value="design">${t('tournaments.voteCatDesign')}</option>
        </select>
      </div>
      <div class="form-group">
        <textarea id="voteComment" class="input" rows="2" placeholder="${t('tournaments.voteComment')}..."></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick="closeModal('voteModal')">${t('auth.cancelBtn')}</button>
        <button class="btn btn-primary" onclick="doVote()">${t('tournaments.voteBtn')}</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal('voteModal'); });
  }
  const titleEl = document.getElementById('voteModalTitle');
  if (titleEl) titleEl.textContent = '«' + projectTitle + '»';
  _voteProjectId = projectId;
  modal.style.display = 'flex';
}

async function doVote() {
  if (!_voteProjectId) return;
  const score = parseInt(document.getElementById('voteScore')?.value) || 8;
  const comment = document.getElementById('voteComment')?.value?.trim() || '';
  const category = document.getElementById('voteCategory')?.value || 'overall';
  if (score < 1 || score > 10) return showToast(t('tournaments.voteRangeError'), 'error');
  try {
    await api.voteProject(_voteProjectId, score, comment, category);
    closeModal('voteModal');
    showToast(t('tournaments.voteSuccess'), 'success');
    if (AUTH.isLoggedIn()) api.getMe().then(u => { AUTH.setUser(u); updateSidebarUser(u); }).catch(() => {});
  } catch (e) {
    showToast(e.message, 'error');
  }
}
/* ══════════════════════════ PROFILE EDIT ═══════════════════════════ */
function openEditProfile() {
  if (!AUTH.isLoggedIn()) return openAuth();
  const m = document.getElementById('editProfileModal');
  if (m) m.style.display = 'flex';
}

async function saveProfile() {
  const fullName  = document.getElementById('editFullName')?.value?.trim();
  const bio       = document.getElementById('editBio')?.value?.trim();
  const github    = document.getElementById('editGithub')?.value?.trim();
  const skillsRaw = document.getElementById('editSkills')?.value?.trim();
  const role      = document.getElementById('editRole')?.value;
  const looking   = document.getElementById('editLooking')?.checked || false;
  const skills    = skillsRaw ? skillsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  try {
    const user = await api.updateMe({ full_name: fullName, bio, github_url: github, skills, role, is_looking_for_team: looking });
    AUTH.setUser(user);
    updateSidebarUser(user);
    renderProfile(user);
    closeModal('editProfileModal');
    showToast(t('profile.saved'), 'success');
  } catch (e) {
    showToast(e.message || t('profile.saveError'), 'error');
  }
}

/* ══════════════════════════ HOME STATS ═════════════════════════════ */
async function refreshHomeStats() {
  try {
    const stats = await apiCall('GET', '/api/stats');
    setEl('statUsers',       stats.users);
    setEl('statTournaments', stats.tournaments);
    setEl('statProjects',    stats.projects);
  } catch { /* optional */ }
}
/* ═════════════════════════════ MODAL UTILS ════════════════════════ */
function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.style.display = 'none';
}

function showToast(msg, type = 'info') {
  // Use app.js showToast if available (it renders via #toast element)
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = msg;
    toast.className = `toast show ${type}`;
    clearTimeout(toast._tid);
    toast._tid = setTimeout(() => toast.classList.remove('show'), 3500);
    return;
  }
  // Fallback: create floating toast
  const div = document.createElement('div');
  div.style.cssText = `position:fixed;bottom:20px;right:20px;background:${type==='error'?'#c0392b':type==='success'?'#27ae60':'#2c3e50'};color:#fff;padding:12px 20px;border-radius:8px;z-index:9999;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,.4)`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

/* ═════════════════════════════ INIT ════════════════════════════════ */
function initAuth() {
  // Show/hide auth landing based on login state
  initAuthLanding();

  // Check saved token and restore sidebar
  if (AUTH.isLoggedIn()) {
    const saved = AUTH.getUser();
    if (saved) updateSidebarUser(saved);
    // Quietly refresh user data in background
    api.getMe().then(u => { AUTH.setUser(u); updateSidebarUser(u); }).catch(() => {
      // Token expired — clear
      AUTH.clear();
      updateSidebarUser(null);
      const landing = document.getElementById('authLanding');
      if (landing) landing.classList.remove('hidden');
    });
  } else {
    updateSidebarUser(null);
  }

  // Auth overlay click-outside to close
  const overlay = document.getElementById('authOverlay');
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeAuth();
    });
  }

  // Modal overlays click-outside
  ['createTournamentModal', 'tournamentDetailModal', 'submitProjectModal', 'editProfileModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', (e) => { if (e.target === el) closeModal(id); });
  });

  // Load home stats
  refreshHomeStats();

  // Auth tab buttons (data-tab attr)
  document.querySelectorAll('.auth-tab').forEach(btn => {
    btn.addEventListener('click', () => switchAuthTab(btn.dataset.tab));
  });

  // Enter key on login form
  document.getElementById('loginPassword')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('regPassword')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doRegister();
  });

  // Enter key on landing forms
  document.getElementById('llPassword')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLandingLogin();
  });
  document.getElementById('llUsername')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLandingLogin();
  });
  document.getElementById('lrPassword')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doLandingRegister();
  });

  // Filter buttons on tournaments page
  document.querySelectorAll('.filter-btn[data-status]').forEach(btn => {
    btn.addEventListener('click', () => loadTournaments(btn.dataset.status));
  });

  // Find team search button
  document.getElementById('btnSearchUsers')?.addEventListener('click', searchUsers);

  // Create tournament button
  document.getElementById('btnCreateTournament')?.addEventListener('click', openCreateTournament);
}

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAuth);
} else {
  initAuth();
}
