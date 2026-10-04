(()=>{"use strict";
/*
  Dream Builder DB9 Cloud Sync
  ----------------------------
  Local-first remains the source of resilience.
  Cloud Sync is optional and uses Firebase Authentication + Realtime Database.
  Dream Builder data is synced; the local PIN hash and cloud metadata are NOT synced.
*/

const $=id=>document.getElementById(id);
const CLOUD_META_PREFIX='db_cloud_';
const CLOUD_PIN_KEY='db_pin_hash';
const CLOUD_DEVICE_KEY='db_cloud_device_id';
const CLOUD_LOCAL_MODIFIED_KEY='db_cloud_local_modified';
const CLOUD_LAST_SYNC_KEY='db_cloud_last_sync';
const CLOUD_AUTO_KEY='db_cloud_auto';

let app=null,auth=null,db=null,user=null;
let applying=false,pushTimer=null,sdkPromise=null,initialized=false;

function lang(){return localStorage.getItem('db_lang')==='th'?'th':'en'}
function tx(en,th){return lang()==='th'?th:en}
function setStatus(en,th=en){
  const el=$('dbCloudStatus');
  if(el)el.textContent=tx(en,th);
}
function deviceId(){
  let id=localStorage.getItem(CLOUD_DEVICE_KEY);
  if(!id){
    id='dev-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
    localStorage.setItem(CLOUD_DEVICE_KEY,id);
  }
  return id;
}
function isAppKey(k){
  return !!k && k.startsWith('db_') && !k.startsWith(CLOUD_META_PREFIX) && k!==CLOUD_PIN_KEY;
}
function appKeys(){
  const out=[];
  for(let i=0;i<localStorage.length;i++){
    const k=localStorage.key(i);
    if(isAppKey(k))out.push(k);
  }
  return out.sort();
}
function hasMeaningfulLocal(){
  for(const k of appKeys()){
    const v=localStorage.getItem(k)||'';
    if(k.startsWith('db_day_') && v && v!=='{}') return true;
    if(k.toLowerCase().includes('client') && v && v!=='[]' && v!=='{}') return true;

    if(k==='db_global'){
      try{
        const o=JSON.parse(v||'{}');
        if(Object.values(o).some(x=>String(x||'').trim())) return true;
      }catch{}
    }

    if(k.startsWith('db_production_goals')){
      try{
        const o=JSON.parse(v||'{}');
        if(Object.values(o.years||{}).some(y=>
          (Number(y.actualFyp)||0)>0 || (Number(y.actualFyc)||0)>0
        )) return true;
      }catch{}
    }

    if(k.startsWith('db_dallas_')){
      try{
        const o=JSON.parse(v||'{}');
        if(Object.entries(o).some(([key,val])=>
          /actual|saved/i.test(key) && (Number(val)||0)>0
        )) return true;
      }catch{}
    }
  }
  return false;
}
function buildSnapshot(){
  const items={};
  appKeys().forEach(k=>items[k]=localStorage.getItem(k));
  return {
    schema:1,
    app:'Dream Builder DB9',
    updatedAt:Date.now(),
    sourceDevice:deviceId(),
    items
  };
}
function refreshHeader(state){
  let saveLine=document.querySelector('.save-line');
  if(!saveLine)return;
  let badge=$('dbCloudHeader');
  if(!badge){
    badge=document.createElement('span');
    badge.id='dbCloudHeader';
    badge.style.cssText='margin-left:8px;font-size:11px;color:#747b87;font-weight:800';
    saveLine.appendChild(badge);
  }
  badge.textContent=state||tx('☁ Cloud off','☁ Cloud ปิด');
}
function refreshUi(message){
  const configured=!!window.DREAM_BUILDER_FIREBASE_CONFIG;
  const connected=!!user;
  const dot=$('dbCloudDot'), who=$('dbCloudUser'), setup=$('dbCloudSetupNote');
  if(dot)dot.classList.toggle('on',connected);
  if(who){
    who.textContent=connected
      ?tx('Connected • '+(user.email||'Dream Builder'),'เชื่อมต่อแล้ว • '+(user.email||'Dream Builder'))
      :(configured?tx('Cloud ready • sign in to sync','Cloud พร้อม • ลงชื่อเข้าใช้เพื่อ Sync'):tx('Cloud activation needed','ต้องเปิดใช้งาน Cloud ก่อน'));
  }
  if(setup)setup.classList.toggle('hidden',configured);
  ['dbCloudSyncBtn','dbCloudUploadBtn','dbCloudDownloadBtn'].forEach(id=>{
    if($(id))$(id).disabled=!connected;
  });
  if($('dbCloudSignOutBtn'))$('dbCloudSignOutBtn').classList.toggle('hidden',!connected);
  if($('dbCloudSignInBtn'))$('dbCloudSignInBtn').classList.toggle('hidden',connected);
  if($('dbCloudCreateBtn'))$('dbCloudCreateBtn').classList.toggle('hidden',connected);

  refreshHeader(connected?tx('☁ Cloud connected','☁ Cloud เชื่อมแล้ว'):tx('☁ Cloud off','☁ Cloud ปิด'));
  if(message)setStatus(message,message);
}
function refreshLanguage(){
  if(!$('dbCloudTitle'))return;
  $('dbCloudTitle').textContent=tx('Phone ↔ Cloud ↔ Laptop','มือถือ ↔ Cloud ↔ Laptop');
  $('dbCloudIntro').textContent=tx(
    'One Dream Builder across devices. Local-first: it still works without internet.',
    'Dream Builder ชุดเดียวทุกอุปกรณ์ และยังทำงานในเครื่องได้แม้ไม่มีอินเทอร์เน็ต'
  );
  $('dbCloudSetupNote').textContent=tx(
    'Cloud Sync is built into DB9. One-time Firebase activation is required before first use.',
    'DB9 มี Cloud Sync แล้ว เหลือเปิดใช้งาน Firebase ครั้งเดียวก่อนใช้ครั้งแรก'
  );
  $('dbCloudEmailLabel').textContent=tx('Email','อีเมล');
  $('dbCloudPasswordLabel').textContent=tx('Password','รหัสผ่าน');
  $('dbCloudSignInBtn').textContent=tx('Sign in','เข้าสู่ระบบ');
  $('dbCloudCreateBtn').textContent=tx('Create account','สร้างบัญชี');
  $('dbCloudSignOutBtn').textContent=tx('Sign out','ออกจากระบบ');
  $('dbCloudSyncBtn').textContent=tx('Sync now','Sync ตอนนี้');
  $('dbCloudUploadBtn').textContent=tx('Upload this device','ส่งข้อมูลเครื่องนี้ขึ้น Cloud');
  $('dbCloudDownloadBtn').textContent=tx('Download cloud','ดึงข้อมูล Cloud ลงเครื่องนี้');
  $('dbCloudAutoLabel').textContent=tx('Auto sync after local changes','Sync อัตโนมัติเมื่อข้อมูลเปลี่ยน');
  refreshUi();
}
function injectStyle(){
  if($('dbCloudStyle'))return;
  const st=document.createElement('style');
  st.id='dbCloudStyle';
  st.textContent=`
    .db-cloud-card{border:1px solid #bfd0da;border-radius:20px;padding:16px;margin:0 0 16px;background:linear-gradient(145deg,#f6fbfd,#fffaf0)}
    .db-cloud-card h3{margin:2px 0 5px;color:#123f63}
    .db-cloud-line{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .db-cloud-dot{width:9px;height:9px;border-radius:50%;background:#9aa1aa}
    .db-cloud-dot.on{background:#178259}
    .db-cloud-status{font-size:12px;color:#747b87;margin-top:9px;min-height:18px;line-height:1.4}
    .db-cloud-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .db-cloud-user{font-size:12px;color:#123f63;font-weight:800}
    .db-cloud-note{border-left:4px solid #b99145;padding:9px 0 9px 12px;color:#4b5563;margin:10px 0}
    .db-cloud-card input[type=checkbox]{width:18px;height:18px;accent-color:#178259}
    .db-cloud-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .db-cloud-grid label{display:block;color:#123f63;font-weight:800;margin:10px 0 6px}
    .db-cloud-grid input{width:100%;border:1px solid #ded7ca;border-radius:14px;padding:12px 13px;background:#fff;color:#142033;outline:none;font:inherit}
    .db-cloud-grid input:focus{border-color:#8da9bd;box-shadow:0 0 0 3px rgba(18,63,99,.08)}
    @media(max-width:720px){.db-cloud-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(st);
}
function injectUi(){
  const pane=$('more-backup');
  if(!pane || $('dbCloudCard'))return false;
  injectStyle();
  pane.insertAdjacentHTML('afterbegin',`
    <div id="dbCloudCard" class="db-cloud-card">
      <div class="eyebrow">ONE ACCOUNT • ALL DEVICES</div>
      <h3 id="dbCloudTitle">Phone ↔ Cloud ↔ Laptop</h3>
      <p id="dbCloudIntro" class="muted">One Dream Builder across devices.</p>
      <div class="db-cloud-line">
        <span id="dbCloudDot" class="db-cloud-dot"></span>
        <span id="dbCloudUser" class="db-cloud-user">Cloud not connected</span>
      </div>

      <div id="dbCloudSetupNote" class="db-cloud-note">
        Cloud Sync is ready in DB9. Firebase activation is required once before first use.
      </div>

      <div class="db-cloud-grid">
        <div>
          <label id="dbCloudEmailLabel">Email</label>
          <input id="dbCloudEmail" type="email" autocomplete="email" placeholder="you@example.com">
        </div>
        <div>
          <label id="dbCloudPasswordLabel">Password</label>
          <input id="dbCloudPassword" type="password" autocomplete="current-password" placeholder="6+ characters">
        </div>
      </div>

      <div class="db-cloud-actions">
        <button id="dbCloudSignInBtn" class="btn primary" type="button">Sign in</button>
        <button id="dbCloudCreateBtn" class="btn" type="button">Create account</button>
        <button id="dbCloudSignOutBtn" class="btn danger hidden" type="button">Sign out</button>
      </div>

      <div class="db-cloud-actions">
        <button id="dbCloudSyncBtn" class="btn primary" type="button" disabled>Sync now</button>
        <button id="dbCloudUploadBtn" class="btn" type="button" disabled>Upload this device</button>
        <button id="dbCloudDownloadBtn" class="btn" type="button" disabled>Download cloud</button>
      </div>

      <label class="db-cloud-line" style="margin-top:12px">
        <input id="dbCloudAutoSync" type="checkbox" checked>
        <span id="dbCloudAutoLabel">Auto sync after local changes</span>
      </label>

      <div id="dbCloudStatus" class="db-cloud-status">
        Local mode is safe. Cloud is off until connected.
      </div>
    </div>
  `);
  refreshLanguage();
  return true;
}
function loadScript(src,id){
  return new Promise((resolve,reject)=>{
    if(document.getElementById(id)){resolve();return}
    const sc=document.createElement('script');
    sc.id=id;sc.src=src;sc.async=true;
    sc.onload=resolve;
    sc.onerror=()=>reject(new Error('Could not load cloud library'));
    document.head.appendChild(sc);
  });
}
async function ensureSdk(){
  if(window.firebase && firebase.auth && firebase.database)return;
  if(sdkPromise)return sdkPromise;
  sdkPromise=(async()=>{
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js','db-firebase-app');
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js','db-firebase-auth');
    await loadScript('https://www.gstatic.com/firebasejs/10.14.1/firebase-database-compat.js','db-firebase-db');
  })();
  return sdkPromise;
}
function applySnapshot(remote){
  if(!remote || !remote.items)return;
  applying=true;
  try{
    appKeys().forEach(k=>localStorage.removeItem(k));
    Object.entries(remote.items).forEach(([k,v])=>{
      if(isAppKey(k))localStorage.setItem(k,String(v));
    });
    const ts=Number(remote.updatedAt)||Date.now();
    localStorage.setItem(CLOUD_LOCAL_MODIFIED_KEY,String(ts));
    localStorage.setItem(CLOUD_LAST_SYNC_KEY,String(ts));
    setStatus(
      'Cloud data loaded ✓ Reloading Dream Builder…',
      'ดึงข้อมูลจาก Cloud แล้ว ✓ กำลังเปิด Dream Builder ใหม่…'
    );
    setTimeout(()=>location.reload(),500);
  }finally{
    applying=false;
  }
}
async function upload(){
  if(!user||!db){setStatus('Sign in first.','กรุณาเข้าสู่ระบบก่อน');return}
  if(!navigator.onLine){
    setStatus('Offline • saved locally. Cloud will sync when online.','ออฟไลน์ • บันทึกในเครื่องแล้ว จะ Sync เมื่อออนไลน์');
    return;
  }
  try{
    setStatus('Uploading to cloud…','กำลังส่งข้อมูลขึ้น Cloud…');
    const snap=buildSnapshot();
    await db.ref('users/'+user.uid+'/dreamBuilder/state').set(snap);
    localStorage.setItem(CLOUD_LAST_SYNC_KEY,String(snap.updatedAt));
    localStorage.setItem(CLOUD_LOCAL_MODIFIED_KEY,String(snap.updatedAt));
    setStatus('Cloud synced ✓','Cloud Sync แล้ว ✓');
    refreshHeader(tx('☁ Synced','☁ Sync แล้ว'));
  }catch(e){
    setStatus('Cloud sync failed: '+(e.message||e),'Cloud Sync ไม่สำเร็จ: '+(e.message||e));
  }
}
async function download(){
  if(!user||!db){setStatus('Sign in first.','กรุณาเข้าสู่ระบบก่อน');return}
  try{
    setStatus('Checking cloud…','กำลังตรวจ Cloud…');
    const ss=await db.ref('users/'+user.uid+'/dreamBuilder/state').once('value');
    const remote=ss.val();
    if(!remote){
      setStatus('No cloud copy yet. Upload this device first.','ยังไม่มีข้อมูลบน Cloud ให้ส่งข้อมูลเครื่องนี้ขึ้นก่อน');
      return;
    }
    applySnapshot(remote);
  }catch(e){
    setStatus('Could not download cloud: '+(e.message||e),'ดึงข้อมูล Cloud ไม่สำเร็จ: '+(e.message||e));
  }
}
async function syncNow(){
  if(!user||!db){setStatus('Sign in first.','กรุณาเข้าสู่ระบบก่อน');return}
  try{
    const ss=await db.ref('users/'+user.uid+'/dreamBuilder/state').once('value');
    const remote=ss.val();

    if(!remote){await upload();return}

    const last=Number(localStorage.getItem(CLOUD_LAST_SYNC_KEY)||0);
    const localModified=Number(localStorage.getItem(CLOUD_LOCAL_MODIFIED_KEY)||0);
    const remoteModified=Number(remote.updatedAt)||0;

    if(last && localModified>last && remoteModified>last && remote.sourceDevice!==deviceId()){
      setStatus(
        'Both devices changed since last sync. Choose Upload this device or Download cloud.',
        'ทั้งสองเครื่องมีการเปลี่ยนแปลงหลัง Sync ครั้งล่าสุด ให้เลือกส่งข้อมูลเครื่องนี้ขึ้น หรือดึง Cloud ลง'
      );
      return;
    }

    if(localModified>remoteModified)await upload();
    else if(remoteModified>localModified)applySnapshot(remote);
    else setStatus('Already in sync ✓','ข้อมูลตรงกันแล้ว ✓');
  }catch(e){
    setStatus('Sync failed: '+(e.message||e),'Sync ไม่สำเร็จ: '+(e.message||e));
  }
}
function schedulePush(){
  if(applying || !user || !$('dbCloudAutoSync') || !$('dbCloudAutoSync').checked)return;
  clearTimeout(pushTimer);
  pushTimer=setTimeout(()=>upload(),1800);
}
function markLocalChange(){
  if(applying)return;
  localStorage.setItem(CLOUD_LOCAL_MODIFIED_KEY,String(Date.now()));
  refreshHeader(tx('☁ Waiting to sync','☁ รอ Sync'));
  schedulePush();
}
function installStorageObserver(){
  if(Storage.prototype.__dreamBuilderCloudWrapped)return;
  const native=Storage.prototype.setItem;
  Storage.prototype.setItem=function(k,v){
    native.call(this,k,v);
    if(this===localStorage && isAppKey(String(k)) && !applying)markLocalChange();
  };
  Storage.prototype.__dreamBuilderCloudWrapped=true;
}
async function initialReconcile(){
  if(!user||!db)return;
  try{
    const ss=await db.ref('users/'+user.uid+'/dreamBuilder/state').once('value');
    const remote=ss.val();
    const last=Number(localStorage.getItem(CLOUD_LAST_SYNC_KEY)||0);

    if(!remote){
      if(hasMeaningfulLocal())await upload();
      else setStatus(
        'Connected • cloud is empty. Start using Dream Builder and it will sync.',
        'เชื่อมต่อแล้ว • Cloud ยังว่าง เริ่มใช้ Dream Builder แล้วระบบจะ Sync ให้'
      );
      return;
    }

    if(!last){
      if(hasMeaningfulLocal()){
        setStatus(
          'Cloud copy found. First sync: choose Upload this device or Download cloud.',
          'พบข้อมูลบน Cloud • Sync ครั้งแรก ให้เลือกส่งข้อมูลเครื่องนี้ขึ้น หรือดึง Cloud ลง'
        );
      }else{
        applySnapshot(remote);
      }
      return;
    }

    await syncNow();
  }catch(e){
    setStatus('Cloud check failed: '+(e.message||e),'ตรวจ Cloud ไม่สำเร็จ: '+(e.message||e));
  }
}
function bindUi(){
  $('dbCloudAutoSync').checked=localStorage.getItem(CLOUD_AUTO_KEY)!=='0';
  $('dbCloudAutoSync').onchange=()=>{
    localStorage.setItem(CLOUD_AUTO_KEY,$('dbCloudAutoSync').checked?'1':'0');
    setStatus(
      $('dbCloudAutoSync').checked?'Auto sync is on.':'Auto sync is off.',
      $('dbCloudAutoSync').checked?'เปิด Auto Sync แล้ว':'ปิด Auto Sync แล้ว'
    );
  };

  $('dbCloudSyncBtn').onclick=syncNow;
  $('dbCloudUploadBtn').onclick=()=>{
    if(confirm(tx(
      'Replace the cloud copy with THIS device?',
      'แทนที่ข้อมูลบน Cloud ด้วยข้อมูลจากเครื่องนี้?'
    )))upload();
  };
  $('dbCloudDownloadBtn').onclick=()=>{
    if(confirm(tx(
      'Replace THIS device with the cloud copy?',
      'แทนที่ข้อมูลในเครื่องนี้ด้วยข้อมูลจาก Cloud?'
    )))download();
  };

  document.getElementById('langEn')?.addEventListener('click',()=>setTimeout(refreshLanguage,0));
  document.getElementById('langTh')?.addEventListener('click',()=>setTimeout(refreshLanguage,0));
}
async function init(){
  if(initialized)return;
  initialized=true;

  if(!injectUi()){
    // If a very old UI loads slowly, retry once.
    setTimeout(()=>{initialized=false;init()},500);
    return;
  }

  installStorageObserver();
  bindUi();
  refreshHeader();

  const cfg=window.DREAM_BUILDER_FIREBASE_CONFIG;
  if(!cfg){
    refreshUi(tx(
      'Cloud code is installed. Firebase still needs one-time activation.',
      'ติดตั้ง Cloud Sync ในแอปแล้ว เหลือเปิด Firebase ครั้งเดียว'
    ));
    return;
  }

  try{
    await ensureSdk();
    app=firebase.apps.length?firebase.app():firebase.initializeApp(cfg);
    auth=firebase.auth();
    db=firebase.database();

    await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

    $('dbCloudSignInBtn').onclick=async()=>{
      try{
        await auth.signInWithEmailAndPassword(
          $('dbCloudEmail').value.trim(),
          $('dbCloudPassword').value
        );
        $('dbCloudPassword').value='';
      }catch(e){
        setStatus('Sign in failed: '+(e.message||e),'เข้าสู่ระบบไม่สำเร็จ: '+(e.message||e));
      }
    };

    $('dbCloudCreateBtn').onclick=async()=>{
      try{
        await auth.createUserWithEmailAndPassword(
          $('dbCloudEmail').value.trim(),
          $('dbCloudPassword').value
        );
        $('dbCloudPassword').value='';
      }catch(e){
        setStatus('Account creation failed: '+(e.message||e),'สร้างบัญชีไม่สำเร็จ: '+(e.message||e));
      }
    };

    $('dbCloudSignOutBtn').onclick=()=>auth.signOut();

    auth.onAuthStateChanged(async u=>{
      user=u||null;
      refreshUi();
      if(user){
        $('dbCloudEmail').value=user.email||$('dbCloudEmail').value;
        await initialReconcile();
      }else{
        setStatus(
          'Local mode is safe. Sign in when you want cross-device sync.',
          'โหมดในเครื่องยังใช้งานได้ตามปกติ เข้าสู่ระบบเมื่อต้องการ Sync ข้ามอุปกรณ์'
        );
      }
    });

    window.addEventListener('online',()=>{
      if(user){
        setStatus('Back online • checking cloud…','ออนไลน์แล้ว • กำลังตรวจ Cloud…');
        initialReconcile();
      }
    });

    document.addEventListener('visibilitychange',()=>{
      if(document.visibilityState==='visible' && user)initialReconcile();
    });

  }catch(e){
    setStatus('Cloud setup error: '+(e.message||e),'ตั้งค่า Cloud ไม่สำเร็จ: '+(e.message||e));
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
else init();

})();
