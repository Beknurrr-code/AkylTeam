/* ── api.js — API calls to FastAPI backend ───────────────────── */
const API_BASE = '';  // Same origin

async function apiCall(method, path, body = null, isFormData = false) {
  const opts = { method, headers: {} };
  // Attach JWT token if available
  const token = localStorage.getItem('akyl_token');
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;

  if (body && !isFormData) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body && isFormData) {
    opts.body = body; // FormData — no Content-Type header
  }
  const res = await fetch(API_BASE + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(err.detail || 'Request failed');
  }
  return res.json();
}

const api = {
  // ── Auth ───────────────────────────────────────────────────────
  register: (data) => apiCall('POST', '/api/auth/register', data),
  login: (username, password) => {
    const form = new URLSearchParams();
    form.append('username', username);
    form.append('password', password);
    return fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    }).then(async r => { if (!r.ok) { const e = await r.json(); throw new Error(e.detail || 'Login failed'); } return r.json(); });
  },
  getMe: () => apiCall('GET', '/api/auth/me'),
  updateMe: (data) => apiCall('PUT', '/api/auth/me', data),
  updateProfile: (data) => apiCall('PUT', '/api/auth/me', data),
  heartbeat: () => apiCall('POST', '/api/auth/heartbeat'),
  awardXp: (amount, reason) => apiCall('POST', '/api/auth/award-xp', { amount, reason }),
  getOnlineUsers: () => apiCall('GET', '/api/auth/users/online'),
  searchUsers: (skills, role, looking) => apiCall('GET', `/api/auth/users/search?skills=${encodeURIComponent(skills)}&role=${encodeURIComponent(role)}&looking=${looking}`),
  searchUsersByName: (q) => apiCall('GET', `/api/auth/users/search?q=${encodeURIComponent(q)}`),

  // ── Personal AI Chat ─────────────────────────────────────────────
  personalChat: (message, userId, language, mode) => apiCall('POST', '/api/personal-chat/message', { message, user_id: userId, language, mode }),
  getPersonalHistory: (userId) => apiCall('GET', `/api/personal-chat/history/${userId}`),
  clearPersonalHistory: (userId) => apiCall('DELETE', `/api/personal-chat/history/${userId}`),
  getLeaderboard: (limit = 50) => apiCall('GET', `/api/auth/leaderboard?limit=${limit}`),

  // ── Teams ───────────────────────────────────────────────────────
  createTeam: (name, theme) => apiCall('POST', '/api/hackathon/teams', { name, hackathon_theme: theme }),
  getTeams: () => apiCall('GET', '/api/hackathon/teams'),
  getTeam: (id) => apiCall('GET', `/api/hackathon/teams/${id}`),
  getTeamMembers: (id) => apiCall('GET', `/api/hackathon/teams/${id}/members`),
  findTeamByCode: (code) => apiCall('GET', `/api/hackathon/teams/by-code/${code}`),
  joinTeamByCode: (code, name, skills, level, lang) => {
    const params = new URLSearchParams({ code, name, experience_level: level, language: lang });
    (skills || []).forEach(s => params.append('skills', s));
    return apiCall('POST', `/api/hackathon/teams/join-by-code?${params.toString()}`);
  },
  regenerateInviteCode: (teamId) => apiCall('POST', `/api/hackathon/teams/${teamId}/regenerate-code`),

  // ── Members ─────────────────────────────────────────────────────
  addMember: (data) => apiCall('POST', '/api/hackathon/members', data),

  // ── AI Insights ─────────────────────────────────────────────────
  predictFailure: (teamId, lang) => apiCall('POST', `/api/insights/predict-failure?team_id=${teamId}&language=${lang}`),
  skillMatch: (data) => apiCall('POST', '/api/insights/skill-match', data),
  postHackathonReport: (teamId, summary, lang) => apiCall('POST', `/api/insights/post-hackathon-report?team_id=${teamId}&project_summary=${encodeURIComponent(summary)}&language=${lang}`),

  // ── Analysis ────────────────────────────────────────────────────
  analyzeTeam: (teamId, lang) => apiCall('POST', `/api/hackathon/analyze-team?team_id=${teamId}&language=${lang}`),
  assignTasks: (teamId, desc, lang) => apiCall('POST', `/api/hackathon/assign-tasks?team_id=${teamId}&project_description=${encodeURIComponent(desc)}&language=${lang}`),
  hackathonChat: (data) => apiCall('POST', '/api/hackathon/chat', data),
  agentDiscussion: (topic, lang) => apiCall('POST', `/api/hackathon/agent-discussion?topic=${encodeURIComponent(topic)}&language=${lang}`),
  quickFeedback: (situation, lang) => apiCall('POST', `/api/hackathon/quick-feedback?situation=${encodeURIComponent(situation)}&language=${lang}`),

  // ── Burnout ──────────────────────────────────────────────────────
  getBurnoutQuestions: (lang) => apiCall('GET', `/api/burnout/questions?language=${lang}`),
  checkBurnout: (memberId, answers, lang) => apiCall('POST', '/api/burnout/check', { member_id: memberId, answers, language: lang }),
  optimizeSchedule: (memberId, hours, tasks, lang) => {
    const params = new URLSearchParams({ member_id: memberId, remaining_hours: hours, language: lang });
    tasks.forEach(t => params.append('tasks', t));
    return apiCall('POST', `/api/burnout/schedule-optimizer?${params.toString()}`);
  },

  // ── Teacher ──────────────────────────────────────────────────────
  getTopics: (lang) => apiCall('GET', `/api/teacher/topics?language=${lang}`),
  explain: (data) => apiCall('POST', '/api/teacher/explain', data),
  generateQuiz: (topic, level, lang, n) => apiCall('POST', `/api/teacher/quiz?topic=${encodeURIComponent(topic)}&level=${level}&language=${lang}&num_questions=${n}`),
  debugHelp: (code, error, lang) => apiCall('POST', `/api/teacher/debug-helper?code=${encodeURIComponent(code)}&error=${encodeURIComponent(error)}&language=${lang}`),
  generateRoadmap: (goal, skills, hours, lang) => {
    const params = new URLSearchParams({ goal, available_hours: hours, language: lang });
    skills.forEach(s => params.append('current_skills', s));
    return apiCall('POST', `/api/teacher/roadmap?${params.toString()}`);
  },

  // ── Tools ────────────────────────────────────────────────────────
  generateIdeas: (data) => apiCall('POST', '/api/tools/generate-ideas', data),
  validateIdea: (idea, skills, lang) => apiCall('POST', `/api/tools/validate-idea?idea=${encodeURIComponent(idea)}&team_skills=${encodeURIComponent(skills)}&language=${lang}`),
  codeReview: (data) => apiCall('POST', '/api/tools/code-review', data),
  buildPitch: (data) => apiCall('POST', '/api/tools/build-pitch', data),
  analyzeProgress: (done, total, remaining, blockers, lang) => apiCall('POST',
    `/api/tools/analyze-progress?completed_tasks=${done}&total_tasks=${total}&remaining_hours=${remaining}&blockers=${encodeURIComponent(blockers)}&language=${lang}`
  ),

  // ── Hackathon Catalog ─────────────────────────────────────────
  catalogList: (cat, tag) => apiCall('GET', `/api/catalog/list${cat ? '?category='+encodeURIComponent(cat) : ''}${tag ? (cat?'&':'?')+'tag='+encodeURIComponent(tag) : ''}`),
  catalogSearch: (data) => apiCall('POST', '/api/catalog/search', data),
  catalogMatch: (data) => apiCall('POST', '/api/catalog/match', data),
  catalogIdeas: (data) => apiCall('POST', '/api/catalog/ideas', data),

  // ── Daily Challenge ───────────────────────────────────────────
  getChallenge:      ()     => apiCall('GET',  '/api/daily/challenge'),
  completeChallenge: ()     => apiCall('POST', '/api/daily/challenge/complete'),
  challengeHistory:  ()     => apiCall('GET',  '/api/daily/challenge/history'),

  // ── Chat ─────────────────────────────────────────────────────────
  getChatMessages: (teamId) => apiCall('GET', `/api/chat/messages/${teamId}`),
  sendMessage: (data) => apiCall('POST', '/api/chat/messages', data),
  sendAIMessage: (teamId, message, lang) => apiCall('POST', `/api/chat/ai-message?team_id=${teamId}&message=${encodeURIComponent(message)}&language=${lang}`),

  // ── Voice ────────────────────────────────────────────────────────
  tts: (text, lang) => apiCall('POST', '/api/voice/tts', { text, language: lang }),
  stt: (formData) => apiCall('POST', '/api/voice/stt', formData, true),

  // ── Tournaments ──────────────────────────────────────────────────
  createTournament: (data) => apiCall('POST', '/api/tournament', data),
  getTournaments: (status = '') => apiCall('GET', `/api/tournament${status ? '?status=' + status : ''}`),
  getTournament: (id) => apiCall('GET', `/api/tournament/${id}`),
  updateTournamentStatus: (id, status) => apiCall('PATCH', `/api/tournament/${id}/status?new_status=${status}`),
  getTournamentLeaderboard: (id) => apiCall('GET', `/api/tournament/${id}/leaderboard`),

  // ── Projects ─────────────────────────────────────────────────────
  createProject: (data) => apiCall('POST', '/api/tournament/projects', data),
  getAllProjects: (tournamentId) => apiCall('GET', `/api/tournament/projects/all${tournamentId ? '?tournament_id=' + tournamentId : ''}`),
  getProject: (id) => apiCall('GET', `/api/tournament/projects/${id}`),
  updateProject: (id, data) => apiCall('PUT', `/api/tournament/projects/${id}`, data),
  submitProject: (id) => apiCall('POST', `/api/tournament/projects/${id}/submit`),
  voteProject: (id, score, comment, category) => apiCall('POST', `/api/tournament/projects/${id}/vote`, { score, comment, category }),
  getVotes: (id) => apiCall('GET', `/api/tournament/projects/${id}/votes`),

  // ── Kanban ───────────────────────────────────────────────────────
  kanbanTasks: (queryString) => apiCall('GET', `/api/kanban/tasks${queryString ? '?' + queryString : ''}`),
  kanbanCreate: (data) => apiCall('POST', '/api/kanban/tasks', data),
  kanbanMoveTask: (id, status) => apiCall('PATCH', `/api/kanban/tasks/${id}/status?status=${status}`),
  kanbanUpdateTask: (id, data) => apiCall('PATCH', `/api/kanban/tasks/${id}`, data),
  kanbanDelete: (id) => apiCall('DELETE', `/api/kanban/tasks/${id}`),

  // ── Chat Reactions & Pins ────────────────────────────────────────
  reactToMessage: (msgId, emoji, username) => apiCall('POST', `/api/chat/messages/${msgId}/react`, { emoji, username }),
  getPinnedMessages: (teamId) => apiCall('GET', `/api/chat/messages/${teamId}/pinned`),
  togglePin: (msgId) => apiCall('PATCH', `/api/chat/messages/${msgId}/pin`),

  // ── Guest ────────────────────────────────────────────────────────
  guestLogin: () => apiCall('POST', '/api/auth/guest'),
  // ── Channels ─────────────────────────────────────────────────
  getChannels: (teamId) => apiCall('GET', `/api/channels/team/${teamId}`),
  createChannel: (data) => apiCall('POST', '/api/channels', data),
  deleteChannel: (id) => apiCall('DELETE', `/api/channels/${id}`),
  toggleChannelAI: (id) => apiCall('PATCH', `/api/channels/${id}/toggle-ai`),
  getChannelMessages: (id, limit = 50) => apiCall('GET', `/api/channels/${id}/messages?limit=${limit}`),
  sendChannelMessage: (id, data) => apiCall('POST', `/api/channels/${id}/messages`, data),
  channelAIReply: (id, message, lang) => apiCall('POST', `/api/channels/${id}/ai-reply?message=${encodeURIComponent(message)}&language=${lang}`),
  channelSummary: (id, lang) => apiCall('POST', `/api/channels/${id}/ai-summary?language=${lang}`),};
