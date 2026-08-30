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

import { db, state } from './config.js';
import { $ } from './utils.js';
import {
  collection, query, where,
  doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { MRGRAM_AI_UID } from './mrgram-ai.js';

function chatIdFor(uidA, uidB) { return [uidA, uidB].sort().join('_'); }

/* ══════════════════════════════════════════════════════════════════════
   WebRTC CALL ENGINE  (Firestore signaling)
   ══════════════════════════════════════════════════════════════════════ */

// STUN — faqat "ochiq" tarmoqlarda ishlaydi. Ko'pchilik haqiqiy holatda
// (mobil internet, turli operatorlar, qattiq NAT) TO'G'RIDAN-TO'G'RI P2P
// ulanish imkonsiz bo'ladi va TURN relay orqali o'tish SHART bo'ladi —
// shuning uchun TURN serverlar ham qo'shildi (aks holda qo'ng'iroq "ulanadi,
// lekin ovoz/video kelmaydi" yoki "tez-tez uziladi" bo'lib chiqadi).
// PASTDAGI OpenRelay (Metered.ca) — bepul, umumiy, sinov uchun yaroqli TURN.
// Productionda o'zingizning TURN serveringiz (masalan coturn) yoki
// Twilio/Metered'ning shaxsiy hisobidagi kalitlaringiz bilan almashtiring —
// bepul umumiy server yuklama ostida sekinlashishi/cheklanishi mumkin.
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:openrelay.metered.ca:80' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};

let _pc          = null;
let _localStream = null;
let _callDocRef  = null;
let _staleCallDocRef = null; // avvalgi qo'ng'iroq hujjati o'chmay qolgan bo'lsa, shu yerda saqlanadi
let _callUnsub   = null;
let _callTimer   = null;
let _callSec     = 0;
let _callIsVideo = false;
let _isCaller    = false;
let _facingMode  = 'user'; // 'user' = old kamera, 'environment' = orqa kamera

// ── Qo'ng'iroq davomida video yoqish/o'chirish (Telegram uslubi: bitta
// "qo'ng'iroq" tugmasi bilan boshlanadi, video esa faol qo'ng'iroq ichida
// kamera tugmasi bosilganda yoqiladi) uchun holat ──
let _localVideoOn      = false; // biz hozir video yuboryapmizmi
let _remoteHasVideo    = false; // qarshi tomon hozir video yuboryaptimi
let _callConnected     = false; // ulanish effektlari (beep/timer) faqat 1 marta ishga tushishi uchun
let _lastRenegoOfferTs  = 0;
let _lastRenegoAnswerTs = 0;

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

/* ══════════════════════════════════════════════════════════════════════
   UMUMIY (SHARED) AudioContext — BUGFIX (2026-07-08)
   ══════════════════════════════════════════════════════════════════════
   ILGARI: har bir qo'ng'iroqda 3 TA ALOHIDA AudioContext yaratilardi —
   mikrofon "pulse" animatsiyasi uchun, VAD (ovoz aniqlash) uchun, va AI
   ovozini tahlil qilish uchun. Bu:
     1) Mobil brauzerlarda (ayniqsa iOS Safari) resurs bo'lib ketardi —
        bir nechta parallel AudioContext ba'zan ovoz kesilishi/g'ijirlashiga
        sabab bo'lardi.
     2) Fon rejimiga o'tilganda (ekran qulflansa, boshqa ilova ochilsa)
        brauzer AudioContext'larni avtomatik "suspend" qiladi — kod esa
        ularni qayta "resume" qilmasdi. Natijada TASODIFIY: AI ovozi
        umuman eshitilmay qoladi (audio elementi "ijro etilyapti", lekin
        WebAudio grafigi to'xtatilgan bo'lgani uchun tovush chiqmaydi) YOKI
        mikrofon tahlili doim "jimlik" o'qib, foydalanuvchi gapirsa ham
        aniqlanmay qoladi ("mikrofon eshitmayapti").
   ENDI: bitta AudioContext yaratiladi va butun sessiya davomida saqlanadi
   (yopilmaydi) — har ishlatishdan oldin resume() chaqiriladi, shuningdek
   sahifa qayta ko'rinadigan bo'lganda (visibilitychange) ham avtomatik
   resume qilinadi. */
let _sharedAudioCtx = null;

function _getSharedAudioCtx() {
  if (!_sharedAudioCtx || _sharedAudioCtx.state === 'closed') {
    _sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_sharedAudioCtx.state === 'suspended') {
    _sharedAudioCtx.resume().catch(() => {});
  }
  return _sharedAudioCtx;
}

// Ilova fonga o'tib qaytganda (ekran qulflanishi, boshqa ilova, tab
// almashtirish) — qo'ng'iroq hali faol bo'lsa audio grafigini darhol
// tiklaymiz, aks holda foydalanuvchi qaytib kelganda ovoz "o'lik" qolib
// ketishi mumkin edi.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && _pc) {
    _sharedAudioCtx?.resume().catch(() => {});
  }
});

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
    const ctx      = _getSharedAudioCtx();
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
    // ESLATMA: bu yerda AudioContext'ni endi YOPMAYMIZ — u umumiy
    // (_getSharedAudioCtx) va butun sessiya davomida qayta ishlatiladi;
    // yopish keyingi qo'ng'iroqlarda yangi context yaratish zarurati va
    // shu bilan bog'liq tasodifiy audio muammolarni qaytarardi.
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

/* ── Yordamchi: voice-wrap ↔ video-wrap orasida SMOOTH (crossfade) o'tish ──
   Ikkala qatlam ham doim DOM'da turadi (call-stage ichida ustma-ust), shu
   sababli display:none bilan sakrab o'tish o'rniga opacity/scale bilan
   erib o'tadi (CSS: .cs-active klassi orqali boshqariladi). */
function _setVideoModeUI(showVideo) {
  const modal      = document.getElementById('callActiveModal');
  const videoWrap  = document.getElementById('callVideoWrap');
  const voiceWrap  = document.getElementById('callVoiceWrap');
  const camBtn     = document.getElementById('callCamBtn');
  const switchBtn  = document.getElementById('callSwitchCamBtn');

  modal?.classList.toggle('video-mode', !!showVideo);
  videoWrap?.classList.toggle('cs-active', !!showVideo);
  voiceWrap?.classList.toggle('cs-active', !showVideo);

  const localVideoEl = document.getElementById('callLocalVideo');
  localVideoEl?.classList.toggle('cs-active', _localVideoOn);

  if (camBtn) {
    camBtn.classList.toggle('active', _localVideoOn);
    camBtn.classList.toggle('muted',  showVideo && !_localVideoOn);
    camBtn.title = _localVideoOn ? 'Kamerani o\'chirish' : 'Videoni yoqish';
  }
  // Kamera almashtirish tugmasi faqat biz o'zimiz video yuborayotganda kerak
  const switchCol = document.getElementById('callSwitchCol');
  if (switchCol) switchCol.style.display = _localVideoOn ? '' : 'none';
}

/* ── Yordamchi: modal ko'rsatish ── */
/* Avatar rasm bo'lmasa — ismning bosh harfi bilan doira (Telegram/Discord uslubida) */
function _avatarHTML(name, photoUrl) {
  if (photoUrl) return `<img src="${photoUrl}" onerror="this.style.display='none'">`;
  const letter = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="call-avi-initial">${letter}</span>`;
}

function _showActiveCallModal(otherName, otherAvi, isVideo) {
  const modal = document.getElementById('callActiveModal');
  const nameEl = document.getElementById('callActiveName');
  const aviEl  = document.getElementById('callActiveAvi');
  const statusEl = document.getElementById('callStatus');
  const timerEl  = document.getElementById('callTimer');

  if (nameEl)   nameEl.textContent = otherName || 'Foydalanuvchi';
  if (aviEl)    aviEl.innerHTML = _avatarHTML(otherName, otherAvi);
  if (statusEl) statusEl.textContent = 'Qo\'ng\'iroq qilinmoqda...';
  if (timerEl)  timerEl.textContent  = '00:00';

  // Endi barcha qo'ng'iroqlar OVOZLI boshlanadi (Telegram uslubi — hdr'da
  // bitta tugma bor); video faqat qo'ng'iroq ichida kamera tugmasi bilan
  // yoqiladi. `isVideo` faqat eski/dasturiy chaqiruvlar uchun saqlanadi.
  _localVideoOn   = !!isVideo;
  _remoteHasVideo = false;
  _setVideoModeUI(!!isVideo);

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

  // Firestore call hujjatini HAR DOIM o'chiramiz (notify'dan qat'i nazar) —
  // aks holda hujjat qolib ketadi (ID ikkala user uid'idan tuzilgani uchun
  // doim bir xil), va keyingi qo'ng'iroqda setDoc "update" deb hisoblanib,
  // qoidalar ruxsat bermay permission-denied beradi. Delete'ga ikkala
  // tomon ham (callerId yoki calleeId) ruxsatli, shu bilan xavfsiz.
  //
  // Bitta urinish internet uzilishi kabi vaqtinchalik sabablarga qarshi
  // ojiz — shuning uchun bitta qayta urinish (retry) qilinadi. Ikkalasi
  // ham muvaffaqiyatsiz bo'lsa, xato endi jimgina yutilmaydi: konsolga
  // yoziladi va keyingi qo'ng'iroq boshlanishida buni hisobga olish
  // uchun "_staleCallDocRef" saqlab qo'yiladi (pastda startCall'da qayta
  // tozalashga urinish uchun ishlatiladi).
  if (_callDocRef) {
    const refToDelete = _callDocRef;
    try {
      await deleteDoc(refToDelete);
    } catch (err1) {
      try {
        await deleteDoc(refToDelete);
      } catch (err2) {
        console.error('[Call] Eski qo\'ng\'iroq hujjatini o\'chirib bo\'lmadi (2 urinishdan keyin ham). ' +
          'Keyingi qo\'ng\'iroqda "boshlanmayapti" xatosi kelib chiqishi mumkin:', err2);
        _staleCallDocRef = refToDelete;
      }
    }
  }
  _callDocRef = null;
  _isCaller   = false;
  _facingMode = 'user';

  _localVideoOn      = false;
  _remoteHasVideo    = false;
  _callConnected     = false;
  _lastRenegoOfferTs  = 0;
  _lastRenegoAnswerTs = 0;
}

/* ── PeerConnection yaratish ── */
function _createPC() {
  if (_pc) { _pc.close(); }
  _pc = new RTCPeerConnection(ICE_SERVERS);

  _pc.ontrack = e => {
    const track  = e.track;
    const stream = e.streams[0];

    if (track.kind === 'video') {
      const rv = document.getElementById('callRemoteVideo');
      if (rv) rv.srcObject = stream;

      // Qarshi tomon video trackni enabled=false qilib qo'ysa (kamerani
      // o'chirsa), bu tomonda WebRTC spetsifikatsiyasiga ko'ra shu
      // qabul qilinayotgan track uchun 'mute'/'unmute' hodisalari
      // avtomatik chaqiriladi — shu orqali UI'ni smooth almashtiramiz.
      _remoteHasVideo = !track.muted;
      _setVideoModeUI(_localVideoOn || _remoteHasVideo);

      track.onunmute = () => { _remoteHasVideo = true;  _setVideoModeUI(true); };
      track.onmute   = () => { _remoteHasVideo = false; _setVideoModeUI(_localVideoOn); };
    } else {
      const ra = document.getElementById('callRemoteAudio');
      if (ra) {
        ra.srcObject = stream;
        // Default = earpiece (quloqqa tutilsa eshitiladi)
        setTimeout(() => _applySpeaker(_speakerOn), 300);
      }
    }

    // Qo'ng'iroq ulandi — bu effektlar faqat BIRINCHI marta ishga tushsin
    // (video keyinroq qo'shilganda qayta beep/timer restart bo'lmasin).
    if (!_callConnected) {
      _callConnected = true;
      _stopRingback();
      _playConnectBeep();
      _startMicPulse(_localStream);
      const statusEl = document.getElementById('callStatus');
      if (statusEl) statusEl.textContent = 'Ulandi';
      _startCallTimer();
    }
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

/* ── Qo'ng'iroq DAVOMIDA video yoqilganda qayta muzokara (renegotiation) ──
   Boshlang'ich ulanish faqat ovoz bilan tuziladi. Foydalanuvchi kamera
   tugmasini bosganda YANGI video track qo'shiladi — buni qarshi tomonga
   yetkazish uchun signalingni "offer/answer" jarayonini YANA BIR MARTA
   (Firestore call hujjatidagi alohida videoOffer/videoAnswer maydonlari
   orqali) o'tkazamiz. Har ikki tomon ham o'zining onSnapshot listeneri
   ichida shuni tekshiradi. */
async function _handleRenego(data) {
  if (!_pc || !_callDocRef || !state.me) return;

  if (data.videoOffer &&
      data.videoOffer.from !== state.me.uid &&
      data.videoOffer.ts !== _lastRenegoOfferTs) {
    _lastRenegoOfferTs = data.videoOffer.ts;
    try {
      await _pc.setRemoteDescription(new RTCSessionDescription(data.videoOffer));
      const answer = await _pc.createAnswer();
      await _pc.setLocalDescription(answer);
      await updateDoc(_callDocRef, {
        videoAnswer: { type: answer.type, sdp: answer.sdp, from: state.me.uid, ts: Date.now() }
      });
    } catch (err) {
      console.error('[Call] Video taklifini qayta ishlab bo\'lmadi:', err);
    }
  }

  if (data.videoAnswer &&
      data.videoAnswer.from !== state.me.uid &&
      data.videoAnswer.ts !== _lastRenegoAnswerTs) {
    _lastRenegoAnswerTs = data.videoAnswer.ts;
    if (_pc.signalingState === 'have-local-offer') {
      try {
        await _pc.setRemoteDescription(new RTCSessionDescription(data.videoAnswer));
      } catch (err) {
        console.error('[Call] Video javobini qayta ishlab bo\'lmadi:', err);
      }
    }
  }
}

/* ── Qo'ng'iroq ichida videoni yoqish (kamera tugmasi) ── */
async function _enableLocalVideo() {
  if (_localVideoOn || !_pc || !_localStream || !_callDocRef) return;

  let track = _localStream.getVideoTracks()[0];
  try {
    if (!track) {
      const vidStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: _facingMode }
      });
      track = vidStream.getVideoTracks()[0];
      _localStream.addTrack(track);
      _pc.addTrack(track, _localStream);
    } else {
      track.enabled = true;
    }
  } catch (err) {
    alert('Kameraga ruxsat yo\'q: ' + err.message);
    return;
  }

  const lv = document.getElementById('callLocalVideo');
  if (lv) lv.srcObject = _localStream;

  _localVideoOn = true;
  _callIsVideo  = true;
  _setVideoModeUI(true);

  // Qarshi tomonga yangi trackni yetkazish uchun qayta muzokara boshlaymiz
  try {
    const offer = await _pc.createOffer();
    await _pc.setLocalDescription(offer);
    await updateDoc(_callDocRef, {
      videoOffer: { type: offer.type, sdp: offer.sdp, from: state.me.uid, ts: Date.now() }
    });
  } catch (err) {
    console.error('[Call] Video taklifini yuborib bo\'lmadi:', err);
  }
}

/* ── Qo'ng'iroq ichida videoni o'chirish (kamera tugmasi) ──
   Trackni butunlay olib tashlamaymiz (qayta yoqishda tezroq bo'lishi va
   yana renegotiation kerak bo'lmasligi uchun) — shunchaki enabled=false
   qilamiz. Bu qarshi tomonda ham avtomatik 'mute' hodisasini chaqiradi. */
function _disableLocalVideo() {
  const track = _localStream?.getVideoTracks()[0];
  if (track) track.enabled = false;
  _localVideoOn = false;
  _setVideoModeUI(_remoteHasVideo);
}

/* ── Qo'ng'iroq boshlash (caller) ── */
async function initiateCall(isVideo) {
  const uid = state.currentChatUid;
  if (!uid || !state.me) return;

  // "MRgram AI" bilan qo'ng'iroq funksiyasi olib tashlandi — endi AI bilan
  // faqat ovozli xabar (voice message) orqali "tabiiy" muloqot qilinadi
  // (chat.js: sendVoiceMessage / _triggerMrgramAiVoiceReply). Tugmalar ham
  // AI suhbatida butunlay yashirilgan (chat.js: openChatThread), shuning
  // uchun bu funksiyaga umuman kirmasligi kerak — lekin himoya sifatida:
  if (uid === MRGRAM_AI_UID) return;

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
  _callDocRef = doc(db, 'chats', '_index', 'calls', chatId);

  // Agar avvalgi qo'ng'iroqdan o'chmay qolgan hujjat bo'lsa (_endCall ikki
  // marta urinib ham o'chira olmagan holat) — shu yerda yana bir bor
  // tozalashga harakat qilamiz, aks holda quyidagi setDoc "update" deb
  // hisoblanib, qoidalar permission-denied qaytaradi.
  if (_staleCallDocRef && _staleCallDocRef.path === _callDocRef.path) {
    try { await deleteDoc(_staleCallDocRef); _staleCallDocRef = null; } catch (_) { /* pastda ushlanadi */ }
  }

  try {
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
  } catch (err) {
    console.error('[Call] Qo\'ng\'iroq hujjatini yozib bo\'lmadi:', err);
    alert('Qo\'ng\'iroqni boshlab bo\'lmadi. Internetni tekshirib, qayta urinib ko\'ring.');
    _hideActiveCallModal();
    _stopRingback();
    if (_localStream) { _localStream.getTracks().forEach(t => t.stop()); _localStream = null; }
    if (_pc) { _pc.close(); _pc = null; }
    _callDocRef = null;
    return;
  }

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

    // Qo'ng'iroq davomida video yoqilgan bo'lsa — qayta muzokara
    await _handleRenego(data);
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

    // Qo'ng'iroq davomida video yoqilgan bo'lsa — qayta muzokara
    await _handleRenego(data);
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
    query(collection(db, 'chats', '_index', 'calls'), where('calleeId', '==', state.me.uid), where('status', '==', 'ringing')),
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
      if (aviEl)  aviEl.innerHTML = _avatarHTML(callerName, callerAvi);

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

/* ── Call tugmasiga click listener ──
   Endi hdr'da bitta tugma bor (Telegram uslubi) — qo'ng'iroq HAR DOIM
   ovozli boshlanadi, video esa faol qo'ng'iroq ichida kamera tugmasi
   bilan yoqiladi (pastga q.). */
document.getElementById('chatVoiceCallBtn')?.addEventListener('click', () => initiateCall(false));

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

document.getElementById('callCamBtn')?.addEventListener('click', async function () {
  if (_localVideoOn) {
    _disableLocalVideo();
  } else {
    await _enableLocalVideo();
  }
});

/* ── Old kamera ↔ orqa kamera almashtirish ── */
let _switchingCam = false;

async function _switchCamera() {
  if (_switchingCam || !_localStream || !_localVideoOn) return;
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
