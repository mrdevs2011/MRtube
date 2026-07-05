/**
 * call.js — faqat WebRTC call engine + chat.js dan re-export
 * 
 * MUHIM: Oldingi versiyada call.js chat.js bilan bir xil kodni o'z ichida 
 * takrorlagan, natijada barcha Firestore listener'lar IKKI MARTA ishga tushar,
 * RAM va CPU ikki barobar sarflanardi. Endi faqat call-specific kod bu yerda.
 */

// Chat funksiyalarini chat.js dan re-export qilamiz (takrorlash yo'q)
export {
  startChatsWatcher,
  stopChatsWatcher,
  renderChatsList,
  repaintNoticeBanner,
  openChatThread,
  closeChatThread,
  sendChatMessage,
  destroyChatsView,
} from './chat.js';

import { db, state, isAdmin } from './config.js';
import { $ } from './utils.js';
import {
  collection, query, where,
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

function chatIdFor(uidA, uidB) { return [uidA, uidB].sort().join('_'); }

/* ══════════════════════════════════════════════════════════════════════
   WebRTC CALL ENGINE  (Firestore signaling)
   ══════════════════════════════════════════════════════════════════════ */

const ICE_SERVERS = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let _pc          = null;
let _localStream = null;
let _callDocRef  = null;
let _callUnsub   = null;
let _callTimer   = null;
let _callSec     = 0;
let _callIsVideo = false;
let _isCaller    = false;
let _facingMode  = 'user'; // 'user' = old kamera, 'environment' = orqa kamera

/* ─── RINGBACK TONE ─────────────────────────────────────────────────── */
let _ringbackCtx  = null;
let _ringbackLoop = null;

function _playRingback() {
  _stopRingback();
  try {
    _ringbackCtx = new (window.AudioContext || window.webkitAudioContext)();
    function _beep() {
      if (!_ringbackCtx) return;
      const osc  = _ringbackCtx.createOscillator();
      const gain = _ringbackCtx.createGain();
      osc.connect(gain); gain.connect(_ringbackCtx.destination);
      osc.type = 'sine'; osc.frequency.value = 425;
      gain.gain.setValueAtTime(0, _ringbackCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.18, _ringbackCtx.currentTime + 0.02);
      gain.gain.setValueAtTime(0.18, _ringbackCtx.currentTime + 0.95);
      gain.gain.linearRampToValueAtTime(0, _ringbackCtx.currentTime + 1.0);
      osc.start(_ringbackCtx.currentTime);
      osc.stop(_ringbackCtx.currentTime + 1.0);
    }
    _beep();
    _ringbackLoop = setInterval(_beep, 5000);
  } catch (_) {}
}

function _stopRingback() {
  clearInterval(_ringbackLoop); _ringbackLoop = null;
  if (_ringbackCtx) { try { _ringbackCtx.close(); } catch(_){} _ringbackCtx = null; }
}

/* ─── INCOMING RINGTONE (qabul qiluvchi uchun) ──────────────────────── */
let _ringCtx      = null;
let _ringLoop     = null;
let _ringVibrate  = null;

function _startRingtone() {
  _stopRingtone();

  // Telefon jiringlash ovozi (klassik ring pattern: 440Hz + 480Hz mix)
  try {
    _ringCtx = new (window.AudioContext || window.webkitAudioContext)();

    function _ringOnce() {
      if (!_ringCtx) return;
      const dur = 1.2; // bir marta jiringlash davomiyligi

      [440, 480].forEach(freq => {
        const osc  = _ringCtx.createOscillator();
        const gain = _ringCtx.createGain();
        osc.connect(gain);
        gain.connect(_ringCtx.destination);
        osc.type = 'sine';
        osc.frequency.value = freq;

        const t = _ringCtx.currentTime;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.25, t + 0.05);
        gain.gain.setValueAtTime(0.25, t + dur - 0.1);
        gain.gain.linearRampToValueAtTime(0, t + dur);
        osc.start(t);
        osc.stop(t + dur);
      });
    }

    _ringOnce();
    // Har 2 soniyada jiringlaydi (1.2s ovoz + 0.8s pauza)
    _ringLoop = setInterval(_ringOnce, 2000);
  } catch (_) {}

  // Tebranish pattern: [jiringlash, pauza, jiringlash, pauza...]
  if (navigator.vibrate) {
    const vibratePattern = [500, 500, 500, 500, 500, 500];
    navigator.vibrate(vibratePattern);
    _ringVibrate = setInterval(() => {
      if (navigator.vibrate) navigator.vibrate(vibratePattern);
    }, 3000);
  }
}

function _stopRingtone() {
  clearInterval(_ringLoop);   _ringLoop = null;
  clearInterval(_ringVibrate); _ringVibrate = null;
  if (_ringCtx) {
    try { _ringCtx.close(); } catch (_) {}
    _ringCtx = null;
  }
  if (navigator.vibrate) navigator.vibrate(0); // tebranishni to'xtatish
}

function _playConnectBeep() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(1100, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.22, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.28);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
    osc.onended = () => { try { ctx.close(); } catch(_){} };
  } catch (_) {}
}

/* ─── MIC PULSE ANIMATSIYA ──────────────────────────────────────────── */
let _micAnalyserFrame = null;

function _startMicPulse(stream) {
  _stopMicPulse();
  const wrap = document.getElementById('callActiveAvi');
  if (!wrap) return;

  // img ni topamiz yoki fallback sifatida wrap ni ishlatamiz
  const img = wrap.querySelector('img') || wrap;

  // wrapper ga overflow:visible berish — scale kesib qolmasin
  wrap.style.overflow        = 'visible';
  wrap.style.willChange      = 'box-shadow';
  wrap.style.transformOrigin = '50% 50%';

  // img smooth scale uchun
  img.style.willChange      = 'transform';
  img.style.transformOrigin = '50% 50%';
  img.style.borderRadius    = '50%';

  try {
    const ctx      = new (window.AudioContext || window.webkitAudioContext)();
    const src      = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize        = 512;
    analyser.smoothingTimeConstant = 0.75;   // smooth
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    // Eksponensial smoothing uchun
    let smoothLevel = 0;

    function _tick() {
      _micAnalyserFrame = requestAnimationFrame(_tick);
      analyser.getByteFrequencyData(data);

      // Faqat nutq diapazonini olish (200–3000 Hz)
      const binHz   = (ctx.sampleRate / analyser.fftSize);
      const lo      = Math.floor(200  / binHz);
      const hi      = Math.ceil(3000  / binHz);
      let sum = 0;
      for (let i = lo; i <= hi && i < data.length; i++) sum += data[i];
      const raw = sum / ((hi - lo) || 1);

      // Yumshoq o'tish (attack tez, release sekin)
      const target = Math.min(raw / 90, 1);
      smoothLevel += target > smoothLevel
        ? (target - smoothLevel) * 0.35   // attack
        : (target - smoothLevel) * 0.12;  // release

      const scale = 1 + smoothLevel * 0.32;          // max ~1.32x
      const ring1 = Math.round(smoothLevel * 18);    // yaqin ring px
      const ring2 = Math.round(smoothLevel * 38);    // uzoq ring px
      const a1    = (0.15 + smoothLevel * 0.75).toFixed(2);
      const a2    = (0.05 + smoothLevel * 0.35).toFixed(2);

      // IMG: smooth scale
      img.style.transform  = `scale(${scale.toFixed(4)})`;
      img.style.transition = 'transform 0.06s ease-out';

      // WRAPPER: glow rings
      wrap.style.boxShadow =
        `0 0 0 ${ring1}px rgba(59,130,246,${a1}),` +
        `0 0 0 ${ring2}px rgba(59,130,246,${a2}),` +
        `0 0 ${ring2 * 2}px rgba(99,179,237,${(a2 * 0.6).toFixed(2)})`;
      wrap.style.transition = 'box-shadow 0.06s ease-out';
    }
    _tick();
    wrap._micCtx = ctx;
  } catch (_) {}
}

function _stopMicPulse() {
  if (_micAnalyserFrame) { cancelAnimationFrame(_micAnalyserFrame); _micAnalyserFrame = null; }
  const wrap = document.getElementById('callActiveAvi');
  if (wrap) {
    const img = wrap.querySelector('img') || wrap;
    img.style.transform  = 'scale(1)';
    img.style.transition = 'transform 0.3s ease-out';
    wrap.style.boxShadow = '';
    wrap.style.overflow  = 'hidden';
    setTimeout(() => { img.style.transform = ''; img.style.transition = ''; }, 320);
    if (wrap._micCtx) { try { wrap._micCtx.close(); } catch(_){} wrap._micCtx = null; }
  }
}

/* ── Yordamchi: timer ── */
function _startCallTimer() {
  _callSec = 0;
  clearInterval(_callTimer);
  _callTimer = setInterval(() => {
    _callSec++;
    const m = String(Math.floor(_callSec / 60)).padStart(2, '0');
    const s = String(_callSec % 60).padStart(2, '0');
    const el = document.getElementById('callTimer');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

function _stopCallTimer() {
  clearInterval(_callTimer);
  _callTimer = null;
  _callSec   = 0;
}

/* ── Yordamchi: modal ko'rsatish ── */
function _showActiveCallModal(otherName, otherAvi, isVideo) {
  const modal = document.getElementById('callActiveModal');
  const nameEl = document.getElementById('callActiveName');
  const aviEl  = document.getElementById('callActiveAvi');
  const statusEl = document.getElementById('callStatus');
  const timerEl  = document.getElementById('callTimer');
  const videoWrap = document.getElementById('callVideoWrap');
  const voiceWrap = document.getElementById('callVoiceWrap');
  const camBtn    = document.getElementById('callCamBtn');
  const switchBtn = document.getElementById('callSwitchCamBtn');

  if (nameEl)   nameEl.textContent = otherName || 'Foydalanuvchi';
  if (aviEl)    aviEl.innerHTML = otherAvi
    ? `<img src="${otherAvi}" onerror="this.style.display='none'">`
    : '';
  if (statusEl) statusEl.textContent = 'Qo\'ng\'iroq qilinmoqda...';
  if (timerEl)  timerEl.textContent  = '00:00';

  if (isVideo) {
    modal?.classList.add('video-mode');
    if (videoWrap)  videoWrap.style.display  = '';
    if (voiceWrap)  voiceWrap.style.display  = 'none';
    if (camBtn)     camBtn.style.display     = '';
    if (switchBtn)  switchBtn.style.display  = '';
  } else {
    modal?.classList.remove('video-mode');
    if (videoWrap)  videoWrap.style.display  = 'none';
    if (voiceWrap)  voiceWrap.style.display  = '';
    if (camBtn)     camBtn.style.display     = 'none';
    if (switchBtn)  switchBtn.style.display  = 'none';
  }

  modal?.classList.add('show');
}

function _hideActiveCallModal() {
  document.getElementById('callActiveModal')?.classList.remove('show', 'video-mode');
}

/* ── Qo'ng'iroqni to'liq tugatish ── */
async function _endCall(notify = true) {
  _stopCallTimer();
  _stopRingback();
  _stopMicPulse();

  if (_callUnsub) { _callUnsub(); _callUnsub = null; }

  if (_localStream) {
    _localStream.getTracks().forEach(t => t.stop());
    _localStream = null;
  }

  if (_pc) {
    _pc.close();
    _pc = null;
  }

  // Video elementlarni tozalash
  const rv = document.getElementById('callRemoteVideo');
  const lv = document.getElementById('callLocalVideo');
  const ra = document.getElementById('callRemoteAudio');
  if (rv) rv.srcObject = null;
  if (lv) lv.srcObject = null;
  if (ra) ra.srcObject = null;

  _hideActiveCallModal();
  document.getElementById('incomingCallModal')?.classList.remove('show');

  // Firestore call hujjatini o'chirish
  if (notify && _callDocRef) {
    try { await deleteDoc(_callDocRef); } catch (_) {}
  }
  _callDocRef = null;
  _isCaller   = false;
  _facingMode = 'user';
}

/* ── PeerConnection yaratish ── */
function _createPC() {
  if (_pc) { _pc.close(); }
  _pc = new RTCPeerConnection(ICE_SERVERS);

  _pc.ontrack = e => {
    const stream = e.streams[0];
    if (_callIsVideo) {
      const rv = document.getElementById('callRemoteVideo');
      if (rv) rv.srcObject = stream;
    } else {
      const ra = document.getElementById('callRemoteAudio');
      if (ra) {
        ra.srcObject = stream;
        // Default = earpiece (quloqqa tutilsa eshitiladi)
        setTimeout(() => _applySpeaker(_speakerOn), 300);
      }
    }
    // Qo'ng'iroq ulandi
    _stopRingback();
    _playConnectBeep();
    _startMicPulse(_localStream);
    const statusEl = document.getElementById('callStatus');
    if (statusEl) statusEl.textContent = 'Ulandi';
    _startCallTimer();
  };

  _pc.onicecandidate = async e => {
    if (e.candidate && _callDocRef) {
      const field = _isCaller ? 'callerCandidates' : 'calleeCandidates';
      try {
        await updateDoc(_callDocRef, {
          [field]: arrayUnion(e.candidate.toJSON())
        });
      } catch (_) {}
    }
  };

  _pc.onconnectionstatechange = () => {
    if (_pc?.connectionState === 'disconnected' ||
        _pc?.connectionState === 'failed' ||
        _pc?.connectionState === 'closed') {
      _endCall(false);
    }
  };

  return _pc;
}

/* ── Qo'ng'iroq boshlash (caller) ── */
async function initiateCall(isVideo) {
  const uid = state.currentChatUid;
  if (!uid || !state.me) return;

  _callIsVideo = isVideo;
  _isCaller    = true;
  _facingMode  = 'user';

  // Har yangi qo'ng'iroqda speaker = off (earpiece, default)
  _speakerOn = false;
  const spBtn = document.getElementById('callSpeakerBtn');
  if (spBtn) { spBtn.classList.remove('active'); spBtn.title = 'Dinamik (ovoz)'; }

  try {
    _localStream = await navigator.mediaDevices.getUserMedia(
      isVideo ? { audio: true, video: { facingMode: _facingMode } } : { audio: true }
    );
  } catch (err) {
    alert('Mikrofon/kameraga ruxsat yo\'q: ' + err.message);
    return;
  }

  // Local video preview
  if (isVideo) {
    const lv = document.getElementById('callLocalVideo');
    if (lv) lv.srcObject = _localStream;
  }

  // Qabul qiluvchi ma'lumotlari
  let otherName = document.getElementById('chatThreadName')?.textContent || 'Foydalanuvchi';
  let otherAvi  = '';
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const d = snap.data() || {};
    otherName = d.fullName || otherName;
    otherAvi  = d.avatar   || '';
  } catch (_) {}

  _showActiveCallModal(otherName, otherAvi, isVideo);
  _playRingback();

  // PC yaratish va track qo'shish
  _createPC();
  _localStream.getTracks().forEach(t => _pc.addTrack(t, _localStream));

  // Offer yaratish
  const offer = await _pc.createOffer();
  await _pc.setLocalDescription(offer);

  // Firestore da call hujjat yaratish
  const chatId = chatIdFor(state.me.uid, uid);
  _callDocRef = doc(db, 'calls', chatId);
  await setDoc(_callDocRef, {
    callerId:         state.me.uid,
    calleeId:         uid,
    type:             isVideo ? 'video' : 'voice',
    status:           'ringing',
    offer:            { type: offer.type, sdp: offer.sdp },
    callerCandidates: [],
    calleeCandidates: [],
    createdAt:        serverTimestamp()
  });

  // Answer kutish
  _callUnsub = onSnapshot(_callDocRef, async snap => {
    const data = snap.data();
    if (!data) { await _endCall(false); return; }

    if (data.status === 'declined' || data.status === 'ended') {
      await _endCall(false);
      return;
    }

    if (data.answer && _pc.signalingState === 'have-local-offer') {
      await _pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }

    // Callee ICE candidates
    if (data.calleeCandidates?.length) {
      const existing = _pc._addedCallee || 0;
      const newOnes  = data.calleeCandidates.slice(existing);
      for (const c of newOnes) {
        try { await _pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
      }
      _pc._addedCallee = data.calleeCandidates.length;
    }
  });
}

/* ── Kiruvchi qo'ng'iroqni qabul qilish (callee) ── */
async function _acceptIncomingCall(callData, callRef) {
  _callIsVideo = callData.type === 'video';
  _isCaller    = false;
  _callDocRef  = callRef;
  _facingMode  = 'user';

  document.getElementById('incomingCallModal')?.classList.remove('show');

  try {
    _localStream = await navigator.mediaDevices.getUserMedia(
      _callIsVideo ? { audio: true, video: { facingMode: _facingMode } } : { audio: true }
    );
  } catch (err) {
    alert('Mikrofon/kameraga ruxsat yo\'q: ' + err.message);
    await updateDoc(callRef, { status: 'declined' });
    return;
  }

  if (_callIsVideo) {
    const lv = document.getElementById('callLocalVideo');
    if (lv) lv.srcObject = _localStream;
  }

  // Caller ma'lumotlari
  let callerName = 'Foydalanuvchi', callerAvi = '';
  try {
    const snap = await getDoc(doc(db, 'users', callData.callerId));
    const d = snap.data() || {};
    callerName = d.fullName || callerName;
    callerAvi  = d.avatar   || '';
  } catch (_) {}

  _showActiveCallModal(callerName, callerAvi, _callIsVideo);

  _createPC();
  _localStream.getTracks().forEach(t => _pc.addTrack(t, _localStream));

  await _pc.setRemoteDescription(new RTCSessionDescription(callData.offer));

  // Caller ICE candidates (mavjudlarini qo'shish)
  if (callData.callerCandidates?.length) {
    for (const c of callData.callerCandidates) {
      try { await _pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
    }
    _pc._addedCaller = callData.callerCandidates.length;
  }

  const answer = await _pc.createAnswer();
  await _pc.setLocalDescription(answer);
  await updateDoc(callRef, {
    answer: { type: answer.type, sdp: answer.sdp },
    status: 'accepted'
  });

  // Caller ICE candidates stream
  _callUnsub = onSnapshot(callRef, async snap => {
    const data = snap.data();
    if (!data) { await _endCall(false); return; }
    if (data.status === 'ended') { await _endCall(false); return; }

    if (data.callerCandidates?.length) {
      const existing = _pc._addedCaller || 0;
      const newOnes  = data.callerCandidates.slice(existing);
      for (const c of newOnes) {
        try { await _pc.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
      }
      _pc._addedCaller = data.callerCandidates.length;
    }
  });
}

/* ── Kiruvchi qo'ng'iroqni kuzatish ── */
let _incomingUnsub  = null;
let _activeCallDocId = null; // hozir ko'rsatilayotgan qo'ng'iroq ID si (duplicate oldini olish)
let _autoRejectTimer = null;

// Tugma listenerlarini tozalash uchun ref lar
let _boundAccept = null;
let _boundReject = null;

function _cleanCallModal() {
  const acceptBtn = document.getElementById('incomingCallAccept');
  const rejectBtn = document.getElementById('incomingCallReject');
  if (_boundAccept) { acceptBtn?.removeEventListener('click', _boundAccept); _boundAccept = null; }
  if (_boundReject) { rejectBtn?.removeEventListener('click', _boundReject); _boundReject = null; }
  if (_autoRejectTimer) { clearTimeout(_autoRejectTimer); _autoRejectTimer = null; }
  _activeCallDocId = null;
  _stopRingtone();
  document.getElementById('incomingCallModal')?.classList.remove('show');
}

export function startCallWatcher() {
  if (!state.me?.uid) return;
  if (_incomingUnsub) { _incomingUnsub(); _incomingUnsub = null; }

  _incomingUnsub = onSnapshot(
    query(collection(db, 'calls'), where('calleeId', '==', state.me.uid), where('status', '==', 'ringing')),
    async snap => {
      // Qo'ng'iroq tugagan — modal yopish
      if (snap.empty) {
        if (_activeCallDocId) _cleanCallModal();
        return;
      }

      const callDoc = snap.docs[0];
      const data    = callDoc.data();

      // Allaqachon shu qo'ng'iroq ko'rsatilmoqda — qayta ochmaymiz
      if (_activeCallDocId === callDoc.id) return;

      // Allaqachon qo'ng'iroqda bo'lsak — rad etamiz
      if (_pc) {
        try { await updateDoc(callDoc.ref, { status: 'declined' }); } catch(_) {}
        return;
      }

      // Avvalgi modal tozalash (eski listenerlar olib tashlanadi)
      _cleanCallModal();
      _activeCallDocId = callDoc.id;

      // Caller ma'lumotlari
      let callerName = 'Foydalanuvchi', callerAvi = '';
      try {
        const us = await getDoc(doc(db, 'users', data.callerId));
        const ud = us.data() || {};
        callerName = ud.fullName || callerName;
        callerAvi  = ud.avatar   || '';
      } catch (_) {}

      // Kiruvchi qo'ng'iroq modal
      const modal    = document.getElementById('incomingCallModal');
      const nameEl   = document.getElementById('incomingCallName');
      const typeEl   = document.getElementById('incomingCallType');
      const aviEl    = document.getElementById('incomingCallAvi');
      const acceptBtn = document.getElementById('incomingCallAccept');
      const rejectBtn = document.getElementById('incomingCallReject');

      if (nameEl) nameEl.textContent = callerName;
      if (typeEl) typeEl.textContent = data.type === 'video' ? 'Video qo\'ng\'iroq' : 'Ovozli qo\'ng\'iroq';
      if (aviEl)  aviEl.innerHTML = callerAvi
        ? `<img src="${callerAvi}" onerror="this.style.display='none'">`
        : '';

      modal?.classList.add('show');
      _startRingtone();

      // Qabul qilish
      _boundAccept = async () => {
        _cleanCallModal();
        await _acceptIncomingCall(data, callDoc.ref);
      };

      // Rad etish
      _boundReject = async () => {
        _cleanCallModal();
        try { await updateDoc(callDoc.ref, { status: 'declined' }); } catch(_) {}
      };

      acceptBtn?.addEventListener('click', _boundAccept);
      rejectBtn?.addEventListener('click', _boundReject);

      // 30 soniyadan keyin avtomatik rad etish
      _autoRejectTimer = setTimeout(async () => {
        if (_activeCallDocId === callDoc.id) {
          _cleanCallModal();
          try { await updateDoc(callDoc.ref, { status: 'declined' }); } catch (_) {}
        }
      }, 30000);
    },
    err => {
      // Index yo'q yoki ruxsat yo'q — konsolga yozamiz
      console.error('[CallWatcher] onSnapshot xatosi:', err.code, err.message);
      if (err.code === 'failed-precondition') {
        console.warn('[CallWatcher] Firestore composite index kerak: calleeId + status\n' +
          'Firebase Console → Firestore → Indexes → Add index:\n' +
          'Collection: calls | Fields: calleeId ASC, status ASC');
      }
    }
  );
}

export function stopCallWatcher() {
  if (_incomingUnsub) { _incomingUnsub(); _incomingUnsub = null; }
}

/* ── Call tugmalariga click listener ── */
document.getElementById('chatVoiceCallBtn')?.addEventListener('click', () => initiateCall(false));
document.getElementById('chatVideoCallBtn')?.addEventListener('click', () => initiateCall(true));

/* ── Active call controls ── */
document.getElementById('callEndBtn')?.addEventListener('click', async () => {
  if (_callDocRef) {
    try { await updateDoc(_callDocRef, { status: 'ended' }); } catch (_) {}
  }
  await _endCall(false);
});

document.getElementById('callMicBtn')?.addEventListener('click', function () {
  const track = _localStream?.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  this.classList.toggle('muted', !track.enabled);
});

document.getElementById('callCamBtn')?.addEventListener('click', function () {
  const track = _localStream?.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  this.classList.toggle('muted', !track.enabled);
});

/* ── Old kamera ↔ orqa kamera almashtirish ── */
let _switchingCam = false;

async function _switchCamera() {
  if (_switchingCam || !_localStream || !_callIsVideo) return;
  const oldTrack = _localStream.getVideoTracks()[0];
  if (!oldTrack) return;

  _switchingCam = true;
  const btn = document.getElementById('callSwitchCamBtn');
  btn?.classList.add('active');

  const wasEnabled = oldTrack.enabled;
  const newFacing  = _facingMode === 'user' ? 'environment' : 'user';

  // Avval eski kamerani to'liq to'xtatamiz — ko'pchilik mobil brauzerlar
  // (Android/iOS) bir vaqtda 2 ta kamera oqimini ochishga ruxsat bermaydi,
  // shuning uchun eskisi ochiq turganda yangisini so'rash xato beradi.
  _localStream.removeTrack(oldTrack);
  oldTrack.stop();

  const getStream = (constraint) => navigator.mediaDevices.getUserMedia({
    audio: false,
    video: constraint
  });

  try {
    let newStream;
    try {
      // Avval qat'iy (exact) urinib ko'ramiz
      newStream = await getStream({ facingMode: { exact: newFacing } });
    } catch (_) {
      // Qurilmada aynan shu label topilmasa, yumshoqroq (ideal) bilan qayta urinamiz
      newStream = await getStream({ facingMode: { ideal: newFacing } });
    }

    const newTrack = newStream.getVideoTracks()[0];
    newTrack.enabled = wasEnabled;

    // Peer connection ga yangi trackni almashtirish (qayta muzokarasiz)
    const sender = _pc?.getSenders().find(s => s.track && s.track.kind === 'video');
    if (sender) { try { await sender.replaceTrack(newTrack); } catch (_) {} }

    // Local streamga yangi trackni qo'shamiz
    _localStream.addTrack(newTrack);

    // Preview elementini yangilash (ba'zi brauzerlarda kerak bo'ladi)
    const lv = document.getElementById('callLocalVideo');
    if (lv) { lv.srcObject = null; lv.srcObject = _localStream; }

    _facingMode = newFacing;
  } catch (err) {
    console.warn('[Call] Kamera almashtirib bo\'lmadi:', err.message);
    // Eski kamerani qaytarishga urinamiz, aks holda video butunlay o'chib qolmasin
    try {
      const restored = await getStream({ facingMode: { ideal: _facingMode } });
      const restoredTrack = restored.getVideoTracks()[0];
      restoredTrack.enabled = wasEnabled;
      _localStream.addTrack(restoredTrack);
      const sender = _pc?.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) { try { await sender.replaceTrack(restoredTrack); } catch (_) {} }
      const lv = document.getElementById('callLocalVideo');
      if (lv) { lv.srcObject = null; lv.srcObject = _localStream; }
    } catch (_) {}
    alert('Kamerani almashtirib bo\'lmadi. Qurilmangizda faqat bitta kamera bo\'lishi mumkin.');
  } finally {
    _switchingCam = false;
    btn?.classList.remove('active');
  }
}

document.getElementById('callSwitchCamBtn')?.addEventListener('click', _switchCamera);

/* ── Speaker (earpiece ↔ dinamik) toggle ── */
// _speakerOn = false → earpiece (quloqqa tutilsa eshitiladi, default)
// _speakerOn = true  → dinamik (baland ovoz)
let _speakerOn = false;

async function _applySpeaker(on) {
  const ra = document.getElementById('callRemoteAudio');
  if (!ra) return;

  // setSinkId — Chrome/Edge Android da earpiece vs speaker
  if (typeof ra.setSinkId === 'function') {
    try {
      if (on) {
        // Barcha audio qurilmalarini olish va 'speaker' ni topish
        const devices = await navigator.mediaDevices.enumerateDevices();
        const speaker = devices.find(d =>
          d.kind === 'audiooutput' &&
          (d.label.toLowerCase().includes('speaker') ||
           d.label.toLowerCase().includes('loud') ||
           d.deviceId === 'speaker')
        );
        await ra.setSinkId(speaker?.deviceId || 'default');
      } else {
        // Earpiece — 'communications' device yoki bo'sh string
        const devices = await navigator.mediaDevices.enumerateDevices();
        const earpiece = devices.find(d =>
          d.kind === 'audiooutput' &&
          (d.label.toLowerCase().includes('earpiece') ||
           d.label.toLowerCase().includes('ear') ||
           d.deviceId === 'communications')
        );
        await ra.setSinkId(earpiece?.deviceId || 'communications');
      }
    } catch (err) {
      console.warn('[Call] setSinkId failed:', err.message);
      // Fallback: volume orqali farqlash
      ra.volume = on ? 1.0 : 0.3;
    }
  } else {
    // setSinkId qo'llab-quvvatlanmasa — volume bilan farqlaymiz
    ra.volume = on ? 1.0 : 0.3;
  }
}

document.getElementById('callSpeakerBtn')?.addEventListener('click', async function () {
  _speakerOn = !_speakerOn;
  await _applySpeaker(_speakerOn);
  // muted emas — speaker off = earpiece (baribir eshitiladi, faqat past)
  this.classList.toggle('active', _speakerOn);
  this.title = _speakerOn ? 'Dinamik (yoqiq)' : 'Quloqcha rejimi';
});

// Qo'ng'iroq boshlanganida default = earpiece (past, quloqqa tutilsa eshitiladi)
export function _resetSpeaker() {
  _speakerOn = false;
  _applySpeaker(false);
  const btn = document.getElementById('callSpeakerBtn');
  if (btn) { btn.classList.remove('active'); btn.title = 'Dinamik (ovoz)'; }
}
