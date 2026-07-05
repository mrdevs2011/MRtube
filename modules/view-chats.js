/**
 * MRdatabase — Suhbatlar View Controller
 * Handles chats rendering and chats view specific logic
 */

import { renderChatsList, destroyChatsView } from './chat.js';

export function initView() {
  renderChatsList();
}

export function destroyView() {
  destroyChatsView();
}
