/* Apply saved theme immediately (before first paint) to prevent FOUC */
(function () {
  try {
    var t = localStorage.getItem('arh-theme');
    if (t === 'dark' || t === 'light') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (e) {}
})();

/* Theme API — available to all pages */
window.ArTheme = (function () {
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function apply(dark) {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    try { localStorage.setItem('arh-theme', dark ? 'dark' : 'light'); } catch (e) {}
    updateBtns();
  }

  function updateBtns() {
    var dark = isDark();
    document.querySelectorAll('.theme-toggle-btn').forEach(function (btn) {
      btn.querySelector('.theme-icon').textContent = dark ? '☀️' : '🌙';
      btn.querySelector('.theme-label').textContent = dark ? 'Light mode' : 'Dark mode';
      btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    });
  }

  /* Keep button labels in sync when system pref changes (only if user hasn't pinned a mode) */
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (!document.documentElement.getAttribute('data-theme')) updateBtns();
  });

  document.addEventListener('DOMContentLoaded', updateBtns);

  return {
    toggle: function () { apply(!isDark()); },
    isDark: isDark
  };
})();
