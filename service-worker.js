const CACHE='ultimate-teams-cloud-4-15-7';
const AUTH_SDK='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
const STATIC_ASSETS=[
  './',
  './index.html',
  './theme.css?v=4.15.7',
  './styles.css?v=4.15.7',
  './legacy-core.js?v=4.15.7',
  './app.js?v=4.15.7',
  './config.js',
  './version.js?v=4.15.7',
  './sandbox-host.js?v=4.15.7',
  './sandbox-runtime.js?v=4.15.7',
  './manifest.json'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(async cache=>{
        await cache.addAll(STATIC_ASSETS.map(asset=>new Request(new URL(asset,self.location.href),{cache:'reload'})));
        // Carry the already-downloaded SDK into the new release before old caches
        // are removed. Offline startup must not depend on a CDN round trip.
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),10000);
        try{
          const sdk=(await caches.match(AUTH_SDK)) || await fetch(AUTH_SDK,{signal:controller.signal});
          if(!sdk?.ok) throw new Error('Auth library could not be cached');
          await cache.put(AUTH_SDK,sdk);
        }finally{clearTimeout(timer);}
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith('ultimate-teams-cloud-') && key!==CACHE).map(key=>caches.delete(key)));
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
    if(!response?.ok) return (await cache.match(fallbackPath || request)) || response || Response.error();
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

  // The release shell is installed atomically with its versioned local assets.
  // Reopening never waits for the network; worker updates install the next shell.
  if(event.request.mode==='navigate' && url.origin===self.location.origin){
    event.respondWith(caches.open(CACHE).then(async cache=>
      (await cache.match('./index.html')) || networkFirst(event.request,'./index.html')));
    return;
  }

  // Sandbox requests a release-specific page; stable configuration comes from
  // the same installed release to avoid blocking startup or mixing versions.
  if(url.origin===self.location.origin && ['/index.html','/config.js','/manifest.json'].some(path=>url.pathname.endsWith(path))){
    const path=url.pathname.endsWith('/index.html') ? './index.html'
      : url.pathname.endsWith('/config.js') ? './config.js' : './manifest.json';
    event.respondWith(caches.open(CACHE).then(async cache=>
      (await cache.match(path)) || networkFirst(event.request,path)));
    return;
  }

  // Local assets use stable filenames and release-specific query strings.
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
