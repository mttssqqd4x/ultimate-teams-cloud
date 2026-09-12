const CACHE='ultimate-teams-cloud-4-11-21';
const STATIC_ASSETS=['./','./index.html','./app.js','./config.js','./manifest.json'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC_ASSETS)).catch(()=>null));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    if(self.registration.navigationPreload){
      try{ await self.registration.navigationPreload.enable(); }catch(e){}
    }
    await self.clients.claim();
  })());
});

async function staleWhileRevalidate(request){
  const cache=await caches.open(CACHE);
  const cached=await cache.match(request);
  const network=fetch(request).then(response=>{
    if(response && (response.ok || response.type==='opaque')){
      cache.put(request,response.clone()).catch(()=>null);
    }
    return response;
  }).catch(()=>null);
  return cached || network || Response.error();
}

async function navigationResponse(event){
  const cache=await caches.open(CACHE);
  const cached=await cache.match('./index.html');
  const preload=await event.preloadResponse.catch(()=>null);

  if(preload && preload.ok){
    cache.put('./index.html',preload.clone()).catch(()=>null);
    return preload;
  }

  const network=fetch(event.request).then(response=>{
    if(response && response.ok) cache.put('./index.html',response.clone()).catch(()=>null);
    return response;
  }).catch(()=>null);

  const fastNetwork=await Promise.race([
    network,
    new Promise(resolve=>setTimeout(()=>resolve(null),700))
  ]);

  if(fastNetwork) return fastNetwork;
  if(cached){
    network.catch(()=>null);
    return cached;
  }
  return (await network) || Response.error();
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;

  const url=new URL(event.request.url);

  // Never cache database/auth/realtime/function traffic.
  if(url.hostname.endsWith('.supabase.co')) return;

  if(event.request.mode==='navigate'){
    event.respondWith(navigationResponse(event));
    return;
  }

  const localStatic=url.origin===self.location.origin
    && /\.(?:js|css|json|png|svg|ico|webp)$/.test(url.pathname);

  const supabaseLibrary=url.hostname==='cdn.jsdelivr.net'
    && url.pathname.includes('@supabase/supabase-js');

  if(localStatic || supabaseLibrary){
    event.respondWith(staleWhileRevalidate(event.request));
  }
});

self.addEventListener('push',event=>{
  let data={};
  try{ data=event.data?event.data.json():{}; }
  catch(e){ data={body:event.data?event.data.text():''}; }

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
    const allClients=await clients.matchAll({type:'window',includeUncontrolled:true});
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
