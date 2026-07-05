/**
 * MRgram — Admin Statistics Panel
 * Firebase Firestore Overview grafigi ko'rinishida
 */

import { db, state } from './config.js';
import { ADMIN_UID } from './view-users.js';
import {
  collection, getDocs, query, orderBy
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

/* ── CSS ─────────────────────────────────────────────────────────────── */
function _injectCSS() {
  if (document.getElementById('stats-css')) return;
  const s = document.createElement('style');
  s.id = 'stats-css';
  s.textContent = `
/* ══════════════════════════════════════════
   ADMIN STATS — Firebase Overview style
   ══════════════════════════════════════════ */

#statsView,
#actionsStatsSection {
  display: flex;
  flex-direction: column;
  background: var(--bg);
  /* actions view ichida scroll yo'q — parent scroll qiladi */
}

.stats-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.stats-header-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.2px;
}
.stats-period-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--line2);
  background: var(--bg3);
  color: var(--text2);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition: background 0.15s;
}
.stats-period-pill:hover { background: var(--bg4); }

/* ── Period tabs ── */
.stats-period-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--line);
  overflow-x: auto;
  scrollbar-width: none;
  flex-shrink: 0;
}
.stats-period-tabs::-webkit-scrollbar { display: none; }
.stats-ptab {
  padding: 5px 14px;
  border-radius: 6px;
  border: 1px solid var(--line2);
  background: transparent;
  color: var(--text3);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: var(--font);
  white-space: nowrap;
  transition: all 0.15s;
}
.stats-ptab:hover { color: var(--text2); background: var(--bg3); }
.stats-ptab.active {
  background: var(--blue);
  border-color: var(--blue);
  color: #fff;
  font-weight: 600;
}

/* ── Overview card (Firebase style) ── */
.stats-overview-card {
  margin: 16px 16px 0;
  border: 1px solid var(--line2);
  border-radius: 14px;
  background: var(--bg2);
  overflow: hidden;
}
.stats-overview-inner {
  display: grid;
  grid-template-columns: 160px 1fr;
  min-height: 200px;
}
@media (max-width: 480px) {
  .stats-overview-inner {
    grid-template-columns: 130px 1fr;
  }
}

/* Left legend panel */
.stats-legend-panel {
  padding: 20px 16px;
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: var(--bg2);
}
.stats-legend-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: 8px;
  transition: background 0.15s;
  margin: -6px -8px;
}
.stats-legend-item:hover { background: var(--bg3); }
.stats-legend-item--off { opacity: 0.4; }

.stats-legend-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.stats-legend-check {
  width: 14px; height: 14px;
  border-radius: 3px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.stats-legend-check svg { width: 10px; height: 10px; }
.stats-legend-name {
  font-size: 11px;
  color: var(--text3);
  font-weight: 500;
}
.stats-legend-val {
  font-size: 22px;
  font-weight: 800;
  letter-spacing: -0.8px;
  line-height: 1;
  margin-left: 2px;
}
.stats-legend-sub {
  font-size: 10px;
  color: var(--text3);
  margin-left: 2px;
}

/* Right chart panel */
.stats-chart-panel {
  position: relative;
  padding: 16px 16px 8px 8px;
  overflow: hidden;
}
.stats-chart-svg {
  width: 100%;
  height: 170px;
  overflow: visible;
  display: block;
}

/* Y-axis labels */
.stats-y-label {
  font-size: 9px;
  fill: var(--text3, #666);
}
/* X-axis labels */
.stats-x-label {
  font-size: 9px;
  fill: var(--text3, #666);
}

/* ── Summary cards row ── */
.stats-cards-row {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  padding: 14px 16px 0;
}
@media (min-width: 600px) {
  .stats-cards-row { grid-template-columns: repeat(4, 1fr); }
}
.stats-mini-card {
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 14px 14px 12px;
  position: relative;
  overflow: hidden;
}
.stats-mini-card::after {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  border-radius: 12px 12px 0 0;
}
.stats-mini-card--blue::after  { background: var(--blue); }
.stats-mini-card--green::after { background: var(--green); }
.stats-mini-card--amber::after { background: var(--amber); }
.stats-mini-card--red::after   { background: var(--red); }

.stats-mini-icon { font-size: 18px; margin-bottom: 6px; display: block; }
.stats-mini-icon svg { width: 18px; height: 18px; }
.stats-mini-card--blue  .stats-mini-icon { color: var(--blue); }
.stats-mini-card--green .stats-mini-icon { color: var(--green); }
.stats-mini-card--amber .stats-mini-icon { color: var(--amber); }
.stats-mini-card--red   .stats-mini-icon { color: var(--red); }
.stats-mini-val  {
  font-size: 22px; font-weight: 800; color: var(--text);
  letter-spacing: -0.5px; line-height: 1; margin-bottom: 3px;
}
.stats-mini-label { font-size: 11px; color: var(--text3); }
.stats-mini-trend {
  position: absolute; top: 12px; right: 10px;
  font-size: 10px; font-weight: 600;
  padding: 2px 6px; border-radius: 20px;
}
.trend-up   { background: rgba(90,203,140,0.15); color: var(--green); }
.trend-down { background: rgba(240,96,144,0.15);  color: var(--red);   }
.trend-neu  { background: var(--bg4); color: var(--text3); }

/* ── Second chart: Users vs Posts bar ── */
.stats-section {
  margin: 14px 16px 0;
}
.stats-section-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.stats-section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}
.stats-section-sub {
  font-size: 11px;
  color: var(--text3);
}
.stats-chart2-wrap {
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 14px 14px 10px;
}
.stats-chart2-inner {
  display: grid;
  grid-template-columns: 130px 1fr;
}
@media (max-width: 480px) {
  .stats-chart2-inner { grid-template-columns: 110px 1fr; }
}
.stats-legend2 {
  padding: 8px 12px 8px 4px;
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 14px;
  justify-content: center;
}
.stats-legend2-item { cursor: pointer; }
.stats-legend2-name { font-size: 10px; color: var(--text3); display: flex; align-items: center; gap: 5px; }
.stats-legend2-dot  { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
.stats-legend2-val  { font-size: 18px; font-weight: 800; color: var(--text); letter-spacing: -0.5px; margin-top: 2px; }
.stats-legend2-sub  { font-size: 10px; color: var(--text3); }

/* ── Status donut section ── */
.stats-donut-wrap {
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 14px;
  align-items: center;
}
.stats-donut-center { position: relative; width: 110px; height: 110px; }
.stats-donut-center svg { width: 100%; height: 100%; }
.stats-donut-text {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%,-50%);
  text-align: center; pointer-events: none;
}
.stats-donut-big   { font-size: 20px; font-weight: 800; color: var(--text); line-height: 1; display: block; }
.stats-donut-small { font-size: 9px; color: var(--text3); display: block; margin-top: 2px; }
.stats-donut-legend { display: flex; flex-direction: column; gap: 9px; }
.stats-donut-row { display: flex; align-items: center; gap: 7px; }
.stats-donut-dot { width: 9px; height: 9px; border-radius: 2px; flex-shrink: 0; }
.stats-donut-lbl { font-size: 11.5px; color: var(--text2); flex: 1; }
.stats-donut-num { font-size: 12px; font-weight: 700; color: var(--text); }
.stats-donut-pct { font-size: 10px; color: var(--text3); margin-left: 3px; }

/* ── Top users ── */
.stats-top-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--bg2);
  border: 1px solid var(--line);
  margin-bottom: 7px;
  transition: background 0.15s;
}
.stats-top-row:hover { background: var(--bg3); }
.stats-top-rank { font-size: 13px; font-weight: 800; color: var(--text3); width: 24px; text-align: center; flex-shrink: 0; }
.stats-top-avi {
  width: 34px; height: 34px; border-radius: 50%;
  overflow: hidden; flex-shrink: 0;
  background: linear-gradient(135deg, var(--blue3), var(--blue));
  display: flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 700; color: #fff;
  border: 1.5px solid var(--line2);
}
.stats-top-avi img { width: 100%; height: 100%; object-fit: cover; }
.stats-top-info { flex: 1; min-width: 0; }
.stats-top-name { font-size: 12.5px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stats-top-sub  { font-size: 10.5px; color: var(--text3); }
.stats-top-bar-wrap { flex: 1; max-width: 80px; }
.stats-top-bar-bg { height: 4px; border-radius: 2px; background: var(--bg4); overflow: hidden; }
.stats-top-bar-fill { height: 100%; border-radius: 2px; background: linear-gradient(90deg, var(--blue3), var(--blue2)); transition: width 0.5s; }
.stats-top-count { font-size: 13px; font-weight: 700; color: var(--blue); flex-shrink: 0; min-width: 28px; text-align: right; }

.stats-pb { height: 80px; }

/* ── Tooltip ── */
.stats-tooltip {
  position: fixed;
  background: var(--bg2);
  border: 1px solid var(--line2);
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 11px;
  color: var(--text);
  pointer-events: none;
  z-index: 9999;
  box-shadow: 0 4px 16px rgba(0,0,0,0.25);
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.1s;
}
.stats-tooltip.show { opacity: 1; }
.stats-tooltip-date { font-size: 10px; color: var(--text3); margin-bottom: 4px; }
.stats-tooltip-line { display: flex; align-items: center; gap: 5px; margin-top: 2px; }
.stats-tooltip-dot  { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }

[data-theme="dark"] .stats-overview-card,
[data-theme="dark"] .stats-chart2-wrap,
[data-theme="dark"] .stats-donut-wrap {
  background: rgba(255,255,255,0.025);
  border-color: rgba(255,255,255,0.08);
}
`;
  document.head.appendChild(s);
}

/* ── State ── */
let _period = 30;
let _visibility = { users: true, posts: true, likes: true };
let _statsInitialized = false;
let _currentWrap = null;

/* ── initView ── */
export async function initView(containerEl) {
  if (!state.me || state.me.uid !== ADMIN_UID) return;
  if (_statsInitialized) { return; } // Guard: qayta render qilma
  _statsInitialized = true;
  _injectCSS();
  _ensureTooltip();
  const wrap = containerEl || document.getElementById('statsView');
  if (!wrap) return;
  // wrap ni keyingi _load() chaqiruvi uchun saqlaymiz
  _currentWrap = wrap;
  const isEmbedded = wrap.id === 'actionsStatsSection';
  wrap.innerHTML = `
    ${isEmbedded ? '' : `
    <div class="stats-header">
      <div class="stats-header-title">Statistika</div>
      <div class="stats-period-pill" id="statsPeriodLabel">So'nggi ${_period} kun</div>
    </div>`}
    <div class="stats-period-tabs">
      ${[7,14,30,60,90].map(d => `
        <button class="stats-ptab ${_period===d?'active':''}" data-d="${d}">${d} kun</button>
      `).join('')}
    </div>
    <div id="statsBody" style="padding-bottom:80px">
      <div style="display:flex;align-items:center;justify-content:center;height:200px;color:var(--text3);font-size:13px">
        Yuklanmoqda...
      </div>
    </div>
  `;

  wrap.querySelectorAll('.stats-ptab').forEach(btn => {
    btn.addEventListener('click', () => {
      _period = +btn.dataset.d;
      const pill = wrap.querySelector('.stats-period-pill');
      if (pill) pill.textContent = `So'nggi ${_period} kun`;
      wrap.querySelectorAll('.stats-ptab').forEach(b => b.classList.toggle('active', b===btn));
      _load();
    });
  });

  await _load();
}

async function _load() {
  const wrap = _currentWrap;
  if (!wrap) return;
  const body = wrap.querySelector('#statsBody') || document.getElementById('statsBody');
  if (!body) return;

  try {
    const data = await _fetchData();
    _renderBody(body, data);
  } catch(err) {
    console.error('[Stats]', err);
    body.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text3)">${err.message}</div>`;
  }
}

/* ── Fetch ── */
async function _fetchData() {
  const [usersSnap, postsSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc')))
  ]);

  const now = Date.now();
  const DAY = 86400000;
  const days = _period;

  // Build daily buckets
  const buckets = {}; // "YYYY-MM-DD" -> {users, posts, likes}
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    const key = _dayKey(d);
    buckets[key] = { users: 0, posts: 0, likes: 0 };
  }

  const users = [];
  usersSnap.forEach(d => users.push({ id: d.id, ...d.data() }));

  const posts = [];
  postsSnap.forEach(d => posts.push({ id: d.id, ...d.data() }));

  // Fill users
  users.forEach(u => {
    const ts = u.createdAt?.toDate?.() || (u.createdAt ? new Date(u.createdAt) : null);
    if (!ts) return;
    const key = _dayKey(ts);
    if (key in buckets) buckets[key].users++;
  });

  // Fill posts + likes
  posts.forEach(p => {
    const ts = p.createdAt?.toDate?.() || (p.createdAt ? new Date(p.createdAt) : null);
    if (!ts) return;
    const key = _dayKey(ts);
    if (key in buckets) {
      buckets[key].posts++;
      buckets[key].likes += (p.likeCount || p.likes || 0);
    }
  });

  const keys = Object.keys(buckets).sort();
  const dailyUsers = keys.map(k => buckets[k].users);
  const dailyPosts = keys.map(k => buckets[k].posts);
  const dailyLikes = keys.map(k => buckets[k].likes);

  // Cumulative
  let cu = 0, cp = 0, cl = 0;
  const cumUsers = dailyUsers.map(v => (cu += v, cu));
  const cumPosts = dailyPosts.map(v => (cp += v, cp));
  const cumLikes = dailyLikes.map(v => (cl += v, cl));

  // Totals in period
  const totalUsersInPeriod = dailyUsers.reduce((a,b) => a+b, 0);
  const totalPostsInPeriod = dailyPosts.reduce((a,b) => a+b, 0);
  const totalLikesInPeriod = dailyLikes.reduce((a,b) => a+b, 0);

  // All-time
  const totalUsers = users.length;
  const totalPosts = posts.length;
  const totalViews = posts.reduce((s,p) => s+(p.views||0), 0);
  const totalLikes = posts.reduce((s,p) => s+(p.likeCount||p.likes||0), 0);

  // Week growth
  const half = Math.floor(days/2);
  const recentUsers = dailyUsers.slice(-half).reduce((a,b)=>a+b,0);
  const prevUsers   = dailyUsers.slice(0, half).reduce((a,b)=>a+b,0);
  const growth = prevUsers > 0 ? Math.round((recentUsers-prevUsers)/prevUsers*100) : (recentUsers>0?100:0);

  // Status
  const status = { approved:0, pending:0, rejected:0, blocked:0 };
  users.forEach(u => {
    if (u.blocked) { status.blocked++; return; }
    const ap = u.approved;
    if (ap===true||ap==='approved') status.approved++;
    else if (ap==='rejected') status.rejected++;
    else status.pending++;
  });

  // Top posters
  const pCount = {};
  posts.forEach(p => { if (p.uid) pCount[p.uid] = (pCount[p.uid]||0)+1; });
  const topPosters = Object.entries(pCount)
    .sort((a,b)=>b[1]-a[1])
    .map(([uid,cnt]) => {
      const u = users.find(x => x.uid === uid || x.id === uid);
      if (!u) return null;
      return { uid, cnt, name: u.fullName||u.username||u.displayName||'—', avatar: u.avatar };
    })
    .filter(Boolean)
    .slice(0,5);

  return {
    keys, dailyUsers, dailyPosts, dailyLikes,
    cumUsers, cumPosts, cumLikes,
    totalUsersInPeriod, totalPostsInPeriod, totalLikesInPeriod,
    totalUsers, totalPosts, totalViews, totalLikes,
    growth, status, topPosters
  };
}

/* ── Render body ── */
function _renderBody(body, d) {
  const {
    keys, dailyUsers, dailyPosts, dailyLikes,
    cumUsers, cumPosts, cumLikes,
    totalUsersInPeriod, totalPostsInPeriod, totalLikesInPeriod,
    totalUsers, totalPosts, totalViews, totalLikes,
    growth, status, topPosters
  } = d;

  const trendCls = growth >= 0 ? 'trend-up' : 'trend-down';
  const trendTxt = `${growth>=0?'+':'-'} ${Math.abs(growth)}%`;

  body.innerHTML = `
    <!-- 1. Main overview chart (Firebase style) -->
    <div class="stats-overview-card">
      <div class="stats-overview-inner">

        <!-- Left: legend -->
        <div class="stats-legend-panel">
          <div class="stats-legend-item ${_visibility.users?'':'stats-legend-item--off'}" data-series="users">
            <div class="stats-legend-top">
              ${_checkIcon('#5b8ef5')}
              <span class="stats-legend-name">Yangi users</span>
            </div>
            <div class="stats-legend-val" style="color:#5b8ef5">${_fmtK(totalUsersInPeriod)}</div>
            <div class="stats-legend-sub">jami ro'yxat</div>
          </div>
          <div class="stats-legend-item ${_visibility.posts?'':'stats-legend-item--off'}" data-series="posts">
            <div class="stats-legend-top">
              ${_checkIcon('#f0a855')}
              <span class="stats-legend-name">Yangi postlar</span>
            </div>
            <div class="stats-legend-val" style="color:#f0a855">${_fmtK(totalPostsInPeriod)}</div>
            <div class="stats-legend-sub">jami post</div>
          </div>
          <div class="stats-legend-item ${_visibility.likes?'':'stats-legend-item--off'}" data-series="likes">
            <div class="stats-legend-top">
              ${_checkIcon('#f06090')}
              <span class="stats-legend-name">Likelar</span>
            </div>
            <div class="stats-legend-val" style="color:#f06090">${_fmtK(totalLikesInPeriod)}</div>
            <div class="stats-legend-sub">jami like</div>
          </div>
        </div>

        <!-- Right: chart -->
        <div class="stats-chart-panel" id="mainChartPanel">
          ${_renderMainChart(keys, dailyUsers, dailyPosts, dailyLikes)}
        </div>
      </div>
    </div>

    <!-- 2. Summary cards -->
    <div class="stats-cards-row">
      <div class="stats-mini-card stats-mini-card--blue">
        <span class="stats-mini-icon">${_iconUsers()}</span>
        <div class="stats-mini-val">${_fmtK(totalUsers)}</div>
        <div class="stats-mini-label">Jami users</div>
        <div class="stats-mini-trend ${trendCls}">${trendTxt}</div>
      </div>
      <div class="stats-mini-card stats-mini-card--green">
        <span class="stats-mini-icon">${_iconCheck()}</span>
        <div class="stats-mini-val">${_fmtK(status.approved)}</div>
        <div class="stats-mini-label">Tasdiqlangan</div>
      </div>
      <div class="stats-mini-card stats-mini-card--amber">
        <span class="stats-mini-icon">${_iconPost()}</span>
        <div class="stats-mini-val">${_fmtK(totalPosts)}</div>
        <div class="stats-mini-label">Jami postlar</div>
      </div>
      <div class="stats-mini-card stats-mini-card--red">
        <span class="stats-mini-icon">${_iconEye()}</span>
        <div class="stats-mini-val">${_fmtK(totalViews)}</div>
        <div class="stats-mini-label">Ko'rishlar</div>
      </div>
    </div>

    <!-- 3. Users vs Posts chart -->
    <div class="stats-section">
      <div class="stats-section-hdr">
        <div class="stats-section-title">Kunlik faollik</div>
        <div class="stats-section-sub">${_period} kun</div>
      </div>
      <div class="stats-chart2-wrap">
        <div class="stats-chart2-inner">
          <div class="stats-legend2">
            <div class="stats-legend2-item">
              <div class="stats-legend2-name"><span class="stats-legend2-dot" style="background:#5b8ef5"></span>Foydalanuvchilar</div>
              <div class="stats-legend2-val">${_fmtK(totalUsersInPeriod)}</div>
              <div class="stats-legend2-sub">+${_period} kunda</div>
            </div>
            <div class="stats-legend2-item">
              <div class="stats-legend2-name"><span class="stats-legend2-dot" style="background:#f0a855"></span>Postlar</div>
              <div class="stats-legend2-val">${_fmtK(totalPostsInPeriod)}</div>
              <div class="stats-legend2-sub">+${_period} kunda</div>
            </div>
          </div>
          <div style="padding:8px 0 4px 8px">
            ${_renderBarChart(keys, dailyUsers, dailyPosts)}
          </div>
        </div>
      </div>
    </div>

    <!-- 4. Status donut -->
    <div class="stats-section">
      <div class="stats-section-hdr">
        <div class="stats-section-title">User holati</div>
        <div class="stats-section-sub">${totalUsers} ta jami</div>
      </div>
      <div class="stats-donut-wrap">
        <div class="stats-donut-center">
          ${_donutSVG([
            { val: status.approved, color: '#5acb8c' },
            { val: status.pending,  color: '#f0a855' },
            { val: status.rejected, color: '#f06090' },
            { val: status.blocked,  color: '#8e44ad' },
          ], totalUsers)}
          <div class="stats-donut-text">
            <span class="stats-donut-big">${totalUsers}</span>
            <span class="stats-donut-small">jami</span>
          </div>
        </div>
        <div class="stats-donut-legend">
          ${[
            { label:'Tasdiqlangan', val:status.approved, color:'#5acb8c' },
            { label:'Kutmoqda',     val:status.pending,  color:'#f0a855' },
            { label:'Rad etilgan',  val:status.rejected, color:'#f06090' },
            { label:'Bloklangan',   val:status.blocked,  color:'#8e44ad' },
          ].map(it => `
            <div class="stats-donut-row">
              <div class="stats-donut-dot" style="background:${it.color}"></div>
              <div class="stats-donut-lbl">${it.label}</div>
              <div class="stats-donut-num">${it.val}</div>
              <div class="stats-donut-pct">${totalUsers>0?Math.round(it.val/totalUsers*100):0}%</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- 5. Top posters -->
    ${topPosters.length ? `
    <div class="stats-section">
      <div class="stats-section-hdr">
        <div class="stats-section-title">Top foydalanuvchilar</div>
      </div>
      ${topPosters.map((u,i) => {
        const maxCnt = topPosters[0].cnt || 1;
        const pct = Math.round(u.cnt/maxCnt*100);
        return `
        <div class="stats-top-row">
          <div class="stats-top-rank">${i===0?'#1':i===1?'#2':i===2?'#3':'#'+(i+1)}</div>
          <div class="stats-top-avi">
            ${u.avatar ? `<img src="${u.avatar}" loading="lazy">` : (u.name[0]||'?').toUpperCase()}
          </div>
          <div class="stats-top-info">
            <div class="stats-top-name">${_esc(u.name)}</div>
            <div class="stats-top-sub">${u.cnt} post</div>
          </div>
          <div class="stats-top-bar-wrap">
            <div class="stats-top-bar-bg">
              <div class="stats-top-bar-fill" style="width:${pct}%"></div>
            </div>
          </div>
          <div class="stats-top-count">${u.cnt}</div>
        </div>`;
      }).join('')}
    </div>
    ` : ''}

    <!-- 6. Like efficiency -->
    <div class="stats-section">
      <div class="stats-section-hdr">
        <div class="stats-section-title">Like samaradorligi</div>
      </div>
      <div class="stats-chart2-wrap">
        <div style="display:flex;gap:24px;padding:8px 4px;flex-wrap:wrap">
          ${[
            { label:'Jami likelar',       val: _fmtK(totalLikes),  color:'#f06090' },
            { label:'Post boshiga',        val: totalPosts>0?(totalLikes/totalPosts).toFixed(1):'—',  color:'#f0a855' },
            { label:'Ko\'rish boshiga',   val: totalViews>0?(totalLikes/totalViews*100).toFixed(1)+'%':'—', color:'#5b8ef5' },
          ].map(it => `
            <div>
              <div style="font-size:10px;color:var(--text3);margin-bottom:4px">${it.label}</div>
              <div style="font-size:22px;font-weight:800;color:${it.color};letter-spacing:-0.5px">${it.val}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <div class="stats-pb"></div>
  `;

  // Legend click → toggle series
  body.querySelectorAll('.stats-legend-item[data-series]').forEach(el => {
    el.addEventListener('click', () => {
      const s = el.dataset.series;
      _visibility[s] = !_visibility[s];
      el.classList.toggle('stats-legend-item--off', !_visibility[s]);
      // Redraw main chart — body-scoped, document ga emas
      const panel = body.querySelector('#mainChartPanel');
      if (panel) panel.innerHTML = _renderMainChart(keys, dailyUsers, dailyPosts, dailyLikes);
      _attachChartEvents(panel, keys, dailyUsers, dailyPosts, dailyLikes);
    });
  });

  // Attach tooltip events — body-scoped
  _attachChartEvents(
    body.querySelector('#mainChartPanel'),
    keys, dailyUsers, dailyPosts, dailyLikes
  );
}

/* ── Main Line Chart (Firebase overview style) ── */
function _renderMainChart(keys, users, posts, likes) {
  const W = 500, H = 150, PL = 32, PR = 8, PT = 10, PB = 26;
  const iW = W - PL - PR, iH = H - PT - PB;
  const n = keys.length;
  if (!n) return `<svg class="stats-chart-svg" viewBox="0 0 ${W} ${H}"></svg>`;

  const maxVal = Math.max(
    _visibility.users ? Math.max(...users) : 0,
    _visibility.posts ? Math.max(...posts) : 0,
    _visibility.likes ? Math.max(...likes) : 0,
    1
  );

  const yN = _niceSteps(maxVal, 4);
  const yStep = yN.max / (yN.ticks - 1);

  const xOf  = i => PL + (i / (n-1||1)) * iW;
  const yOf  = v => PT + iH - (v / yN.max) * iH;

  // Build polyline points
  const lineU = users.map((v,i) => `${xOf(i)},${yOf(v)}`).join(' ');
  const lineP = posts.map((v,i) => `${xOf(i)},${yOf(v)}`).join(' ');
  const lineL = likes.map((v,i) => `${xOf(i)},${yOf(v)}`).join(' ');

  // Area polygon
  const areaU = `${xOf(0)},${yOf(0)} ${lineU} ${xOf(n-1)},${yOf(0)}`;
  const areaP = `${xOf(0)},${yOf(0)} ${lineP} ${xOf(n-1)},${yOf(0)}`;
  const areaL = `${xOf(0)},${yOf(0)} ${lineL} ${xOf(n-1)},${yOf(0)}`;

  // Y axis labels
  const yLabels = Array.from({length: yN.ticks}, (_,i) => {
    const val = yStep * i;
    const y = yOf(val);
    return `<text class="stats-y-label" x="${PL-4}" y="${y+3.5}" text-anchor="end">${_fmtAxis(val)}</text>`;
  }).join('');

  // Y grid lines
  const yGrids = Array.from({length: yN.ticks}, (_,i) => {
    const val = yStep * i;
    const y = yOf(val);
    return `<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" stroke="var(--line)" stroke-width="${i===0?1.5:0.8}" stroke-dasharray="${i===0?'none':'3,4'}"/>`;
  }).join('');

  // X axis labels — show ~6 labels
  const xStep = Math.max(1, Math.floor(n / 6));
  const xLabels = keys.map((k,i) => {
    if (i % xStep !== 0 && i !== n-1) return '';
    const d = new Date(k);
    const lbl = `${d.getDate()} ${_monthShort(d.getMonth())}`;
    return `<text class="stats-x-label" x="${xOf(i)}" y="${H-6}" text-anchor="middle">${lbl}</text>`;
  }).join('');

  // Invisible hit areas for tooltip
  const hitRects = keys.map((k,i) => {
    const x = xOf(i);
    const w2 = iW / (n * 2);
    return `<rect class="chart-hit" data-i="${i}" x="${x-w2}" y="${PT}" width="${w2*2}" height="${iH}" fill="transparent" cursor="crosshair"/>`;
  }).join('');

  // Vertical cursor line (hidden initially)
  const cursor = `<line id="chartCursor" x1="0" y1="${PT}" x2="0" y2="${PT+iH}" stroke="var(--line3)" stroke-width="1" stroke-dasharray="3,3" opacity="0"/>`;

  // Dot indicators
  const dotU = `<circle id="dotU" cx="0" cy="0" r="3.5" fill="#5b8ef5" stroke="var(--bg2)" stroke-width="2" opacity="0"/>`;
  const dotP = `<circle id="dotP" cx="0" cy="0" r="3.5" fill="#f0a855" stroke="var(--bg2)" stroke-width="2" opacity="0"/>`;
  const dotL = `<circle id="dotL" cx="0" cy="0" r="3.5" fill="#f06090" stroke="var(--bg2)" stroke-width="2" opacity="0"/>`;

  return `
    <svg class="stats-chart-svg" id="mainChartSVG" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
         style="height:170px">
      <defs>
        <linearGradient id="gU" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#5b8ef5" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="#5b8ef5" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="gP" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f0a855" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#f0a855" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="gL" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f06090" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#f06090" stop-opacity="0"/>
        </linearGradient>
        <clipPath id="chartClip">
          <rect x="${PL}" y="${PT}" width="${iW}" height="${iH+1}"/>
        </clipPath>
      </defs>

      <!-- Grid -->
      ${yGrids}

      <!-- Chart area (clipped) -->
      <g clip-path="url(#chartClip)">
        ${_visibility.likes ? `<polygon points="${areaL}" fill="url(#gL)" opacity="0.8"/>` : ''}
        ${_visibility.posts ? `<polygon points="${areaP}" fill="url(#gP)" opacity="0.8"/>` : ''}
        ${_visibility.users ? `<polygon points="${areaU}" fill="url(#gU)" opacity="0.9"/>` : ''}
        ${_visibility.likes ? `<polyline points="${lineL}" fill="none" stroke="#f06090" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
        ${_visibility.posts ? `<polyline points="${lineP}" fill="none" stroke="#f0a855" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
        ${_visibility.users ? `<polyline points="${lineU}" fill="none" stroke="#5b8ef5" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
      </g>

      <!-- Axes -->
      ${yLabels}
      ${xLabels}

      <!-- Interactive layer -->
      ${cursor}
      ${dotU}${dotP}${dotL}
      ${hitRects}
    </svg>
  `;
}

/* ── Attach tooltip events ── */
function _attachChartEvents(panel, keys, users, posts, likes) {
  if (!panel) return;
  const svg = panel.querySelector('#mainChartSVG');
  if (!svg) return;

  const tt = document.getElementById('statsTooltipEl');
  const cursor = svg.querySelector('#chartCursor');
  const dotU = svg.querySelector('#dotU');
  const dotP = svg.querySelector('#dotP');
  const dotL = svg.querySelector('#dotL');

  const W = 500, H = 150, PL = 32, PR = 8, PT = 10, PB = 26;
  const iW = W - PL - PR, iH = H - PT - PB;
  const n = keys.length;

  const maxVal = Math.max(
    _visibility.users ? Math.max(...users) : 0,
    _visibility.posts ? Math.max(...posts) : 0,
    _visibility.likes ? Math.max(...likes) : 0,
    1
  );

  const yN = _niceSteps(maxVal, 4);
  const xOf = i => PL + (i / (n-1||1)) * iW;
  const yOf = v => PT + iH - (v / yN.max) * iH;

  svg.querySelectorAll('.chart-hit').forEach(rect => {
    rect.addEventListener('mouseenter', e => {
      const i = +rect.dataset.i;
      const x = xOf(i);

      if (cursor) { cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); cursor.setAttribute('opacity','1'); }

      const d = new Date(keys[i]);
      const dateStr = `${d.getDate()} ${_monthShort(d.getMonth())} ${d.getFullYear()}`;
      let lines = '';
      if (_visibility.users) lines += `<div class="stats-tooltip-line"><div class="stats-tooltip-dot" style="background:#5b8ef5"></div>Users: <b>${users[i]}</b></div>`;
      if (_visibility.posts) lines += `<div class="stats-tooltip-line"><div class="stats-tooltip-dot" style="background:#f0a855"></div>Postlar: <b>${posts[i]}</b></div>`;
      if (_visibility.likes) lines += `<div class="stats-tooltip-line"><div class="stats-tooltip-dot" style="background:#f06090"></div>Likelar: <b>${likes[i]}</b></div>`;

      if (tt) {
        tt.innerHTML = `<div class="stats-tooltip-date">${dateStr}</div>${lines}`;
        tt.classList.add('show');
      }

      if (dotU) { dotU.setAttribute('cx', x); dotU.setAttribute('cy', yOf(users[i])); dotU.setAttribute('opacity', _visibility.users?'1':'0'); }
      if (dotP) { dotP.setAttribute('cx', x); dotP.setAttribute('cy', yOf(posts[i])); dotP.setAttribute('opacity', _visibility.posts?'1':'0'); }
      if (dotL) { dotL.setAttribute('cx', x); dotL.setAttribute('cy', yOf(likes[i])); dotL.setAttribute('opacity', _visibility.likes?'1':'0'); }
    });

    rect.addEventListener('mousemove', e => {
      if (tt) {
        tt.style.left = (e.clientX + 12) + 'px';
        tt.style.top  = (e.clientY - 40) + 'px';
      }
    });

    rect.addEventListener('mouseleave', () => {
      if (cursor) cursor.setAttribute('opacity','0');
      if (tt) tt.classList.remove('show');
      if (dotU) dotU.setAttribute('opacity','0');
      if (dotP) dotP.setAttribute('opacity','0');
      if (dotL) dotL.setAttribute('opacity','0');
    });
  });
}

/* ── Bar chart ── */
function _renderBarChart(keys, users, posts) {
  const maxVal = Math.max(...users, ...posts, 1);
  const H = 90;
  const n = keys.length;
  const step = Math.max(1, Math.floor(n / 8));

  const bars = keys.map((k, i) => {
    const hu = Math.max(users[i]/maxVal*H, users[i]>0?2:0);
    const hp = Math.max(posts[i]/maxVal*H, posts[i]>0?2:0);
    const showLbl = i % step === 0 || i === n-1;
    const d = new Date(k);
    const lbl = showLbl ? `${d.getDate()}/${d.getMonth()+1}` : '';
    return `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0">
        <div style="display:flex;gap:1px;align-items:flex-end;height:${H}px;width:100%;justify-content:center">
          <div style="flex:1;max-width:9px;height:${hu}px;border-radius:2px 2px 0 0;background:linear-gradient(180deg,#7ba5ff,#3a6bd4);opacity:${users[i]>0?1:0.2}" title="${k}: ${users[i]} user"></div>
          <div style="flex:1;max-width:9px;height:${hp}px;border-radius:2px 2px 0 0;background:linear-gradient(180deg,#f0c875,#e67e22);opacity:${posts[i]>0?1:0.2}" title="${k}: ${posts[i]} post"></div>
        </div>
        <div style="font-size:8.5px;color:var(--text3);text-align:center;overflow:hidden;width:100%;white-space:nowrap">${lbl}</div>
      </div>`;
  }).join('');

  return `<div style="display:flex;gap:3px;align-items:flex-end;height:${H+18}px;width:100%">${bars}</div>`;
}

/* ── Donut SVG ── */
function _donutSVG(segs, total) {
  const R=42, CX=55, CY=55, SW=13, C=2*Math.PI*R;
  let off=0;
  const arcs = segs.map(s => {
    const d = total>0?s.val/total*C:0;
    const a = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${s.color}" stroke-width="${SW}"
      stroke-dasharray="${d} ${C-d}" stroke-dashoffset="${-off}"
      transform="rotate(-90 ${CX} ${CY})" opacity="${s.val>0?1:0.1}"/>`;
    off += d; return a;
  });
  return `<svg width="110" height="110" viewBox="0 0 110 110">
    <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--bg4)" stroke-width="${SW}"/>
    ${arcs.join('')}
  </svg>`;
}

/* ── Tooltip el ── */
function _ensureTooltip() {
  if (document.getElementById('statsTooltipEl')) return;
  const el = document.createElement('div');
  el.id = 'statsTooltipEl';
  el.className = 'stats-tooltip';
  document.body.appendChild(el);
}

/* ── Mini-card icons ── */
function _iconUsers() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>`;
}
function _iconCheck() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
  </svg>`;
}
function _iconPost() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18"/><path d="M9 21V9"/>
  </svg>`;
}
function _iconEye() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/>
  </svg>`;
}

/* ── Check icon ── */
function _checkIcon(color) {
  return `<div class="stats-legend-check" style="background:${color}">
    <svg viewBox="0 0 10 10" fill="none"><polyline points="2,5 4,7.5 8,2.5" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </div>`;
}

/* ── Nice axis steps ── */
function _niceSteps(max, ticks=4) {
  if (max <= 0) return { max: 10, ticks };
  const raw = max / (ticks - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1,2,2.5,5,10].map(f => f*mag).find(f => f >= raw) || raw;
  return { max: nice * (ticks - 1), ticks };
}

function _fmtAxis(v) {
  if (v >= 1000000) return (v/1000000).toFixed(1)+'M';
  if (v >= 1000)    return (v/1000).toFixed(0)+'K';
  return String(Math.round(v));
}
function _fmtK(n) {
  if (n >= 1000000) return (n/1000000).toFixed(1)+'M';
  if (n >= 1000)    return (n/1000).toFixed(1)+'K';
  return String(n);
}
function _dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _monthShort(m) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m];
}
function _esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export function destroyView() {
  _visibility = { users: true, posts: true, likes: true };
  _statsInitialized = false;
  _currentWrap = null;
}
