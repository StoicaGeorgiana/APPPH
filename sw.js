const CACHE='gestiunepro-v22-pro';
const APP_SHELL=['./','./index.html','./manifest.json','./app.js',
'./v8_addon.js','./v11_override.js','./v12_labels_override.js',
'./v13_intrari_fix.js','./v14_fix.js','./v16_patch.js',
'./v17_patch.js','./v18_patch.js','./v20_scanner_plu_patch.js',
'./v21_final_patch.js','./v22_pro.js'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache=>cache.addAll(APP_SHELL)).catch(()=>{})
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    // Sterge TOATE cache-urile vechi
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
    const clients=await self.clients.matchAll({type:'window'});
    clients.forEach(client=>client.postMessage({type:'APP_UPDATED'}));
  })());
});

self.addEventListener('message',event=>{
  if(event.data&&event.data.type==='SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  // Nu cachea Supabase sau config
  if(url.hostname.includes('supabase.co')) return;
  if(url.pathname.endsWith('/config.js')) return;

  const isNavigation=event.request.mode==='navigate';
  const isAsset=/\.(js|css|html|json|svg)$/i.test(url.pathname);

  if(isNavigation||isAsset){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(event.request,{cache:'no-store'});
        const cache=await caches.open(CACHE);
        cache.put(event.request,fresh.clone()).catch(()=>{});
        return fresh;
      }catch(e){
        const cached=await caches.match(event.request);
        return cached||caches.match('./index.html');
      }
    })());
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached=>cached||fetch(event.request))
  );
});
