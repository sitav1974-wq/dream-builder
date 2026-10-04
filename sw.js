const CACHE='dream-builder-db9-cloud-sync-20261004-v1';
const CORE=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./cloud-sync.js'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});

async function injectCloudScripts(response){
  if(!response)return response;
  let html=await response.text();
  if(!html.includes('cloud-sync.js')){
    html=html.replace(
      '</body>',
      '<script src="./firebase-config.js"></script><script src="./cloud-sync.js"></script></body>'
    );
  }
  const headers=new Headers(response.headers);
  headers.set('Content-Type','text/html; charset=utf-8');
  headers.delete('Content-Length');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;

  const u=new URL(e.request.url);

  // Firebase config is intentionally network-first so one future config update
  // activates all devices without another app rebuild.
  if(u.pathname.endsWith('/firebase-config.js')){
    e.respondWith(
      fetch(e.request,{cache:'no-store'})
        .catch(()=>new Response(
          'window.DREAM_BUILDER_FIREBASE_CONFIG = null;',
          {headers:{'Content-Type':'application/javascript; charset=utf-8'}}
        ))
    );
    return;
  }

  if(e.request.mode==='navigate'){
    e.respondWith((async()=>{
      try{
        const r=await fetch(e.request);
        const copy=r.clone();
        caches.open(CACHE).then(c=>c.put('./index.html',copy));
        return injectCloudScripts(r);
      }catch{
        const cached=await caches.match('./index.html');
        return cached?injectCloudScripts(cached):Response.error();
      }
    })());
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached=>
      cached || fetch(e.request).then(r=>{
        const copy=r.clone();
        caches.open(CACHE).then(c=>c.put(e.request,copy));
        return r;
      })
    )
  );
});
