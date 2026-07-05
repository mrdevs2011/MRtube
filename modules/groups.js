/**
 * MRgram — Guruhlar va Kanallar moduli
 * Groups & Channels for MRgram chat
 *
 * Firestore schema:
 *   groups/{groupId} {
 *     type: 'group' | 'channel',
 *     name, avatar, description?,
 *     ownerId, adminIds: [uid,...],
 *     members: [uid,...],
 *     lastMessage, lastSenderId, lastMessageAt,
 *     unreadCount: { [uid]: number },
 *     createdAt, subscriberCount (channel only)
 *   }
 *   groups/{groupId}/messages/{msgId} {
 *     senderId, text?, type?, mediaUrl?, mediaPath?,
 *     mediaType?, fileName?, fileSize?, duration?,
 *     createdAt, status: 'sent'
 *   }
 */

import { db, state, uploadViaController, isAdmin, aiModeratePost } from './config.js';
import { $, esc, defAvi, fmt, fmtTime, fmtSz, lockScroll, unlockScroll } from './utils.js';
import { toast }                                    from './toast.js';
import {
  collection, query, where, orderBy, limit,
  doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, writeBatch, increment, arrayUnion, arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

/* ─────────────────────────────────────────────────────────────────────
   STATE
   ───────────────────────────────────────────────────────────────────── */
let _groupsUnsub     = null;
let _groupThreadUnsub = null;
let _latestGroupMap  = {};   // groupId → group data (for list rendering)
export let groupListItems = []; // exported so chat.js can merge
let _currentGroupId  = null;
let _currentGroupData = null;
let _groupChatSelFile = null;

/* ─────────────────────────────────────────────────────────────────────
   WATCHER — real-time listener for groups/channels the user is in
   ───────────────────────────────────────────────────────────────────── */
export function startGroupsWatcher() {
  if (_groupsUnsub || !state.me?.uid) return;
  _groupsUnsub = onSnapshot(
    query(collection(db, 'groups'), where('memberIds', 'array-contains', state.me.uid)),
    snap => {
      _latestGroupMap = {};
      groupListItems = [];
      snap.docs.forEach(d => {
        const g = { id: d.id, ...d.data() };
        _latestGroupMap[d.id] = g;
        groupListItems.push(g);
      });
      // Notify chat.js list to repaint
      if (state.view === 'chats') {
        const ev = new CustomEvent('groupsUpdated');
        document.dispatchEvent(ev);
      }
    },
    err => console.warn('[Groups] watcher error:', err.message)
  );
}

export function stopGroupsWatcher() {
  if (_groupsUnsub) { _groupsUnsub(); _groupsUnsub = null; }
  if (_groupThreadUnsub) { _groupThreadUnsub(); _groupThreadUnsub = null; }
  _latestGroupMap  = {};
  groupListItems   = [];
  _currentGroupId  = null;
  _currentGroupData = null;
}

/* ─────────────────────────────────────────────────────────────────────
   OPEN GROUP/CHANNEL THREAD
   ───────────────────────────────────────────────────────────────────── */
/* ── Kanal uchun Join / Leave tugmasi ───────────────────────────────── */
function _renderChannelActionBar(groupId, groupData) {
  // Input row ni yashirish
  const inputRow = document.querySelector('.chat-thread-input-row');
  if (inputRow) inputRow.style.display = 'none';

  // Eski bar ni olib tashlash
  document.getElementById('channelActionBar')?.remove();

  const members   = groupData.memberIds || groupData.members || groupData.participants || [];
  const isMember  = Array.isArray(members)
    ? members.includes(state.me.uid)
    : (members[state.me.uid] != null);

  const bar = document.createElement('div');
  bar.id = 'channelActionBar';
  bar.style.cssText = [
    'display:flex', 'align-items:center', 'justify-content:center',
    'padding:10px 16px 10px',
    'background:var(--bg,#0f172a)',
    'border-top:1px solid var(--line,rgba(255,255,255,0.08))',
    'flex-shrink:0',
  ].join(';');

  if (isMember) {
    // Kanaldan chiqish
    bar.innerHTML = `
      <button id="channelLeaveBtn" style="
        width:100%; padding:13px 0; border-radius:14px; border:1.5px solid rgba(239,68,68,0.4);
        background:rgba(239,68,68,0.08); color:#ef4444; font-size:15px; font-weight:600;
        cursor:pointer; transition:all 0.18s; display:flex; align-items:center; justify-content:center; gap:8px;
      ">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Kanalni tark etish
      </button>`;

    bar.querySelector('#channelLeaveBtn').addEventListener('click', async () => {
      try {
        const field = Array.isArray(groupData.memberIds || groupData.members || [])
          ? (groupData.memberIds != null ? 'memberIds' : 'members')
          : 'participants';
        await updateDoc(doc(db, 'groups', groupId), { [field]: arrayRemove(state.me.uid) });
        // UI ni yangilash
        groupData[field] = (groupData[field] || []).filter(id => id !== state.me.uid);
        _renderChannelActionBar(groupId, groupData);
        toast("Kanaldan chiqdingiz", 'info');
      } catch (e) { toast("Xato: " + e.message, 'error'); }
    });
  } else {
    // Kanalga qo'shilish
    bar.innerHTML = `
      <button id="channelJoinBtn" style="
        width:100%; padding:13px 0; border-radius:14px; border:none;
        background:linear-gradient(135deg,#3b82f6,#2563eb); color:#fff;
        font-size:15px; font-weight:600; cursor:pointer;
        transition:all 0.2s; display:flex; align-items:center; justify-content:center; gap:8px;
        box-shadow:0 4px 16px rgba(59,130,246,0.35);
      ">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
        </svg>
        Kanalga qo'shilish
      </button>`;

    bar.querySelector('#channelJoinBtn').addEventListener('mouseenter', function() {
      this.style.transform = 'scale(1.02)';
      this.style.boxShadow = '0 6px 24px rgba(59,130,246,0.5)';
    });
    bar.querySelector('#channelJoinBtn').addEventListener('mouseleave', function() {
      this.style.transform = '';
      this.style.boxShadow = '0 4px 16px rgba(59,130,246,0.35)';
    });

    bar.querySelector('#channelJoinBtn').addEventListener('click', async () => {
      try {
        const field = groupData.memberIds != null ? 'memberIds'
          : groupData.members != null ? 'members' : 'participants';
        await updateDoc(doc(db, 'groups', groupId), { [field]: arrayUnion(state.me.uid) });
        groupData[field] = [...(groupData[field] || []), state.me.uid];
        _renderChannelActionBar(groupId, groupData);
        toast("Kanalga qo'shildingiz!", 'success');
      } catch (e) { toast("Xato: " + e.message, 'error'); }
    });
  }

  // chatThreadModal pastiga qo'shamiz
  const modal = $('chatThreadModal');
  if (modal) modal.appendChild(bar);
}

function _restoreInputRow() {
  // Join/Leave barni o'chirish
  document.getElementById('channelActionBar')?.remove();
  // Input row ni qayta ko'rsatish
  const inputRow = document.querySelector('.chat-thread-input-row');
  if (inputRow) inputRow.style.display = '';
}

export async function openGroupThread(groupId) {
  const groupData = _latestGroupMap[groupId];
  if (!groupData || !state.me) return;

  _currentGroupId   = groupId;
  _currentGroupData = groupData;
  state.currentChatKind = groupData.type; // 'group' | 'channel'

  const modal = $('chatThreadModal');
  modal.classList.add('show');
  lockScroll();
  modal.dataset.kind = groupData.type;
  modal.dataset.gid  = groupId;

  // Header
  const av = groupData.avatar || defAvi(groupData.name || 'G');
  $('chatThreadAvi').innerHTML = `<img src="${av}" onerror="this.style.display='none'">`;

  // Type badge on avi
  let existingBadge = modal.querySelector('.grp-avi-badge');
  if (existingBadge) existingBadge.remove();
  const badge = document.createElement('div');
  badge.className = 'grp-avi-badge grp-avi-badge--' + groupData.type;
  badge.innerHTML = groupData.type === 'channel'
    ? `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>`
    : `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`;
  $('chatThreadAvi').appendChild(badge);

  const memberCount = (groupData.members || []).length;
  const subLabel = groupData.type === 'channel'
    ? `${memberCount} ta obunaçhi`
    : `${memberCount} ta a'zo`;
  $('chatThreadName').textContent = groupData.name || 'Guruh';

  // Subtitle (typing slot reused)
  const typingEl = $('chatTypingStatus');
  if (typingEl) typingEl.textContent = subLabel;

  // Hide call buttons for groups/channels
  ['chatVoiceCallBtn','chatVideoCallBtn'].forEach(id => {
    const el = $(id); if (el) el.style.display = 'none';
  });

  // Input area logic
  const isOwner    = groupData.ownerId === state.me.uid;
  const isGrpAdmin = (groupData.adminIds || []).includes(state.me.uid);
  const isChannel  = groupData.type === 'channel';
  const canPost    = !isChannel || isOwner || isGrpAdmin;

  if (isChannel && !canPost) {
    // Kanal — oddiy foydalanuvchi: input row o'rniga Join/Leave tugmasi
    _renderChannelActionBar(groupId, groupData);
  } else {
    // Guruh yoki kanal admin/egasi: oddiy input
    _restoreInputRow();
    $('chatThreadInput').disabled    = false;
    $('chatThreadInput').placeholder = isChannel ? 'Kanal xabari...' : 'Xabar yozing...';
    $('chatAttachBtn') && ($('chatAttachBtn').style.opacity = '');
    $('chatAttachBtn') && ($('chatAttachBtn').style.pointerEvents = '');
    $('chatVoiceBtn')  && ($('chatVoiceBtn').style.opacity = '');
    $('chatVoiceBtn')  && ($('chatVoiceBtn').style.pointerEvents = '');
  }

  // Info button (tap header → group info)
  $('chatThreadAvi').style.cursor  = 'pointer';
  $('chatThreadName').style.cursor = 'pointer';
  const openInfo = () => openGroupInfo(groupId);
  $('chatThreadAvi')._grpInfoHandler  = openInfo;
  $('chatThreadName')._grpInfoHandler = openInfo;
  $('chatThreadAvi').addEventListener('click', openInfo);
  $('chatThreadName').addEventListener('click', openInfo);

  // Messages spinner
  $('chatThreadMessages').innerHTML = `<div class="spin-wrap pt-60px"><div class="spinner"></div></div>`;

  // Mark my unread as 0
  try {
    await updateDoc(doc(db, 'groups', groupId), {
      [`unreadCount.${state.me.uid}`]: 0
    });
  } catch(_) {}

  // Subscribe to messages
  if (_groupThreadUnsub) { _groupThreadUnsub(); _groupThreadUnsub = null; }
  _groupThreadUnsub = onSnapshot(
    query(collection(db, 'groups', groupId, 'messages'), orderBy('createdAt', 'asc')),
    snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      paintGroupMessages(msgs, groupData);
    },
    err => {
      console.warn('[Groups] thread error:', err.message);
      $('chatThreadMessages').innerHTML = `<div class="empty pt-30vh tac"><div class="fs-13px c-text2">Xabarlar yuklanmadi</div></div>`;
    }
  );
}

export function closeGroupThread() {
  if (_groupThreadUnsub) { _groupThreadUnsub(); _groupThreadUnsub = null; }

  // Restore call buttons
  ['chatVoiceCallBtn','chatVideoCallBtn'].forEach(id => {
    const el = $(id); if (el) el.style.display = '';
  });

  // Remove info click handlers
  ['chatThreadAvi','chatThreadName'].forEach(id => {
    const el = $(id);
    if (el && el._grpInfoHandler) {
      el.removeEventListener('click', el._grpInfoHandler);
      el._grpInfoHandler = null;
      el.style.cursor = '';
    }
  });

  // Remove avi badge
  const modal = $('chatThreadModal');
  if (modal) {
    modal.dataset.kind = '';
    modal.querySelector('.grp-avi-badge')?.remove();
  }

  // Restore input
  _restoreInputRow();
  $('chatThreadInput').disabled = false;
  $('chatThreadInput').placeholder = 'Xabar yozing...';
  [$('chatAttachBtn'), $('chatVoiceBtn')].forEach(el => {
    if (!el) return;
    el.style.opacity = '';
    el.style.pointerEvents = '';
  });

  const typingEl = $('chatTypingStatus');
  if (typingEl) typingEl.textContent = '';

  _currentGroupId   = null;
  _currentGroupData = null;
  state.currentChatKind = 'dm';
  unlockScroll(); // Modal yopildi — body scrollini qayta ochamiz
}

/* ─────────────────────────────────────────────────────────────────────
   PAINT GROUP MESSAGES (reuses same bubble structure as DM)
   ───────────────────────────────────────────────────────────────────── */
async function paintGroupMessages(msgs, groupData) {
  const box = $('chatThreadMessages');
  if (!box) return;

  // Build a cache of sender names for non-DM display
  const senderIds = [...new Set(msgs.map(m => m.senderId).filter(Boolean))];
  const senderMap = {};
  await Promise.all(senderIds.map(async uid => {
    try {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) senderMap[uid] = snap.data();
    } catch(_) {}
  }));

  if (!msgs.length) {
    box.innerHTML = `<div class="empty pt-30vh tac">
      <div class="fs-14px fw-600 c-text mb-6px">Hozircha xabarlar yo'q</div>
      <div class="fs-13px c-text2">${groupData.type === 'channel' ? 'Kanal tashkil etildi' : 'Birinchi xabar yuboring!'}</div>
    </div>`;
    return;
  }

  box.innerHTML = msgs.map(m => {
    const mine   = m.senderId === state.me?.uid;
    const sender = senderMap[m.senderId] || {};
    const sName  = sender.fullName || 'Foydalanuvchi';
    const time   = fmtTime(m.createdAt);
    let bubbleContent = '';

    if (m.type === 'file') {
      const fname  = esc(m.fileName || 'file');
      const fsz    = m.fileSize ? fmtSz(m.fileSize) : '';
      const safeUrl = (m.mediaUrl || '').replace(/"/g, '&quot;');
      const _ext   = (m.fileName || '').toLowerCase().split('.').pop() || '';
      const _mime  = (m.mediaType || '').toLowerCase();
      const _isImg = _mime.startsWith('image') || ['jpg','jpeg','png','gif','webp','svg','avif'].includes(_ext);
      const _isVid = _mime.startsWith('video') || ['mp4','mov','avi','mkv','webm'].includes(_ext);
      if (_isImg) {
        bubbleContent = `<div class="cfm-media-wrap"><a href="${safeUrl}" target="_blank" rel="noopener" class="cfm-img-link"><img class="cfm-img-preview" src="${safeUrl}" alt="${fname}" loading="lazy"></a>${fsz?`<div class="cfm-media-meta">${fname} · ${fsz}</div>`:''}</div>`;
      } else if (_isVid) {
        bubbleContent = `<div class="cfm-media-wrap"><video class="cfm-video-preview" src="${safeUrl}" controls playsinline preload="metadata"></video>${fsz?`<div class="cfm-media-meta">${fname} · ${fsz}</div>`:''}</div>`;
      } else {
        bubbleContent = `<div class="chat-file-msg"><div class="cfm-info"><a class="cfm-name cfm-name--link" href="${safeUrl}" target="_blank">${fname}</a>${fsz?`<div class="cfm-size">${fsz}</div>`:''}</div><a class="cfm-dl" href="${safeUrl}" download="${fname}" target="_blank"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg></a></div>`;
      }
    } else {
      bubbleContent = `<div class="chat-bubble-text">${esc(m.text || '')}</div>`;
    }

    const senderAvi = sender.avatar || defAvi(sName);
    const senderLine = (!mine && groupData.type !== 'channel')
      ? `<div class="grp-sender-name">${esc(sName)}</div>`
      : '';

    return `<div class="chat-msg ${mine ? 'mine' : 'theirs'}">
      ${!mine ? `<button class="msg-avi-btn" data-uid="${esc(m.senderId)}" title="${esc(sName)} profilini ko'rish">
        <img src="${esc(senderAvi)}" onerror="this.style.display='none'">
      </button>` : ''}
      <div class="chat-bubble">
        <div class="chat-bubble-wrap">
          ${senderLine}
          ${bubbleContent}
          <span class="chat-msg-meta">
            <span class="chat-msg-time">${time}</span>
          </span>
        </div>
      </div>
    </div>`;
  }).join('');

  setTimeout(() => { box.scrollTop = box.scrollHeight; }, 60);

  // "theirs" xabarlaridagi avatar bosilganda profil ochamiz
  box.querySelectorAll('.msg-avi-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = btn.dataset.uid;
      if (!uid || uid === state.me?.uid) return;
      const { openUserProfileModal } = await import('./profile.js');
      openUserProfileModal(uid);
    });
  });
}

/* ─────────────────────────────────────────────────────────────────────
   SEND MESSAGE TO GROUP / CHANNEL
   ───────────────────────────────────────────────────────────────────── */
export async function sendGroupMessage() {
  if (!_currentGroupId || !state.me) return;
  const inp  = $('chatThreadInput');
  const text = inp?.value?.trim();
  if (!text) return;
  inp.value = '';

  const groupId = _currentGroupId;
  const groupData = _currentGroupData;
  const members   = groupData?.members || [];

  try {
    // Unread count: increment for everyone except sender
    const unreadUpdate = {};
    members.forEach(uid => {
      if (uid !== state.me.uid) unreadUpdate[`unreadCount.${uid}`] = increment(1);
    });
    await updateDoc(doc(db, 'groups', groupId), {
      lastMessage:   text,
      lastSenderId:  state.me.uid,
      lastMessageAt: serverTimestamp(),
      ...unreadUpdate
    });
    await addDoc(collection(db, 'groups', groupId, 'messages'), {
      senderId:  state.me.uid,
      text,
      type:      'text',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    console.error('[Groups] send failed:', err);
    toast('Xabar yuborilmadi', 'error');
    inp.value = text;
    return;
  }

  // ── YENGIL AI TEKSHIRUV: faqat GURUHLARDA (kanalda emas) ──
  // Kanal (masalan kanal egasi joylagan xabar) umuman tekshirilmaydi.
  // Guruh xabari bo'lsa — fonda yengil tekshiruv o'tadi, faqat aniq va
  // og'ir qoidabuzarlik bo'lsagina xabar egasiga ogohlantirish beriladi.
  if (groupData?.type !== 'channel') {
    const textToCheck = text;
    setTimeout(async () => {
      try {
        const aiResult = await aiModeratePost({ text: textToCheck, light: true });
        if (aiResult.flagged) {
          toast('⚠️ Guruhdagi xabaringiz qoidalarga zid deb topildi: ' + (aiResult.reason || ''), 'error', 8000);
          const { _recordViolationAndWarn, VIOLATION_SOURCE } = await import('./upload.js');
          await _recordViolationAndWarn(state.me.uid, aiResult.reason, VIOLATION_SOURCE.CHAT);
        }
      } catch (e) {
        console.warn('[Group AI] Tekshiruvda xato:', e.message);
      }
    }, 0);
  }
}

export async function sendGroupFile(file) {
  if (!_currentGroupId || !state.me || !file) return;
  const groupId   = _currentGroupId;
  const groupData = _currentGroupData;
  const members   = groupData?.members || [];

  toast('Fayl yuklanmoqda...', 'info', 3000);
  try {
    const result = await uploadViaController(file, 'group-files');
    const unreadUpdate = {};
    members.forEach(uid => {
      if (uid !== state.me.uid) unreadUpdate[`unreadCount.${uid}`] = increment(1);
    });
    await updateDoc(doc(db, 'groups', groupId), {
      lastMessage:   file.name,
      lastSenderId:  state.me.uid,
      lastMessageAt: serverTimestamp(),
      ...unreadUpdate
    });
    await addDoc(collection(db, 'groups', groupId, 'messages'), {
      senderId:     state.me.uid,
      type:         'file',
      mediaUrl:     result.url,
      mediaPath:    result.path,
      storageIndex: result.storageIndex,
      mediaType:    file.type,
      fileName:     file.name,
      fileSize:     file.size,
      createdAt:    serverTimestamp(),
    });
    toast('Fayl yuborildi', 'success');
  } catch (err) {
    console.error('[Groups] file send failed:', err);
    toast('Fayl yuborilmadi', 'error');
  }
}

/* ─────────────────────────────────────────────────────────────────────
   GROUP/CHANNEL INFO PANEL
   ───────────────────────────────────────────────────────────────────── */
export async function openGroupInfo(groupId) {
  const g = _latestGroupMap[groupId];
  if (!g) return;
  const isChannel = g.type === 'channel';
  const isOwner   = g.ownerId === state.me?.uid;
  const isGrpAdm  = (g.adminIds || []).includes(state.me?.uid);
  const canManage = isOwner || isGrpAdm || isAdmin();
  const members   = g.members || [];
  const typeLabel  = isChannel ? 'Kanal' : 'Guruh';

  const panel = document.getElementById('grpInfoOverlay');
  if (!panel) return;

  // Open panel immediately with loading state
  panel.classList.add('show');

  /* ── Hero section ─────────────────────────── */
  const av = g.avatar || defAvi(g.name || 'G');
  const aviEl = panel.querySelector('#grpInfoAvi');
  if (aviEl) {
    aviEl.innerHTML = `<img src="${av}" onerror="this.style.display='none'">`;
    aviEl.style.cursor = 'pointer';

    // Click: admin → rasm o'zgartirish + zoom; boshqa → faqat zoom
    aviEl.onclick = async () => {
      // Avatar zoom (har doim)
      const { openZoom } = await import('./utils.js');
      openZoom(av, 'avatar');
      // Admin uchun "rasm o'zgartirish" tugmasi zoom ichida
      if (canManage) {
        const zm = document.getElementById('zoomModal');
        if (zm) {
          let editBtn = zm.querySelector('.gi-avi-zoom-edit');
          if (!editBtn) {
            editBtn = document.createElement('button');
            editBtn.className = 'gi-avi-zoom-edit avi-zoom-edit-btn';
            zm.appendChild(editBtn);
          }
          editBtn.style.display = 'flex';
          editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Rasmni o'zgartirish`;
          editBtn.onclick = (e) => {
            e.stopPropagation();
            zm.classList.remove('show');
            editBtn.style.display = 'none';
            const inp = document.createElement('input');
            inp.type = 'file'; inp.accept = 'image/*';
            inp.onchange = async ev => {
              const f = ev.target.files[0];
              if (!f || !f.type.startsWith('image/')) return;
              if (f.size > 5*1024*1024) { toast("Rasm 5 MB dan kam bo'lishi kerak", 'error'); return; }
              toast('Yuklanmoqda...', 'info');
              try {
                const result = await uploadViaController(f, 'group-avatars');
                await updateDoc(doc(db, 'groups', groupId), { avatar: result.url });
                toast('Rasm yangilandi', 'success');
                openGroupInfo(groupId);
              } catch(e2) { toast('Xato: ' + e2.message, 'error'); }
            };
            inp.click();
          };
          // Zoom yopilganda editBtn ni yashir
          const hideEdit = () => { editBtn.style.display = 'none'; zm.removeEventListener('click', hideEdit); };
          zm.addEventListener('click', hideEdit);
        }
      }
    };
    if (canManage) aviEl.title = "Rasmni ko'rish / o'zgartirish";
  }

  const nameEl  = panel.querySelector('#grpInfoName');
  const badgeEl = panel.querySelector('#grpInfoTypeBadge');
  const linkRow = panel.querySelector('#grpInfoLinkRow');
  const linkTxt = panel.querySelector('#grpInfoLinkText');
  const descEl  = panel.querySelector('#grpInfoDesc');
  const cntEl   = panel.querySelector('#grpInfoMemberCount');
  const lblEl   = panel.querySelector('#grpInfoMemberLbl');

  if (nameEl)  nameEl.textContent  = g.name || '';
  if (badgeEl) badgeEl.textContent = typeLabel;

  // Channel public link
  if (isChannel && g.username && !g.isPrivate) {
    const link = `@${g.username}`;
    if (linkTxt) linkTxt.textContent = link;
    if (linkRow) {
      linkRow.style.display = 'flex';
      linkRow.style.cursor  = 'pointer';
      linkRow.onclick = () => {
        navigator.clipboard?.writeText(g.username).catch(()=>{});
        toast('Username nusxalandi', 'success');
      };
    }
  } else {
    if (linkRow) linkRow.style.display = 'none';
  }

  if (descEl) {
    if (g.description) { descEl.textContent = g.description; descEl.style.display = ''; }
    else descEl.style.display = 'none';
  }

  if (cntEl) cntEl.textContent = members.length;
  if (lblEl) lblEl.textContent = isChannel ? 'obunachi' : "a'zo";

  /* ── Channel: hide members list; Group: show ── */
  const membersSection = panel.querySelector('#grpMembersSection');
  if (membersSection) membersSection.style.display = isChannel ? 'none' : '';

  /* ── Buttons ── */
  panel.querySelector('#grpInfoLeaveBtn').style.display      = isOwner ? 'none' : '';
  panel.querySelector('#grpInfoDeleteBtn').style.display     = isOwner ? '' : 'none';
  panel.querySelector('#grpInfoAddMemberBtn').style.display  = (canManage && !isChannel) ? '' : 'none';
  panel.querySelector('#grpInfoEditBtn').style.display       = canManage ? '' : 'none';

  /* ── Button handlers ── */
  panel.querySelector('#grpInfoLeaveBtn').onclick = async () => {
    if (!confirm(`${typeLabel}dan chiqmoqchimisiz?`)) return;
    try {
      await updateDoc(doc(db, 'groups', groupId), { members: arrayRemove(state.me.uid) });
      panel.classList.remove('show');
      closeGroupThread();
      $('chatThreadModal').classList.remove('show');
      toast(`${typeLabel}dan chiqdingiz`, 'info');
    } catch(e) { toast('Xato yuz berdi', 'error'); }
  };

  panel.querySelector('#grpInfoDeleteBtn').onclick = async () => {
    if (!confirm(`${typeLabel}ni o'chirasizmi? Bu amalni qaytarib bo'lmaydi!`)) return;
    try {
      await deleteDoc(doc(db, 'groups', groupId));
      panel.classList.remove('show');
      closeGroupThread();
      $('chatThreadModal').classList.remove('show');
      toast(`${typeLabel} o'chirildi`, 'success');
    } catch(e) { toast('Xato yuz berdi', 'error'); }
  };

  panel.querySelector('#grpInfoAddMemberBtn').onclick = () => {
    panel.classList.remove('show');
    openMemberPicker(groupId, 'add');
  };

  panel.querySelector('#grpInfoEditBtn').onclick = () => {
    panel.classList.remove('show');
    openGroupEdit(groupId, g);
  };

  /* ── Load members list (group only) in parallel ── */
  if (!isChannel) {
    const membersEl = panel.querySelector('#grpMembersList');
    if (membersEl) {
      membersEl.innerHTML = '<div class="gi-media-spin"><div class="spinner"></div></div>';
      Promise.all(members.map(uid => getDoc(doc(db, 'users', uid)).catch(()=>null)))
        .then(snaps => {
          const html = snaps.map(s => {
            if (!s || !s.exists()) return '';
            const u    = s.data();
            const av   = u.avatar || defAvi(u.fullName || 'U');
            const uid  = s.id;
            const role = uid === g.ownerId ? 'Egasi' : (g.adminIds||[]).includes(uid) ? 'Admin' : '';
            const isSelf = uid === state.me?.uid;
            return `<div class="grp-member-row" data-uid="${uid}">
              <div class="grp-member-avi"><img src="${av}" onerror="this.style.display='none'"></div>
              <div class="grp-member-info">
                <div class="grp-member-name">${esc(u.fullName||'Foydalanuvchi')}</div>
                ${role ? `<div class="grp-member-role">${role}</div>` : ''}
              </div>
              ${(canManage && !isSelf && uid !== g.ownerId) ? `<button class="grp-member-kick" data-uid="${uid}" title="Chiqarish">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>` : ''}
            </div>`;
          }).join('');
          membersEl.innerHTML = html || '<div class="gi-empty">A\'zolar topilmadi</div>';
          membersEl.querySelectorAll('.grp-member-kick').forEach(btn => {
            btn.onclick = async () => {
              const uid = btn.dataset.uid;
              if (!confirm('Bu foydalanuvchini chiqarasizmi?')) return;
              try {
                await updateDoc(doc(db, 'groups', groupId), { members: arrayRemove(uid) });
                toast("A'zo chiqarildi", 'success');
                openGroupInfo(groupId);
              } catch(e) { toast('Xato yuz berdi', 'error'); }
            };
          });
        }).catch(() => { if (membersEl) membersEl.innerHTML = ''; });
    }
  }

  /* ── Load media files (images + videos) ── */
  const mediaGrid = panel.querySelector('#grpInfoMediaGrid');
  const mediaStat = panel.querySelector('#grpInfoMediaStat');
  const mediaCount = panel.querySelector('#grpInfoMediaCount');
  if (mediaGrid) {
    mediaGrid.innerHTML = '<div class="gi-media-spin"><div class="spinner"></div></div>';
    try {
      const msgSnap = await getDocs(
        query(collection(db, 'groups', groupId, 'messages'),
          where('type', '==', 'file'),
          orderBy('createdAt', 'desc'),
          limit(60)
        )
      );
      const mediaMsgs = msgSnap.docs
        .map(d => d.data())
        .filter(m => {
          const mime = (m.mediaType || '').toLowerCase();
          const ext  = (m.fileName || '').toLowerCase().split('.').pop();
          return mime.startsWith('image') || mime.startsWith('video') ||
                 ['jpg','jpeg','png','gif','webp','avif','svg','mp4','mov','mkv','webm'].includes(ext);
        });

      if (mediaStat) mediaStat.style.display = mediaMsgs.length ? '' : 'none';
      if (mediaCount) mediaCount.textContent = mediaMsgs.length;

      if (!mediaMsgs.length) {
        mediaGrid.innerHTML = '<div class="gi-empty">Media fayllar yo\'q</div>';
      } else {
        mediaGrid.innerHTML = mediaMsgs.map(m => {
          const safeUrl = (m.mediaUrl || '').replace(/"/g, '&quot;');
          const mime    = (m.mediaType || '').toLowerCase();
          const isVideo = mime.startsWith('video') ||
                          ['mp4','mov','mkv','webm'].includes((m.fileName||'').toLowerCase().split('.').pop());
          return `<div class="gi-media-cell" data-url="${safeUrl}" data-type="${isVideo?'video':'image'}">
            ${isVideo
              ? `<video src="${safeUrl}" preload="metadata" muted playsinline></video>
                 <div class="gi-media-play"><svg width="12" height="12" viewBox="0 0 24 24" fill="white"><path d="m5 3 14 9-14 9V3z"/></svg></div>`
              : `<img src="${safeUrl}" loading="lazy" onerror="this.closest('.gi-media-cell').style.display='none'">`
            }
          </div>`;
        }).join('');

        // Click → open in zoom modal
        mediaGrid.querySelectorAll('.gi-media-cell').forEach(cell => {
          cell.addEventListener('click', async () => {
            const { openZoom } = await import('./utils.js');
            if (typeof openZoom === 'function') {
              openZoom(cell.dataset.url, cell.dataset.type);
            } else {
              window.open(cell.dataset.url, '_blank', 'noopener');
            }
          });
        });
      }
    } catch(e) {
      mediaGrid.innerHTML = '<div class="gi-empty">Media yuklanmadi</div>';
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────
   CREATE FLOW: action choice → form
   ───────────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────────
   EDIT GROUP / CHANNEL — owner & admin can update everything
   ───────────────────────────────────────────────────────────────────── */
let _editingGroupId = null;
let _grpEditPendingAviUrl = null;

export function openGroupEdit(groupId, g) {
  const panel = document.getElementById('grpEditOverlay');
  if (!panel) return;

  _editingGroupId = groupId;
  _grpEditPendingAviUrl = null;

  const typeLabel = g.type === 'channel' ? 'Kanal' : 'Guruh';
  panel.querySelector('#grpEditTitle').textContent = `${typeLabel}ni sozlash`;
  panel.querySelector('#grpEditNameLabel').textContent = `${typeLabel} nomi *`;
  panel.querySelector('#grpEditName').value = g.name || '';
  panel.querySelector('#grpEditDesc').value = g.description || '';

  // Avatar preview
  const av = g.avatar || defAvi(g.name || 'G');
  const aviEl = panel.querySelector('#grpEditAviImg');
  aviEl.innerHTML = `<img src="${av}" onerror="this.style.display='none'">`;

  // Show/hide type-specific fields
  const isChannel = g.type === 'channel';
  panel.querySelector('#grpEditChannelFields').style.display = isChannel ? '' : 'none';
  panel.querySelector('#grpEditGroupFields').style.display = isChannel ? 'none' : '';

  if (isChannel) {
    panel.querySelector('#grpEditUsername').value = g.username || '';
    panel.querySelector('#grpEditPrivacy').value = g.isPrivate ? 'private' : 'public';
  } else {
    panel.querySelector('#grpEditGroupPrivacy').value = g.isPrivate ? 'private' : 'public';
    panel.querySelector('#grpEditMsgPerm').value = g.msgPermission || 'all';
  }

  // Avatar file input
  const aviBadge = panel.querySelector('#grpEditAviBadge');
  const aviInput = panel.querySelector('#grpEditAviInput');
  aviBadge.onclick = () => aviInput.click();
  aviInput.onchange = async ev => {
    const f = ev.target.files[0];
    if (!f || !f.type.startsWith('image/')) return;
    if (f.size > 5*1024*1024) { toast('Rasm 5 MB dan kam bo\'lishi kerak', 'error'); return; }
    toast('Yuklanmoqda...', 'info');
    try {
      const result = await uploadViaController(f, 'group-avatars');
      _grpEditPendingAviUrl = result.url;
      aviEl.innerHTML = `<img src="${result.url}">`;
      toast('Rasm tanlandi (Saqlash tugmasini bosing)', 'success');
    } catch(e) { toast('Xato: ' + e.message, 'error'); }
  };

  // Save
  panel.querySelector('#grpEditSaveBtn').onclick = async () => {
    const name = panel.querySelector('#grpEditName').value.trim();
    if (!name) { toast('Nom kiritilishi shart', 'error'); return; }
    const desc = panel.querySelector('#grpEditDesc').value.trim();

    const updates = { name, description: desc };
    if (_grpEditPendingAviUrl) updates.avatar = _grpEditPendingAviUrl;

    if (isChannel) {
      const uname = panel.querySelector('#grpEditUsername').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (uname) updates.username = uname;
      updates.isPrivate = panel.querySelector('#grpEditPrivacy').value === 'private';
    } else {
      updates.isPrivate = panel.querySelector('#grpEditGroupPrivacy').value === 'private';
      updates.msgPermission = panel.querySelector('#grpEditMsgPerm').value;
    }

    try {
      await updateDoc(doc(db, 'groups', groupId), updates);
      panel.classList.remove('show');
      unlockScroll();
      toast(`${typeLabel} yangilandi`, 'success');
      // Refresh info panel if re-opened
      openGroupInfo(groupId);
    } catch(e) { toast('Xato: ' + e.message, 'error'); }
  };

  // Cancel
  panel.querySelector('#grpEditCancelBtn').onclick = () => {
    panel.classList.remove('show');
    unlockScroll();
    openGroupInfo(groupId);
  };

  panel.classList.add('show');
  lockScroll();
}

export function openCreateChoice() {
  const el = document.getElementById('grpCreateChoiceOverlay');
  if (el) el.classList.add('show');
}

let _createType    = 'group'; // 'group' | 'channel'
let _selectedMembers = new Set();
let _pendingPhotoUrl = null;
let _usersForPicker = [];
let _isPrivate      = true;   // default: maxfiy
let _inviteCode     = '';
let _customLinkMode = false;

function _genInviteCode(len = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function openCreateForm(type) {
  _createType      = type;
  _selectedMembers = new Set();
  _pendingPhotoUrl = null;
  _usersForPicker  = [];
  _isPrivate       = true;
  _inviteCode      = _genInviteCode();
  _customLinkMode  = false;

  // Close choice sheet
  document.getElementById('grpCreateChoiceOverlay')?.classList.remove('show');

  const overlay = document.getElementById('grpCreateFormOverlay');
  if (!overlay) return;

  overlay.querySelector('.grp-form-title').textContent = type === 'channel' ? 'Yangi kanal' : 'Yangi guruh';
  overlay.querySelector('#grpFormDescWrap').style.display = type === 'channel' ? '' : 'none';
  overlay.querySelector('.grp-form-desc-hint').textContent = type === 'channel'
    ? 'A\'zolar faqat o\'qiy oladi. Faqat siz xabar yubora olasiz.'
    : 'Barcha a\'zolar xabar yubora oladi.';

  _renderLinkSection(overlay);

  // Member picker section — channels can have members too (subscribers)
  const pickerSection = overlay.querySelector('#grpMemberPickerSection');
  pickerSection.innerHTML = '<div class="spin-wrap pt-20px"><div class="spinner"></div></div>';

  // Load users
  _loadUsersForPicker().then(users => {
    _usersForPicker = users;
    _renderMemberPicker(pickerSection, users);
  });

  overlay.querySelector('#grpFormName').value = '';
  overlay.querySelector('#grpFormDesc').value = '';
  overlay.querySelector('.grp-form-avi-img').src = '';
  overlay.querySelector('.grp-form-avi-img').style.display = 'none';
  overlay.querySelector('.grp-form-avi-placeholder').style.display = '';

  overlay.classList.add('show');
}

function _renderLinkSection(overlay) {
  const sec = overlay.querySelector('#grpFormLinkSection');
  if (!sec) return;

  sec.innerHTML = `
    <div class="grp-privacy-toggle">
      <button type="button" class="grp-privacy-opt ${_isPrivate ? 'active' : ''}" data-val="private">Maxfiy</button>
      <button type="button" class="grp-privacy-opt ${!_isPrivate ? 'active' : ''}" data-val="public">Ochiq</button>
    </div>
    <div id="grpFormLinkBody" class="mt-12px"></div>
  `;

  sec.querySelectorAll('.grp-privacy-opt').forEach(btn => {
    btn.onclick = () => {
      _isPrivate = btn.dataset.val === 'private';
      if (_isPrivate && !_inviteCode) _inviteCode = _genInviteCode();
      _customLinkMode = false;
      _renderLinkSection(overlay);
    };
  });

  _renderLinkBody(overlay.querySelector('#grpFormLinkBody'));
}

function _renderLinkBody(body) {
  if (!body) return;

  if (_isPrivate) {
    body.innerHTML = `
      <div class="grp-form-desc-hint">Bu guruh maxfiy — unga faqat quyidagi havola orqali qo'shilish mumkin. Havolani hech kim taxmin qila olmaydi.</div>
      <div class="grp-invite-box">
        <input class="field grp-invite-code" id="grpInviteCodeInput" value="${esc(_inviteCode)}" readonly>
        <button type="button" class="grp-invite-btn" id="grpInviteCopyBtn" title="Nusxalash">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <button type="button" class="grp-invite-btn" id="grpInviteRegenBtn" title="Yangilash">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        </button>
      </div>
    `;
    body.querySelector('#grpInviteCopyBtn').onclick = async () => {
      try { await navigator.clipboard.writeText(_inviteCode); toast('Havola nusxalandi', 'success'); }
      catch(_) { toast('Nusxalab bo\'lmadi', 'error'); }
    };
    body.querySelector('#grpInviteRegenBtn').onclick = () => {
      _inviteCode = _genInviteCode();
      body.querySelector('#grpInviteCodeInput').value = _inviteCode;
    };
  } else {
    if (_customLinkMode) {
      body.innerHTML = `
        <div class="grp-form-desc-hint">O'zingizning havolangizni kiriting (ixtiyoriy).</div>
        <input class="field" id="grpCustomLinkInput" placeholder="masalan: mening-guruhim" maxlength="40" value="${esc(_inviteCode)}">
      `;
      const inp = body.querySelector('#grpCustomLinkInput');
      inp.addEventListener('input', () => { _inviteCode = inp.value.trim(); });
    } else {
      body.innerHTML = `
        <div class="grp-form-desc-hint">Bu guruh ochiq. Havola kiritmasangiz, guruhga havolasiz qo'shib bo'lmaydi.</div>
        <button type="button" class="btn-ghost grp-add-link-btn" id="grpAddLinkBtn">+ Havola qo'shish</button>
      `;
      body.querySelector('#grpAddLinkBtn').onclick = () => {
        _customLinkMode = true;
        _inviteCode = '';
        _renderLinkBody(body);
      };
    }
  }
}


async function _loadUsersForPicker() {
  try {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(u => u.uid !== state.me?.uid);
  } catch(_) { return []; }
}

function _renderMemberPicker(container, users) {
  if (!users.length) {
    container.innerHTML = `<div class="grp-empty-users">Boshqa foydalanuvchilar yo'q</div>`;
    return;
  }
  container.innerHTML = `
    <div class="grp-picker-search-wrap">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="7"/><line x1="17" y1="17" x2="22" y2="22"/></svg>
      <input class="grp-picker-search" id="grpPickerSearch" placeholder="Ism yoki username..." autocomplete="off">
    </div>
    <div class="grp-picker-list" id="grpPickerList"></div>
    <div class="grp-sel-count" id="grpSelCount">0 ta tanlangan</div>
  `;
  _renderPickerRows(users, container.querySelector('#grpPickerList'));

  container.querySelector('#grpPickerSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = q ? users.filter(u =>
      (u.fullName||'').toLowerCase().includes(q) || (u.username||'').toLowerCase().includes(q)
    ) : users;
    _renderPickerRows(filtered, container.querySelector('#grpPickerList'));
  });
}

function _renderPickerRows(users, listEl) {
  if (!listEl) return;
  listEl.innerHTML = users.map(u => {
    const av   = u.avatar || defAvi(u.fullName || 'U');
    const sel  = _selectedMembers.has(u.uid);
    return `<div class="grp-picker-row ${sel ? 'selected' : ''}" data-uid="${u.uid}">
      <div class="grp-picker-avi"><img src="${av}" onerror="this.style.display='none'"></div>
      <div class="grp-picker-info">
        <div class="grp-picker-name">${esc(u.fullName||'Foydalanuvchi')}</div>
        ${u.username ? `<div class="grp-picker-user">@${esc(u.username)}</div>` : ''}
      </div>
      <div class="grp-picker-check ${sel ? 'on' : ''}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
    </div>`;
  }).join('');
  listEl.querySelectorAll('.grp-picker-row').forEach(row => {
    row.addEventListener('click', () => {
      const uid = row.dataset.uid;
      if (_selectedMembers.has(uid)) _selectedMembers.delete(uid);
      else _selectedMembers.add(uid);
      row.classList.toggle('selected');
      row.querySelector('.grp-picker-check').classList.toggle('on');
      const cnt = document.getElementById('grpSelCount');
      if (cnt) cnt.textContent = `${_selectedMembers.size} ta tanlangan`;
    });
  });
}

/* ─────────────────────────────────────────────────────────────────────
   ADD USER BY USERNAME (start a private chat)
   ───────────────────────────────────────────────────────────────────── */
export function openAddUserByUsername() {
  document.getElementById('grpCreateChoiceOverlay')?.classList.remove('show');
  const overlay = document.getElementById('grpAddUserOverlay');
  if (!overlay) return;
  const inp = overlay.querySelector('#grpAddUserInput');
  const err = overlay.querySelector('#grpAddUserErr');
  inp.value = '';
  err.textContent = '';
  err.style.display = 'none';
  overlay.classList.add('show');
  setTimeout(() => inp.focus(), 150);
}

async function _submitAddUserByUsername() {
  const overlay = document.getElementById('grpAddUserOverlay');
  const inp     = overlay.querySelector('#grpAddUserInput');
  const err     = overlay.querySelector('#grpAddUserErr');
  const btn     = overlay.querySelector('#grpAddUserSubmitBtn');
  let uname = inp.value.trim();
  if (uname.startsWith('@')) uname = uname.slice(1);
  if (!uname) {
    err.textContent = "Username kiriting";
    err.style.display = '';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Qidirilmoqda...';
  try {
    const users = await _loadUsersForPicker();
    const found = users.find(u => (u.username || '').toLowerCase() === uname.toLowerCase());
    if (!found) {
      err.textContent = `"@${uname}" topilmadi`;
      err.style.display = '';
      return;
    }
    overlay.classList.remove('show');
    const { openChatThread } = await import('./chat.js');
    toast(`@${found.username} bilan suhbat ochildi`, 'success');
    setTimeout(() => openChatThread(found.uid), 200);
  } catch (e) {
    err.textContent = 'Xato yuz berdi';
    err.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = "Qo'shish";
  }
}

/* ─────────────────────────────────────────────────────────────────────
   JOIN GROUP/CHANNEL BY INVITE LINK
   ───────────────────────────────────────────────────────────────────── */
export function openJoinByLink() {
  const overlay = document.getElementById('grpJoinLinkOverlay');
  if (!overlay) return;
  const inp = overlay.querySelector('#grpJoinLinkInput');
  const err = overlay.querySelector('#grpJoinLinkErr');
  inp.value = '';
  err.textContent = '';
  err.style.display = 'none';
  overlay.classList.add('show');
  setTimeout(() => inp.focus(), 150);
}

/**
 * Shared logic: look up a group/channel by invite code, join (if not
 * already a member) and open its thread. Returns {ok:true} on success
 * or {ok:false, reason} on failure — caller decides how to display it.
 */
export async function joinGroupByCode(code) {
  code = (code || '').trim();
  if (!code) return { ok: false, reason: 'empty' };
  try {
    const snap = await getDocs(query(collection(db, 'groups'), where('inviteCode', '==', code)));
    if (snap.empty) return { ok: false, reason: 'not-found' };

    const groupSnap = snap.docs[0];
    const g = groupSnap.data();

    if ((g.members || []).includes(state.me.uid)) {
      openGroupThread(groupSnap.id);
      return { ok: true, joined: false, group: g };
    }

    await updateDoc(doc(db, 'groups', groupSnap.id), { members: arrayUnion(state.me.uid) });
    toast(`${g.type === 'channel' ? 'Kanalga' : 'Guruhga'} qo'shildingiz!`, 'success');
    setTimeout(() => openGroupThread(groupSnap.id), 200);
    return { ok: true, joined: true, group: g };
  } catch (e) {
    return { ok: false, reason: 'error' };
  }
}

async function _submitJoinByLink() {
  const overlay = document.getElementById('grpJoinLinkOverlay');
  const inp     = overlay.querySelector('#grpJoinLinkInput');
  const err     = overlay.querySelector('#grpJoinLinkErr');
  const btn     = overlay.querySelector('#grpJoinLinkSubmitBtn');
  const code = inp.value.trim();
  if (!code) {
    err.textContent = 'Havola kiriting';
    err.style.display = '';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Qidirilmoqda...';
  try {
    const res = await joinGroupByCode(code);
    if (!res.ok) {
      err.textContent = 'Bu havola orqali hech narsa topilmadi';
      err.style.display = '';
      return;
    }
    overlay.classList.remove('show');
  } finally {
    btn.disabled = false;
    btn.textContent = "Qo'shilish";
  }
}


/* ─────────────────────────────────────────────────────────────────────
   ADD MEMBER to existing group
   ───────────────────────────────────────────────────────────────────── */
export async function openMemberPicker(groupId, mode) {
  // Re-open create form overlay as add-member flow (reuse UI)
  _selectedMembers = new Set();
  const g = _latestGroupMap[groupId];
  const existingMembers = new Set(g?.members || []);

  const overlay = document.getElementById('grpCreateFormOverlay');
  if (!overlay) return;

  overlay.querySelector('.grp-form-title').textContent = "A'zo qo'shish";
  overlay.querySelector('#grpFormDescWrap').style.display = 'none';
  overlay.querySelector('.grp-form-avi-wrap').style.display = 'none';
  overlay.querySelector('.grp-form-desc-hint').textContent = '';
  overlay.querySelector('#grpFormName').style.display = 'none';
  overlay.querySelector('#grpFormCreateBtn').textContent = "Qo'shish";
  overlay.dataset.addMode = groupId;

  const pickerSection = overlay.querySelector('#grpMemberPickerSection');
  pickerSection.innerHTML = '<div class="spin-wrap pt-20px"><div class="spinner"></div></div>';
  const users = await _loadUsersForPicker();
  const nonMembers = users.filter(u => !existingMembers.has(u.uid));
  _usersForPicker = nonMembers;
  _renderMemberPicker(pickerSection, nonMembers);

  overlay.classList.add('show');
}

/* ─────────────────────────────────────────────────────────────────────
   SUBMIT CREATE / ADD MEMBER
   ───────────────────────────────────────────────────────────────────── */
export async function submitCreateGroup() {
  const overlay  = document.getElementById('grpCreateFormOverlay');
  const addMode  = overlay?.dataset?.addMode;

  if (addMode) {
    // Add members to existing group
    if (!_selectedMembers.size) { toast('Kamida 1 ta a\'zo tanlang', 'error'); return; }
    try {
      await updateDoc(doc(db, 'groups', addMode), {
        members: arrayUnion(...Array.from(_selectedMembers))
      });
      overlay.classList.remove('show');
      overlay.dataset.addMode = '';
      // Reset hidden elements
      overlay.querySelector('.grp-form-avi-wrap').style.display = '';
      overlay.querySelector('#grpFormName').style.display = '';
      overlay.querySelector('#grpFormCreateBtn').textContent = 'Yaratish';
      toast(`${_selectedMembers.size} ta a'zo qo'shildi`, 'success');
    } catch(e) { toast('Xato yuz berdi', 'error'); }
    return;
  }

  const name = overlay?.querySelector('#grpFormName').value?.trim();
  if (!name) { toast('Nom kiriting', 'error'); return; }

  const btn = overlay?.querySelector('#grpFormCreateBtn');
  btn.disabled = true;
  btn.textContent = 'Yaratilmoqda...';

  try {
    if (_inviteCode) {
      const dupSnap = await getDocs(query(collection(db, 'groups'), where('inviteCode', '==', _inviteCode)));
      if (!dupSnap.empty) {
        toast('Bu havola band, boshqa havola tanlang', 'error');
        btn.disabled = false;
        btn.textContent = 'Yaratish';
        return;
      }
    }

    const members = [state.me.uid, ...Array.from(_selectedMembers)];
    const groupDoc = {
      type:         _createType,
      name,
      avatar:       _pendingPhotoUrl || '',
      description:  overlay.querySelector('#grpFormDesc')?.value?.trim() || '',
      ownerId:      state.me.uid,
      adminIds:     [state.me.uid],
      members,
      isPrivate:    _isPrivate,
      inviteCode:   _inviteCode || null,
      lastMessage:   '',
      lastSenderId:  '',
      lastMessageAt: serverTimestamp(),
      unreadCount:   {},
      createdAt:     serverTimestamp(),
    };
    if (_createType === 'channel') groupDoc.subscriberCount = members.length;

    const ref = await addDoc(collection(db, 'groups'), groupDoc);
    overlay.classList.remove('show');
    toast(`${_createType === 'channel' ? 'Kanal' : 'Guruh'} yaratildi!`, 'success');
    setTimeout(() => openGroupThread(ref.id), 300);
  } catch(err) {
    console.error('[Groups] create failed:', err);
    toast('Yaratib bo\'lmadi: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Yaratish';
  }
}

/* ─────────────────────────────────────────────────────────────────────
   PHOTO UPLOAD for group/channel
   ───────────────────────────────────────────────────────────────────── */
export async function pickGroupPhoto() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast('Rasm 5 MB dan kichik bo\'lishi kerak', 'error'); return; }
    toast('Rasm yuklanmoqda...', 'info', 2000);
    try {
      const result = await uploadViaController(file, 'group-avatars');
      _pendingPhotoUrl = result.url;
      const img = document.querySelector('#grpCreateFormOverlay .grp-form-avi-img');
      const ph  = document.querySelector('#grpCreateFormOverlay .grp-form-avi-placeholder');
      if (img) { img.src = result.url; img.style.display = ''; }
      if (ph)  ph.style.display = 'none';
      toast('Rasm yuklandi', 'success');
    } catch(e) { toast('Rasm yuklanmadi', 'error'); }
  };
  input.click();
}

/* ─────────────────────────────────────────────────────────────────────
   INJECT DOM — all overlays/panels added once to body
   ───────────────────────────────────────────────────────────────────── */
export function injectGroupsDOM() {
  if (document.getElementById('grpCreateChoiceOverlay')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <!-- Choice sheet: Guruh yoki Kanal -->
    <div class="overlay" id="grpCreateChoiceOverlay">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Yangi suhbat</div>
        <button class="grp-choice-btn" id="grpChoiceGroup">
          <div class="grp-choice-icon grp-choice-icon--group">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          </div>
          <div class="grp-choice-info">
            <div class="grp-choice-name">Yangi guruh</div>
            <div class="grp-choice-sub">Barcha a'zolar xabar yubora oladi</div>
          </div>
          <svg class="grp-choice-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>
        <button class="grp-choice-btn" id="grpChoiceChannel">
          <div class="grp-choice-icon grp-choice-icon--channel">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
          </div>
          <div class="grp-choice-info">
            <div class="grp-choice-name">Yangi kanal</div>
            <div class="grp-choice-sub">Faqat adminlar xabar yubora oladi</div>
          </div>
          <svg class="grp-choice-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>
        <button class="grp-choice-btn" id="grpChoiceUser">
          <div class="grp-choice-icon grp-choice-icon--user">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
          </div>
          <div class="grp-choice-info">
            <div class="grp-choice-name">Foydalanuvchi qo'shish</div>
            <div class="grp-choice-sub">Username orqali suhbat boshlash</div>
          </div>
          <svg class="grp-choice-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </button>
        <button class="btn-ghost mt-12px" id="grpChoiceCancel">Bekor qilish</button>
      </div>
    </div>

    <!-- Add user by username sheet -->
    <div class="overlay" id="grpAddUserOverlay">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Foydalanuvchi qo'shish</div>
        <input class="field mb-12px" id="grpAddUserInput" placeholder="@username" maxlength="32" autocomplete="off">
        <div class="grp-form-desc-hint" id="grpAddUserErr" style="display:none;color:var(--red,#ef4444)"></div>
        <div class="grp-form-actions">
          <button class="btn-ghost" id="grpAddUserCancelBtn">Bekor qilish</button>
          <button class="btn-primary" id="grpAddUserSubmitBtn">Qo'shish</button>
        </div>
      </div>
    </div>

    <!-- Create form sheet -->
    <div class="overlay" id="grpCreateFormOverlay">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="grp-form-title sheet-title">Yangi guruh</div>

        <!-- Avatar picker -->
        <div class="grp-form-avi-wrap" id="grpFormAviWrap">
          <div class="grp-form-avi" id="grpFormAvi">
            <div class="grp-form-avi-placeholder">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </div>
            <img class="grp-form-avi-img" src="" style="display:none;" alt="">
          </div>
          <div class="grp-form-avi-hint">Rasm tanlash</div>
        </div>

        <!-- Name -->
        <input class="field mb-12px" id="grpFormName" placeholder="Guruh / Kanal nomi" maxlength="64" autocomplete="off">

        <!-- Description (channel only) -->
        <div id="grpFormDescWrap" style="display:none">
          <textarea class="ta mb-12px" id="grpFormDesc" placeholder="Tavsif (ixtiyoriy)" rows="2" maxlength="300"></textarea>
        </div>

        <div class="grp-form-desc-hint"></div>

        <!-- Privacy & invite link -->
        <div class="grp-form-section-title">Maxfiylik</div>
        <div id="grpFormLinkSection"></div>

        <!-- Member picker -->
        <div class="grp-form-section-title">A'zolar qo'shish</div>
        <div id="grpMemberPickerSection"></div>

        <div class="grp-form-actions">
          <button class="btn-ghost" id="grpFormCancelBtn">Bekor qilish</button>
          <button class="btn-primary" id="grpFormCreateBtn">Yaratish</button>
        </div>
      </div>
    </div>

    <!-- Join group by invite link -->
    <div class="overlay" id="grpJoinLinkOverlay">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Havola orqali qo'shilish</div>
        <input class="field mb-12px" id="grpJoinLinkInput" placeholder="Guruh havolasini kiriting" maxlength="40" autocomplete="off">
        <div class="grp-form-desc-hint" id="grpJoinLinkErr" style="display:none;color:var(--red,#ef4444)"></div>
        <div class="grp-form-actions">
          <button class="btn-ghost" id="grpJoinLinkCancelBtn">Bekor qilish</button>
          <button class="btn-primary" id="grpJoinLinkSubmitBtn">Qo'shilish</button>
        </div>
      </div>
    </div>

    <!-- Group / Channel info panel -->
    <!-- Group / Channel info (full-screen page, like userProfileModal) -->
    <div id="grpInfoOverlay">
      <button class="gi-back-btn" id="grpInfoCloseBtn" title="Orqaga">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5m7-7-7 7 7 7"/></svg>
      </button>

      <div class="gi-body">

          <!-- Cover + overlapping avatar -->
          <div class="gi-cover" id="grpInfoCover">
            <div class="gi-avi-wrap">
              <div class="gi-avi" id="grpInfoAvi" title="Rasmni ko'rish"></div>
            </div>
          </div>

          <!-- Info below cover -->
          <div class="gi-info">
            <div class="gi-name" id="grpInfoName"></div>
            <div class="gi-type-badge" id="grpInfoTypeBadge"></div>
            <div class="gi-link-row" id="grpInfoLinkRow" style="display:none">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.5"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07L12.5 19.5"/></svg>
              <span id="grpInfoLinkText"></span>
            </div>
            <div class="gi-desc" id="grpInfoDesc" style="display:none"></div>

            <!-- Stats row -->
            <div class="gi-stats-row">
              <div class="gi-stat">
                <div class="gi-stat-val" id="grpInfoMemberCount">0</div>
                <div class="gi-stat-lbl" id="grpInfoMemberLbl">a'zo</div>
              </div>
              <div class="gi-stat" id="grpInfoMediaStat" style="display:none">
                <div class="gi-stat-val" id="grpInfoMediaCount">0</div>
                <div class="gi-stat-lbl">media</div>
              </div>
            </div>
          </div>

          <!-- Action buttons -->
          <div class="gi-actions">
            <button class="gi-action-btn" id="grpInfoEditBtn" style="display:none">
              <span class="gi-action-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg></span>
              <span>Sozlamalar</span>
            </button>
            <button class="gi-action-btn" id="grpInfoAddMemberBtn" style="display:none">
              <span class="gi-action-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg></span>
              <span>A'zo qo'shish</span>
            </button>
            <button class="gi-action-btn gi-action-danger" id="grpInfoLeaveBtn">
              <span class="gi-action-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></span>
              <span>Chiqish</span>
            </button>
            <button class="gi-action-btn gi-action-delete" id="grpInfoDeleteBtn" style="display:none">
              <span class="gi-action-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg></span>
              <span>O'chirish</span>
            </button>
          </div>

          <!-- Media grid -->
          <div class="gi-section" id="grpMediaSection">
            <div class="gi-section-title">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 9 5 3-5 3V9z"/></svg>
              Media fayllar
            </div>
            <div class="gi-media-grid" id="grpInfoMediaGrid">
              <div class="gi-media-spin"><div class="spinner"></div></div>
            </div>
          </div>

          <!-- Members list (group only, hidden for channel) -->
          <div class="gi-section" id="grpMembersSection">
            <div class="gi-section-title">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              A'zolar
            </div>
            <div class="grp-members-list" id="grpMembersList"></div>
          </div>

      </div><!-- /gi-body -->
    </div>

    <!-- GROUP/CHANNEL EDIT OVERLAY -->
    <div class="overlay" id="grpEditOverlay">
      <div class="sheet" style="padding-bottom: max(32px, env(safe-area-inset-bottom))">
        <div class="sheet-handle"></div>
        <div class="sheet-title" id="grpEditTitle">Guruhni sozlash</div>

        <!-- Avatar picker -->
        <div class="grp-edit-avi-wrap">
          <div class="grp-edit-avi" id="grpEditAviImg"></div>
          <div class="grp-edit-avi-badge" id="grpEditAviBadge" title="Rasm o'zgartirish">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </div>
          <input type="file" id="grpEditAviInput" accept="image/*" style="display:none">
        </div>

        <div class="pe-fields">
          <div class="pe-field-label" id="grpEditNameLabel">Guruh nomi *</div>
          <input class="field" type="text" id="grpEditName" placeholder="Guruh nomi">

          <div class="pe-field-label">Tavsif</div>
          <textarea class="ta" id="grpEditDesc" rows="3" placeholder="Guruh haqida..."></textarea>

          <!-- Channel-only: username/link -->
          <div id="grpEditChannelFields" style="display:none">
            <div class="pe-field-label">Kanal havolasi (username)</div>
            <div class="pe-field-prefix-wrap">
              <span class="pe-prefix">@</span>
              <input class="field pe-prefix-field" type="text" id="grpEditUsername" placeholder="channel_name" autocapitalize="none">
            </div>
            <div class="pe-field-label">Kanal turi</div>
            <select class="field" id="grpEditPrivacy">
              <option value="public">Ochiq (hamma topishi mumkin)</option>
              <option value="private">Yopiq (faqat taklif orqali)</option>
            </select>
          </div>

          <!-- Group-only: settings -->
          <div id="grpEditGroupFields" style="display:none">
            <div class="pe-field-label">Guruh turi</div>
            <select class="field" id="grpEditGroupPrivacy">
              <option value="public">Ochiq</option>
              <option value="private">Yopiq</option>
            </select>
            <div class="pe-field-label">Xabar yuborish huquqi</div>
            <select class="field" id="grpEditMsgPerm">
              <option value="all">Barcha a'zolar</option>
              <option value="admins">Faqat adminlar</option>
            </select>
          </div>
        </div>

        <button class="btn-primary" id="grpEditSaveBtn">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Saqlash
        </button>
        <button class="btn-ghost" id="grpEditCancelBtn">Bekor qilish</button>
      </div>
    </div>
  `);

  // Wire events
  document.getElementById('grpChoiceGroup').onclick    = () => openCreateForm('group');
  document.getElementById('grpChoiceChannel').onclick  = () => openCreateForm('channel');
  document.getElementById('grpChoiceUser').onclick     = () => openAddUserByUsername();
  document.getElementById('grpChoiceCancel').onclick   = () =>
    document.getElementById('grpCreateChoiceOverlay').classList.remove('show');

  document.getElementById('grpAddUserSubmitBtn').onclick = _submitAddUserByUsername;
  document.getElementById('grpAddUserCancelBtn').onclick = () =>
    document.getElementById('grpAddUserOverlay').classList.remove('show');
  document.getElementById('grpAddUserInput')

  document.getElementById('grpJoinLinkSubmitBtn').onclick = _submitJoinByLink;
  document.getElementById('grpJoinLinkCancelBtn').onclick = () =>
    document.getElementById('grpJoinLinkOverlay').classList.remove('show');
  document.getElementById('grpJoinLinkInput')

  document.getElementById('grpFormAvi').onclick   = pickGroupPhoto;
  document.getElementById('grpFormAviWrap').onclick = pickGroupPhoto;
  document.getElementById('grpFormCreateBtn').onclick = submitCreateGroup;
  document.getElementById('grpFormCancelBtn').onclick = () => {
    const ov = document.getElementById('grpCreateFormOverlay');
    ov.classList.remove('show');
    ov.dataset.addMode = '';
    ov.querySelector('.grp-form-avi-wrap').style.display = '';
    ov.querySelector('#grpFormName').style.display = '';
    ov.querySelector('#grpFormCreateBtn').textContent = 'Yaratish';
  };

  // Close info panel
  document.getElementById('grpInfoCloseBtn').onclick = () =>
    document.getElementById('grpInfoOverlay').classList.remove('show');

  // Backdrop click closes
  ['grpCreateChoiceOverlay','grpAddUserOverlay','grpJoinLinkOverlay','grpCreateFormOverlay','grpInfoOverlay','grpEditOverlay'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target.id === id) { document.getElementById(id).classList.remove('show'); unlockScroll(); }
    });
  });
}

/* ─────────────────────────────────────────────────────────────────────
   RENDER GROUP ROWS in chats list (called from chat.js)
   ───────────────────────────────────────────────────────────────────── */
export function getGroupRows() {
  return groupListItems;
}

export function getCurrentGroupId() { return _currentGroupId; }
export function getCurrentGroupData() { return _currentGroupData; }
