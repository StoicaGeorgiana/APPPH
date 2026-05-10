'use strict';

/* =========================
   CONFIG SUPABASE - FINAL
   ========================= */
const SUPABASE_URL = 'https://iqvwlpwxhimkbxqghcrr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_sLnsWUDPGmz8xFTSwUQVxw_IpQbrhcM';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* =========================
   CONFIG LOCAL APP
   ========================= */
const DB_NAME='GestiuneProV44';
const DB_VERSION=3;
const STORES=['produse','intrari','inventar','cart','iesiri','settings'];

let db=null;
let PAGE='dashboard';
let CART=[];
let PRICE_CHANGES=[];
let LABEL_LINES=[];
let INV_LINES=[];
let REC_LINES=[];
let TRANS_LINES=[];
let APP={produseCount:0,intrariCount:0,lastImport:null};

// Cache rapid produse pentru telefon / CT58
let PROD_CACHE = [];
let PROD_BY_COD = new Map();
let PROD_BY_PLU = new Map();
let PROD_CACHE_READY = false;

const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const norm=s=>String(s??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
const cleanCode=v=>String(v??'').replace(/\.0$/,'').replace(/\s/g,'').trim();

const money=v=>{
  if(typeof v==='number') return Number.isFinite(v)?v:0;
  let s=String(v??'').trim().replace(/\s/g,'');
  if(s.includes(',')&&s.includes('.')) s=s.replace(/\./g,'').replace(',','.');
  else s=s.replace(',','.');
  const n=Number(s);
  return Number.isFinite(n)?n:0;
};

const parseCant=v=>{
  let s=String(v??'').trim().replace(/\s/g,'').replace(',','.');
  const n=parseFloat(s);
  return Number.isFinite(n)?Math.round(n*1000)/1000:0;
};

const fmtCant=v=>parseCant(v).toFixed(3).replace('.',',');
const lei=n=>(Number(n)||0).toLocaleString('ro-RO',{minimumFractionDigits:2,maximumFractionDigits:2})+' lei';
const isSGR=p=>norm(p?.denumire||'').includes('sgr');
const sgrVal=(p,q)=>isSGR(p)?parseCant(q)*0.50:0;

function tvaProcentFix(v){
  const n = money(v);
  if(!n) return '';
  const procent = n * 100;
  if(procent >= 0 && procent < 15) return '11%';
  if(procent >= 15 && procent < 30) return '21%';
  return '';
}

/* =========================
   LOGIN / LOGOUT
   ========================= */
async function login(){
  const email=$('email').value.trim();
  const password=$('password').value;
  const err=$('login-error');
  err.textContent='';

  if(!email || !password){
    err.textContent='Completează email și parolă.';
    return;
  }

  try{
    const {error}=await supabaseClient.auth.signInWithPassword({email,password});

    if(error){
      err.textContent='Eroare login: '+error.message;
      return;
    }

    $('login-screen').style.display='none';
    $('app').style.display='block';
    await init();

  }catch(e){
    console.error(e);
    err.textContent='Eroare conexiune Supabase. Verifică internetul, URL-ul și cheia publicabilă.';
  }
}
window.login=login;

async function logout(){
  await supabaseClient.auth.signOut();
  location.reload();
}
window.logout=logout;



/* =========================
   SCANARE CU CAMERA TELEFON
   ========================= */
let cameraScanner = null;

function openCameraScanner(inputId, afterScanFnName){
  closeCameraScanner();

  if(typeof Html5Qrcode === 'undefined'){
    alert('Scannerul cu camera nu este încărcat. Verifică internetul și reîncarcă aplicația.');
    return;
  }

  const overlay=document.createElement('div');
  overlay.id='camera-scan-overlay';
  overlay.innerHTML=`
    <div class="camera-box">
      <h2>Scanează codul de bare</h2>
      <p class="muted">Ține codul de bare în zona camerei.</p>
      <div id="camera-reader"></div>
      <button class="red" onclick="closeCameraScanner()">Închide camera</button>
    </div>`;

  document.body.appendChild(overlay);

  cameraScanner = new Html5Qrcode('camera-reader');

  const scanConfig={
    fps: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? 8 : 12,
    qrbox: /iPhone|iPad|iPod/i.test(navigator.userAgent) ? { width: 220, height: 100 } : { width: 260, height: 130 },
    aspectRatio: 1.777,
    disableFlip: true
  };
  if(window.Html5QrcodeSupportedFormats){
    scanConfig.formatsToSupport=[
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E
    ];
  }

  cameraScanner.start(
    { facingMode: 'environment' },
    scanConfig,
    async decodedText=>{
      const input=$(inputId);
      if(input){
        input.value=String(decodedText||'').trim();
        input.focus();
      }

      await closeCameraScanner();

      if(afterScanFnName && typeof window[afterScanFnName] === 'function'){
        try{
          const result = window[afterScanFnName](inputId);
          if(result && typeof result.then === 'function') await result;
        }catch(e){
          console.error('Eroare după scanare:', e);
          alert('Codul a fost scanat, dar căutarea a dat eroare.');
        }
      }
    },
    ()=>{}
  ).catch(err=>{
    alert('Nu pot porni camera: ' + err);
    closeCameraScanner();
  });
}

async function closeCameraScanner(){
  try{
    if(cameraScanner){
      await cameraScanner.stop();
      await cameraScanner.clear();
    }
  }catch(e){}
  cameraScanner=null;

  const old=document.getElementById('camera-scan-overlay');
  if(old) old.remove();
}

window.openCameraScanner=openCameraScanner;
window.closeCameraScanner=closeCameraScanner;

/* =========================
   ERORI / NOTIFICĂRI
   ========================= */
function showFatal(err, where='Eroare'){
  console.error(where, err);
  const main=document.getElementById('main') || document.getElementById('app');
  if(main){
    main.innerHTML=`<div class="card bad">
      <h1>Eroare aplicație</h1>
      <p><b>${where}</b></p>
      <pre style="white-space:pre-wrap;background:#0c1426;padding:12px;border-radius:12px">${esc(String(err && (err.stack || err.message) || err))}</pre>
      <button onclick="location.reload()">Reîncarcă</button>
      <button class="red" onclick="indexedDB.deleteDatabase(DB_NAME);localStorage.clear();location.reload()">Reset baza locală</button>
    </div>`;
  }
}

function toast(m){
  const d=document.createElement('div');
  d.className='notice good';
  d.style.cssText='position:fixed;right:16px;bottom:16px;z-index:9999;background:#0c1426';
  d.textContent=m;
  document.body.appendChild(d);
  setTimeout(()=>d.remove(),3500);
}

/* =========================
   INDEXEDDB
   ========================= */
function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);

    req.onupgradeneeded=e=>{
      const d=e.target.result;

      if(!d.objectStoreNames.contains('produse')){
        const s=d.createObjectStore('produse',{keyPath:'id'});
        s.createIndex('cod_bare','cod_bare',{unique:false});
        s.createIndex('plu','plu',{unique:false});
        s.createIndex('denumire','denumire',{unique:false});
      }

      if(!d.objectStoreNames.contains('intrari')){
        const s=d.createObjectStore('intrari',{keyPath:'id'});
        s.createIndex('cod_bare','cod_bare',{unique:false});
        s.createIndex('plu','plu',{unique:false});
        s.createIndex('data','data',{unique:false});
      }

      if(!d.objectStoreNames.contains('inventar')) d.createObjectStore('inventar',{keyPath:'id',autoIncrement:true});
      if(!d.objectStoreNames.contains('cart')) d.createObjectStore('cart',{keyPath:'key'});

      if(!d.objectStoreNames.contains('iesiri')){
        const s=d.createObjectStore('iesiri',{keyPath:'id'});
        s.createIndex('data','data',{unique:false});
        s.createIndex('method','method',{unique:false});
      }

      if(!d.objectStoreNames.contains('settings')) d.createObjectStore('settings',{keyPath:'key'});
    };

    req.onsuccess=()=>{db=req.result; resolve(db)};
    req.onerror=()=>reject(req.error);
  });
}

function tx(store,mode='readonly'){
  return db.transaction(store,mode).objectStore(store);
}

function putMany(store,rows,chunk=1000,onProgress=null){
  return new Promise(async(resolve,reject)=>{
    try{
      for(let i=0;i<rows.length;i+=chunk){
        await new Promise((res,rej)=>{
          const tr=db.transaction(store,'readwrite');
          const st=tr.objectStore(store);
          rows.slice(i,i+chunk).forEach(r=>st.put(r));
          tr.oncomplete=res;
          tr.onerror=()=>rej(tr.error);
        });

        if(onProgress) onProgress(Math.min(i+chunk,rows.length),rows.length);
        await new Promise(r=>setTimeout(r,0));
      }
      resolve();
    }catch(e){reject(e)}
  });
}

function clearStore(store){
  return new Promise((res,rej)=>{
    const r=tx(store,'readwrite').clear();
    r.onsuccess=res;
    r.onerror=()=>rej(r.error);
  });
}

function countStore(store){
  return new Promise((res,rej)=>{
    const r=tx(store).count();
    r.onsuccess=()=>res(r.result||0);
    r.onerror=()=>rej(r.error);
  });
}

function getAll(store,limit=0){
  return new Promise((res,rej)=>{
    const out=[];
    const r=tx(store).openCursor();
    r.onsuccess=e=>{
      const c=e.target.result;
      if(c){
        out.push(c.value);
        if(limit && out.length>=limit) res(out);
        else c.continue();
      }else res(out);
    };
    r.onerror=()=>rej(r.error);
  });
}

function getByIndex(store,index,value){
  return new Promise((res,rej)=>{
    const r=tx(store).index(index).getAll(value);
    r.onsuccess=()=>res(r.result||[]);
    r.onerror=()=>rej(r.error);
  });
}

function setSetting(key,value){
  return new Promise((res,rej)=>{
    const r=tx('settings','readwrite').put({key,value});
    r.onsuccess=res;
    r.onerror=()=>rej(r.error);
  });
}

function getSetting(key){
  return new Promise((res,rej)=>{
    const r=tx('settings').get(key);
    r.onsuccess=()=>res(r.result?.value);
    r.onerror=()=>rej(r.error);
  });
}

/* =========================
   PORNIRE APP
   ========================= */
async function loadCounts(){
  APP.produseCount=await countStore('produse');
  APP.intrariCount=await countStore('intrari');
  APP.lastImport=await getSetting('lastImport');
  CART=await getAll('cart');
}

async function loadProductCache(){
  try{
    PROD_CACHE = await getAll('produse');
    PROD_BY_COD = new Map();
    PROD_BY_PLU = new Map();
    PROD_CACHE.forEach(p=>{
      const cod = cleanCode(p.cod_bare || '');
      const plu = cleanCode(p.plu || '');
      if(cod) PROD_BY_COD.set(cod, p);
      if(plu) PROD_BY_PLU.set(plu, p);
    });
    PROD_CACHE_READY = true;
    console.log('Cache produse încărcat:', PROD_CACHE.length);
  }catch(e){
    console.warn('Nu pot încărca cache produse:', e);
    PROD_CACHE_READY = false;
  }
}

async function saveCart(){
  await clearStore('cart');
  await putMany('cart',CART,500);
}

async function init(){
  await openDB();
  await loadCounts();
  await loadProductCache();
  renderShell();
}

function renderShell(){
  $('app').innerHTML=`
  <div class="wrap">
    <aside class="side">
      <div class="brand">Gestiune<span>Pro</span></div>
      <button class="secondary" onclick="logout()">Ieșire</button>
      <div class="userbox">administrator<br><span class="pill">PRO v44</span></div>

      <div class="nav">
        ${nav('dashboard','📊 Dashboard')}
        ${nav('cos','🛒 Coș cumpărături')}
        ${nav('coduri','⌁ Coduri casă')}
        ${nav('verificare','🔍 Verificare preț')}
        ${nav('preturi','🏷 Prețuri schimbate')}
        ${nav('inventar','📦 Inventar')}
        ${nav('intrari','📥 Intrări')}
        ${nav('receptie','📥 Recepție marfă')}
        ${nav('transport','🚚 Fișă transport')}
        ${nav('iesiri','📤 Ieșiri')}
        ${nav('etichete','🏷 Etichete preț')}
        ${nav('backup','💾 Backup / reset')}
      </div>
    </aside>

    <main class="main" id="main"></main>
  </div>`;

  go(PAGE);
}

function nav(id,label){
  return `<button id="nav-${id}" onclick="go('${id}')">${label}</button>`;
}

function getPageFunction(p){
  return ({
    dashboard,
    cos,
    coduri,
    verificare,
    preturi,
    inventar,
    intrari,
    receptie,
    transport,
    iesiri,
    etichete,
    backup
  })[p] || dashboard;
}

function go(p){
  try{
    PAGE=p;
    document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));
    $('nav-'+p)?.classList.add('active');

    const r=getPageFunction(p)();
    if(r && typeof r.catch==='function') r.catch(e=>showFatal(e,'Pagina '+p));

  }catch(e){
    showFatal(e,'Pagina '+p);
  }
}
window.go=go;

/* =========================
   DASHBOARD + IMPORT
   ========================= */
function progressBox(title){
  return `<div class="notice">
    <b>${title}</b>
    <p id="prog-txt">Pregătire...</p>
    <div class="progress"><b id="prog-bar"></b></div>
  </div>`;
}

function setProg(txt,done,total){
  if($('prog-txt')) $('prog-txt').textContent=txt;
  if($('prog-bar')) $('prog-bar').style.width=(total?Math.round(done/total*100):0)+'%';
}

function dashboard(){
  $('main').innerHTML=`
  <h1>Dashboard Administrator</h1>

  <div class="grid">
    <div class="card"><div class="stat">${APP.produseCount}</div><div class="muted">Produse</div></div>
    <div class="card"><div class="stat">${APP.intrariCount}</div><div class="muted">Intrări importate</div></div>
    <div class="card"><div class="stat">${lei(cartTotal())}</div><div class="muted">Coș curent</div></div>
    <div class="card">
      <button class="orange" onclick="location.reload()">Actualizează aplicația</button>
      <button class="secondary" onclick="reloadData()">Reîncarcă date</button>
      <button class="red" onclick="resetAllData()">Șterge toate datele</button>
      <p class="muted">Ultimul import: ${APP.lastImport||'niciunul'}</p>
    </div>
  </div>

  <div class="card">
    <h3>⬆ Import unic SCANARECODPRETURI / MAMA / SAGA</h3>
    <input class="input" type="file" accept=".xlsx,.xls" onchange="importExcel(event)">
    <p class="muted">Citește sheet-ul TABEL pentru produse și TVA / intrări pentru intrări. După import, paginile se încarcă din IndexedDB.</p>
    <div id="import-status"></div>
  </div>`;
}

async function reloadData(){
  await loadCounts();
  toast('Date reîncărcate');
  dashboard();
}

async function resetAllData(){
  if(!confirm('Ștergi TOATE datele locale?')) return;
  if(prompt('Scrie RESET pentru confirmare')!=='RESET') return;

  for(const s of STORES) await clearStore(s);
  CART=[];
  PRICE_CHANGES=[];
  LABEL_LINES=[];
  INV_LINES=[];
  await loadCounts();
  toast('Date șterse');
  dashboard();
}

function findSheet(wb,name){
  const target=norm(name);
  return wb.SheetNames.find(n=>norm(n)===target)||wb.SheetNames.find(n=>norm(n).includes(target.split(' ')[0]));
}

function getAny(row,names){
  const map={};
  Object.keys(row||{}).forEach(k=>map[norm(k).replace(/[_.\-]+/g,' ')]=row[k]);

  for(const n of names){
    const v=map[norm(n).replace(/[_.\-]+/g,' ')];
    if(v!==undefined && v!==null && String(v).trim()!=='') return v;
  }

  return '';
}

function normProd(row,i){
  const cod=cleanCode(getAny(row,['cod_bare','cod bare','codbar','ean','cod produs','cod']));
  const plu=cleanCode(getAny(row,['plu','PLU']));
  const den=String(getAny(row,['denumire','produs','nume produs','nume'])||'').trim();

  if(!cod && !plu && !den) return null;

  return {
    id: cod || ('PLU_'+plu) || ('DEN_'+i+'_'+den),
    cod_bare: cod,
    plu: plu && plu!=='0'?plu:'',
    denumire: den || cod || plu,
    pret: money(getAny(row,['pret_v_tva','pret cu tva','pret tva','pret','preț'])),
    stoc: money(getAny(row,['stoc','cantitate'])),
    um: String(getAny(row,['um','u.m.','unitate','unitate masura'])||'BUC').trim(),
    categorie: String(getAny(row,['categorie','grupa'])||'').trim()
  };
}

function excelDate(v){
  const pad=n=>String(n).padStart(2,'0');
  const ymd=(y,m,d)=>`${y}-${pad(m)}-${pad(d)}`;

  if(v===null || v===undefined || v==='') return '';

  // Excel/SheetJS poate returna Date cu ora mutată pe UTC.
  // Luăm data locală calendaristică, nu ISO/UTC.
  if(v instanceof Date && !isNaN(v)){
    // SheetJS transformă data Excel în Date la miezul nopții UTC.
    // În România, local poate deveni ziua anterioară, deci folosim UTC.
    return ymd(v.getUTCFullYear(), v.getUTCMonth()+1, v.getUTCDate());
  }

  // Excel serial date. Folosim parse_date_code, apoi data calendaristică exactă.
  if(typeof v==='number' && window.XLSX){
    try{
      const d=XLSX.SSF.parse_date_code(v);
      if(d) return ymd(d.y,d.m,d.d);
    }catch(_){}
  }

  const s=String(v||'').trim();
  if(!s) return '';

  // Dacă vine ca ISO cu timezone, ex: 2026-05-01T21:00:00.000Z,
  // NU luăm slice(0,10), fiindcă asta dă ziua anterioară.
  if(/^\d{4}-\d{2}-\d{2}T/.test(s) || /GMT|UTC|Z$/.test(s)){
    const d=new Date(s);
    if(!isNaN(d)) return ymd(d.getUTCFullYear(), d.getUTCMonth()+1, d.getUTCDate());
  }

  // Format românesc Excel: 02/05/2026, 02.05.2026, 02-05-2026
  let m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if(m){
    let y=Number(m[3]);
    if(y<100) y+=2000;
    return ymd(y,Number(m[2]),Number(m[1]));
  }

  // Format deja corect: 2026-05-02
  if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Fallback: încercăm Date local.
  const d=new Date(s);
  if(!isNaN(d)) return ymd(d.getFullYear(), d.getMonth()+1, d.getDate());

  return '';
}

function normIntr(row,i,prodLookup=null){
  const cod=cleanCode(getAny(row,['cod_bare','cod bare','codbar','ean','cod produs','cod']));
  const plu=cleanCode(getAny(row,['plu','PLU']));
  const den=String(getAny(row,['denumire','produs','nume produs','nume'])||'').trim();

  if(!cod && !plu && !den) return null;

  const data=excelDate(getAny(row,['data','date']));
  const cant=money(getAny(row,['cantitate','cant','qty','total cantitate']));

  // PREȚ ACHIZIȚIE FĂRĂ TVA = coloana F "pret" din sheet-ul "tva 11, 21"
  const pret=money(getAny(row,['pret','preț','pret fara tva','pret achizitie']));

  // PREȚ ACHIZIȚIE CU TVA = ultima coloană L "pret cu tva" din sheet-ul "tva 11, 21"
  // Nu mai luăm prețul din TABEL / produse, fiindcă acela este preț de vânzare.
  const pretCuTvaMama=money(getAny(row,['pret cu tva','pret_cu_tva','preț cu tva','pret tva achizitie']));

  // TVA procentual = coloana K "tva2", forțat la 11% / 21%
  const tvaRaw=getAny(row,['tva2','tva procent','procent tva','cota tva']);
  const tvaProcent=tvaProcentFix(tvaRaw);

  const nr=String(getAny(row,['nr','numar','număr','document','nr document','numar document'])||'').trim();

  return {
    id: [data,nr,i,cod,plu,den,cant,pret].join('|'),
    data,
    nr,
    cod_bare:cod,
    plu:plu&&plu!=='0'?plu:'',
    denumire:den||cod||plu,
    cantitate:cant,
    pret,
    valoare: money(getAny(row,['valoare','valoare fara tva','total valoare'])) || cant*pret,
    tva: money(getAny(row,['tva','valoare tva','tva valoare'])),
    tva_procent:tvaProcent,
    pret_cu_tva_mama: pretCuTvaMama,
    furnizor: String(getAny(row,['furnizor','nume furnizor','denumire furnizor','furnizor nume','supplier','vendor','cod fiscal','cui','cod_fiscal'])||'').trim()
  };
}


function hasLeadingProductDigits(p){
  const den=String(p?.denumire||'').trim();
  return /^\d{3,14}(\s|[-–—]|$)/.test(den);
}

function samePriceCents(a,b){
  return Math.round(money(a)*100)===Math.round(money(b)*100);
}


function intrareKeyForDuplicate(x){
  return [
    String(x.data||'').trim(),
    String(x.nr||'').trim().toUpperCase(),
    cleanCode(x.cod_bare||x.plu||''),
    norm(x.denumire||''),
    String(parseCant(x.cantitate||0)),
    String(Math.round(money(x.pret||0)*100)),
    String(Math.round(money(x.valoare||0)*100))
  ].join('|');
}

function dedupeIntrariExact(rows){
  const seen=new Set();
  const out=[];
  let removed=0;

  (rows||[]).forEach(x=>{
    const key=intrareKeyForDuplicate(x);
    if(seen.has(key)){
      removed++;
      return;
    }
    seen.add(key);
    out.push(x);
  });

  window.LAST_INTRARI_DUPLICATES_REMOVED=removed;
  return out;
}

async function detectPriceChangesBeforeImport(newProducts){
  const oldProducts=await getAll('produse');
  const oldMap=new Map(oldProducts.map(p=>[p.id,p]));

  // Curățăm lista la fiecare import. Nu păstrăm produse vechi care nu mai sunt în SCANARECODPRETURI.
  PRICE_CHANGES=[];

  newProducts.forEach(p=>{
    // Prețuri schimbate: afișăm doar produse care există în fișierul importat
    // și au cod/cifre la începutul denumirii. Produsele scoase din fișier nu mai apar.
    if(!hasLeadingProductDigits(p)) return;

    const old=oldMap.get(p.id);
    if(!old) return;

    const oldPrice=money(old.pret);
    const newPrice=money(p.pret);

    if(!samePriceCents(oldPrice,newPrice)){
      PRICE_CHANGES.push({
        id:p.id,
        cod_bare:p.cod_bare,
        plu:p.plu,
        denumire:p.denumire,
        pret_vechi:oldPrice,
        pret_nou:newPrice,
        data:new Date().toLocaleString('ro-RO')
      });
    }
  });
}

async function importExcel(e){
  const file=e.target.files?.[0];
  if(!file) return;

  $('import-status').innerHTML=progressBox('Import în desfășurare');

  const buf=await file.arrayBuffer();
  setProg('Se citește Excel...',1,100);

  const wb=XLSX.read(buf,{type:'array',cellDates:true});

  const tabelName=findSheet(wb,'TABEL');
  const tvaName=wb.SheetNames.find(n=>norm(n)==='tva 11, 21') ||
                wb.SheetNames.find(n=>norm(n).includes('tva')) ||
                wb.SheetNames.find(n=>norm(n).includes('intrari'));

  if(!tabelName && !tvaName){
    $('import-status').innerHTML='<div class="notice bad">Nu găsesc sheet TABEL sau TVA / intrări.</div>';
    return;
  }

  const rowsT=tabelName?XLSX.utils.sheet_to_json(wb.Sheets[tabelName],{defval:''}):[];
  const rowsI=tvaName?XLSX.utils.sheet_to_json(wb.Sheets[tvaName],{defval:''}):[];

  const produse=rowsT.map(normProd).filter(Boolean);
  const prodLookup=new Map();
  produse.forEach(p=>{
    if(p.cod_bare) prodLookup.set(String(p.cod_bare),p);
    if(p.plu) prodLookup.set(String(p.plu),p);
  });
  const intrari=dedupeIntrariExact(rowsI.map((r,i)=>normIntr(r,i,prodLookup)).filter(Boolean));

  await detectPriceChangesBeforeImport(produse);

  await clearStore('produse');
  await clearStore('intrari');

  await putMany('produse',produse,1500,(d,t)=>setProg(`Produse TABEL: ${d}/${t}`,d,t));
  await putMany('intrari',intrari,1500,(d,t)=>setProg(`Intrări: ${d}/${t}`,d,t));

  await setSetting('lastImport',new Date().toLocaleString('ro-RO'));

  await loadCounts();
  await loadProductCache();

  {
    const produseUnice=(await getAll('produse')).length;
    const duplicateProduse=Math.max(0,produse.length-produseUnice);
    $('import-status').innerHTML=`<div class="notice good">Import finalizat: ${produseUnice} produse unice din ${produse.length} rânduri TABEL și ${intrari.length} intrări.${duplicateProduse?`<br>Observație produse: ${duplicateProduse} rânduri din TABEL au fost duplicate după cod/ID și au fost comasate.`:''}${window.LAST_INTRARI_DUPLICATES_REMOVED?`<br>Observație intrări: ${window.LAST_INTRARI_DUPLICATES_REMOVED} rânduri duplicate identic au fost eliminate.`:''}</div>`;
  }
  dashboard();
}

/* =========================
   PRODUSE / CĂUTARE
   ========================= */
async function searchProducts(q){
  q = String(q || '').trim();
  if (!q) return [];

  if (!PROD_CACHE_READY) await loadProductCache();

  const code = cleanCode(q);
  const nq = norm(q);
  const words = nq.split(/\s+/).filter(Boolean);

  if (code) {
    const exact = PROD_BY_COD.get(code) || PROD_BY_PLU.get(code);
    if (exact) return [exact];
  }

  const starts = [];
  const containsAll = [];
  const containsAny = [];

  for (const p of PROD_CACHE) {
    const den = norm(p.denumire || '');
    const cod = String(p.cod_bare || '');
    const plu = String(p.plu || '');
    const hay = `${den} ${cod} ${plu}`;

    if (code && (cod.includes(code) || plu.includes(code))) {
      containsAll.push(p);
      continue;
    }

    if (!words.length) continue;

    const all = words.every(w => hay.includes(w));
    const any = words.some(w => hay.includes(w));

    if (all) {
      if (words.some(w => den.startsWith(w))) starts.push(p);
      else containsAll.push(p);
    } else if (any) {
      containsAny.push(p);
    }
  }

  return uniqueProds([...starts, ...containsAll, ...containsAny]);
}

function uniqueProds(arr){
  const m=new Map();
  arr.forEach(p=>m.set(p.id,p));
  return [...m.values()];
}

async function byCode(q){
  q=String(q||'').trim();
  if(!q) return null;

  if(!PROD_CACHE_READY) await loadProductCache();

  const code=cleanCode(q);
  if(code){
    const exact = PROD_BY_COD.get(code) || PROD_BY_PLU.get(code);
    if(exact) return exact;
  }

  const arr=await searchProducts(q);
  return arr[0]||null;
}

async function getProdById(id){
  return new Promise((res,rej)=>{
    const r=tx('produse').get(id);
    r.onsuccess=()=>res(r.result);
    r.onerror=()=>rej(r.error);
  });
}

window.showSuggest=async function(id,pickFn){
  const q=$(id).value;
  const box=$(id+'-s');

  if(!q || String(q).trim().length<2){
    box.classList.add('hide');
    box.innerHTML='';
    return;
  }

  const arr=await searchProducts(q);

  if(!arr.length){
    box.classList.add('hide');
    box.innerHTML='';
    return;
  }

  box.classList.remove('hide');

  const visible=arr.slice(0,80);
  box.innerHTML=visible.map(p=>`
    <div onclick="${pickFn}('${esc(p.id)}')">
      <b>${esc(p.cod_bare||'')}</b>
      ${p.plu?`PLU ${esc(p.plu)}`:''}
      — ${esc(p.denumire)}
      <span style="float:right">${lei(p.pret)}</span>
    </div>`).join('') + (
      arr.length>visible.length
        ? `<div class="muted">Mai există ${arr.length-visible.length} rezultate. Scrie mai multe litere pentru filtrare.</div>`
        : ''
    );
};

function productSearchHtml(inputId,pickFn,placeholder='Cod bare / PLU / denumire'){
  return `<div style="position:relative">
    <input class="input" id="${inputId}" placeholder="${placeholder}" oninput="showSuggest('${inputId}','${pickFn}')">
    <div class="suggest hide" id="${inputId}-s"></div>
  </div>`;
}

/* =========================
   COȘ
   ========================= */
function cartTotal(){
  return CART.reduce((s,p)=>s+(parseCant(p.cantitate)*money(p.pret)+sgrVal(p,p.cantitate)),0);
}

function addCart(p,q=1){
  const key=p.id||p.cod_bare||p.plu||p.denumire;
  let e=CART.find(x=>x.key===key);

  if(e) e.cantitate=Math.round((parseCant(e.cantitate)+parseCant(q))*1000)/1000;
  else CART.push({
    key,
    id:p.id,
    cod_bare:p.cod_bare,
    plu:p.plu,
    denumire:p.denumire,
    pret:p.pret,
    cantitate:parseCant(q)||1
  });

  saveCart();
  renderCart();
}

window.pickCart=async id=>{
  const p=await getProdById(id);
  if(p) addCart(p);
  document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'));
};

function cos(){
  $('main').innerHTML=`
  <h1>Coș cumpărături</h1>

  <div class="grid2">
    <div class="card">
      <h3>Adaugă produs</h3>
      <div style="position:relative">
        <input class="input" id="cart-q" placeholder="Cod bare / PLU / denumire" oninput="showSuggest('cart-q','pickCart')" onkeydown="if(event.key==='Enter')addCartByInput('cart-q')">
        <div class="suggest hide" id="cart-q-s"></div>
      </div>

      <div class="row">
        <button onclick="addCartByInput('cart-q')">Adaugă după text</button>
        <button class="secondary" onclick="openCameraScanner('cart-q','addCartByInput')">📷 Scanează</button>
        <input class="input" id="cart-plu" style="max-width:260px" placeholder="Introdu PLU manual" onkeydown="if(event.key==='Enter')addCartByInput('cart-plu')">
        <button onclick="addCartByInput('cart-plu')">Caută PLU</button>
        <button class="red" onclick="clearCart()">Golește coș</button>
      </div>
    </div>

    <div class="card">
      <h3>Plată</h3>
      <p>Produse: <span id="pay-products">0 lei</span><br>SGR: <span id="pay-sgr">0 lei</span></p>
      <div class="stat" id="pay-total">0 lei</div>
      <div class="row">
        <button class="green" onclick="finalizeSale('cash')">Plată Cash</button>
        <button onclick="finalizeSale('card')">Plată Card</button>
        <button class="orange" onclick="sendCartToCasa()">Trimite în Coduri casă</button>
      </div>
    </div>
  </div>

  <div class="card tbl-wrap">
    <table>
      <thead>
        <tr>
          <th>Cod</th>
          <th>PLU</th>
          <th>Denumire</th>
          <th>SGR</th>
          <th>Cant.</th>
          <th>Preț</th>
          <th>Total</th>
          <th></th>
        </tr>
      </thead>
      <tbody id="cart-body"></tbody>
    </table>
  </div>`;

  renderCart();
}

async function addCartByInput(id){
  const p=await byCode($(id).value);
  if(!p) return toast('Produs inexistent');

  addCart(p);
  $(id).value='';
}

function renderCart(){
  const tb=$('cart-body');
  if(!tb) return;

  if(!CART.length){
    tb.innerHTML='<tr><td colspan="8" class="muted">Coșul este gol.</td></tr>';
    updatePay();
    return;
  }

  tb.innerHTML=CART.map((p,i)=>{
    const q=parseCant(p.cantitate);
    const val=q*money(p.pret);
    const sg=sgrVal(p,q);
    const total=val+sg;

    return `<tr>
      <td>${esc(p.cod_bare)}</td>
      <td>${esc(p.plu)}</td>
      <td>${esc(p.denumire)}</td>
      <td>${isSGR(p)?'<span class="pill">SGR</span>':'—'}</td>
      <td>
        <div class="qty">
          <button onclick="chgQty(${i},-1)">−</button>
          <input value="${fmtCant(q)}" onfocus="this.select()" onkeydown="if(event.key==='Enter')setQty(${i},this.value)" onblur="setQty(${i},this.value)">
          <button onclick="chgQty(${i},1)">+</button>
        </div>
      </td>
      <td>${lei(p.pret)}</td>
      <td><b>${lei(total)}</b></td>
      <td><button class="red" onclick="delCart(${i})">×</button></td>
    </tr>`;
  }).join('');

  updatePay();
}

function updatePay(){
  const prod=CART.reduce((s,p)=>s+parseCant(p.cantitate)*money(p.pret),0);
  const sg=CART.reduce((s,p)=>s+sgrVal(p,p.cantitate),0);

  if($('pay-products')) $('pay-products').textContent=lei(prod);
  if($('pay-sgr')) $('pay-sgr').textContent=lei(sg);
  if($('pay-total')) $('pay-total').textContent=lei(prod+sg);
}

function setQty(i,v){
  const q=parseCant(v);
  if(q<=0) CART.splice(i,1);
  else CART[i].cantitate=q;

  saveCart();
  renderCart();
}

function chgQty(i,d){
  setQty(i,parseCant(CART[i].cantitate)+d);
}

function delCart(i){
  CART.splice(i,1);
  saveCart();
  renderCart();
}

function clearCart(){
  CART=[];
  saveCart();
  renderCart();
}

async function finalizeSale(method){
  if(!CART.length) return toast('Coș gol');

  const produseTotal=CART.reduce((s,p)=>s+parseCant(p.cantitate)*money(p.pret),0);
  const sgrTotal=CART.reduce((s,p)=>s+sgrVal(p,p.cantitate),0);

  const sale={
    id:'SALE_'+Date.now(),
    data:new Date().toISOString(),
    method,
    produseTotal,
    sgrTotal,
    total:produseTotal+sgrTotal,
    linii:CART.map(p=>({...p}))
  };

  await putMany('iesiri',[sale],1);

  toast('Vânzare salvată: '+lei(sale.total));
  clearCart();
}

/* =========================
   CODURI CASĂ
   ========================= */
function sendCartToCasa(){
  localStorage.setItem('gp_coduri_casa_v44',JSON.stringify(CART));
  toast('Coș trimis în Coduri casă');
  go('coduri');
}


/* =========================
   CODURI CASĂ - GENERATOR EAN COMPATIBIL
   ========================= */
function onlyDigits(v){
  return String(v||'').replace(/\D/g,'');
}

function eanCheckDigit(base){
  const s=onlyDigits(base);
  let sum=0;
  for(let i=s.length-1, pos=1; i>=0; i--, pos++){
    const n=Number(s[i]||0);
    sum += (pos % 2 === 1) ? n*3 : n;
  }
  return String((10 - (sum % 10)) % 10);
}

function isValidEAN8(code){
  const s=onlyDigits(code);
  if(s.length!==8) return false;
  return eanCheckDigit(s.slice(0,7))===s[7];
}

function isValidEAN13(code){
  const s=onlyDigits(code);
  if(s.length!==13) return false;
  return eanCheckDigit(s.slice(0,12))===s[12];
}

function leadingCodeFromName(product){
  // Caută codul numeric scris la începutul denumirii:
  // exemplu: "1000727 MANDARINE" => "1000727"
  const den=String(product?.denumire||'').trim();
  const m=den.match(/^(\d{3,14})(?=\s|[-–—]|$)/);
  return m ? m[1] : '';
}

function makeInternalEAN13FromCode(code){
  // Prefix intern de magazin: 29 + codul din fața denumirii / codul produsului.
  // Păstrează cifrele importante în interiorul EAN13.
  let digits=onlyDigits(code);
  if(!digits) digits='0';
  const base='29' + digits.slice(-10).padStart(10,'0');
  return base + eanCheckDigit(base);
}

function getCashierBarcode(product){
  const leading=leadingCodeFromName(product);
  const original=onlyDigits(product?.cod_bare || product?.plu || product?.id || '');

  // 1) Dacă produsul are deja EAN8/EAN13 valid, îl păstrăm exact.
  if(isValidEAN13(original)) return {value:original, format:'EAN13', generated:false, original, source:'cod_bare'};
  if(isValidEAN8(original)) return {value:original, format:'EAN8', generated:false, original, source:'cod_bare'};

  // 2) Dacă denumirea începe cu cifre, generăm codul de casă pe baza acelor cifre.
  // Exemplu: "1000727 MANDARINE" => EAN13 intern valid care conține baza 1000727.
  if(leading){
    const generated=makeInternalEAN13FromCode(leading);
    return {value:generated, format:'EAN13', generated:true, original, source:'denumire', leading};
  }

  // 3) Fallback: generăm din cod_bare / PLU existent.
  const generated=makeInternalEAN13FromCode(original);
  return {value:generated, format:'EAN13', generated:true, original, source:'cod_bare', leading:''};
}

function barcodeInfoText(info){
  if(!info) return '';
  if(info.generated && info.source==='denumire'){
    return `Cod casă generat: ${info.value} · baza: ${info.leading}`;
  }
  if(info.generated){
    return `Cod casă generat: ${info.value} · cod original: ${info.original || '—'}`;
  }
  return `Cod casă valid: ${info.value}`;
}


function getCasaItems(){
  try{
    const saved=JSON.parse(localStorage.getItem('gp_coduri_casa_v44')||'[]');
    if(Array.isArray(saved) && saved.length) return saved;
  }catch(e){}

  return CART;
}

function clearCasaItems(){
  localStorage.removeItem('gp_coduri_casa_v44');
  toast('Coduri casă golite');
  coduri();
}

function coduri(){
  const mode=localStorage.getItem('barcodeMode')||'repeat';
  const casaItems=getCasaItems();
  const items=[];

  casaItems.forEach(p=>{
    const n=mode==='repeat'?Math.max(1,Math.round(parseCant(p.cantitate))):1;
    const bc=getCashierBarcode(p);
    for(let i=1;i<=n;i++) items.push({...p,scanIndex:i,scanQty:n,cashierBarcode:bc});
  });

  const generatedCount=items.filter(x=>x.cashierBarcode?.generated).length;

  $('main').innerHTML=`
    <h1>Coduri scanabile pentru casa de marcat</h1>

    <div class="card no-print">
      <div class="row">
        <button onclick="go('cos')">Înapoi la coș</button>
        <button onclick="window.print()">Printează coduri</button>
        <button class="secondary" onclick="localStorage.setItem('barcodeMode','repeat');coduri()">Repetă după cantitate</button>
        <button class="secondary" onclick="localStorage.setItem('barcodeMode','once');coduri()">Un cod/produs</button>
        <button class="red" onclick="clearCasaItems()">Golește coduri casă</button>
      </div>
      <div class="notice ${generatedCount?'warn':'good'}">
        ${generatedCount
          ? `Atenție: ${generatedCount} coduri au fost generate în EAN13 valid, folosind prioritar cifrele din fața denumirii produsului. Pentru vânzare, codul generat trebuie asociat în casa de marcat cu produsul respectiv.`
          : `Toate codurile sunt EAN valide.`}
      </div>
    </div>

    <div class="barcode-grid">
      ${items.length?items.map((p,i)=>{
        const bc=p.cashierBarcode;
        return `
        <div class="label-card cashier-label">
          <b>${esc(p.denumire)}</b>
          <p class="cashier-info">${esc(barcodeInfoText(bc))}</p>
          <div class="cashier-barcode-wrap"><svg id="bc-${i}"></svg></div>
          <p>${mode==='repeat'?`Bucată ${p.scanIndex} din ${p.scanQty}`:`Cantitate: ${fmtCant(p.cantitate)}`}</p>
        </div>`;
      }).join(''):'<div class="card">Nu ai coduri trimise din coș.</div>'}
    </div>`;

  setTimeout(()=>items.forEach((p,i)=>{
    try{
      const bc=p.cashierBarcode;
      JsBarcode(`#bc-${i}`,bc.value,{
        format:bc.format,
        displayValue:true,
        height:95,
        width:2.8,
        fontSize:20,
        margin:18,
        background:'#ffffff',
        lineColor:'#000000'
      });
    }catch(e){
      console.error('Nu pot genera cod casă', p, e);
      try{
        JsBarcode(`#bc-${i}`,String(p.cashierBarcode?.value||p.cod_bare||p.plu||''),{
          format:'CODE128',
          displayValue:true,
          height:95,
          width:2.8,
          fontSize:20,
          margin:18,
          background:'#ffffff',
          lineColor:'#000000'
        });
      }catch(err){}
    }
  }),80);
}

/* =========================
   VERIFICARE PREȚ
   ========================= */
function verificare(){
  $('main').innerHTML=`
    <h1>Verificare preț</h1>

    <div class="card">
      <div style="position:relative">
        <input class="input" id="ver-q" placeholder="Cod bare / PLU / denumire" oninput="showSuggest('ver-q','pickVerify')" onkeydown="if(event.key==='Enter')verifyInput('ver-q')">
        <div class="suggest hide" id="ver-q-s"></div>
      </div>

      <div class="row">
        <button onclick="verifyInput('ver-q')">Verifică manual</button>
        <button class="secondary" onclick="openCameraScanner('ver-q','verifyInput')">📷 Scanează</button>
        <button class="secondary" onclick="$('ver-result').innerHTML='';$('ver-q').value=''">Golește</button>
      </div>
    </div>

    <div id="ver-result"></div>`;
}

window.pickVerify=async id=>{
  const p=await getProdById(id);
  showVerify(p);
  document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'));
};

async function verifyInput(id){
  const p=await byCode($(id).value);

  if(!p){
    $('ver-result').innerHTML='<div class="notice bad">Produs inexistent</div>';
    return;
  }

  showVerify(p);
}

function showVerify(p){
  $('ver-result').innerHTML=`
    <div class="card">
      <h2>${esc(p.cod_bare)} ${esc(p.denumire)}</h2>
      <div class="stat">${lei(p.pret)}</div>
      <p>Cod: ${esc(p.cod_bare)} · PLU: ${esc(p.plu||'—')} · Stoc: ${fmtCant(p.stoc||0)}</p>
    </div>`;
}

/* =========================
   PREȚURI SCHIMBATE
   ========================= */
function preturi(){
  $('main').innerHTML=`
    <h1>Prețuri schimbate</h1>

    <div class="card row">
      <button onclick="exportPreturiExcel()">Export Excel</button>
      <button class="red" onclick="clearPreturiSchimbate()">Golește total</button>
      <button class="orange" onclick="sendPreturiToEtichete()">Trimite în etichete preț</button>
    </div>

    <div class="card tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Cod</th>
            <th>PLU</th>
            <th>Denumire</th>
            <th>Preț vechi</th>
            <th>Preț nou</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody id="preturi-body"></tbody>
      </table>
    </div>`;

  renderPreturi();
}

function renderPreturi(){
  const tb=$('preturi-body');
  if(!tb) return;

  const changes=(PRICE_CHANGES||[]).filter(x=>hasLeadingProductDigits(x) && !samePriceCents(x.pret_vechi,x.pret_nou));

  tb.innerHTML=changes.length?changes.map(x=>`
    <tr>
      <td>${esc(x.cod_bare||'')}</td>
      <td>${esc(x.plu||'')}</td>
      <td>${esc(x.denumire||'')}</td>
      <td>${lei(x.pret_vechi)}</td>
      <td>${lei(x.pret_nou)}</td>
      <td>${esc(x.data||'')}</td>
    </tr>`).join(''):'<tr><td colspan="6" class="muted">Nu există prețuri schimbate.</td></tr>';
}

function clearPreturiSchimbate(){
  if(confirm('Golești toate prețurile schimbate?')){
    PRICE_CHANGES=[];
    renderPreturi();
  }
}

function sendPreturiToEtichete(){
  (PRICE_CHANGES||[])
    .filter(x=>hasLeadingProductDigits(x) && !samePriceCents(x.pret_vechi,x.pret_nou))
    .forEach(x=>addLabelProduct({
      id:x.id,
      cod_bare:x.cod_bare,
      plu:x.plu,
      denumire:x.denumire,
      pret:x.pret_nou
    },'preturi schimbate'));

  go('etichete');
}

/* =========================
   INVENTAR
   ========================= */
function inventar(){
  $('main').innerHTML=`
    <h1>Inventar</h1>

    <div class="grid2">
      <div class="card">
        ${productSearchHtml('inv-q','pickInv')}
        <div class="row">
          <button onclick="addInvByInput('inv-q')">Adaugă</button>
          <button class="secondary" onclick="openCameraScanner('inv-q','addInvByInput')">📷 Scanează</button>
          <button class="secondary" onclick="exportInvExcel()">Export Excel</button>
          <button class="secondary" onclick="exportInvWord()">Export Word</button>
          <button class="red" onclick="clearInventarLinii()">Golește inventar</button>
        </div>
      </div>
    </div>

    <div class="card" id="inv-summary"></div>

    <div class="card tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Cod</th>
            <th>PLU</th>
            <th>Denumire</th>
            <th>Preț</th>
            <th>Stoc</th>
            <th>Cantitate</th>
            <th>Dif.</th>
            <th>Valoare</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="inv-body"></tbody>
      </table>
    </div>`;

  renderInvLines();
}

window.pickInv=async id=>{
  const p=await getProdById(id);
  addInvLine(p);
  document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'));
};

async function addInvByInput(id){
  const p=await byCode($(id).value);
  if(!p) return toast('Produs inexistent');

  addInvLine(p);
  $(id).value='';
}

function addInvLine(p){
  let e=INV_LINES.find(x=>x.id===p.id);

  if(e) e.cantitate=parseCant(e.cantitate)+1;
  else INV_LINES.push({...p,cantitate:1,pret:money(p.pret)});

  renderInvLines();
}

function renderInvLines(){
  const tb=$('inv-body');
  if(!tb) return;

  let totalCant=0,totalVal=0,totalDifCant=0,totalDifVal=0;

  INV_LINES.forEach(l=>{
    const cant=parseCant(l.cantitate);
    const stoc=parseCant(l.stoc||0);
    const pret=money(l.pret);

    totalCant+=cant;
    totalVal+=cant*pret;
    totalDifCant+=cant-stoc;
    totalDifVal+=(cant-stoc)*pret;
  });

  $('inv-summary').innerHTML=`
    <div class="row">
      <span class="pill">Total cantitativ: ${fmtCant(totalCant)}</span>
      <span class="pill">Total valoric: ${lei(totalVal)}</span>
      <span class="pill">Diferență: ${fmtCant(totalDifCant)}</span>
      <span class="pill">Dif. valorică: ${lei(totalDifVal)}</span>
    </div>`;

  tb.innerHTML=INV_LINES.length?INV_LINES.map((l,i)=>{
    const cant=parseCant(l.cantitate);
    const stoc=parseCant(l.stoc||0);
    const pret=money(l.pret);
    const dif=cant-stoc;

    return `<tr>
      <td>${esc(l.cod_bare)}</td>
      <td>${esc(l.plu)}</td>
      <td>${esc(l.denumire)}</td>
      <td>${lei(pret)}</td>
      <td>${fmtCant(stoc)}</td>
      <td>
        <input class="input" style="max-width:140px" value="${fmtCant(cant)}" onfocus="this.select()" onkeydown="if(event.key==='Enter')setInvQty(${i},this.value)" onblur="setInvQty(${i},this.value)">
      </td>
      <td>${fmtCant(dif)}</td>
      <td>${lei(cant*pret)}</td>
      <td><button class="red" onclick="INV_LINES.splice(${i},1);renderInvLines()">×</button></td>
    </tr>`;
  }).join(''):'<tr><td colspan="10" class="muted">Nu ai linii inventar.</td></tr>';
}

function setInvQty(i,v){
  if(!INV_LINES[i]) return;

  const q=parseCant(v);
  if(q<0) return;

  INV_LINES[i].cantitate=q;
  renderInvLines();
}

function clearInventarLinii(){
  if(confirm('Golești toate liniile din inventar?')){
    INV_LINES=[];
    renderInvLines();
  }
}

function invRows(){
  return INV_LINES.map(l=>{
    const cant=parseCant(l.cantitate);
    const stoc=parseCant(l.stoc||0);
    const pret=money(l.pret);
    const dif=cant-stoc;

    return {
      cod:l.cod_bare,
      plu:l.plu,
      denumire:l.denumire,
      pret,
      stoc_scriptic:stoc,
      cantitate_inventariata:cant,
      diferenta:dif,
      valoare_inventar:cant*pret,
      diferenta_valorica:dif*pret
    };
  });
}

function exportInvExcel(){
  downloadExcel('inventar.xlsx',invRows(),'Inventar');
}

function exportInvWord(){
  downloadWord('inventar.doc','Inventar',rowsTable(invRows()));
}

/* =========================
   INTRĂRI
   ========================= */

function setMonthRange(prefix){
  const monthEl=$(prefix+'-luna');
  const startEl=$(prefix+'-data-start');
  const endEl=$(prefix+'-data-end');
  if(!monthEl || !startEl || !endEl || !monthEl.value){
    toast('Alege întâi luna.');
    return;
  }
  const [y,m]=monthEl.value.split('-').map(Number);
  const start=new Date(y,m-1,0);
  const end=new Date(y,m,1);
  const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  startEl.value=fmt(start);
  endEl.value=fmt(end);
  toast('Interval setat: '+startEl.value+' - '+endEl.value);
}

function getIntrariFilters(){
  return {
    q:$('intrari-search')?.value||'',
    furnizor:$('intrari-furnizor')?.value||'',
    zi:$('intrari-data')?.value||'',
    dataStart:$('intrari-data-start')?.value||'',
    dataEnd:$('intrari-data-end')?.value||'',
    luna:$('intrari-luna')?.value||'',
    an:$('intrari-an')?.value||''
  };
}

function intrareMatchesFilters(x,f){
  const data=String(x.data||'').slice(0,10);
  const an=data.slice(0,4);
  const luna=data.slice(0,7);

  if(f.zi && data!==f.zi) return false;
  if(f.dataStart && data<f.dataStart) return false;
  if(f.dataEnd && data>f.dataEnd) return false;
  if(f.luna && luna!==f.luna) return false;
  if(f.an && an!==String(f.an)) return false;

  const furnizorQ=String(f.furnizor||'').trim();
  if(furnizorQ){
    const fw=norm(furnizorQ).split(/\s+/).filter(Boolean);
    const fhay=norm(x.furnizor||'');
    if(fw.length && !fw.every(w=>fhay.includes(w))) return false;
  }

  const q=String(f.q||'').trim();
  if(!q) return true;

  const code=cleanCode(q);
  const nq=norm(q);
  const words=nq.split(/\s+/).filter(Boolean);

  const hay=`${norm(x.denumire||'')} ${norm(x.nr||'')} ${norm(x.furnizor||'')} ${String(x.cod_bare||'')} ${String(x.plu||'')}`;

  return (code && (String(x.cod_bare||'').includes(code)||String(x.plu||'').includes(code))) ||
         (words.length && words.every(w=>hay.includes(w)));
}

function sortIntrariNewestFirst(rows){
  return rows.sort((a,b)=>String(b.data||'').localeCompare(String(a.data||'')) || String(b.nr||'').localeCompare(String(a.nr||'')));
}

async function searchIntrariRows(filters=null,limit=150000){
  const f=filters||getIntrariFilters();
  const all=await getAll('intrari');
  return sortIntrariNewestFirst(all.filter(x=>intrareMatchesFilters(x,f))).slice(0,limit);
}

async function renderIntrariView(filters=null){
  const rows=await searchIntrariRows(filters||getIntrariFilters(),150000);
  const total=await countStore('intrari');

  let cantTotal=0,valTotal=0;

  rows.forEach(x=>{
    cantTotal+=money(x.cantitate);
    valTotal+=money(x.valoare);
  });

  $('intrari-results').innerHTML=`
    <div class="card">
      <h3>Totaluri rezultate filtrate</h3>
      <p>Rânduri găsite/afișate: <b>${rows.length}</b> din ${total}</p>
      <p>Cantitate totală: <b>${fmtCant(cantTotal)}</b></p>
      <p>Valoare totală: <b>${lei(valTotal)}</b></p>
      <button class="secondary" onclick="exportIntrariCautare()">Export rezultate filtrate Excel</button>
    </div>

    <div class="card tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Document</th>
            <th>Cod</th>
            <th>PLU</th>
            <th>Produs</th>
            <th>Cant.</th>
            <th>Preț</th>
            <th>Preț cu TVA MAMA</th>
            <th>TVA %</th>
            <th>Valoare</th>
            <th>Furnizor</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(x=>`
            <tr>
              <td>${esc(x.data)}</td>
              <td>${esc(x.nr)}</td>
              <td>${esc(x.cod_bare)}</td>
              <td>${esc(x.plu)}</td>
              <td>${esc(x.denumire)}</td>
              <td>${fmtCant(x.cantitate)}</td>
              <td>${lei(x.pret)}</td>
              <td>${x.pret_cu_tva_mama?lei(x.pret_cu_tva_mama):''}</td>
              <td>${esc(x.tva_procent||'')}</td>
              <td>${lei(x.valoare)}</td>
              <td>${esc(x.furnizor||'')}</td>
            </tr>`).join('') || '<tr><td colspan="11" class="muted">Nu există rezultate.</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

async function intrari(){
  const total=await countStore('intrari');

  $('main').innerHTML=`
    <h1>Intrări marfă</h1>

    <div class="card row">
      <button onclick="go('dashboard')">Import / dashboard</button>
      <button onclick="exportIntrariExcel()">Export Excel toate</button>
      <span class="pill">${total} rânduri salvate</span>
    </div>

    <div class="card">
      <h3>🔍 Verificare intrări produs</h3>

      <div class="row">
        <input class="input" id="intrari-search" style="max-width:420px" placeholder="Cod bare / PLU / denumire / document" onkeydown="if(event.key==='Enter')cautaIntrari()">
        <input class="input" id="intrari-furnizor" style="max-width:260px" placeholder="Nume / CUI furnizor" onkeydown="if(event.key==='Enter')cautaIntrari()">
        <input class="input" id="intrari-data" type="date" title="Data exactă intrare">
        <input class="input" id="intrari-data-start" type="date" title="De la data">
        <input class="input" id="intrari-data-end" type="date" title="Până la data">
        <input class="input" id="intrari-luna" type="month" title="Luna intrării">
        <input class="input" id="intrari-an" type="number" min="2000" max="2100" placeholder="An" style="max-width:120px">
        <button class="secondary" onclick="setMonthRange('intrari')">Setează interval lună</button>
        <button class="secondary" onclick="openCameraScanner('intrari-search','cautaIntrari')">📷 Scanează cu camera</button>
        <button onclick="cautaIntrari()">Caută în intrări</button>
        <button class="secondary" onclick="$('intrari-search').value='';$('intrari-furnizor').value='';$('intrari-data').value='';$('intrari-data-start').value='';$('intrari-data-end').value='';$('intrari-luna').value='';$('intrari-an').value='';renderIntrariView({q:'',furnizor:'',zi:'',dataStart:'',dataEnd:'',luna:'',an:''})">Golește</button>
      </div>
    </div>

    <div id="intrari-results"><div class="notice">Se încarcă...</div></div>`;

  await renderIntrariView({q:'',furnizor:'',zi:'',dataStart:'',dataEnd:'',luna:'',an:''});
}

async function cautaIntrari(){
  await renderIntrariView(getIntrariFilters());
}
window.cautaIntrari=cautaIntrari;

async function exportIntrariCautare(){
  const rows=await searchIntrariRows(getIntrariFilters(),1000000);
  downloadExcel('intrari_filtrate.xlsx',rows,'Intrari filtrate');
}

async function exportIntrariExcel(){
  const rows=sortIntrariNewestFirst(await getAll('intrari'));
  downloadExcel('intrari.xlsx',rows,'Intrari');
}


/* =========================
   RECEPȚIE MARFĂ / FIȘĂ TRANSPORT - v49
   ========================= */

function makeUnknownProductFromCode(code){
  const c=cleanCode(code) || String(code||'').trim();
  return {
    id:'manual-'+Date.now()+'-'+Math.random().toString(16).slice(2),
    cod_bare:c,
    plu:'',
    denumire:'',
    pret:0,
    pret_cu_tva_mama:0,
    tva_procent:'',
    cantitate:1,
    manual:true
  };
}

function addProductToReceptie(p){
  if(!p) return toast('Produs inexistent');

  REC_LINES.push({
    id:p.id || ('manual-'+Date.now()),
    cod_bare:p.cod_bare || '',
    plu:p.plu || '',
    denumire:p.denumire || '',
    pret:money(p.pret),
    pret_cu_tva_mama:money(p.pret_cu_tva_mama || p["pret cu tva"] || p.pret),
    tva_procent:p.tva_procent || '',
    cantitate:p.cantitate || 1,
    manual:!!p.manual
  });

  const q=$('rec-q');
  if(q) q.value='';
  document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'));
  renderReceptieLines();
}
window.addProductToReceptie=addProductToReceptie;

async function addRecByInput(inputId='rec-q'){
  const q=($(inputId)?.value||'').trim();
  if(!q) return;
  const p=await byCode(q);
  if(!p){
    addProductToReceptie(makeUnknownProductFromCode(q));
    toast('Cod nou adăugat manual. Completează denumirea, cantitatea și prețul când ai timp.');
    return;
  }
  addProductToReceptie(p);
}
window.addRecByInput=addRecByInput;

window.pickReceptie=async function(id){
  const p=await getProdById(id);
  addProductToReceptie(p);
};


function renderReceptieLines(){
  const body=$('rec-body'); if(!body) return;
  let total=0;
  body.innerHTML=(REC_LINES||[]).map((x,i)=>{
    const cant=parseCant(x.cantitate||1);
    const pret=money(x.pret);
    const val=cant*pret;
    total+=val;
    return `<tr>
      <td><input class="input" value="${esc(x.cod_bare||'')}" onchange="REC_LINES[${i}].cod_bare=this.value"></td>
      <td><input class="input" value="${esc(x.plu||'')}" onchange="REC_LINES[${i}].plu=this.value" style="min-width:80px"></td>
      <td><input class="input" value="${esc(x.denumire||'')}" placeholder="Denumire produs" onchange="REC_LINES[${i}].denumire=this.value"></td>
      <td><input class="input" type="number" step="0.001" value="${cant}" onchange="REC_LINES[${i}].cantitate=this.value;renderReceptieLines()"></td>
      <td><input class="input" type="number" step="0.01" value="${pret}" onchange="REC_LINES[${i}].pret=this.value;renderReceptieLines()"></td>
      <td><input class="input" type="number" step="0.01" value="${money(x.pret_cu_tva_mama)}" onchange="REC_LINES[${i}].pret_cu_tva_mama=this.value;renderReceptieLines()"></td>
      <td><b>${lei(val)}</b></td>
      <td><button class="red" onclick="REC_LINES.splice(${i},1);renderReceptieLines()">×</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="8" class="muted">Nu ai produse în recepție.</td></tr>';
  const t=$('rec-total'); if(t) t.textContent='Total recepție: '+lei(total);
}


function clearReceptie(){
  if(!confirm('Golești toate produsele din recepția curentă?')) return;
  REC_LINES=[];
  renderReceptieLines();
  const q=$('rec-q'); if(q) q.value='';
}
window.clearReceptie=clearReceptie;

function clearTransport(){
  if(!confirm('Golești toate produsele din fișa de transport curentă?')) return;
  TRANS_LINES=[];
  renderTransportLines();
  const q=$('trans-q'); if(q) q.value='';
}
window.clearTransport=clearTransport;


async function saveReceptieLocal(){
  if(!REC_LINES.length) return toast('Nu ai produse în recepție.');
  const data=new Date().toISOString().slice(0,10);
  const nr=$('rec-doc')?.value||('REC-'+new Date().toLocaleString('ro-RO'));
  const furnizor=$('rec-furnizor')?.value||'';
  const rows=REC_LINES.map((x,i)=>({
    id:['REC',Date.now(),i,x.cod_bare,x.plu].join('|'),
    data,nr,cod_bare:x.cod_bare,plu:x.plu,denumire:x.denumire,
    cantitate:parseCant(x.cantitate),pret:money(x.pret),
    pret_cu_tva_mama:money(x.pret_cu_tva_mama),
    tva_procent:x.tva_procent||'',
    valoare:parseCant(x.cantitate)*money(x.pret),tva:0,furnizor
  }));
  await putMany('intrari',rows);
  await loadCounts();
  toast('Recepție salvată în intrări.');
}
window.saveReceptieLocal=saveReceptieLocal;

function exportReceptieExcel(){
  downloadExcel('receptie_marfa.xlsx',REC_LINES.map(x=>({
    furnizor:$('rec-furnizor')?.value||'',document:$('rec-doc')?.value||'',
    cod_bare:x.cod_bare,plu:x.plu,denumire:x.denumire,cantitate:parseCant(x.cantitate),pret:money(x.pret),pret_cu_tva_mama:money(x.pret_cu_tva_mama),valoare:parseCant(x.cantitate)*money(x.pret)
  })),'Receptie');
}
window.exportReceptieExcel=exportReceptieExcel;

function receptie(){
  $('main').innerHTML=`
    <h1>Recepție marfă</h1>
    <div class="card">
      <div class="grid2">
        <input class="input" id="rec-furnizor" placeholder="Furnizor">
        <input class="input" id="rec-doc" placeholder="Nr. document / factură">
      </div>
      <div class="row">
        <div style="position:relative;max-width:620px;flex:1">
          <input class="input" id="rec-q" style="max-width:100%" placeholder="Cod bare / PLU / denumire" oninput="showSuggest('rec-q','pickReceptie')" onkeydown="if(event.key==='Enter')addRecByInput('rec-q')">
          <div class="suggest hide" id="rec-q-s"></div>
        </div>
        <button class="secondary" onclick="openCameraScanner('rec-q','addRecByInput')">📷 Scanează cu camera</button>
        <button onclick="addRecByInput('rec-q')">Adaugă produs</button>
        <button class="green" onclick="saveReceptieLocal()">Salvează în intrări</button>
        <button class="secondary" onclick="exportReceptieExcel()">Export Excel</button>
        <button class="red" onclick="clearReceptie()">Golește recepția</button>
      </div>
      <p id="rec-total" class="pill">Total recepție: 0,00 lei</p>
    </div>
    <div class="card tbl-wrap">
      <table><thead><tr><th>Cod</th><th>PLU</th><th>Produs</th><th>Cant.</th><th>Preț</th><th>Preț TVA MAMA</th><th>Valoare</th><th></th></tr></thead><tbody id="rec-body"></tbody></table>
    </div>`;
  renderReceptieLines();
}

function addProductToTransport(p){
  if(!p) return toast('Produs inexistent');

  TRANS_LINES.push({
    id:p.id || ('manual-'+Date.now()),
    cod_bare:p.cod_bare || '',
    plu:p.plu || '',
    denumire:p.denumire || '',
    pret:money(p.pret),
    cantitate:p.cantitate || 1,
    manual:!!p.manual
  });

  const q=$('trans-q');
  if(q) q.value='';
  document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'));
  renderTransportLines();
}
window.addProductToTransport=addProductToTransport;

async function addTransportByInput(inputId='trans-q'){
  const q=($(inputId)?.value||'').trim();
  if(!q) return;
  const p=await byCode(q);
  if(!p){
    addProductToTransport(makeUnknownProductFromCode(q));
    toast('Cod nou adăugat manual. Completează denumirea, cantitatea și prețul când ai timp.');
    return;
  }
  addProductToTransport(p);
}
window.addTransportByInput=addTransportByInput;

window.pickTransport=async function(id){
  const p=await getProdById(id);
  addProductToTransport(p);
};


function renderTransportLines(){
  const body=$('trans-body'); if(!body) return;
  let total=0;
  body.innerHTML=(TRANS_LINES||[]).map((x,i)=>{
    const cant=parseCant(x.cantitate||1); const val=cant*money(x.pret); total+=val;
    return `<tr>
      <td><input class="input" value="${esc(x.cod_bare||'')}" onchange="TRANS_LINES[${i}].cod_bare=this.value"></td>
      <td><input class="input" value="${esc(x.plu||'')}" onchange="TRANS_LINES[${i}].plu=this.value" style="min-width:80px"></td>
      <td><input class="input" value="${esc(x.denumire||'')}" placeholder="Denumire produs" onchange="TRANS_LINES[${i}].denumire=this.value"></td>
      <td><input class="input" type="number" step="0.001" value="${cant}" onchange="TRANS_LINES[${i}].cantitate=this.value;renderTransportLines()"></td>
      <td><input class="input" type="number" step="0.01" value="${money(x.pret)}" onchange="TRANS_LINES[${i}].pret=this.value;renderTransportLines()"></td>
      <td><b>${lei(val)}</b></td>
      <td><button class="red" onclick="TRANS_LINES.splice(${i},1);renderTransportLines()">×</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">Nu ai produse în fișa de transport.</td></tr>';
  const t=$('trans-total'); if(t) t.textContent='Total transport: '+lei(total);
}

function exportTransportExcel(){
  downloadExcel('fisa_transport.xlsx',TRANS_LINES.map(x=>({
    sursa:$('trans-src')?.value||'',destinatie:$('trans-dst')?.value||'',nr_transport:$('trans-nr')?.value||'',
    cod_bare:x.cod_bare,plu:x.plu,denumire:x.denumire,cantitate:parseCant(x.cantitate),pret:money(x.pret),valoare:parseCant(x.cantitate)*money(x.pret)
  })),'Transport');
}
window.exportTransportExcel=exportTransportExcel;

function transport(){
  $('main').innerHTML=`
    <h1>Fișă de transport</h1>
    <div class="card">
      <div class="grid2">
        <input class="input" id="trans-src" placeholder="Magazin sursă">
        <input class="input" id="trans-dst" placeholder="Magazin destinație">
        <input class="input" id="trans-nr" placeholder="Nr. transport">
      </div>
      <div class="row">
        <div style="position:relative;max-width:620px;flex:1">
          <input class="input" id="trans-q" style="max-width:100%" placeholder="Cod bare / PLU / denumire" oninput="showSuggest('trans-q','pickTransport')" onkeydown="if(event.key==='Enter')addTransportByInput('trans-q')">
          <div class="suggest hide" id="trans-q-s"></div>
        </div>
        <button class="secondary" onclick="openCameraScanner('trans-q','addTransportByInput')">📷 Scanează cu camera</button>
        <button onclick="addTransportByInput('trans-q')">Adaugă produs</button>
        <button class="secondary" onclick="exportTransportExcel()">Export Excel</button>
        <button class="red" onclick="clearTransport()">Golește fișa</button>
      </div>
      <p id="trans-total" class="pill">Total transport: 0,00 lei</p>
    </div>
    <div class="card tbl-wrap">
      <table><thead><tr><th>Cod</th><th>PLU</th><th>Produs</th><th>Cant.</th><th>Preț</th><th>Valoare</th><th></th></tr></thead><tbody id="trans-body"></tbody></table>
    </div>`;
  renderTransportLines();
}

/* =========================
   IEȘIRI
   ========================= */
function getIesiriFilters(){
  return {
    q:$('iesiri-search')?.value||'',
    furnizor:$('iesiri-furnizor')?.value||'',
    zi:$('iesiri-data')?.value||'',
    dataStart:$('iesiri-data-start')?.value||'',
    dataEnd:$('iesiri-data-end')?.value||'',
    luna:$('iesiri-luna')?.value||'',
    an:$('iesiri-an')?.value||''
  };
}

function iesireDateOnly(x){
  const d=x?.data;
  if(!d) return '';
  if(/^\d{4}-\d{2}-\d{2}/.test(String(d))) return String(d).slice(0,10);
  const dt=new Date(d);
  if(isNaN(dt)) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

function iesireMatchesFilters(x,f){
  const data=iesireDateOnly(x);
  const an=data.slice(0,4);
  const luna=data.slice(0,7);

  if(f.zi && data!==f.zi) return false;
  if(f.dataStart && data<f.dataStart) return false;
  if(f.dataEnd && data>f.dataEnd) return false;
  if(f.luna && luna!==f.luna) return false;
  if(f.an && an!==String(f.an)) return false;

  const linii=x.linii||[];

  const furnizorQ=String(f.furnizor||'').trim();
  if(furnizorQ){
    const fw=norm(furnizorQ).split(/\s+/).filter(Boolean);
    const fhay=norm(linii.map(l=>l.furnizor||l.supplier||'').join(' '));
    if(fw.length && !fw.every(w=>fhay.includes(w))) return false;
  }

  const q=String(f.q||'').trim();
  if(!q) return true;

  const code=cleanCode(q);
  const nq=norm(q);
  const words=nq.split(/\s+/).filter(Boolean);
  const hay=`${norm(x.method||'')} ${norm(x.furnizor||'')} ${linii.map(l=>`${norm(l.denumire||'')} ${norm(l.furnizor||'')} ${String(l.cod_bare||'')} ${String(l.plu||'')}`).join(' ')}`;

  return (code && hay.includes(code)) || (words.length && words.every(w=>hay.includes(w)));
}

async function searchIesiriRows(filters=null,limit=150000){
  const f=filters||getIesiriFilters();
  const all=await getAll('iesiri');
  return sortIntrariNewestFirst(all.filter(x=>iesireMatchesFilters(x,f))).slice(0,limit);
}

async function renderIesiriView(filters=null){
  const rows=await searchIesiriRows(filters||getIesiriFilters(),150000);
  const total=rows.reduce((s,x)=>s+money(x.total),0);

  $('iesiri-results').innerHTML=`
    <div class="card">
      <p>Vânzări găsite/afișate: <b>${rows.length}</b></p>
      <p>Total: <b>${lei(total)}</b></p>
      <button class="secondary" onclick="exportIesiriExcel()">Export rezultate filtrate Excel</button>
    </div>

    <div class="card tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Metodă</th>
            <th>Furnizor</th>
            <th>Produse</th>
            <th>SGR</th>
            <th>Total</th>
            <th>Linii</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(x=>{
            const furnizori=[...new Set((x.linii||[]).map(l=>l.furnizor||l.supplier||'').filter(Boolean))].join('<br>');
            return `
            <tr>
              <td>${new Date(x.data).toLocaleString('ro-RO')}</td>
              <td>${esc(x.method)}</td>
              <td>${furnizori||esc(x.furnizor||'')}</td>
              <td>${lei(x.produseTotal)}</td>
              <td>${lei(x.sgrTotal)}</td>
              <td><b>${lei(x.total)}</b></td>
              <td>${(x.linii||[]).map(l=>`${esc(l.denumire)} × ${fmtCant(l.cantitate)}`).join('<br>')}</td>
            </tr>`;
          }).join('') || '<tr><td colspan="7" class="muted">Nu există vânzări salvate.</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

async function iesiri(){
  const totalAll=await countStore('iesiri');

  $('main').innerHTML=`
    <h1>Ieșiri / vânzări</h1>

    <div class="card">
      <div class="row">
        <input class="input" id="iesiri-search" style="max-width:420px" placeholder="Cod / PLU / denumire / metodă" onkeydown="if(event.key==='Enter')cautaIesiri()">
        <input class="input" id="iesiri-furnizor" style="max-width:260px" placeholder="Nume / CUI furnizor" onkeydown="if(event.key==='Enter')cautaIesiri()">
        <input class="input" id="iesiri-data" type="date" title="Data exactă ieșire">
        <input class="input" id="iesiri-data-start" type="date" title="De la data">
        <input class="input" id="iesiri-data-end" type="date" title="Până la data">
        <input class="input" id="iesiri-luna" type="month" title="Luna ieșirii">
        <input class="input" id="iesiri-an" type="number" min="2000" max="2100" placeholder="An" style="max-width:120px">
        <button class="secondary" onclick="setMonthRange('iesiri')">Setează interval lună</button>
        <button onclick="cautaIesiri()">Caută în ieșiri</button>
        <button class="secondary" onclick="$('iesiri-search').value='';$('iesiri-furnizor').value='';$('iesiri-data').value='';$('iesiri-data-start').value='';$('iesiri-data-end').value='';$('iesiri-luna').value='';$('iesiri-an').value='';renderIesiriView({q:'',furnizor:'',zi:'',dataStart:'',dataEnd:'',luna:'',an:''})">Golește</button>
      </div>
      <span class="pill">${totalAll} vânzări salvate</span>
    </div>

    <div id="iesiri-results"><div class="notice">Se încarcă...</div></div>`;

  await renderIesiriView({q:'',furnizor:'',zi:'',dataStart:'',dataEnd:'',luna:'',an:''});
}

async function cautaIesiri(){
  await renderIesiriView(getIesiriFilters());
}
window.cautaIesiri=cautaIesiri;

async function exportIesiriExcel(){
  const rows=await searchIesiriRows(getIesiriFilters(),1000000);
  const flat=[];

  rows.forEach(v=>(v.linii||[]).forEach(l=>flat.push({
    data:new Date(v.data).toLocaleString('ro-RO'),
    metoda:v.method,
    furnizor:l.furnizor||l.supplier||v.furnizor||'',
    cod:l.cod_bare,
    plu:l.plu,
    denumire:l.denumire,
    cantitate:parseCant(l.cantitate),
    pret:money(l.pret),
    total_linie:parseCant(l.cantitate)*money(l.pret),
    total_bon:v.total
  })));

  downloadExcel('iesiri_filtrate.xlsx',flat,'Iesiri');
}

/* =========================
   ETICHETE
   ========================= */
function hasSGR(p){
  return norm(p?.denumire||'').includes('sgr');
}

function labelBasePrice(p){
  return money(p?.pret);
}

function labelTotalPrice(p){
  const pret=money(p?.pret);
  return hasSGR(p)?money(pret+0.50):pret;
}

function leiParts(n){
  const s=(Number(n)||0).toFixed(2).replace('.',',');
  const [leiP,baniP]=s.split(',');
  return {lei:leiP,bani:baniP};
}

function addLabelProduct(p,source='manual'){
  if(!p) return;

  const key=p.id||p.cod_bare||p.plu||p.denumire;
  let e=LABEL_LINES.find(x=>x.key===key);

  if(e) e.cantitate=parseCant(e.cantitate||1)+1;
  else LABEL_LINES.push({
    key,
    id:p.id,
    cod_bare:p.cod_bare,
    plu:p.plu,
    denumire:p.denumire,
    pret:p.pret,
    cantitate:1,
    source
  });

  renderLabels();
}

async function addLabelByInput(id){
  const p=await byCode($(id).value);
  if(!p) return toast('Produs inexistent');

  addLabelProduct(p);
  $(id).value='';
}

function clearLabels(){
  LABEL_LINES=[];
  renderLabels();
}

function labelCardHtml(p,i){
  const base=leiParts(labelBasePrice(p));
  const total=lei(labelTotalPrice(p));
  const sgr=hasSGR(p);

  return `<div class="price-label-24 shelf-label-preview">
    <button class="label-x no-print" onclick="LABEL_LINES.splice(${i},1);renderLabels()">×</button>
    <div class="label-name label-name-full">${esc(p.denumire||'')}</div>
    <div class="label-line"></div>
    <div class="label-price shelf-price">
      <span class="label-lei">${base.lei}</span>
      <span class="label-bani">,${base.bani}</span>
      <span class="label-currency">LEI</span>
    </div>
    <div class="label-bottom label-bottom-sgr shelf-sgr-line">
      ${sgr?`<span class="label-total-sgr">TOTAL: ${total}<br><small>cu SGR</small></span>`:'<span>BUC</span>'}
      ${sgr?`<span class="label-sgr">+ 0.50 BANI SGR</span>`:'<span></span>'}
    </div>
  </div>`;
}

function labelExportSettings(){
  const readNum=(id,def)=>{
    const v=Number($(id)?.value);
    return Number.isFinite(v)&&v>0?v:def;
  };
  return {
    namePt:readNum('label-font-name',8.5),
    pricePt:readNum('label-font-price',27)
  };
}

function etichete(){
  $('main').innerHTML=`
    <h1>Etichete preț</h1>

    <div class="card">
      <h3>Adaugă produs pentru etichetă</h3>

      <div style="position:relative">
        <input class="input" id="label-q" placeholder="Scanează / cod bare / PLU / denumire" oninput="showSuggest('label-q','pickLabel')" onkeydown="if(event.key==='Enter')addLabelByInput('label-q')">
        <div class="suggest hide" id="label-q-s"></div>
      </div>

      <div class="row">
        <button onclick="addLabelByInput('label-q')">Adaugă etichetă</button>
        <button class="secondary" onclick="openCameraScanner('label-q','addLabelByInput')">📷 Scanează</button>
        <label class="row">Copii/etichetă:
          <input class="input" id="label-copies" type="number" min="1" step="1" value="1" style="max-width:90px">
        </label>
        <label class="row">Text denumire:
          <input class="input" id="label-font-name" type="number" min="6" max="14" step="0.5" value="8.5" style="max-width:90px"> pt
        </label>
        <label class="row">Preț:
          <input class="input" id="label-font-price" type="number" min="18" max="40" step="1" value="27" style="max-width:90px"> pt
        </label>
        <button class="secondary" onclick="printLabels()">Tipărește previzualizare</button>
        <button class="green" onclick="exportLabelsWordSmall()">Word etichete mici 40×21 mm</button>
        <button class="green" onclick="exportLabelsWordLarge()">Word etichete mari 50×35 mm</button>
        <button class="secondary" onclick="exportLabelsExcel()">Export Excel</button>
        <button class="red" onclick="clearLabels()">Golește etichete</button>
      </div>
    </div>

    <div class="labels-a4" id="labels-grid"></div>`;

  renderLabels();
}

window.pickLabel=async id=>{
  const p=await getProdById(id);

  if(p) addLabelProduct(p);

  document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'));
};

function renderLabels(){
  const grid=$('labels-grid');
  if(!grid) return;

  grid.innerHTML=LABEL_LINES.length?LABEL_LINES.map((p,i)=>labelCardHtml(p,i)).join(''):'<div class="card">Nu ai etichete adăugate.</div>';
}

function printLabels(){
  window.print();
}

function exportLabelsExcel(){
  downloadExcel('etichete_pret.xlsx',LABEL_LINES.map(x=>({
    cod:x.cod_bare,
    plu:x.plu,
    denumire:x.denumire,
    pret:money(x.pret),
    cantitate:parseCant(x.cantitate),
    sursa:x.source||''
  })),'Etichete');
}

function makeBarcodeDataUrl(value){
  value=String(value||'').trim();
  if(!value) return '';
  try{
    const canvas=document.createElement('canvas');
    JsBarcode(canvas,value,{format:'CODE128',displayValue:true,height:34,width:1.25,fontSize:10,margin:0});
    return canvas.toDataURL('image/png');
  }catch(e){
    return '';
  }
}

function shelfLabelWordCell(p, cfg, model){
  if(!p) return '<td class="label-cell empty"></td>';
  const base=leiParts(labelBasePrice(p));
  const total=lei(labelTotalPrice(p));
  const sgr=hasSGR(p);

  return `<td class="label-cell">
    <div class="label-inner ${model}">
      <div class="w-label-name">${esc(p.denumire||'')}</div>
      <div class="w-price"><span class="w-lei">${base.lei}</span><span class="w-bani">,${base.bani}</span><span class="w-currency"> LEI</span></div>
      ${sgr ? `
        <div class="w-sgr-row">
          <div class="w-sgr">+ 0.50 BANI SGR</div>
          <div class="w-total">TOTAL: <b>${total}</b></div>
        </div>` : `<div class="w-unit">BUC</div>`}
    </div>
  </td>`;
}

function exportLabelsWordModel(model){
  const source=LABEL_LINES||[];
  if(!source.length){
    alert('Nu ai etichete de exportat.');
    return;
  }

  const isSmall=model==='small';

  // Mică: 40 x 21 mm
  // Mare: 50 x 35 mm, 3 coloane x 8 rânduri
  const labelW=isSmall?40:50;
  const labelH=isSmall?21:35;
  const cols=isSmall?5:3;
  const rows=isSmall?13:8;
  const perPage=cols*rows;
  const pageW=cols*labelW;
  const pageH=rows*labelH;

  const items=[];
  source.forEach(p=>{
    const copies=Math.max(1,Math.round(parseCant(p.cantitate||1)));
    for(let i=0;i<copies;i++) items.push(p);
  });
  while(items.length%perPage!==0) items.push(null);

  function cellHtml(p){
    if(!p) return '<td class="label-cell empty">&nbsp;</td>';

    const base=leiParts(labelBasePrice(p));
    const total=lei(labelTotalPrice(p));
    const sgr=hasSGR(p);

    return `<td class="label-cell">
      <div class="w-name">${esc(p.denumire||'')}</div>
      <div class="w-sep"></div>
      <div class="w-price">
        <span class="w-lei">${base.lei}</span><span class="w-bani">,${base.bani}</span><span class="w-currency"> LEI</span>
      </div>
      ${sgr?`
        <div class="w-sgr">+ 0.50 BANI SGR</div>
        <div class="w-total">TOTAL: ${total}</div>
      `:`<div class="w-unit">BUC</div>`}
    </td>`;
  }

  const pages=[];
  for(let pageStart=0; pageStart<items.length; pageStart+=perPage){
    const pageItems=items.slice(pageStart,pageStart+perPage);
    const trs=[];
    for(let r=0;r<rows;r++){
      const tds=[];
      for(let c=0;c<cols;c++) tds.push(cellHtml(pageItems[r*cols+c]));
      trs.push(`<tr>${tds.join('')}</tr>`);
    }
    pages.push(`<table class="labels-page">${trs.join('')}</table>`);
  }

  // Stil compatibil Word: fără position:absolute, fără overflow, fără barcode.
  const nameFont=isSmall?6.2:8.8;
  const priceLei=isSmall?14.5:23;
  const priceBani=isSmall?7.5:12;
  const curFont=isSmall?5.2:7.8;
  const unitFont=isSmall?5.4:7.5;
  const sgrFont=isSmall?5.0:7.2;
  const totalFont=isSmall?5.5:7.8;

  const html=`<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      @page{size:A4 portrait;margin:4mm;}
      body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:0;color:#111;background:white;}
      table.labels-page{
        width:${pageW}mm;
        height:${pageH}mm;
        border-collapse:collapse;
        table-layout:fixed;
        margin:0 auto;
        page-break-after:always;
      }
      table.labels-page:last-child{page-break-after:auto;}
      tr{height:${labelH}mm;}
      td.label-cell{
        width:${labelW}mm;
        height:${labelH}mm;
        border:0.3mm solid #aeb4c0;
        padding:${isSmall?'0.8mm':'1.2mm'};
        box-sizing:border-box;
        vertical-align:middle;
        text-align:center;
      }
      td.empty{color:white;}
      .w-name{
        font-weight:900;
        font-size:${nameFont}pt;
        line-height:1.05;
        text-align:center;
        height:${isSmall?'6.4mm':'9.5mm'};
        max-height:${isSmall?'6.4mm':'9.5mm'};
        overflow:hidden;
      }
      .w-sep{border-top:0.25mm solid #333;margin:${isSmall?'.45mm 0 .5mm':'.7mm 0 .8mm'};}
      .w-price{
        font-weight:900;
        text-align:center;
        white-space:nowrap;
        line-height:1;
        margin:0;
        padding:0;
      }
      .w-lei{font-size:${priceLei}pt;font-weight:900;}
      .w-bani{font-size:${priceBani}pt;font-weight:900;vertical-align:top;}
      .w-currency{font-size:${curFont}pt;font-weight:900;}
      .w-unit{
        margin-top:${isSmall?'.5mm':'1mm'};
        text-align:left;
        font-size:${unitFont}pt;
        font-weight:900;
      }
      .w-sgr{
        margin-top:${isSmall?'.5mm':'1mm'};
        background:#c8752c;
        color:white;
        font-size:${sgrFont}pt;
        font-weight:900;
        line-height:1.1;
        padding:${isSmall?'.25mm 0':'.45mm 0'};
        text-align:center;
      }
      .w-total{
        margin-top:${isSmall?'.3mm':'.6mm'};
        font-size:${totalFont}pt;
        font-weight:900;
        text-align:center;
      }
    </style>
  </head>
  <body>${pages.join('')}</body>
  </html>`;

  let blob;
  if(window.htmlDocx && typeof window.htmlDocx.asBlob==='function'){
    blob=window.htmlDocx.asBlob(html,{orientation:'portrait',margins:{top:227,right:227,bottom:227,left:227}});
  }else{
    blob=new Blob(['\ufeff',html],{type:'application/msword'});
  }

  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  const suffix=isSmall?'mici_40x21mm':'mari_50x35mm_3coloane_8randuri';
  a.download=window.htmlDocx?`etichete_raft_${suffix}.docx`:`etichete_raft_${suffix}.doc`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportLabelsWordSmall(){ exportLabelsWordModel('small'); }
function exportLabelsWordLarge(){ exportLabelsWordModel('large'); }
async function exportLabelsWord(){ exportLabelsWordLarge(); }

/* =========================
   BACKUP
   ========================= */
function backup(){
  $('main').innerHTML=`
    <h1>Backup / reset</h1>

    <div class="card row">
      <button onclick="backupJson()">Backup JSON</button>
      <button class="red" onclick="resetAllData()">Șterge toate datele</button>
      <button class="secondary" onclick="reloadData()">Reîncarcă date</button>
    </div>

    <p class="muted">Datele sunt salvate local în IndexedDB pe acest calculator/browser.</p>`;
}

async function backupJson(){
  const data={
    produse:await getAll('produse'),
    intrari:await getAll('intrari'),
    cart:CART,
    iesiri:await getAll('iesiri'),
    created:new Date().toISOString()
  };

  downloadText('gestiunepro_backup.json',JSON.stringify(data,null,2));
}

/* =========================
   EXPORT
   ========================= */
function rowsTable(rows){
  rows=Array.isArray(rows)?rows:[];

  if(!rows.length) return '<p>Nu există date.</p>';

  const cols=Object.keys(rows[0]);

  return `<table>
    <thead>
      <tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr>
    </thead>
    <tbody>
      ${rows.map(r=>`<tr>${cols.map(c=>`<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}
    </tbody>
  </table>`;
}

function downloadWord(name,title,htmlContent){
  const html=`<!doctype html>
  <html>
  <head>
    <meta charset="utf-8">
    <style>
      body{font-family:Arial}
      table{border-collapse:collapse;width:100%}
      td,th{border:1px solid #999;padding:6px}
      th{background:#eee}
    </style>
  </head>
  <body>
    <h1>${esc(title)}</h1>
    ${htmlContent}
  </body>
  </html>`;

  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([html],{type:'application/msword'}));
  a.download=name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadExcel(name, rows, sheetName='Export'){
  rows=Array.isArray(rows)?rows:[];

  if(window.XLSX){
    const ws=XLSX.utils.json_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,String(sheetName||'Export').slice(0,31));
    XLSX.writeFile(wb,name);
    return;
  }

  downloadText(name.replace(/\.xlsx$/i,'.csv'),rows.map(r=>Object.values(r).join(';')).join('\n'));
}

function exportPreturiExcel(){
  downloadExcel('preturi_schimbate.xlsx',PRICE_CHANGES,'Preturi schimbate');
}

function downloadText(name,text){
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
  a.download=name;
  a.click();
  URL.revokeObjectURL(a.href);
}
