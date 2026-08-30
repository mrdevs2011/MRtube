/**
 * MRdatabase — Profil View Controller
 * Handles profile rendering and profile view specific logic
 */

import { state } from './config.js';
import { renderProfile } from './profile.js';

export function initView() {

  if (state.me) {
    renderProfile();
  }
}

export function destroyView() {
  // Profile scroll listener'ni tozalash
  window.onscroll = null;
}
