const CACHE='ultimate-teams-cloud-4-11-6';
const ASSETS=['./','./index.html','./app.js','./config.js','./manifest.json'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request).then(c=>c||caches.match('./index.html'))));
});

self.addEventListener('push', event => {
  let data = {};
  try{
    data = event.data ? event.data.json() : {};
  }catch(e){
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'New teams are ready';
  const options = {
    body: data.body || 'New ultimate teams have been generated.',
    icon: data.icon || './manifest.json',
    badge: data.badge || './manifest.json',
    data: {
      url: data.url || './'
    },
    tag: data.tag || 'ultimate-teams-generated',
    renotify: true
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || './';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for(const client of allClients){
      if('focus' in client){
        client.focus();
        if('navigate' in client) client.navigate(targetUrl);
        return;
      }
    }
    if(clients.openWindow) return clients.openWindow(targetUrl);
  })());
});
