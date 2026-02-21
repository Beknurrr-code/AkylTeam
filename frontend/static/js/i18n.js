/* ── i18n.js — Internationalization ──────────────────────────── */
let currentLang = localStorage.getItem('akyl_lang') || 'ru';
let translations = {};

async function loadTranslations(lang) {
  try {
    const res = await fetch(`/locales/${lang}.json`);
    translations = await res.json();
    currentLang = lang;
    localStorage.setItem('akyl_lang', lang);
    applyTranslations();
  } catch (e) {
    console.warn('Failed to load translations for', lang);
  }
}

function t(key) {
  const keys = key.split('.');
  let val = translations;
  for (const k of keys) {
    val = val?.[k];
    if (val === undefined) return key;
  }
  return val || key;
}

function applyTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });
  // Update active lang btn
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === currentLang);
  });
}

// Init lang buttons
document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    loadTranslations(btn.dataset.lang);
  });
});

// Load default
loadTranslations(currentLang);
