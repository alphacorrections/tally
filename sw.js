/* Tally service worker: notifications and the icon badge only. It does not cache the app,
   so updates keep working the way they always have.
   A push arrives empty. This asks Tally's server what to show for this device, then shows it. */
var FN = 'https://xklfnsqypmsqvcernpwq.supabase.co/functions/v1/push';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('push', function (e) {
  e.waitUntil((async function () {
    var items = [], badge = null;
    try {
      var sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        var r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pull', endpoint: sub.endpoint }) });
        var j = await r.json(); items = j.items || []; badge = j.badge;
      }
    } catch (err) { /* offline: fall through to the plain note below */ }
    /* phones require every push to show something */
    if (!items.length) items = [{ title: 'Tally', body: 'Something needs a look.', tag: 'tally', url: '' }];
    for (var i = 0; i < items.length; i++) {
      var n = items[i];
      await self.registration.showNotification(n.title, { body: n.body || '', tag: n.tag || undefined, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: n.url || '' } });
    }
    if (badge != null && self.navigator && self.navigator.setAppBadge) { try { if (badge > 0) await self.navigator.setAppBadge(badge); else await self.navigator.clearAppBadge(); } catch (err2) { /* no badge on this device */ } }
  })());
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var go = String((e.notification.data && e.notification.data.url) || '').replace(/^#/, '');
  e.waitUntil((async function () {
    var all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (var i = 0; i < all.length; i++) { if ('focus' in all[i]) { await all[i].focus(); if (go) all[i].postMessage({ go: go }); return; } }
    if (self.clients.openWindow) await self.clients.openWindow(self.registration.scope + (go ? '#' + go : ''));
  })());
});
