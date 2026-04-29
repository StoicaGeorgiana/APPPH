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
let APP={produseCount:0,intrariCount:0,lastImport:null};

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

window.addEventListener('load', async ()=>{
  $('app').style.display='none';

  try{
    const {data}=await supabaseClient.auth.getSession();

    if(data?.session){
      $('login-screen').style.display='none';
      $('app').style.display='block';
      await init();
    }
  }catch(e){
    console.warn('Nu pot verifica sesiunea Supabase:', e);
  }
});

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

async function saveCart(){
  await clearStore('cart');
  await putMany('cart',CART,500);
}

async function init(){
  await openDB();
  await loadCounts();
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
  if(v instanceof Date && !isNaN(v)) return v.toISOString().slice(0,10);

  if(typeof v==='number' && window.XLSX){
    try{
      const d=XLSX.SSF.parse_date_code(v);
      if(d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    }catch(_){}
  }

  const s=String(v||'').trim();
  if(!s) return '';

  let m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if(m){
    let y=Number(m[3]);
    if(y<100) y+=2000;
    return `${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  }

  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  return '';
}

function normIntr(row,i){
  const cod=cleanCode(getAny(row,['cod_bare','cod bare','codbar','ean','cod produs','cod']));
  const plu=cleanCode(getAny(row,['plu','PLU']));
  const den=String(getAny(row,['denumire','produs','nume produs','nume'])||'').trim();

  if(!cod && !plu && !den) return null;

  const data=excelDate(getAny(row,['data','date']));
  const cant=money(getAny(row,['cantitate','cant','qty','total cantitate']));
  const pret=money(getAny(row,['pret','preț','pret fara tva','pret achizitie','pret_v_tva','pret cu tva']));
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
    furnizor: String(getAny(row,['furnizor','cod fiscal','cui','cod_fiscal'])||'').trim()
  };
}

async function detectPriceChangesBeforeImport(newProducts){
  const oldProducts=await getAll('produse');
  const oldMap=new Map(oldProducts.map(p=>[p.id,p]));
  PRICE_CHANGES=[];

  newProducts.forEach(p=>{
    const old=oldMap.get(p.id);
    if(old && money(old.pret)!==money(p.pret)){
      PRICE_CHANGES.push({
        id:p.id,
        cod_bare:p.cod_bare,
        plu:p.plu,
        denumire:p.denumire,
        pret_vechi:money(old.pret),
        pret_nou:money(p.pret),
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
  const intrari=rowsI.map(normIntr).filter(Boolean);

  await detectPriceChangesBeforeImport(produse);

  await clearStore('produse');
  await clearStore('intrari');

  await putMany('produse',produse,1500,(d,t)=>setProg(`Produse TABEL: ${d}/${t}`,d,t));
  await putMany('intrari',intrari,1500,(d,t)=>setProg(`Intrări: ${d}/${t}`,d,t));

  await setSetting('lastImport',new Date().toLocaleString('ro-RO'));

  await loadCounts();

  $('import-status').innerHTML=`<div class="notice good">Import finalizat: ${produse.length} produse și ${intrari.length} intrări.</div>`;
  dashboard();
}

/* =========================
   PRODUSE / CĂUTARE
   ========================= */
async function searchProducts(q){
  q=String(q||'').trim();
  if(!q) return [];

  const code=cleanCode(q);
  let out=[];

  if(code){
    out=out.concat(await getByIndex('produse','cod_bare',code));
    out=out.concat(await getByIndex('produse','plu',code));
  }

  const all=await getAll('produse');
  const nq=norm(q);
  const words=nq.split(/\s+/).filter(Boolean);

  out=out.concat(all.filter(p=>{
    const den=norm(p.denumire||'');
    const cod=String(p.cod_bare||'');
    const plu=String(p.plu||'');

    return (code && (cod.includes(code)||plu.includes(code))) ||
           (words.length && words.every(w=>den.includes(w)));
  }));

  return uniqueProds(out).slice(0,50);
}

function uniqueProds(arr){
  const m=new Map();
  arr.forEach(p=>m.set(p.id,p));
  return [...m.values()];
}

async function byCode(q){
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
  const arr=await searchProducts(q);

  if(!arr.length){
    box.classList.add('hide');
    return;
  }

  box.classList.remove('hide');

  box.innerHTML=arr.map(p=>`
    <div onclick="${pickFn}('${esc(p.id)}')">
      <b>${esc(p.cod_bare||'')}</b>
      ${p.plu?`PLU ${esc(p.plu)}`:''}
      — ${esc(p.denumire)}
      <span style="float:right">${lei(p.pret)}</span>
    </div>`).join('');
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
    for(let i=1;i<=n;i++) items.push({...p,scanIndex:i,scanQty:n});
  });

  $('main').innerHTML=`
    <h1>Coduri scanabile pentru casa de marcat</h1>

    <div class="card no-print row">
      <button onclick="go('cos')">Înapoi la coș</button>
      <button onclick="window.print()">Printează coduri</button>
      <button class="secondary" onclick="localStorage.setItem('barcodeMode','repeat');coduri()">Repetă după cantitate</button>
      <button class="secondary" onclick="localStorage.setItem('barcodeMode','once');coduri()">Un cod/produs</button>
      <button class="red" onclick="clearCasaItems()">Golește coduri casă</button>
    </div>

    <div class="barcode-grid">
      ${items.length?items.map((p,i)=>`
        <div class="label-card">
          <b>${esc(p.cod_bare||p.plu)} ${esc(p.denumire)}</b>
          <p>Cod: ${esc(p.cod_bare||p.plu)}</p>
          <svg id="bc-${i}"></svg>
          <p>${mode==='repeat'?`Bucată ${p.scanIndex} din ${p.scanQty}`:`Cantitate: ${fmtCant(p.cantitate)}`}</p>
        </div>`).join(''):'<div class="card">Nu ai coduri trimise din coș.</div>'}
    </div>`;

  setTimeout(()=>items.forEach((p,i)=>{
    try{
      JsBarcode(`#bc-${i}`,String(p.cod_bare||p.plu||''),{format:'CODE128',displayValue:true,height:70,width:2});
    }catch(e){}
  }),50);
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

  tb.innerHTML=PRICE_CHANGES.length?PRICE_CHANGES.map(x=>`
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
  PRICE_CHANGES.forEach(x=>addLabelProduct({
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
  }).join(''):'<tr><td colspan="9" class="muted">Nu ai linii inventar.</td></tr>';
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
function getIntrariFilters(){
  return {
    q:$('intrari-search')?.value||'',
    zi:$('intrari-data')?.value||'',
    luna:$('intrari-luna')?.value||'',
    an:$('intrari-an')?.value||''
  };
}

function intrareMatchesFilters(x,f){
  const data=String(x.data||'').slice(0,10);
  const an=data.slice(0,4);
  const luna=data.slice(0,7);

  if(f.zi && data!==f.zi) return false;
  if(f.luna && luna!==f.luna) return false;
  if(f.an && an!==f.an) return false;

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

async function searchIntrariRows(filters=null,limit=2000){
  const f=filters||getIntrariFilters();
  const all=await getAll('intrari');
  return sortIntrariNewestFirst(all.filter(x=>intrareMatchesFilters(x,f))).slice(0,limit);
}

async function renderIntrariView(filters=null){
  const rows=await searchIntrariRows(filters||getIntrariFilters(),2000);
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
              <td>${lei(x.valoare)}</td>
              <td>${esc(x.furnizor||'')}</td>
            </tr>`).join('') || '<tr><td colspan="9" class="muted">Nu există rezultate.</td></tr>'}
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
        <input class="input" id="intrari-search" style="max-width:520px" placeholder="Cod bare / PLU / denumire / document / furnizor" onkeydown="if(event.key==='Enter')cautaIntrari()">
        <button onclick="cautaIntrari()">Caută în intrări</button>
        <button class="secondary" onclick="$('intrari-search').value='';renderIntrariView({q:'',zi:'',luna:'',an:''})">Golește</button>
      </div>
    </div>

    <div id="intrari-results"><div class="notice">Se încarcă...</div></div>`;

  await renderIntrariView({q:'',zi:'',luna:'',an:''});
}

async function cautaIntrari(){
  await renderIntrariView(getIntrariFilters());
}

async function exportIntrariCautare(){
  const rows=await searchIntrariRows(getIntrariFilters(),1000000);
  downloadExcel('intrari_filtrate.xlsx',rows,'Intrari filtrate');
}

async function exportIntrariExcel(){
  const rows=sortIntrariNewestFirst(await getAll('intrari'));
  downloadExcel('intrari.xlsx',rows,'Intrari');
}

/* =========================
   IEȘIRI
   ========================= */
async function iesiri(){
  const rows=sortIntrariNewestFirst(await getAll('iesiri'));
  const total=rows.reduce((s,x)=>s+money(x.total),0);

  $('main').innerHTML=`
    <h1>Ieșiri / vânzări</h1>

    <div class="card row">
      <button onclick="exportIesiriExcel()">Export Excel ieșiri</button>
      <span class="pill">${rows.length} vânzări</span>
      <span class="pill">Total: ${lei(total)}</span>
    </div>

    <div class="card tbl-wrap">
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Metodă</th>
            <th>Produse</th>
            <th>SGR</th>
            <th>Total</th>
            <th>Linii</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(x=>`
            <tr>
              <td>${new Date(x.data).toLocaleString('ro-RO')}</td>
              <td>${esc(x.method)}</td>
              <td>${lei(x.produseTotal)}</td>
              <td>${lei(x.sgrTotal)}</td>
              <td><b>${lei(x.total)}</b></td>
              <td>${(x.linii||[]).map(l=>`${esc(l.denumire)} × ${fmtCant(l.cantitate)}`).join('<br>')}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">Nu există vânzări salvate.</td></tr>'}
        </tbody>
      </table>
    </div>`;
}

async function exportIesiriExcel(){
  const rows=sortIntrariNewestFirst(await getAll('iesiri'));
  const flat=[];

  rows.forEach(v=>(v.linii||[]).forEach(l=>flat.push({
    data:new Date(v.data).toLocaleString('ro-RO'),
    metoda:v.method,
    cod:l.cod_bare,
    plu:l.plu,
    denumire:l.denumire,
    cantitate:parseCant(l.cantitate),
    pret:money(l.pret),
    total_linie:parseCant(l.cantitate)*money(l.pret),
    total_bon:v.total
  })));

  downloadExcel('iesiri_vanzari.xlsx',flat,'Iesiri');
}

/* =========================
   ETICHETE
   ========================= */
function hasSGR(p){
  return norm(p?.denumire||'').includes('sgr');
}

function labelBasePrice(p){
  const pret=money(p?.pret);
  return hasSGR(p)?Math.max(0,pret-0.50):pret;
}

function labelTotalPrice(p){
  return money(p?.pret);
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

  return `<div class="price-label-24">
    <button class="label-x no-print" onclick="LABEL_LINES.splice(${i},1);renderLabels()">×</button>
    <div class="label-name">${esc(p.denumire||'')}</div>
    <div class="label-line"></div>
    <svg id="label-bc-${i}" class="label-barcode"></svg>
    <div class="label-price">
      <span class="label-lei">${base.lei}</span>
      <span class="label-bani">,${base.bani}</span>
      <span class="label-currency">LEI</span>
    </div>
    <div class="label-bottom">
      <span>BUC</span>
      ${sgr?`<span class="label-sgr">+ SGR<br>${total}</span>`:'<span></span>'}
    </div>
  </div>`;
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
        <label class="row">Copii/etichetă:
          <input class="input" id="label-copies" type="number" min="1" step="1" value="1" style="max-width:90px">
        </label>
        <button class="secondary" onclick="printLabels()">Tipărește 24/pagină</button>
        <button class="green" onclick="exportLabelsWord()">Export Word editabil</button>
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

  setTimeout(()=>LABEL_LINES.forEach((p,i)=>{
    try{
      JsBarcode(`#label-bc-${i}`,String(p.cod_bare||p.plu||''),{format:'CODE128',displayValue:true,height:34,width:1.3,fontSize:10,margin:0});
    }catch(e){}
  }),50);
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

function exportLabelsWord(){
  downloadWord('etichete_pret_editabile.doc','Etichete preț',LABEL_LINES.map(p=>`
    <div>${esc(p.denumire)} - ${lei(labelBasePrice(p))}${hasSGR(p)?' + SGR '+lei(labelTotalPrice(p)):''}</div>
  `).join(''));
}

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
