/**
 * MRdatabase — Navigation Bar Controller
 * Single source of truth for sidebar/bottom navigation
 * Fixed navigation that persists across all views
 */

import { state } from './config.js';
import { $ } from './utils.js';

/* ═══════════════════════════════════════════════════════════════════════
   NAVIGATION STATE
   ═══════════════════════════════════════════════════════════════════════ */

let currentView = 'home';

/* ═══════════════════════════════════════════════════════════════════════
   NAV BUTTON CLICK HANDLER
   ═══════════════════════════════════════════════════════════════════════ */

async function handleNavClick(viewName) {
  // Always delegate to router — router owns current-view state
  const { navigateTo } = await import('./router.js');
  navigateTo(viewName);
}

/* ═══════════════════════════════════════════════════════════════════════
   UPDATE ACTIVE STATE
   ═══════════════════════════════════════════════════════════════════════ */

export function updateActiveNav(viewName) {
  currentView = viewName;

  // Update mobile bottom nav
  document.querySelectorAll('.bot-nav .nav-btn[data-v]').forEach(btn => {
    const isActive = btn.dataset.v === viewName;
    btn.classList.toggle('on', isActive);
  });

  // Update desktop sidebar nav
  document.querySelectorAll('.sb-nav .nav-btn[data-v]').forEach(btn => {
    const isActive = btn.dataset.v === viewName;
    btn.classList.toggle('on', isActive);
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   MANUAL NAVIGATION TRIGGER
   ═══════════════════════════════════════════════════════════════════════ */

export async function navigate(viewName) {
  await handleNavClick(viewName);
}

/* ═══════════════════════════════════════════════════════════════════════
   INIT NAVIGATION
   ═══════════════════════════════════════════════════════════════════════ */

let _navReady = false;
export function initNavigation() {
  if (_navReady) return;
  _navReady = true;

  // Note: nav-btn[data-v] click handlers are registered by router.js initRouter()
  // Do NOT add duplicate listeners here.

  // Logo (desktop sidebar) → home
  const sbLogoBtn = document.getElementById('sbLogoBtn');
  if (sbLogoBtn) {
    sbLogoBtn.addEventListener('click', () => handleNavClick('home'));
  }

  // Yaratish button (center)
  const createBtn = document.querySelector('.nav-center-btn');
  if (createBtn) {
    createBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const uploadOverlay = $('uploadOverlay');
      if (uploadOverlay) {
        uploadOverlay.classList.add('show');
        setTimeout(() => $('captionInput')?.focus(), 100);
      }
    });
  }

  // Qidiruv toggle (desktop sidebar)
  const sbSearchToggle = $('sbSearchToggle');
  if (sbSearchToggle) {
    sbSearchToggle.addEventListener('click', () => {
      const searchOverlay = $('searchOverlay');
      if (searchOverlay) {
        searchOverlay.classList.add('open');
        setTimeout(() => $('searchInput')?.focus(), 60);
      }
    });
  }

  // Mute button (desktop sidebar)
  const sbMuteBtn = $('sbMuteBtn');
  if (sbMuteBtn) {
    sbMuteBtn.addEventListener('click', () => {
      const event = new CustomEvent('togglemute');
      document.dispatchEvent(event);
    });
  }

  // Theme toggle o'chirilgan — faqat dark theme qo'llab-quvvatlanadi

  // Note: Initial nav state is handled by router.js
}

/* ═══════════════════════════════════════════════════════════════════════
   EXPORT CURRENT VIEW
   ═══════════════════════════════════════════════════════════════════════ */

export function getCurrentView() {
  return currentView;
}

/* ═══════════════════════════════════════════════════════════════════════
   AUTO-INIT
   ═══════════════════════════════════════════════════════════════════════ */

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNavigation);
} else {
  initNavigation();
}
