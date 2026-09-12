const CACHE='ultimate-teams-cloud-4-13-1';
const STATIC_ASSETS=[
  './',
  './index.html',
  './theme-4.13.1.css',
  './styles-4120.css',
  './legacy-core-4.13.1.js',
  './app-4.13.1.js',
  './config.js',
  './version-4.13.1.js',
  './sandbox-host-4.13.1.js',
  './sandbox-runtime-4.13.1.js',
  './manifest.json'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(STATIC_ASSETS))
      .catch(()=>null)
  );
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

async function networkFirst(request,fallbackPath){
  const cache=await caches.open(CACHE);
  try{
    const response=await fetch(request,{cache:'no-store'});
    if(response && response.ok){
      const cacheKey=fallbackPath || request;
      cache.put(cacheKey,response.clone()).catch(()=>null);
    }
    return response;
  }catch(e){
    return (await cache.match(fallbackPath || request)) || Response.error();
  }
}

async function cacheFirst(request){
  const cache=await caches.open(CACHE);
  const cached=await cache.match(request);
  if(cached) return cached;
  try{
    const response=await fetch(request);
    if(response && (response.ok || response.type==='opaque')){
      cache.put(request,response.clone()).catch(()=>null);
    }
    return response;
  }catch(e){
    return Response.error();
  }
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;

  const url=new URL(event.request.url);

  // Database/auth/realtime/function traffic is always live.
  if(url.hostname.endsWith('.supabase.co')) return;

  // Always fetch the HTML shell from the network when online.
  if(event.request.mode==='navigate'){
    event.respondWith(networkFirst(event.request,'./index.html'));
    return;
  }

  // config.js is intentionally network-first because it is unversioned.
  if(url.origin===self.location.origin && url.pathname.endsWith('/config.js')){
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Versioned local files are immutable for this release and safe to cache-first.
  if(url.origin===self.location.origin){
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // CDN library: cache-first after initial download.
  if(url.hostname==='cdn.jsdelivr.net'){
    event.respondWith(cacheFirst(event.request));
  }
});

self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?event.data.json():{};}
  catch(e){data={body:event.data?event.data.text():''};}

  event.waitUntil(self.registration.showNotification(
    data.title || 'New teams are ready',
    {
      body:data.body || 'New ultimate teams have been generated.',
      icon:data.icon || './manifest.json',
      badge:data.badge || './manifest.json',
      data:{url:data.url || './'},
      tag:data.tag || 'ultimate-teams-generated',
      renotify:true
    }
  ));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const targetUrl=event.notification?.data?.url || './';

  event.waitUntil((async()=>{
    const windows=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if('focus' in client){
        await client.focus();
        if('navigate' in client) await client.navigate(targetUrl);
        return;
      }
    }
    if(clients.openWindow) return clients.openWindow(targetUrl);
  })());
});
