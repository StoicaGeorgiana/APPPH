
/* GestiunePro v44 ETICHETE 3x8
   - IndexedDB pentru volum mare
   - PWA, telefon, CT58, laptop
   - Coș unic CART, cantitate 3 zecimale
   - Import SCANARECODPRETURI: TABEL + tva 11, 21
   - PLU în coș, verificare preț, inventar
*/
'use strict';

const DB_NAME='GestiuneProV44';
const DB_VERSION=3;
const STORES=['produse','intrari','inventar','cart','iesiri','settings'];
let db=null;
let PAGE='dashboard';
let CART=[];
let PRICE_CHANGES=[];
let LABEL_LINES=[];
let APP={produseCount:0,intrariCount:0,cacheProduse:[], lastImport:null};

const $=id=>document.getElementById(id);
const esc=x=>String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const norm=s=>String(s??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
const cleanCode=v=>String(v??'').replace(/\.0$/,'').replace(/\s/g,'').trim();
const money=v=>{
  if(typeof v==='number') return Number.isFinite(v)?v:0;
  let s=String(v??'').trim().replace(/\s/g,'');
  if(s.includes(',')&&s.includes('.')) s=s.replace(/\./g,'').replace(',','.');
  else s=s.replace(',','.');
  const n=Number(s); return Number.isFinite(n)?n:0;
};
const parseCant=v=>{
  let s=String(v??'').trim().replace(/\s/g,'').replace(',','.');
  const n=parseFloat(s); return Number.isFinite(n)?Math.round(n*1000)/1000:0;
};
const fmtCant=v=>parseCant(v).toFixed(3).replace('.',',');
const lei=n=>(Number(n)||0).toLocaleString('ro-RO',{minimumFractionDigits:2,maximumFractionDigits:2})+' lei';
const isSGR=p=>norm(p?.denumire||'').includes('sgr');
const sgrVal=(p,q)=>isSGR(p)?parseCant(q)*0.50:0;
const today=()=>new Date().toISOString().slice(0,10);

function showFatal(err, where='Eroare'){
  console.error(where, err);
  const main=document.getElementById('main') || document.getElementById('app');
  if(main){
    main.innerHTML=`<div class="card bad">
      <h1>Eroare aplicație</h1>
      <p><b>${where}</b></p>
      <pre style="white-space:pre-wrap;background:#0c1426;padding:12px;border-radius:12px">${String(err && (err.stack || err.message) || err)}</pre>
      <button onclick="location.reload()">Reîncarcă</button>
      <button class="red" onclick="indexedDB.deleteDatabase(DB_NAME);localStorage.clear();location.reload()">Reset baza locală</button>
    </div>`;
  }
}

function toast(m){
  const d=document.createElement('div');
  d.className='notice good';
  d.style.cssText='position:fixed;right:16px;bottom:16px;z-index:9999;background:#0c1426';
  d.textContent=m; document.body.appendChild(d); setTimeout(()=>d.remove(),3500);
}

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
function tx(store,mode='readonly'){return db.transaction(store,mode).objectStore(store)}
function putMany(store,rows,chunk=1000,onProgress=null){
  return new Promise(async(resolve,reject)=>{
    try{
      let done=0;
      for(let i=0;i<rows.length;i+=chunk){
        await new Promise((res,rej)=>{
          const tr=db.transaction(store,'readwrite');
          const st=tr.objectStore(store);
          rows.slice(i,i+chunk).forEach(r=>st.put(r));
          tr.oncomplete=res; tr.onerror=()=>rej(tr.error);
        });
        done=Math.min(i+chunk,rows.length);
        if(onProgress) onProgress(done,rows.length);
        await new Promise(r=>setTimeout(r,0));
      }
      resolve();
    }catch(e){reject(e)}
  });
}
function clearStore(store){return new Promise((res,rej)=>{const r=tx(store,'readwrite').clear();r.onsuccess=res;r.onerror=()=>rej(r.error)})}
function countStore(store){return new Promise((res,rej)=>{const r=tx(store).count();r.onsuccess=()=>res(r.result||0);r.onerror=()=>rej(r.error)})}
function getAll(store,limit=0){
  return new Promise((res,rej)=>{
    const out=[]; const r=tx(store).openCursor();
    r.onsuccess=e=>{const c=e.target.result;if(c){out.push(c.value); if(limit&&out.length>=limit)res(out); else c.continue()}else res(out)};
    r.onerror=()=>rej(r.error);
  });
}
function getByIndex(store,index,value){
  return new Promise((res,rej)=>{
    const r=tx(store).index(index).getAll(value);
    r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error);
  });
}
function setSetting(key,value){return new Promise((res,rej)=>{const r=tx('settings','readwrite').put({key,value});r.onsuccess=res;r.onerror=()=>rej(r.error)})}
function getSetting(key){return new Promise((res,rej)=>{const r=tx('settings').get(key);r.onsuccess=()=>res(r.result?.value);r.onerror=()=>rej(r.error)})}

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
  // v37: Service Worker dezactivat pentru a evita cache vechi.
  await loadCounts();
  renderShell();
}
function renderShell(){
  document.getElementById('app').innerHTML=`
  <div class="wrap">
    <aside class="side">
      <div class="brand">Gestiune<span>Pro</span></div>
      <button class="secondary" onclick="location.reload()">Ieșire</button>
      <div class="userbox">local / administrator<br><span class="pill">PRO v44</span></div>
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
function nav(id,label){return `<button id="nav-${id}" onclick="go('${id}')">${label}</button>`}
function getPageFunction(p){
  if(p==='dashboard') return dashboard;
  if(p==='cos') return cos;
  if(p==='coduri') return coduri;
  if(p==='verificare') return verificare;
  if(p==='preturi') return typeof preturi === 'function' ? preturi : dashboard;
  if(p==='inventar') return inventar;
  if(p==='intrari') return intrari;
  if(p==='iesiri') return typeof iesiri === 'function' ? iesiri : dashboard;
  if(p==='etichete') return typeof etichete === 'function' ? etichete : dashboard;
  if(p==='backup') return typeof backup === 'function' ? backup : dashboard;
  return dashboard;
}

function go(p){
  try{
    PAGE=p;
    document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active'));
    $('nav-'+p)?.classList.add('active');
    const fn=getPageFunction(p);
    const r=fn();
    if(r && typeof r.catch==='function') r.catch(e=>showFatal(e,'Pagina '+p));
  }catch(e){ showFatal(e,'Pagina '+p); }
}

function progressBox(title){return `<div class="notice"><b>${title}</b><p id="prog-txt">Pregătire...</p><div class="progress"><b id="prog-bar"></b></div></div>`}
function setProg(txt,done,total){$('prog-txt')&&( $('prog-txt').textContent=txt ); $('prog-bar')&&( $('prog-bar').style.width=(total?Math.round(done/total*100):0)+'%' )}

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
    <p class="muted">Citește explicit sheet-ul <b>TABEL</b> pentru produse și <b>tva 11, 21</b> pentru intrări. După import, paginile se încarcă din IndexedDB, nu din Excel.</p>
    <div id="import-status"></div>
  </div>

  <div class="grid2">
    <div class="card"><h3>🛒 Coș cumpărături</h3><p>Vânzare, PLU, cantități 3 zecimale, coduri casă.</p><button onclick="go('cos')">Deschide coș</button></div>
    <div class="card"><h3>📥 Intrări</h3><p>${APP.intrariCount} rânduri. Încărcare instant din stocare locală.</p><button onclick="go('intrari')">Vezi intrări</button></div>
    <div class="card"><h3>📦 Inventar</h3><p>Căutare cod bare / PLU / denumire, cantitate editabilă.</p><button onclick="go('inventar')">Deschide inventar</button></div>
    <div class="card"><h3>📱 CT58 / Telefon</h3><p>Deschizi pe aceeași rețea: http://IP-LAPTOP:5500. Apoi Adaugă pe ecranul principal.</p></div>
  </div>`;
}

async function reloadData(){await loadCounts();toast('Date reîncărcate');dashboard()}
async function resetAllData(){
  if(!confirm('Ștergi TOATE datele locale: produse, intrări, inventar, coș?')) return;
  if(prompt('Scrie RESET pentru confirmare')!=='RESET') return;
  for(const s of STORES) await clearStore(s);
  CART=[]; await loadCounts(); toast('Date șterse'); dashboard();
}

function findSheet(wb,name){
  const target=norm(name);
  return wb.SheetNames.find(n=>norm(n)===target)||wb.SheetNames.find(n=>norm(n).includes(target.split(' ')[0]));
}
function getAny(row,names){
  const map={}; Object.keys(row||{}).forEach(k=>map[norm(k).replace(/[_.\-]+/g,' ')]=row[k]);
  for(const n of names){const v=map[norm(n).replace(/[_.\-]+/g,' ')]; if(v!==undefined&&v!==null&&String(v).trim()!=='')return v}
  return '';
}
function normProd(row,i){
  const cod=cleanCode(getAny(row,['cod_bare','cod bare','codbar','ean','cod produs','cod']));
  const plu=cleanCode(getAny(row,['plu','PLU']));
  const den=String(getAny(row,['denumire','produs','nume produs','nume'])||'').trim();
  if(!cod&&!plu&&!den) return null;
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
  if(v instanceof Date&&!isNaN(v)) return v.toISOString().slice(0,10);
  if(typeof v==='number' && window.XLSX){try{const d=XLSX.SSF.parse_date_code(v); if(d)return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`}catch(_){}}
  const s=String(v||'').trim(); if(!s) return '';
  let m=s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/); if(m){let y=Number(m[3]); if(y<100)y+=2000; return `${y}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`}
  if(/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  return '';
}
function normIntr(row,i){
  const cod=cleanCode(getAny(row,['cod_bare','cod bare','codbar','ean','cod produs','cod']));
  const plu=cleanCode(getAny(row,['plu','PLU']));
  const den=String(getAny(row,['denumire','produs','nume produs','nume'])||'').trim();
  if(!cod&&!plu&&!den) return null;
  const data=excelDate(getAny(row,['data','date']));
  const cant=money(getAny(row,['cantitate','cant','qty','total cantitate']));
  const pret=money(getAny(row,['pret','preț','pret fara tva','pret achizitie','pret_v_tva','pret cu tva']));
  const nr=String(getAny(row,['nr','numar','număr','document','nr document','numar document'])||'').trim();
  return {
    id: [data,nr,i,cod,plu,den,cant,pret].join('|'),
    data, nr,
    cod_bare:cod, plu:plu&&plu!=='0'?plu:'',
    denumire:den||cod||plu,
    cantitate:cant,
    pret,
    valoare: money(getAny(row,['valoare','valoare fara tva','total valoare'])) || cant*pret,
    tva: money(getAny(row,['tva','valoare tva','tva valoare'])),
    furnizor: String(getAny(row,['furnizor','cod fiscal','cui','cod_fiscal'])||'').trim()
  };
}

async function detectPriceChangesBeforeImport(newProducts){
  try{
    const oldProducts = await getAll('produse');
    const oldMap = new Map(oldProducts.map(p=>[p.id, p]));
    const changes = [];
    newProducts.forEach(p=>{
      const old = oldMap.get(p.id);
      if(old && money(old.pret) !== money(p.pret)){
        changes.push({
          id:p.id, cod_bare:p.cod_bare, plu:p.plu, denumire:p.denumire,
          pret_vechi:money(old.pret), pret_nou:money(p.pret), data:new Date().toLocaleString('ro-RO')
        });
      }
    });
    if(changes.length) PRICE_CHANGES = changes;
  }catch(e){}
}

async function importExcel(e){
  const file=e.target.files?.[0]; if(!file) return;
  $('import-status').innerHTML=progressBox('Import în desfășurare');
  const buf=await file.arrayBuffer();
  setProg('Se citește Excel...',1,100);
  const wb=XLSX.read(buf,{type:'array',cellDates:true});
  const tabelName=findSheet(wb,'TABEL');
  const tvaName=wb.SheetNames.find(n=>norm(n)==='tva 11, 21') || wb.SheetNames.find(n=>norm(n).includes('tva')) || wb.SheetNames.find(n=>norm(n).includes('intrari'));
  if(!tabelName&&!tvaName){$('import-status').innerHTML='<div class="notice bad">Nu găsesc sheet TABEL sau tva 11, 21.</div>';return}

  const rowsT=tabelName?XLSX.utils.sheet_to_json(wb.Sheets[tabelName],{defval:''}):[];
  const rowsI=tvaName?XLSX.utils.sheet_to_json(wb.Sheets[tvaName],{defval:''}):[];
  const produse=rowsT.map(normProd).filter(Boolean);
  const intrari=rowsI.map(normIntr).filter(Boolean);

  await detectPriceChangesBeforeImport(produse);
  await clearStore('produse'); await clearStore('intrari');
  await Promise.all([
    putMany('produse',produse,1500,(d,t)=>setProg(`Produse TABEL: ${d}/${t}`,d,t)),
    putMany('intrari',intrari,1500,(d,t)=>setProg(`Intrări ${tvaName}: ${d}/${t}`,d,t))
  ]);
  await setSetting('lastImport',new Date().toLocaleString('ro-RO'));
  await loadCounts();
  $('import-status').innerHTML=`<div class="notice good">Import finalizat: ${produse.length} produse și ${intrari.length} intrări.</div>`;
  dashboard();
}

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

  const manual=all.filter(p=>{
    const den=norm(p.denumire||'');
    const cod=String(p.cod_bare||'');
    const plu=String(p.plu||'');
    if(code && (cod.includes(code) || plu.includes(code))) return true;
    if(words.length && words.every(w=>den.includes(w))) return true;
    return false;
  });

  out=out.concat(manual);
  return uniqueProds(out).slice(0,50);
}
function uniqueProds(arr){const m=new Map();arr.forEach(p=>m.set(p.id,p));return [...m.values()]}
async function byCode(q){const arr=await searchProducts(q); return arr[0]||null}

function productSearchHtml(inputId,pickFn,placeholder='Cod bare / PLU / denumire'){
  return `<div style="position:relative"><input class="input" id="${inputId}" placeholder="${placeholder}" oninput="showSuggest('${inputId}','${pickFn}')"><div class="suggest hide" id="${inputId}-s"></div></div>`;
}
window.showSuggest=async function(id,pickFn){
  const q=$(id).value; const box=$(id+'-s'); const arr=await searchProducts(q);
  if(!arr.length){box.classList.add('hide');return}
  box.classList.remove('hide');
  box.innerHTML=arr.map((p,i)=>`<div onclick="${pickFn}('${esc(p.id)}')"><b>${esc(p.cod_bare||'')}</b> ${p.plu?`PLU ${esc(p.plu)}`:''} — ${esc(p.denumire)} <span style="float:right">${lei(p.pret)}</span></div>`).join('');
}
async function getProdById(id){return new Promise((res,rej)=>{const r=tx('produse').get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}

function cartTotal(){return CART.reduce((s,p)=>s+(parseCant(p.cantitate)*money(p.pret)+sgrVal(p,p.cantitate)),0)}
function addCart(p,q=1){
  const key=p.id||p.cod_bare||p.plu||p.denumire;
  let e=CART.find(x=>x.key===key);
  if(e) e.cantitate=Math.round((parseCant(e.cantitate)+parseCant(q))*1000)/1000;
  else CART.push({key,id:p.id,cod_bare:p.cod_bare,plu:p.plu,denumire:p.denumire,pret:p.pret,cantitate:parseCant(q)||1});
  saveCart(); renderCart();
}
window.pickCart=async id=>{const p=await getProdById(id); if(p)addCart(p); document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'))}
function cos(){
  $('main').innerHTML=`
  <h1>Coș cumpărături</h1>
  <div class="grid2">
    <div class="card"><h3>Adaugă produs</h3><div style="position:relative"><input class="input" id="cart-q" placeholder="Cod bare / PLU / denumire" oninput="showSuggest('cart-q','pickCart')" onkeydown="if(event.key==='Enter')addCartByInput('cart-q')"><div class="suggest hide" id="cart-q-s"></div></div><div class="row"><button onclick="addCartByInput('cart-q')">Adaugă după text</button><input class="input" id="cart-plu" style="max-width:260px" placeholder="Introdu PLU manual" onkeydown="if(event.key==='Enter')addCartByInput('cart-plu')"><button onclick="addCartByInput('cart-plu')">Caută PLU</button><button class="red" onclick="clearCart()">Golește coș</button></div><p class="muted">Pentru CT58: scanează în câmpul activ și apasă Enter.</p></div>
    <div class="card"><h3>Plată</h3><p>Produse: <span id="pay-products">0 lei</span><br>SGR: <span id="pay-sgr">0 lei</span></p><div class="stat" id="pay-total">0 lei</div><div class="row"><button class="green" onclick="finalizeSale('cash')">Plată Cash</button><button onclick="finalizeSale('card')">Plată Card</button><button class="orange" onclick="sendCartToCasa()">Trimite în Coduri casă</button></div></div>
  </div>
  <div class="card tbl-wrap"><table><thead><tr><th>Cod</th><th>PLU</th><th>Denumire</th><th>SGR</th><th>Cant.</th><th>Preț</th><th>Valoare produse</th><th>SGR</th><th>Total</th><th></th></tr></thead><tbody id="cart-body"></tbody></table></div>`;
  renderCart();
}
async function addCartByInput(id){const p=await byCode($(id).value); if(!p)return toast('Produs inexistent'); addCart(p); $(id).value=''}
function renderCart(){
  const tb=$('cart-body'); if(!tb) return;
  if(!CART.length){tb.innerHTML='<tr><td colspan="10" class="muted">Coșul este gol.</td></tr>'; updatePay(); return}
  tb.innerHTML=CART.map((p,i)=>{
    const q=parseCant(p.cantitate), val=q*money(p.pret), sg=sgrVal(p,q), total=val+sg;
    return `<tr><td>${esc(p.cod_bare)}</td><td>${esc(p.plu)}</td><td>${esc(p.denumire)}</td><td>${isSGR(p)?'<span class="pill">SGR</span>':'—'}</td><td><div class="qty"><button onclick="chgQty(${i},-1)">−</button><input value="${fmtCant(q)}" inputmode="decimal" onfocus="this.select()" onkeydown="if(event.key==='Enter')setQty(${i},this.value)" onblur="setQty(${i},this.value)"><button onclick="chgQty(${i},1)">+</button></div></td><td>${lei(p.pret)}</td><td>${lei(val)}</td><td>${sg?lei(sg):'—'}</td><td><b>${lei(total)}</b></td><td><button class="red" onclick="delCart(${i})">×</button></td></tr>`
  }).join('');
  updatePay();
}
function updatePay(){const prod=CART.reduce((s,p)=>s+parseCant(p.cantitate)*money(p.pret),0), sg=CART.reduce((s,p)=>s+sgrVal(p,p.cantitate),0); $('pay-products')&&($('pay-products').textContent=lei(prod)); $('pay-sgr')&&($('pay-sgr').textContent=lei(sg)); $('pay-total')&&($('pay-total').textContent=lei(prod+sg))}
function setQty(i,v){const q=parseCant(v); if(q<=0)CART.splice(i,1); else CART[i].cantitate=q; saveCart(); renderCart()}
function chgQty(i,d){setQty(i,parseCant(CART[i].cantitate)+d)}
function delCart(i){CART.splice(i,1);saveCart();renderCart()}
function clearCart(){CART=[];saveCart();renderCart()}
async function finalizeSale(method){
  if(!CART.length) return toast('Coș gol');
  const produseTotal=CART.reduce((s,p)=>s+parseCant(p.cantitate)*money(p.pret),0);
  const sgrTotal=CART.reduce((s,p)=>s+sgrVal(p,p.cantitate),0);
  const total=produseTotal+sgrTotal;
  const sale={
    id:'SALE_'+Date.now(),
    data:new Date().toISOString(),
    method,
    produseTotal,
    sgrTotal,
    total,
    linii:CART.map(p=>({...p}))
  };
  await putMany('iesiri',[sale],1);
  toast('Vânzare salvată în Ieșiri: '+method+' / '+lei(total));
  clearCart();
}


function sendCartToCasa(){
  try{
    localStorage.setItem('gp_coduri_casa_v41', JSON.stringify(CART));
    toast('Coșul a fost trimis în Coduri casă');
  }catch(e){ toast('Nu am putut trimite coșul în Coduri casă'); }
  go('coduri');
}

function getCasaItems(){
  try{
    const saved = JSON.parse(localStorage.getItem('gp_coduri_casa_v41') || '[]');
    if(Array.isArray(saved) && saved.length) return saved;
  }catch(e){}
  return CART;
}

function clearCasaItems(){
  localStorage.removeItem('gp_coduri_casa_v41');
  toast('Codurile casă au fost golite');
  coduri();
}

function addLabelProduct(p, source='manual'){
  if(!p) return;
  const key = p.id || p.cod_bare || p.plu || p.denumire;
  let e = LABEL_LINES.find(x=>x.key===key);
  if(e) e.cantitate = parseCant(e.cantitate || 1) + 1;
  else LABEL_LINES.push({key,id:p.id,cod_bare:p.cod_bare,plu:p.plu,denumire:p.denumire,pret:p.pret,cantitate:1,source});
  renderLabels();
}

async function addLabelByInput(id){
  const p = await byCode($(id).value);
  if(!p){ toast('Produs inexistent pentru etichetă'); return; }
  addLabelProduct(p,'manual');
  $(id).value='';
}

function clearLabels(){
  LABEL_LINES=[];
  renderLabels();
}

function exportLabelsExcel(){
  downloadExcel('etichete_pret.xlsx', LABEL_LINES.map(x=>({
    cod:x.cod_bare, plu:x.plu, denumire:x.denumire, pret:money(x.pret), cantitate:parseCant(x.cantitate), sursa:x.source||''
  })), 'Etichete');
}

function printLabels(){ openLabelsPrint(); }
function coduri(){
  const mode=localStorage.getItem('barcodeMode')||'repeat';
  const casaItems=getCasaItems();
  const items=[];
  casaItems.forEach(p=>{
    const n=mode==='repeat'?Math.max(1,Math.round(parseCant(p.cantitate))):1;
    for(let i=1;i<=n;i++)items.push({...p,scanIndex:i,scanQty:n});
  });
  $('main').innerHTML=`<h1>Coduri scanabile pentru casa de marcat</h1>
    <div class="card no-print row">
      <button onclick="go('cos')">Înapoi la coș</button>
      <button onclick="window.print()">Printează coduri</button>
      <button class="secondary" onclick="localStorage.setItem('barcodeMode','repeat');coduri()">Repetă după cantitate</button>
      <button class="secondary" onclick="localStorage.setItem('barcodeMode','once');coduri()">Un cod/produs</button>
      <button class="red" onclick="clearCasaItems()">Golește coduri casă</button>
    </div>
    <p class="muted no-print">Codurile de aici vin din Coș cumpărături prin butonul „Trimite în Coduri casă”.</p>
    <div class="barcode-grid">${items.length?items.map((p,i)=>`<div class="label-card"><b>${esc(p.cod_bare||p.plu)} ${esc(p.denumire)}</b><p>Cod: ${esc(p.cod_bare||p.plu)}</p><svg id="bc-${i}"></svg><p>${mode==='repeat'?`Bucată ${p.scanIndex} din ${p.scanQty}`:`Cantitate: ${fmtCant(p.cantitate)}`}</p></div>`).join(''):'<div class="card">Nu ai coduri trimise din coș.</div>'}</div>`;
  setTimeout(()=>items.forEach((p,i)=>{try{JsBarcode(`#bc-${i}`,String(p.cod_bare||p.plu||''),{format:'CODE128',displayValue:true,height:70,width:2})}catch(e){}}),50);
}

function verificare(){
  $('main').innerHTML=`<h1>Verificare preț</h1>
    <div class="card">
      <div style="position:relative">
        <input class="input" id="ver-q" placeholder="Cod bare / PLU / denumire"
          oninput="showSuggest('ver-q','pickVerify')"
          onkeydown="if(event.key==='Enter')verifyInput('ver-q')">
        <div class="suggest hide" id="ver-q-s"></div>
      </div>
      <div class="row">
        <button onclick="verifyInput('ver-q')">Verifică manual</button>
        <input class="input" id="ver-plu" style="max-width:260px" placeholder="Introdu PLU manual"
          onkeydown="if(event.key==='Enter')verifyInput('ver-plu')">
        <button onclick="verifyInput('ver-plu')">Caută PLU</button>
        <button class="secondary" onclick="$('ver-result').innerHTML='';$('ver-q').value='';$('ver-plu').value=''">Golește</button>
      </div>
    </div>
    <div id="ver-result"></div>`;
}
window.pickVerify=async id=>{const p=await getProdById(id); showVerify(p); document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'))}
async function verifyInput(id){const p=await byCode($(id).value); if(!p)return $('ver-result').innerHTML='<div class="notice bad">Produs inexistent</div>'; showVerify(p)}
function showVerify(p){$('ver-result').innerHTML=`<div class="card"><h2>${esc(p.cod_bare)} ${esc(p.denumire)}</h2><div class="stat">${lei(p.pret)}</div><p>Cod: ${esc(p.cod_bare)} · PLU: ${esc(p.plu||'—')} · Stoc inițial: ${fmtCant(p.stoc||0)}</p></div>`}


function preturi(){
  $('main').innerHTML = `
    <h1>Prețuri schimbate</h1>
    <div class="card">
      <div class="row">
        <button onclick="exportPreturiExcel()">Export Excel</button>
        <button class="red" onclick="clearPreturiSchimbate()">Golește total</button>
        <button class="orange" onclick="sendPreturiToEtichete()">Trimite în etichete preț</button>
      </div>
      <p class="muted">Aici vor apărea produsele cu preț modificat după importuri succesive. Le poți trimite direct în Etichete preț.</p>
    </div>
    <div class="card tbl-wrap">
      <table>
        <thead><tr><th>Cod</th><th>PLU</th><th>Denumire</th><th>Preț vechi</th><th>Preț nou</th><th>Data</th></tr></thead>
        <tbody id="preturi-body"></tbody>
      </table>
    </div>`;
  renderPreturi();
}

let INV_LINES=[];
function inventar(){
  $('main').innerHTML=`<h1>Inventar</h1>
    <div class="grid2">
      <div class="card">
        <input class="input" id="inv-name" placeholder="Nume inventar" value="Inventar ${new Date().toLocaleString('ro-RO')}">
        <button onclick="INV_LINES=[];renderInvLines()">Deschide inventar nou</button>
      </div>
      <div class="card">
        ${productSearchHtml('inv-q','pickInv')}
        <div class="row">
          <input class="input" style="max-width:260px" id="inv-plu" placeholder="Introdu PLU manual" onkeydown="if(event.key==='Enter')addInvByInput('inv-plu')">
          <button onclick="addInvByInput('inv-plu')">Caută PLU</button>
          <button class="secondary" onclick="exportInvExcel()">Export Excel</button>
          <button class="secondary" onclick="exportInvWord()">Export Word</button>
          <button class="red" onclick="clearInventarLinii()">Golește inventar</button>
        </div>
      </div>
    </div>
    <div id="inv-msg"></div>
    <div class="card" id="inv-summary"></div>
    <div class="card tbl-wrap">
      <table>
        <thead><tr><th>Cod</th><th>PLU</th><th>Denumire</th><th>Preț</th><th>Stoc scriptic</th><th>Cantitate inventariată</th><th>Diferență</th><th>Valoare inventar</th><th>Dif. valorică</th><th></th></tr></thead>
        <tbody id="inv-body"></tbody>
      </table>
    </div>`;
  renderInvLines();
}
window.pickInv=async id=>{const p=await getProdById(id); addInvLine(p); document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'))}
async function addInvByInput(id){
  const p=await byCode($(id).value);
  if(!p){$('inv-msg').innerHTML='<div class="notice bad">Produs inexistent</div>';return}
  $('inv-msg').innerHTML='';
  addInvLine(p);
  $(id).value='';
}
function addInvLine(p){
  let e=INV_LINES.find(x=>x.id===p.id);
  if(e)e.cantitate=parseCant(e.cantitate)+1;
  else INV_LINES.push({...p,cantitate:1,pret:money(p.pret)});
  renderInvLines();
}
function renderInvLines(){
  const tb=$('inv-body'); if(!tb)return;
  let totalCant=0,totalVal=0,totalDifCant=0,totalDifVal=0;
  INV_LINES.forEach(l=>{
    const cant=parseCant(l.cantitate), stoc=parseCant(l.stoc||0), pret=money(l.pret);
    totalCant+=cant;
    totalVal+=cant*pret;
    totalDifCant+=cant-stoc;
    totalDifVal+=(cant-stoc)*pret;
  });
  $('inv-summary').innerHTML=`<div class="row">
    <span class="pill">Total cantitativ: ${fmtCant(totalCant)}</span>
    <span class="pill">Total valoric inventar: ${lei(totalVal)}</span>
    <span class="pill">Diferență cantitativă: ${fmtCant(totalDifCant)}</span>
    <span class="pill">Diferență valorică: ${lei(totalDifVal)}</span>
  </div>`;
  tb.innerHTML=INV_LINES.length?INV_LINES.map((l,i)=>{
    const cant=parseCant(l.cantitate), stoc=parseCant(l.stoc||0), pret=money(l.pret), dif=cant-stoc;
    return `<tr>
      <td>${esc(l.cod_bare)}</td>
      <td>${esc(l.plu)}</td>
      <td>${esc(l.denumire)}</td>
      <td>${lei(pret)}</td>
      <td>${fmtCant(stoc)}</td>
      <td><input class="input" style="max-width:140px" value="${fmtCant(cant)}" onfocus="this.select()" onkeydown="if(event.key==='Enter')setInvQty(${i},this.value)" onblur="setInvQty(${i},this.value)"></td>
      <td>${fmtCant(dif)}</td>
      <td>${lei(cant*pret)}</td>
      <td>${lei(dif*pret)}</td>
      <td><button class="red" onclick="INV_LINES.splice(${i},1);renderInvLines()">×</button></td>
    </tr>`
  }).join(''):'<tr><td colspan="10" class="muted">Nu ai linii inventar.</td></tr>'
}
function setInvQty(i,v){if(!INV_LINES[i])return; const q=parseCant(v); if(q<0)return; INV_LINES[i].cantitate=q; renderInvLines()}
function invRows(){
  return INV_LINES.map(l=>{
    const cant=parseCant(l.cantitate), stoc=parseCant(l.stoc||0), pret=money(l.pret), dif=cant-stoc;
    return {
      cod:l.cod_bare, plu:l.plu, denumire:l.denumire, pret,
      stoc_scriptic:stoc, cantitate_inventariata:cant, diferenta:dif,
      valoare_inventar:cant*pret, diferenta_valorica:dif*pret
    };
  });
}
function clearInventarLinii(){
  if(!confirm('Golești toate liniile adăugate în inventar?')) return;
  INV_LINES=[];
  renderInvLines();
}
function exportInvExcel(){downloadExcel('inventar.xlsx', invRows(), 'Inventar')}
function exportInvWord(){
  const rows=invRows();
  const table=`<table><thead><tr><th>Cod</th><th>PLU</th><th>Denumire</th><th>Preț</th><th>Stoc</th><th>Cantitate</th><th>Dif.</th><th>Valoare</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.cod)}</td><td>${esc(r.plu)}</td><td>${esc(r.denumire)}</td><td>${lei(r.pret)}</td><td>${fmtCant(r.stoc_scriptic)}</td><td>${fmtCant(r.cantitate_inventariata)}</td><td>${fmtCant(r.diferenta)}</td><td>${lei(r.valoare_inventar)}</td></tr>`).join('')}</tbody></table>`;
  downloadWord('inventar.doc','Inventar',table);
}

function getIntrariFilters(){
  return {
    q: $('intrari-search')?.value || '',
    zi: $('intrari-data')?.value || '',
    luna: $('intrari-luna')?.value || '',
    an: $('intrari-an')?.value || ''
  };
}

function intrareMatchesFilters(x, f){
  const data = String(x.data || '').slice(0,10);
  const an = data.slice(0,4);
  const luna = data.slice(0,7);

  if(f.zi && data !== f.zi) return false;
  if(f.luna && luna !== f.luna) return false;
  if(f.an && an !== f.an) return false;

  const q = String(f.q || '').trim();
  if(!q) return true;

  const code = cleanCode(q);
  const nq = norm(q);
  const words = nq.split(/\s+/).filter(Boolean);

  const den = norm(x.denumire || '');
  const nr = norm(x.nr || '');
  const furn = norm(x.furnizor || '');
  const cod = String(x.cod_bare || '');
  const plu = String(x.plu || '');

  if(code && (cod.includes(code) || plu.includes(code))) return true;
  if(nq && (den.includes(nq) || nr.includes(nq) || furn.includes(nq))) return true;

  const haystack = `${den} ${nr} ${furn} ${cod} ${plu}`;
  if(words.length && words.every(w => haystack.includes(w))) return true;

  return false;
}

function sortIntrariNewestFirst(rows){
  return rows.sort((a,b)=>{
    const da = String(a.data || '');
    const db = String(b.data || '');
    if(db !== da) return db.localeCompare(da);
    const na = String(a.nr || '');
    const nb = String(b.nr || '');
    return nb.localeCompare(na);
  });
}

async function searchIntrariRows(filters=null, limit=2000){
  const f = filters || getIntrariFilters();

  // Pentru că avem filtre combinate pe dată/lună/an/produs, citim din IndexedDB și filtrăm local.
  // La 70k rânduri este acceptabil și evită rezultate greșite din filtre separate.
  const all = await getAll('intrari');
  const rows = all.filter(x => intrareMatchesFilters(x, f));
  return sortIntrariNewestFirst(rows).slice(0, limit);
}

async function renderIntrariView(filters=null){
  const f = filters || getIntrariFilters();
  const rows = await searchIntrariRows(f, 2000);
  const total = await countStore('intrari');

  const lunar = {};
  let cantTotal = 0, valTotal = 0;

  rows.forEach(x=>{
    const luna = String(x.data || 'fără dată').slice(0,7);
    const val = money(x.valoare);
    lunar[luna] = (lunar[luna] || 0) + val;
    cantTotal += money(x.cantitate);
    valTotal += val;
  });

  const monthHtml = Object.entries(lunar)
    .sort((a,b)=>b[0].localeCompare(a[0]))
    .map(([k,v])=>`<p>${esc(k)}: <b>${lei(v)}</b></p>`)
    .join('') || '<p class="muted">Nicio intrare găsită.</p>';

  const rowsHtml = rows.map(x=>`<tr>
    <td>${esc(x.data)}</td>
    <td>${esc(x.nr)}</td>
    <td>${esc(x.cod_bare)}</td>
    <td>${esc(x.plu)}</td>
    <td>${esc(x.denumire)}</td>
    <td>${fmtCant(x.cantitate)}</td>
    <td>${lei(x.pret)}</td>
    <td>${lei(x.valoare)}</td>
    <td>${esc(x.furnizor || '')}</td>
  </tr>`).join('');

  $('intrari-results').innerHTML = `
    <div class="grid2">
      <div class="card">
        <h3>Totaluri rezultate filtrate</h3>
        <p>Rânduri găsite/afișate: <b>${rows.length}</b> din ${total}</p>
        <p>Cantitate totală: <b>${fmtCant(cantTotal)}</b></p>
        <p>Valoare totală: <b>${lei(valTotal)}</b></p>
        <hr>${monthHtml}
      </div>
      <div class="card">
        <h3>Verificare produs</h3>
        <p class="muted">Poți verifica manual după cod bare, PLU, denumire, document sau furnizor. Rezultatele sunt afișate de la cea mai nouă dată spre cea mai veche.</p>
        <button class="secondary" onclick="exportIntrariCautare()">Export rezultate filtrate Excel</button>
      </div>
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
        <tbody>${rowsHtml || '<tr><td colspan="9" class="muted">Nu există rezultate.</td></tr>'}</tbody>
      </table>
    </div>`;
}

async function cautaIntrari(){
  await renderIntrariView(getIntrariFilters());
}

function golesteFiltreIntrari(){
  ['intrari-search','intrari-data','intrari-luna','intrari-an'].forEach(id=>{
    const el=$(id);
    if(el) el.value='';
  });
  renderIntrariView({q:'',zi:'',luna:'',an:''});
}

async function exportIntrariCautare(){
  const rows = await searchIntrariRows(getIntrariFilters(), 1000000);
  downloadExcel('intrari_filtrate.xlsx', rows.map(x=>({
    data:x.data, document:x.nr, cod:x.cod_bare, plu:x.plu, denumire:x.denumire,
    cantitate:x.cantitate, pret:x.pret, valoare:x.valoare, furnizor:x.furnizor||''
  })), 'Intrari filtrate');
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
        <input class="input" id="intrari-search" style="max-width:520px"
          placeholder="Cod bare / PLU / denumire / cuvinte cheie / document / furnizor"
          onkeydown="if(event.key==='Enter')cautaIntrari()">
        <button onclick="cautaIntrari()">Caută în intrări</button>
        <button class="secondary" onclick="$('intrari-search').value='';renderIntrariView('')">Golește</button>
      </div>
      <p class="muted">Exemplu: scanezi codul de bare, scrii PLU-ul sau cauți după cuvinte cheie din denumire și vezi când a intrat, cantitatea, prețul, documentul și furnizorul.</p>
    </div>

    <div id="intrari-results">
      <div class="notice">Se încarcă din IndexedDB...</div>
    </div>`;
  await renderIntrariView('');
}

async function exportIntrari(){
  const rows=sortIntrariNewestFirst(await getAll('intrari'));
  downloadExcel('intrari.xlsx', rows.map(x=>({
    data:x.data, document:x.nr, cod:x.cod_bare, plu:x.plu, denumire:x.denumire,
    cantitate:x.cantitate, pret:x.pret, valoare:x.valoare, furnizor:x.furnizor||''
  })), 'Intrari');
}
async function exportIntrariExcel(){ return exportIntrari(); }

function downloadWord(name, title, htmlTable){
  const html=`<!doctype html><html><head><meta charset="utf-8">
  <style>body{font-family:Arial}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px}th{background:#eee}</style>
  </head><body><h1>${esc(title)}</h1>${htmlTable}</body></html>`;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([html],{type:'application/msword'}));
  a.download=name;
  a.click();
  URL.revokeObjectURL(a.href);
}


function downloadExcel(name, rows, sheetName='Export'){
  rows = Array.isArray(rows) ? rows : [];
  const safeName = String(name || 'export.xlsx').replace(/\.csv$/i,'.xlsx');

  if(window.XLSX){
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, String(sheetName || 'Export').slice(0,31));
    XLSX.writeFile(wb, safeName);
    return;
  }

  const cols = rows.length ? Object.keys(rows[0]) : ['info'];
  const body = rows.length ? rows : [{info:'Nu există date de exportat'}];

  const escCell = v => String(v ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');

  const table = `<table><thead><tr>${cols.map(c=>`<th>${escCell(c)}</th>`).join('')}</tr></thead>
    <tbody>${body.map(r=>`<tr>${cols.map(c=>`<td>${escCell(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
    <style>table{border-collapse:collapse}td,th{border:1px solid #999;padding:6px}th{background:#eee}</style>
    </head><body>${table}</body></html>`;

  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([html],{type:'application/vnd.ms-excel'}));
  a.download=safeName.replace(/\.xlsx$/i,'.xls');
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadText(name,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));a.download=name;a.click();URL.revokeObjectURL(a.href)}

window.addEventListener('load',()=>init().catch(e=>showFatal(e,'Pornire aplicație')));


async function iesiri(){
  let rows=[];
  try{ rows=sortIntrariNewestFirst(await getAll('iesiri')); }catch(e){ rows=[]; }
  const total=rows.reduce((s,x)=>s+money(x.total),0);
  $('main').innerHTML=`<h1>Ieșiri / vânzări</h1>
    <div class="card row">
      <button onclick="exportIesiriExcel()">Export Excel ieșiri</button>
      <span class="pill">${rows.length} vânzări</span>
      <span class="pill">Total: ${lei(total)}</span>
    </div>
    <div class="card tbl-wrap">
      <table>
        <thead><tr><th>Data</th><th>Metodă</th><th>Produse</th><th>SGR</th><th>Total</th><th>Linii</th></tr></thead>
        <tbody>${rows.map(x=>`<tr>
          <td>${new Date(x.data).toLocaleString('ro-RO')}</td>
          <td>${esc(x.method)}</td>
          <td>${lei(x.produseTotal)}</td>
          <td>${lei(x.sgrTotal)}</td>
          <td><b>${lei(x.total)}</b></td>
          <td>${(x.linii||[]).map(l=>`${esc(l.denumire)} × ${fmtCant(l.cantitate)}`).join('<br>')}</td>
        </tr>`).join('') || '<tr><td colspan="6" class="muted">Nu există vânzări salvate.</td></tr>'}</tbody>
      </table>
    </div>`;
}

async function exportIesiriExcel(){
  let rows=[];
  try{ rows=sortIntrariNewestFirst(await getAll('iesiri')); }catch(e){ rows=[]; }
  const flat=[];
  rows.forEach(v=>{
    (v.linii||[]).forEach(l=>flat.push({
      data:new Date(v.data).toLocaleString('ro-RO'),
      metoda:v.method,
      cod:l.cod_bare,
      plu:l.plu,
      denumire:l.denumire,
      cantitate:parseCant(l.cantitate),
      pret:money(l.pret),
      total_linie:parseCant(l.cantitate)*money(l.pret),
      total_bon:v.total
    }));
  });
  downloadExcel('iesiri_vanzari.xlsx', flat, 'Iesiri');
}


function hasSGR(p){
  return norm(p?.denumire || '').includes('sgr');
}
function labelBasePrice(p){
  const pret = money(p?.pret);
  return hasSGR(p) ? Math.max(0, pret - 0.50) : pret;
}
function labelTotalPrice(p){
  const pret = money(p?.pret);
  return hasSGR(p) ? pret : pret;
}
function leiParts(n){
  const s = (Number(n)||0).toFixed(2).replace('.', ',');
  const [leiP, baniP] = s.split(',');
  return {lei: leiP, bani: baniP};
}
function labelCardHtml(p, i, editable=false){
  const base = leiParts(labelBasePrice(p));
  const total = lei(labelTotalPrice(p));
  const sgr = hasSGR(p);
  const code = esc(p.cod_bare || p.plu || '');
  const den = esc(p.denumire || '');
  return `<div class="price-label-24" ${editable?'contenteditable="true"':''}>
    <button class="label-x no-print" onclick="LABEL_LINES.splice(${i},1);renderLabels()">×</button>
    <div class="label-name">${den}</div>
    <div class="label-line"></div>
    <svg id="label-bc-${i}" class="label-barcode"></svg>
    <div class="label-price">
      <span class="label-lei">${base.lei}</span><span class="label-bani">,${base.bani}</span>
      <span class="label-currency">LEI</span>
    </div>
    <div class="label-bottom">
      <span>BUC</span>
      ${sgr ? `<span class="label-sgr">+ SGR<br>${total}</span>` : `<span></span>`}
    </div>
  </div>`;
}

function expandedLabelItems(){
  const copies = Math.max(1, Math.round(parseCant($('label-copies')?.value || 1)));
  const expanded = [];
  LABEL_LINES.forEach(p=>{
    const n = Math.max(1, Math.round(parseCant(p.cantitate || 1))) * copies;
    for(let i=0;i<n;i++) expanded.push(p);
  });
  return expanded;
}
function labelWordCellHtml(p){
  if(!p) return '&nbsp;';
  const base = leiParts(labelBasePrice(p));
  const total = lei(labelTotalPrice(p));
  const sgr = hasSGR(p);
  const den = esc(p.denumire || '');
  return `<div class="w-name">${den}</div>
    <div class="w-line"></div>
    <div class="w-price"><span class="w-lei">${base.lei}</span><span class="w-bani">,${base.bani}</span><span class="w-cur">LEI</span></div>
    <div class="w-bottom"><span>BUC</span>${sgr ? `<span class="w-sgr">+ SGR<br>${total}</span>` : `<span></span>`}</div>`;
}
function labelsWordTableHtml(){
  const items = expandedLabelItems();
  let html = '<table class="labels-table">';
  for(let r=0;r<8;r++){
    html += '<tr>';
    for(let c=0;c<3;c++){
      const idx = r*3+c;
      html += `<td class="label-cell">${labelWordCellHtml(items[idx])}</td>`;
    }
    html += '</tr>';
  }
  html += '</table>';
  return html;
}


function labelsPrintHtml(editable=false){
  const expanded = expandedLabelItems();
  return `<div class="labels-a4">${expanded.map((p,i)=>labelCardHtml(p,i,editable)).join('')}</div>`;
}
function exportLabelsWord(){
  const htmlLabels = labelsWordTableHtml();
  const html = `<!doctype html><html><head><meta charset="utf-8">
  <style>
    @page{size:A4;margin:8mm}
    body{font-family:Arial, sans-serif;margin:0}
    table.labels-table{border-collapse:collapse;table-layout:fixed;width:189mm;height:264mm}
    .label-cell{position:relative;width:63mm;height:33mm;border:1px solid #999;padding:2mm;vertical-align:top;overflow:hidden}
    .w-name{text-align:center;font-size:10pt;font-weight:bold;line-height:1.1;white-space:nowrap;overflow:hidden}
    .w-line{border-top:1px solid #333;margin:1mm 2mm}
    .w-price{text-align:center;font-weight:bold;line-height:.9;margin-top:3mm}
    .w-lei{font-size:30pt}
    .w-bani{font-size:15pt;vertical-align:top}
    .w-cur{font-size:9pt;margin-left:1mm}
    .w-bottom{position:absolute;left:3mm;right:3mm;bottom:2mm;display:flex;justify-content:space-between;align-items:flex-end;font-weight:bold;font-size:8pt}
    .w-sgr{background:#f7941d;color:white;border-radius:2mm;padding:1mm 2mm;text-align:center;font-size:8pt}
  </style></head><body>${htmlLabels}</body></html>`;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([html],{type:'application/msword'}));
  a.download='etichete_pret_editabile_3coloane_8randuri.doc';
  a.click();
  URL.revokeObjectURL(a.href);
}
function openLabelsPrint(){
  const htmlLabels = labelsPrintHtml(false);
  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Etichete preț</title>
  <style>
    @page{size:A4;margin:8mm}
    body{font-family:Arial, sans-serif;margin:0;background:#fff}
    .labels-a4{display:grid;grid-template-columns:repeat(3,63mm);grid-auto-rows:33mm;gap:0;align-items:stretch}
    .price-label-24{position:relative;box-sizing:border-box;width:63mm;height:33mm;border:1px solid #999;border-radius:0;padding:2mm;background:#fff;color:#333;overflow:hidden;break-inside:avoid}
    .label-x{display:none}
    .label-name{text-align:center;font-size:10pt;font-weight:700;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .label-line{border-top:1px solid #333;margin:1mm 2mm}
    .label-barcode{display:block;margin:0 auto;height:9mm;max-width:50mm}
    .label-price{text-align:center;font-weight:900;line-height:.9;margin-top:1mm}
    .label-lei{font-size:29pt}
    .label-bani{font-size:15pt;vertical-align:top}
    .label-currency{font-size:9pt;margin-left:1mm}
    .label-bottom{position:absolute;left:3mm;right:3mm;bottom:2mm;display:flex;justify-content:space-between;align-items:flex-end;font-weight:700;font-size:8pt}
    .label-sgr{background:#f7941d;color:white;border-radius:2mm;padding:1mm 2mm;text-align:center;font-size:8pt}
  </style></head><body>${htmlLabels}</body></html>`);
  w.document.close();
  setTimeout(()=>{
    try{
      const expanded = expandedLabelItems();
      expanded.forEach((p,i)=>{
        try{ JsBarcode(w.document.querySelector(`#label-bc-${i}`), String(p.cod_bare||p.plu||''), {format:'CODE128',displayValue:true,height:28,width:1.2,fontSize:9,margin:0}); }catch(e){}
      });
      w.focus();
      w.print();
    }catch(e){}
  },300);
}

function etichete(){
  $('main').innerHTML = `
    <h1>Etichete preț</h1>
    <div class="card">
      <h3>Adaugă produs pentru etichetă</h3>
      <div style="position:relative">
        <input class="input" id="label-q" placeholder="Scanează / cod bare / PLU / denumire"
          oninput="showSuggest('label-q','pickLabel')"
          onkeydown="if(event.key==='Enter')addLabelByInput('label-q')">
        <div class="suggest hide" id="label-q-s"></div>
      </div>
      <div class="row">
        <button onclick="addLabelByInput('label-q')">Adaugă etichetă</button>
        <label class="row" style="gap:8px">Copii/etichetă:
          <input class="input" id="label-copies" type="number" min="1" step="1" value="1" style="max-width:90px">
        </label>
        <button class="secondary" onclick="printLabels()">Tipărește 24/pagină</button>
        <button class="green" onclick="exportLabelsWord()">Export Word editabil</button>
        <button class="secondary" onclick="exportLabelsExcel()">Export Excel</button>
        <button class="red" onclick="clearLabels()">Golește etichete</button>
      </div>
      <p class="muted">Format A4: 24 etichete/pagină, 3 coloane × 8 rânduri. Pentru produse cu SGR în denumire, prețul mare este fără SGR, iar în dreapta jos apare totalul cu SGR.</p>
    </div>
    <div class="labels-a4 screen-labels" id="labels-grid"></div>`;
  renderLabels();
}

function backup(){
  $('main').innerHTML=`<h1>Backup / reset</h1>
    <div class="card row">
      <button onclick="backupJson()">Backup JSON</button>
      <button class="red" onclick="resetAllData()">Șterge toate datele</button>
      <button class="secondary" onclick="reloadData()">Reîncarcă date</button>
    </div>
    <p class="muted">Datele sunt salvate local în IndexedDB pe acest calculator/browser.</p>`;
}

async function backupJson(){
  const data={
    produse: await getAll('produse'),
    intrari: await getAll('intrari'),
    cart: CART,
    iesiri: await getAll('iesiri'),
    created: new Date().toISOString()
  };
  downloadText('gestiunepro_backup.json', JSON.stringify(data,null,2));
}


function renderPreturi(){
  const tb=$('preturi-body');
  if(!tb) return;
  tb.innerHTML = PRICE_CHANGES.length ? PRICE_CHANGES.map(x=>`<tr>
    <td>${esc(x.cod_bare||'')}</td>
    <td>${esc(x.plu||'')}</td>
    <td>${esc(x.denumire||'')}</td>
    <td>${x.pret_vechi!==undefined ? lei(x.pret_vechi) : '—'}</td>
    <td>${x.pret_nou!==undefined ? lei(x.pret_nou) : lei(x.pret||0)}</td>
    <td>${esc(x.data||'')}</td>
  </tr>`).join('') : '<tr><td colspan="6" class="muted">Nu există prețuri schimbate.</td></tr>';
}
function exportPreturiExcel(){
  downloadExcel('preturi_schimbate.xlsx', PRICE_CHANGES.map(x=>({
    cod:x.cod_bare||'', plu:x.plu||'', denumire:x.denumire||'', pret_vechi:x.pret_vechi||'', pret_nou:x.pret_nou||x.pret||'', data:x.data||''
  })), 'Preturi schimbate');
}
function clearPreturiSchimbate(){
  if(!confirm('Golești toate prețurile schimbate?')) return;
  PRICE_CHANGES=[];
  renderPreturi();
}
function sendPreturiToEtichete(){
  PRICE_CHANGES.forEach(x=>addLabelProduct({
    id:x.id, cod_bare:x.cod_bare, plu:x.plu, denumire:x.denumire, pret:x.pret_nou||x.pret||0
  }, 'preturi schimbate'));
  go('etichete');
}


window.pickLabel = async function(id){
  const p = await getProdById(id);
  if(p) addLabelProduct(p,'manual');
  document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'));
}
function renderLabels(){
  const grid=$('labels-grid');
  if(!grid) return;
  grid.innerHTML = LABEL_LINES.length ? LABEL_LINES.map((p,i)=>labelCardHtml(p,i,false)).join('') : '<div class="card">Nu ai etichete adăugate.</div>';
  setTimeout(()=>LABEL_LINES.forEach((p,i)=>{
    try{JsBarcode(`#label-bc-${i}`,String(p.cod_bare||p.plu||''),{format:'CODE128',displayValue:true,height:34,width:1.3,fontSize:10,margin:0})}catch(e){}
  }),50);
}
