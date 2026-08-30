/**
 * MRgram — Cover Image Crop Modal
 * Rasm tanlangach crop/resize qilish imkonini beradi.
 * Aspect ratio: 16:9 (cover uchun optimal)
 * Mobile va desktop da bir xil ishlaydi.
 */

const CROP_RATIO = 16 / 9; // cover aspect ratio
const COVER_W    = 1200;   // export kengligi (px)
const COVER_H    = Math.round(COVER_W / CROP_RATIO); // 675px

let _resolveBlob = null;
let _rejectBlob  = null;

// Drag / pinch state
let _drag  = false;
let _dragStartX = 0, _dragStartY = 0;
let _imgX = 0, _imgY = 0;
let _scale = 1;
let _minScale = 1;
let _imgNatW = 0, _imgNatH = 0;
let _canvasW = 0, _canvasH = 0;

// Touch pinch
let _lastPinchDist = 0;

/* ── CSS ── */
function _injectCSS() {
  if (document.getElementById('cover-crop-css')) return;
  const s = document.createElement('style');
  s.id = 'cover-crop-css';
  s.textContent = `
#coverCropOverlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0,0,0,0.85);
  display: none;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}
#coverCropOverlay.show { display: flex; }

#coverCropModal {
  background: #18181c;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 18px;
  width: 100%;
  max-width: 520px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 64px rgba(0,0,0,0.6);
  user-select: none;
}

.cc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
}
.cc-title {
  font-size: 15px;
  font-weight: 700;
  color: #fff;
}
.cc-close {
  width: 30px; height: 30px;
  border-radius: 50%;
  background: rgba(255,255,255,0.08);
  border: none;
  color: #fff;
  font-size: 18px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}
.cc-close:hover { background: rgba(255,255,255,0.15); }

/* Crop area */
.cc-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 16/9;
  background: #000;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
}
.cc-stage:active { cursor: grabbing; }

#ccCanvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* Grid overlay */
.cc-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    rgba(255,255,255,0.12),
    rgba(255,255,255,0.12);
  background-size: 33.33% 33.33%;
}

/* Border overlay */
.cc-border {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border: 2px solid rgba(255,255,255,0.35);
  box-sizing: border-box;
}

/* Controls */
.cc-controls {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cc-zoom-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.cc-zoom-icon {
  color: rgba(255,255,255,0.5);
  flex-shrink: 0;
}
.cc-zoom-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: rgba(255,255,255,0.15);
  outline: none;
  cursor: pointer;
}
.cc-zoom-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px; height: 20px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  cursor: grab;
}
.cc-zoom-slider::-moz-range-thumb {
  width: 20px; height: 20px;
  border-radius: 50%;
  background: #fff;
  border: none;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  cursor: grab;
}
.cc-zoom-label {
  font-size: 12px;
  color: rgba(255,255,255,0.45);
  width: 38px;
  text-align: right;
  flex-shrink: 0;
}

.cc-hint {
  font-size: 12px;
  color: rgba(255,255,255,0.35);
  text-align: center;
  padding: 0 0 2px;
}

.cc-btns {
  display: flex;
  gap: 10px;
  padding: 0 16px 16px;
}
.cc-btn {
  flex: 1;
  height: 44px;
  border-radius: 12px;
  border: none;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}
.cc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.cc-btn--cancel {
  background: rgba(255,255,255,0.08);
  color: #fff;
}
.cc-btn--cancel:hover { background: rgba(255,255,255,0.12); }
.cc-btn--apply {
  background: #6366f1;
  color: #fff;
}
.cc-btn--apply:hover { opacity: 0.9; }
`;
  document.head.appendChild(s);
}

/* ── DOM ── */
function _ensureDOM() {
  if (document.getElementById('coverCropOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'coverCropOverlay';
  overlay.innerHTML = `
    <div id="coverCropModal">
      <div class="cc-header">
        <span class="cc-title">Cover rasmini moslashtiring</span>
        <button class="cc-close" id="ccClose">×</button>
      </div>
      <div class="cc-stage" id="ccStage">
        <canvas id="ccCanvas"></canvas>
        <div class="cc-grid"></div>
        <div class="cc-border"></div>
      </div>
      <div class="cc-controls">
        <div class="cc-zoom-row">
          <svg class="cc-zoom-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          <input type="range" class="cc-zoom-slider" id="ccZoom" min="100" max="300" value="100" step="1">
          <span class="cc-zoom-label" id="ccZoomLabel">1.0×</span>
        </div>
        <div class="cc-hint">Suring yoki zoom qiling • Ikkita barmoq bilan kattalashtiring</div>
      </div>
      <div class="cc-btns">
        <button class="cc-btn cc-btn--cancel" id="ccCancel">Bekor qilish</button>
        <button class="cc-btn cc-btn--apply" id="ccApply">Tayyor</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Close / cancel
  document.getElementById('ccClose').addEventListener('click', _cancel);
  document.getElementById('ccCancel').addEventListener('click', _cancel);
  overlay.addEventListener('click', e => { if (e.target === overlay) _cancel(); });

  // Apply
  document.getElementById('ccApply').addEventListener('click', _apply);

  // Zoom slider
  document.getElementById('ccZoom').addEventListener('input', _onSlider);

  // Stage drag (mouse)
  const stage = document.getElementById('ccStage');
  stage.addEventListener('mousedown', _onMouseDown);
  window.addEventListener('mousemove', _onMouseMove);
  window.addEventListener('mouseup',   _onMouseUp);

  // Stage drag + pinch (touch)
  stage.addEventListener('touchstart', _onTouchStart, { passive: false });
  stage.addEventListener('touchmove',  _onTouchMove,  { passive: false });
  stage.addEventListener('touchend',   _onTouchEnd);
}

/* ── Public API ── */
/**
 * Foydalanuvchi File tanlaydi → crop modal ochiladi.
 * @returns {Promise<Blob>} crop qilingan rasm Blob (image/jpeg)
 */
export function openCropModal(file) {
  return new Promise((resolve, reject) => {
    _resolveBlob = resolve;
    _rejectBlob  = reject;

    _injectCSS();
    _ensureDOM();

    const url = URL.createObjectURL(file);
    const img  = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      _imgNatW = img.naturalWidth;
      _imgNatH = img.naturalHeight;
      _resetState();
      _drawFrame(img);
      document.getElementById('coverCropOverlay').classList.add('show');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Rasm yuklanmadi')); };
    img.src = url;
  });
}

/* ── State reset ── */
function _resetState() {
  const stage = document.getElementById('ccStage');
  _canvasW = stage.clientWidth;
  _canvasH = stage.clientHeight;

  const canvas = document.getElementById('ccCanvas');
  canvas.width  = _canvasW;
  canvas.height = _canvasH;

  // Min scale: rasm stage ni to'liq qoplashi kerak
  const scaleW = _canvasW / _imgNatW;
  const scaleH = _canvasH / _imgNatH;
  _minScale = Math.max(scaleW, scaleH);
  _scale    = _minScale;

  // Markazga joylashtir
  _imgX = (_canvasW - _imgNatW * _scale) / 2;
  _imgY = (_canvasH - _imgNatH * _scale) / 2;

  // Slider reset
  const slider = document.getElementById('ccZoom');
  slider.min   = '100';
  slider.max   = '300';
  slider.value = '100';
  document.getElementById('ccZoomLabel').textContent = '1.0×';
}

/* ── Draw ── */
let _currentImg = null;
function _drawFrame(img) {
  if (img) _currentImg = img;
  const canvas = document.getElementById('ccCanvas');
  if (!canvas || !_currentImg) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, _canvasW, _canvasH);
  ctx.drawImage(_currentImg, _imgX, _imgY, _imgNatW * _scale, _imgNatH * _scale);
}

/* ── Clamp position (rasm stage'dan chiqmasin) ── */
function _clamp() {
  const w = _imgNatW * _scale;
  const h = _imgNatH * _scale;
  if (_imgX > 0)             _imgX = 0;
  if (_imgY > 0)             _imgY = 0;
  if (_imgX + w < _canvasW)  _imgX = _canvasW - w;
  if (_imgY + h < _canvasH)  _imgY = _canvasH - h;
}

/* ── Zoom slider ── */
function _onSlider(e) {
  const pct      = Number(e.target.value) / 100; // 1.0 … 3.0
  const newScale = _minScale * pct;
  // Scale markazdan kattalashtirish
  const cx = _canvasW / 2;
  const cy = _canvasH / 2;
  _imgX = cx - (cx - _imgX) * (newScale / _scale);
  _imgY = cy - (cy - _imgY) * (newScale / _scale);
  _scale = newScale;
  _clamp();
  _drawFrame();
  document.getElementById('ccZoomLabel').textContent = pct.toFixed(1) + '×';
}

/* ── Mouse drag ── */
function _onMouseDown(e) {
  _drag = true;
  _dragStartX = e.clientX - _imgX;
  _dragStartY = e.clientY - _imgY;
}
function _onMouseMove(e) {
  if (!_drag) return;
  _imgX = e.clientX - _dragStartX;
  _imgY = e.clientY - _dragStartY;
  _clamp();
  _drawFrame();
}
function _onMouseUp() { _drag = false; }

/* ── Touch drag + pinch ── */
function _onTouchStart(e) {
  e.preventDefault();
  if (e.touches.length === 1) {
    _drag = true;
    _dragStartX = e.touches[0].clientX - _imgX;
    _dragStartY = e.touches[0].clientY - _imgY;
  } else if (e.touches.length === 2) {
    _drag = false;
    _lastPinchDist = _pinchDist(e);
  }
}
function _onTouchMove(e) {
  e.preventDefault();
  if (e.touches.length === 1 && _drag) {
    _imgX = e.touches[0].clientX - _dragStartX;
    _imgY = e.touches[0].clientY - _dragStartY;
    _clamp();
    _drawFrame();
  } else if (e.touches.length === 2) {
    const dist     = _pinchDist(e);
    const ratio    = dist / (_lastPinchDist || dist);
    _lastPinchDist = dist;

    const newScale = Math.min(Math.max(_scale * ratio, _minScale), _minScale * 3);
    // Pinch markazi
    const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    const rect = document.getElementById('ccStage').getBoundingClientRect();
    const pcx  = cx - rect.left;
    const pcy  = cy - rect.top;

    _imgX = pcx - (pcx - _imgX) * (newScale / _scale);
    _imgY = pcy - (pcy - _imgY) * (newScale / _scale);
    _scale = newScale;
    _clamp();
    _drawFrame();

    // Slider sync
    const pct = _scale / _minScale;
    const slider = document.getElementById('ccZoom');
    slider.value = String(Math.round(pct * 100));
    document.getElementById('ccZoomLabel').textContent = pct.toFixed(1) + '×';
  }
}
function _onTouchEnd() { _drag = false; }
function _pinchDist(e) {
  const dx = e.touches[0].clientX - e.touches[1].clientX;
  const dy = e.touches[0].clientY - e.touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/* ── Apply: canvas → Blob (1200×675 JPEG) ── */
function _apply() {
  const applyBtn = document.getElementById('ccApply');
  applyBtn.disabled = true;
  applyBtn.textContent = 'Tayyorlanmoqda…';

  try {
    // Stage ko'lami nisbatida rasmning cover ichidagi qismi
    const scaleX = _imgNatW / (_imgNatW * _scale); // 1/scale
    const scaleY = _imgNatH / (_imgNatH * _scale);

    // Cover stage da ko'rinayotgan natRasm koordinatalari
    const srcX = (-_imgX) * scaleX;
    const srcY = (-_imgY) * scaleY;
    const srcW = _canvasW  * scaleX;
    const srcH = _canvasH  * scaleY;

    const out = document.createElement('canvas');
    out.width  = COVER_W;
    out.height = COVER_H;
    const ctx  = out.getContext('2d');
    ctx.drawImage(_currentImg, srcX, srcY, srcW, srcH, 0, 0, COVER_W, COVER_H);

    out.toBlob(blob => {
      _close();
      if (_resolveBlob) _resolveBlob(blob);
    }, 'image/jpeg', 0.92);
  } catch (err) {
    applyBtn.disabled = false;
    applyBtn.textContent = 'Tayyor';
    if (_rejectBlob) _rejectBlob(err);
  }
}

function _cancel() {
  _close();
  if (_rejectBlob) _rejectBlob(new Error('cancelled'));
}

function _close() {
  const overlay = document.getElementById('coverCropOverlay');
  if (overlay) overlay.classList.remove('show');
  _resolveBlob = null;
  _rejectBlob  = null;
  _currentImg  = null;
  _drag        = false;
}
