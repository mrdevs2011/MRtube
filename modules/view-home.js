/**
 * MRdatabase — Bosh sahifa View Controller
 * Handles feed rendering and home view specific logic
 */

import { state } from './config.js';
import { renderFeed, setupPullToRefresh, setupFeedScrollSensitivity } from './feed.js';

let _homeReady = false;

export function initView() {

  // Pull-to-refresh va scroll sensitivity faqat bir marta o'rnatiladi
  if (!_homeReady) {
    setupPullToRefresh();
    setupFeedScrollSensitivity();
    _homeReady = true;
  }

  // Feed har safar yangilanadi (yangi postlar bo'lishi mumkin)
  if (state.me) {
    state.visibleN = 10;
    renderFeed();
  }
}

export function destroyView() {
  // Scroll listener'ni o'chirish — boshqa view'da trigger bo'lmasin
  window.onscroll = null;
}
