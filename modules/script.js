/**
 * MRdatabase v3 — main entry point.
 * Single Page Application - all views rendered from modules/
 */

import { state } from './config.js';
import { $ } from './utils.js';
import { updateMuteBtnUI, toggleGlobalMute } from './ui.js';
import { setRenderCallbacks } from './auth.js';
import { renderFeed, patchCounts } from './feed.js';
import { renderProfile, renderUserProfileModal } from './profile.js';
import { initRouter, navigateTo } from './router.js';
import { initNavigation } from './bar.js';
import { initTokenUsageBubble } from './token-usage.js';

/* ── Splash ──────────────────────────────────────────────────────────── */
setTimeout(() => {
  $('splash')?.classList.add('out');
  setTimeout(() => {
    const splash = $('splash');
    if (splash) splash.style.display = 'none';
    const aw = document.getElementById('authWrap');
    if (aw) aw.style.display = '';
  }, 400);
}, 400);

/* ── Wire auth → render callbacks ────────────────────────────────────── */
setRenderCallbacks({
  renderFeed,
  renderProfile,
  renderUserProfileModal,
  patchCounts,
});

/* ── AI token sarfi bubble (ADVANCED/DEBUG) — DOM tayyorlanadi, lekin
   boshida yashirin; faqat admin uchun modules/router.js -> applyAdminNav()
   orqali ko'rsatiladi ── */
initTokenUsageBubble();

/* ── Router ──────────────────────────────────────────────────────────── */
initRouter();

/* ── Navigation Bar ──────────────────────────────────────────────────── */
initNavigation();

/* ── Lazy-import modules ─────────────────────────────────────────────── */
import('./upload.js');

/* ── Global mute buttons ─────────────────────────────────────────────── */
['globalMuteBtn', 'sbMuteBtn'].forEach(id =>
  $(id)?.addEventListener('click', toggleGlobalMute)
);

updateMuteBtnUI();

/* ── Initial header state ────────────────────────────────────────────── */
$('globalMuteBtn')?.classList.add('hdr-hidden');
/* ── iOS 27 Haptic — global touch feedback ── */
import { haptic, addHapticTouch } from './utils.js';

(function initGlobalHaptics() {
  // Nav buttons — select haptic
  document.querySelectorAll('.nav-btn').forEach(el => addHapticTouch(el, 'select'));

  // All primary/ghost/danger buttons — medium haptic
  document.addEventListener('pointerdown', e => {
    const btn = e.target.closest(
      '.btn-primary, .btn-ghost, .btn-danger, ' +
      '.hdr-icon-btn, .hdr-new-post-btn, .theme-btn, ' +
      '.like-btn, .cmt-like-btn, .post-share-btn, ' +
      '.sheet-close-btn, [data-haptic]'
    );
    if (!btn) return;
    const type = btn.dataset.haptic ||
      (btn.classList.contains('btn-danger') ? 'heavy' :
       btn.classList.contains('btn-primary') ? 'medium' : 'light');
    haptic[type]?.();
  }, { passive: true });

  // Like double-tap — success haptic (MutationObserver on like-btn.on)
  const likeObs = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.target.classList.contains('on')) haptic.success();
    }
  });
  document.querySelectorAll('.like-btn').forEach(el =>
    likeObs.observe(el, { attributes: true, attributeFilter: ['class'] })
  );

  // Form submit success/error — hook into auth button
  const authBtn = document.getElementById('authBtn');
  if (authBtn) {
    authBtn.addEventListener('click', () => haptic.medium());
  }
})();
