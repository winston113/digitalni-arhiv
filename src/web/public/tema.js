// Nastavi temo, preden se stran izriše.
(function () {
  var choice = 'system';
  try { choice = localStorage.getItem('tema') || 'system'; } catch (e) { /* shramba ni na voljo */ }
  var dark = choice === 'dark' || (choice !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
