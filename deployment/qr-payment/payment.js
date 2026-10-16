const requestId = /^\/pay\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(window.location.pathname)?.[1];
if (!requestId) {
  document.querySelector('.pay-entry__error').hidden = false;
  document.querySelectorAll('.pay-entry__choices a').forEach((link) => {
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
  });
} else {
  document.querySelectorAll('.pay-entry__choices a').forEach((link) => {
    const tenant = link.getAttribute('data-tenant');
    link.setAttribute('href', `/${tenant}/app#payment=${encodeURIComponent(requestId)}`);
  });
}
