const toggle = document.querySelector('#settingsToggle');
const panel = document.querySelector('#settingsPanel');
const wrap = document.querySelector('#settingsWrap');
function closeSettings(restoreFocus = false) {
  panel.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  if (restoreFocus) toggle.focus();
}
toggle.addEventListener('click', () => {
  panel.hidden = !panel.hidden;
  toggle.setAttribute('aria-expanded', String(!panel.hidden));
});
document.addEventListener('click', event => {
  if (!wrap.contains(event.target)) closeSettings();
});
wrap.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !panel.hidden) {
    event.preventDefault(); closeSettings(true);
  }
});
wrap.addEventListener('focusout', event => {
  if (!wrap.contains(event.relatedTarget)) closeSettings();
});
panel.addEventListener('click', event => {
  if (event.target.closest('button:not(:disabled)')) closeSettings(true);
});
const themeButton = document.querySelector('#themeToggle');
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
let preference;
try { preference = localStorage.getItem('taskleaf-theme'); } catch { /* Storage may be unavailable. */ }
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = theme === 'dark' ? '切换到浅色模式' : '切换到深色模式';
  themeButton.setAttribute('aria-label', label);
  themeButton.title = label;
}
applyTheme(['light','dark'].includes(preference) ? preference : systemTheme.matches ? 'dark' : 'light');
themeButton.addEventListener('click', () => {
  preference = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(preference);
  try { localStorage.setItem('taskleaf-theme', preference); } catch { /* Switching still works for this page. */ }
});
systemTheme.addEventListener('change', event => {
  if (!['light','dark'].includes(preference)) applyTheme(event.matches ? 'dark' : 'light');
});
