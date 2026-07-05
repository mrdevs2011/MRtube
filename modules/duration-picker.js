/**
 * MRgram — Advanced Duration Picker
 * Mustaqil komponent: kun / soat / daqiqa / soniya / millisoniya darajasida
 * aniq muddat tanlash uchun. Hech qanday tashqi kutubxonaga bog'liq emas.
 *
 * Ishlatilishi:
 *   import { createDurationPicker } from './duration-picker.js';
 *   const picker = createDurationPicker(containerEl, {
 *     onChange: (ms) => console.log('Tanlangan muddat (ms):', ms)
 *   });
 *   picker.getMs();       // hozirgi tanlangan umumiy millisoniya
 *   picker.getUntilDate(); // hozirdan + tanlangan muddat = Date obyekti
 *   picker.reset();
 *   picker.destroy();
 */

let _stylesInjected = false;

function _injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement('style');
  style.id = 'dp-advanced-duration-styles';
  style.textContent = `
    .dp-wrap {
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-family: var(--font, system-ui, sans-serif);
    }
    .dp-units {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 6px;
    }
    .dp-unit {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      background: var(--bg3, #1c1f26);
      border: 1px solid var(--line2, #2a2e38);
      border-radius: 10px;
      padding: 8px 4px 10px;
    }
    .dp-unit-label {
      font-size: 10px;
      color: var(--text3, #8a8f98);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .dp-unit-row {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .dp-stepper-btn {
      width: 22px;
      height: 22px;
      border-radius: 6px;
      border: 1px solid var(--line2, #2a2e38);
      background: var(--bg4, #20242c);
      color: var(--text, #fff);
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      flex-shrink: 0;
    }
    .dp-stepper-btn:hover { background: var(--bg5, #2a2f3a); }
    .dp-stepper-btn:active { transform: scale(0.92); }
    .dp-unit-input {
      width: 44px;
      text-align: center;
      background: transparent;
      border: none;
      color: var(--text, #fff);
      font-size: 15px;
      font-weight: 600;
      font-family: var(--font, system-ui, sans-serif);
      outline: none;
      -moz-appearance: textfield;
    }
    .dp-unit-input::-webkit-outer-spin-button,
    .dp-unit-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    .dp-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .dp-preset-btn {
      padding: 5px 10px;
      border-radius: 14px;
      border: 1px solid var(--line2, #2a2e38);
      background: var(--bg3, #1c1f26);
      color: var(--text2, #c5c8ce);
      font-size: 11px;
      cursor: pointer;
      font-family: var(--font, system-ui, sans-serif);
    }
    .dp-preset-btn:hover { background: var(--bg4, #20242c); color: var(--text, #fff); }
    .dp-summary {
      background: var(--bg3, #1c1f26);
      border: 1px solid var(--line2, #2a2e38);
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 12px;
      color: var(--text2, #c5c8ce);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .dp-summary strong { color: var(--text, #fff); }
    .dp-summary .dp-ms-total {
      font-size: 11px;
      color: var(--text3, #8a8f98);
    }
    .dp-permanent-toggle {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--text2, #c5c8ce);
      cursor: pointer;
      user-select: none;
    }
    .dp-permanent-toggle input { accent-color: var(--red, #e0455f); }
    .dp-units.dp-disabled { opacity: 0.35; pointer-events: none; }
  `;
  document.head.appendChild(style);
}

const UNITS = [
  { key: 'days',  label: 'Kun',    ms: 24 * 60 * 60 * 1000, max: 36500 },
  { key: 'hours', label: 'Soat',   ms: 60 * 60 * 1000,      max: 23 },
  { key: 'mins',  label: 'Daqiqa', ms: 60 * 1000,           max: 59 },
  { key: 'secs',  label: 'Soniya', ms: 1000,                max: 59 },
  { key: 'msecs', label: 'ms',     ms: 1,                   max: 999 },
];

const PRESETS = [
  { label: '1 daqiqa', ms: 60 * 1000 },
  { label: '1 soat',   ms: 60 * 60 * 1000 },
  { label: '6 soat',   ms: 6 * 60 * 60 * 1000 },
  { label: '1 kun',    ms: 24 * 60 * 60 * 1000 },
  { label: '3 kun',    ms: 3 * 24 * 60 * 60 * 1000 },
  { label: '1 hafta',  ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '1 oy',     ms: 30 * 24 * 60 * 60 * 1000 },
];

/**
 * @param {HTMLElement} container - widget shu elementga chiziladi
 * @param {Object} opts
 * @param {(ms:number, isPermanent:boolean) => void} [opts.onChange]
 * @param {boolean} [opts.allowPermanent=true]
 * @param {number} [opts.initialMs=0]
 */
export function createDurationPicker(container, opts = {}) {
  _injectStyles();
  const allowPermanent = opts.allowPermanent !== false;
  const values = { days: 0, hours: 0, mins: 0, secs: 0, msecs: 0 };
  let isPermanent = false;

  container.innerHTML = `
    <div class="dp-wrap">
      ${allowPermanent ? `
        <label class="dp-permanent-toggle">
          <input type="checkbox" id="dpPermanentChk">
          Doimiy bloklash (muddatsiz)
        </label>
      ` : ''}
      <div class="dp-units" id="dpUnits">
        ${UNITS.map(u => `
          <div class="dp-unit" data-unit="${u.key}">
            <span class="dp-unit-label">${u.label}</span>
            <div class="dp-unit-row">
              <button type="button" class="dp-stepper-btn" data-action="dec" data-unit="${u.key}">−</button>
              <input type="number" class="dp-unit-input" id="dpInput-${u.key}" data-unit="${u.key}"
                     value="0" min="0" max="${u.max}" inputmode="numeric">
              <button type="button" class="dp-stepper-btn" data-action="inc" data-unit="${u.key}">+</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="dp-presets" id="dpPresets">
        ${PRESETS.map(p => `<button type="button" class="dp-preset-btn" data-ms="${p.ms}">${p.label}</button>`).join('')}
      </div>
      <div class="dp-summary" id="dpSummary">
        <div id="dpSummaryMain">Foydalanuvchi <strong>doimiy</strong> bloklanadi.</div>
        <div class="dp-ms-total" id="dpSummaryMs"></div>
      </div>
    </div>
  `;

  const unitsWrap = container.querySelector('#dpUnits');
  const permChk   = container.querySelector('#dpPermanentChk');
  const summaryMain = container.querySelector('#dpSummaryMain');
  const summaryMs    = container.querySelector('#dpSummaryMs');

  function totalMs() {
    return UNITS.reduce((sum, u) => sum + (Number(values[u.key]) || 0) * u.ms, 0);
  }

  function emit() {
    const ms = isPermanent ? 0 : totalMs();
    if (typeof opts.onChange === 'function') opts.onChange(ms, isPermanent);
    renderSummary(ms);
  }

  function renderSummary(ms) {
    if (isPermanent || ms <= 0) {
      summaryMain.innerHTML = `Foydalanuvchi <strong>doimiy</strong> bloklanadi.`;
      summaryMs.textContent = '';
      return;
    }
    const until = new Date(Date.now() + ms);
    summaryMain.innerHTML = `Muddat tugashi: <strong>${until.toLocaleString('uz-UZ')}</strong>`;
    summaryMs.textContent = `Umumiy: ${ms.toLocaleString('uz-UZ')} millisoniya`;
  }

  function setUnitValue(key, val) {
    const u = UNITS.find(x => x.key === key);
    let v = Math.max(0, Math.min(u.max, Math.round(Number(val) || 0)));
    values[key] = v;
    const input = container.querySelector(`#dpInput-${key}`);
    if (input) input.value = v;
    emit();
  }

  // Stepper tugmalari (+/-)
  unitsWrap.addEventListener('click', e => {
    const btn = e.target.closest('.dp-stepper-btn');
    if (!btn) return;
    const key = btn.dataset.unit;
    const dir = btn.dataset.action === 'inc' ? 1 : -1;
    setUnitValue(key, (values[key] || 0) + dir);
  });

  // Qo'lda raqam kiritish
  unitsWrap.addEventListener('input', e => {
    const input = e.target.closest('.dp-unit-input');
    if (!input) return;
    setUnitValue(input.dataset.unit, input.value);
  });

  // Tayyor muddat tugmalari — input qiymatlarini avtomatik to'ldiradi
  container.querySelector('#dpPresets').addEventListener('click', e => {
    const btn = e.target.closest('.dp-preset-btn');
    if (!btn) return;
    if (permChk) { permChk.checked = false; isPermanent = false; }
    unitsWrap.classList.remove('dp-disabled');
    let remaining = Number(btn.dataset.ms);
    UNITS.forEach(u => {
      const v = Math.floor(remaining / u.ms);
      values[u.key] = v;
      remaining -= v * u.ms;
      const input = container.querySelector(`#dpInput-${u.key}`);
      if (input) input.value = v;
    });
    emit();
  });

  // "Doimiy" checkbox
  if (permChk) {
    permChk.addEventListener('change', () => {
      isPermanent = permChk.checked;
      unitsWrap.classList.toggle('dp-disabled', isPermanent);
      emit();
    });
  }

  // Boshlang'ich qiymat
  if (opts.initialMs > 0) {
    let remaining = opts.initialMs;
    UNITS.forEach(u => {
      const v = Math.floor(remaining / u.ms);
      values[u.key] = v;
      remaining -= v * u.ms;
    });
  } else if (allowPermanent) {
    isPermanent = true;
    if (permChk) permChk.checked = true;
    unitsWrap.classList.add('dp-disabled');
  }
  emit();

  return {
    /** Hozirgi tanlangan umumiy millisoniya (doimiy bo'lsa 0) */
    getMs: () => (isPermanent ? 0 : totalMs()),
    /** Doimiy tanlanganmi */
    isPermanent: () => isPermanent,
    /** Hozirdan + tanlangan muddat = Date obyekti (doimiy bo'lsa null) */
    getUntilDate: () => {
      const ms = isPermanent ? 0 : totalMs();
      return ms > 0 ? new Date(Date.now() + ms) : null;
    },
    reset: () => {
      UNITS.forEach(u => { values[u.key] = 0; const i = container.querySelector(`#dpInput-${u.key}`); if (i) i.value = 0; });
      isPermanent = allowPermanent;
      if (permChk) permChk.checked = allowPermanent;
      unitsWrap.classList.toggle('dp-disabled', allowPermanent);
      emit();
    },
    destroy: () => { container.innerHTML = ''; }
  };
}
