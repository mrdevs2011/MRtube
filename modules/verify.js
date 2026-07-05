/**
 * MRdatabase — modules/verify.js
 *
 * Foydalanuvchi birinchi marta ilovaga kirganida 2 ta savol beradi.
 * Ikkalasi ham to'g'ri javob berilsa — localStorage ga belgi qo'yadi
 * va login sahifasini ochadi. Noto'g'ri javobda shake + xato xabar.
 *
 * Savollar va javoblar faqat shu faylda — backendsiz.
 */

const STORAGE_KEY = 'mr_verified';

const STEPS = [
  {
    q: 'MRgram yaratuvchisi kim?',
    a: 'muhammadrasul',          // kichik harf bilan tekshiriladi
  },
  {
    q: 'Muhammadrasul necha yoshda?',
    a: '14',
  },
];

let currentStep = 0;

function normalize(str) {
  return str.trim().toLowerCase().replace(/\s+/g, '');
}

function shake(input) {
  input.classList.remove('shake');
  void input.offsetWidth; // reflow — animatsiyani qayta boshlash
  input.classList.add('shake');
  setTimeout(() => input.classList.remove('shake'), 400);
}

export function needsVerification() {
  return !localStorage.getItem(STORAGE_KEY);
}

export function initVerify(onPassed) {
  if (!needsVerification()) {
    onPassed();
    return;
  }

  const wrap  = document.getElementById('verifyWrap');
  const qEl   = document.getElementById('verifyQuestion');
  const input = document.getElementById('verifyInput');
  const errEl = document.getElementById('verifyErr');
  const btn   = document.getElementById('verifyBtn');

  if (!wrap) { onPassed(); return; }

  // Sahifani ko'rsat
  wrap.style.display = 'flex';

  function showStep(i) {
    currentStep = i;
    qEl.textContent = STEPS[i].q;
    input.value = '';
    errEl.textContent = '';
    input.focus();
  }

  function attempt() {
    const val = input.value;
    if (!val.trim()) return;

    const correct = normalize(STEPS[currentStep].a);
    const given   = normalize(val);

    if (given === correct) {
      errEl.textContent = '';
      if (currentStep < STEPS.length - 1) {
        // Keyingi savolga o'tish — kichik fade
        qEl.style.opacity = '0';
        setTimeout(() => {
          showStep(currentStep + 1);
          qEl.style.opacity = '1';
        }, 200);
      } else {
        // Hammasi to'g'ri — o'tkazish
        localStorage.setItem(STORAGE_KEY, '1');
        wrap.style.transition = 'opacity .3s';
        wrap.style.opacity = '0';
        setTimeout(() => {
          wrap.style.display = 'none';
          onPassed();
        }, 300);
      }
    } else {
      shake(input);
      errEl.textContent = 'Noto\'g\'ri javob. Qaytadan urinib ko\'ring.';
    }
  }

  btn.addEventListener('click', attempt);
  input

  showStep(0);
}
