(() => {
  'use strict';
  // The browser-origin code never receives Tauri IPC or Jellyfin tokens.
  // The native navigation handler accepts only this exact trusted URL.
  if (window !== window.top ||
      window.location.origin !== 'https://cocojellyfin.duckdns.org:38443') {
    return;
  }
  const ID = 'vyneo-desktop-discovery-link';
  const DISCOVER = 'https://vyneo-preview.visyren.fr/app/secure.html';

  function mountOrRefresh() {
    if (!document.body) return;
    let el = document.getElementById(ID);
    const playback = Boolean(document.fullscreenElement) ||
      [...document.querySelectorAll('video')].some((v) => !v.paused);
    const loggingIn = Boolean(document.querySelector('input[type="password"]'));
    if (!el) {
      el = document.createElement('a');
      el.id = ID;
      el.href = DISCOVER;
      el.textContent = '✦ Découvrir avec l’IA';
      el.title = 'Sections, Top 10 et univers Vynéo';
      el.setAttribute('aria-label', 'Découvrir les sections et univers avec l’intelligence artificielle');
      el.style.cssText = [
        'position:fixed', 'right:22px', 'top:66px', 'z-index:9000',
        'padding:10px 14px', 'border-radius:9px',
        'background:rgba(23,25,30,.95)', 'color:#f6f2f2',
        'border:1px solid rgba(250,116,64,.42)',
        'box-shadow:0 6px 20px rgba(0,0,0,.35)',
        'font:600 13px Segoe UI,system-ui,sans-serif',
        'text-decoration:none', 'white-space:nowrap'
      ].join(';');
      document.body.append(el);
    }
    el.style.display = (playback || loggingIn) ? 'none' : '';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountOrRefresh, { once:true });
  } else {
    mountOrRefresh();
  }
  // Jellyfin swaps entire SPA subtrees; restore a lightweight control without
  // MutationObservers watching each of its hundreds of media cards.
  setInterval(mountOrRefresh, 2400);
  document.addEventListener('fullscreenchange', mountOrRefresh);
})();
