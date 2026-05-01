let sb=null, USER=null, PROFILE=null, PAGE='dashboard';
let CART=[], INV_SESSION=null, INV_LINE=null, SCANNER=null;
let MAG=[];
const $=id=>document.getElementById(id);
const lei=n=>(Number(n)||0).toLocaleString('ro-RO',{minimumFractionDigits:2,maximumFractionDigits:2})+' lei';
const SGR_PRICE=0.50;
const isSGR=p=>String((typeof p==='string'?p:p?.denumire)||'').toUpperCase().includes('SGR');
const sgrVal=(p,qty=1)=>isSGR(p)?Number(qty||0)*SGR_PRICE:0;
const lineBase=(p,qty=1)=>Number(qty||0)*Number(p?.pret||0);
const lineTotal=(p,qty=1)=>lineBase(p,qty)+sgrVal(p,qty);
const roDate=d=>d?new Date(d).toLocaleString('ro-RO'):'';
const toast=m=>{const d=document.createElement('div');d.textContent=m;d.style.cssText='position:fixed;right:16px;bottom:16px;background:#111827;border:1px solid #374151;color:white;padding:12px 16px;border-radius:12px;z-index:9999';document.body.appendChild(d);setTimeout(()=>d.remove(),3600)};
function showUpdateBanner(){
 if(document.getElementById('update-banner')) return;
 const b=document.createElement('div');
 b.id='update-banner';
 b.style.cssText='position:fixed;left:16px;right:16px;bottom:16px;background:#0f172a;border:1px solid #60a5fa;color:#fff;padding:14px 16px;border-radius:14px;z-index:10000;box-shadow:0 10px 40px rgba(0,0,0,.45);display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap';
 b.innerHTML='<b>Există o versiune nouă GestiunePro.</b><button style="background:#2563eb;color:white;border:0;border-radius:10px;padding:10px 14px;font-weight:800" onclick="location.reload()">Actualizează acum</button>';
 document.body.appendChild(b);
}
function registerAutoUpdate(){
 if(!('serviceWorker' in navigator)) return;
 navigator.serviceWorker.register('./sw.js').then(reg=>{
   if(reg.waiting){ reg.waiting.postMessage({type:'SKIP_WAITING'}); showUpdateBanner(); }
   reg.addEventListener('updatefound',()=>{
     const nw=reg.installing;
     if(!nw) return;
     nw.addEventListener('statechange',()=>{
       if(nw.state==='installed' && navigator.serviceWorker.controller){
         nw.postMessage({type:'SKIP_WAITING'});
         showUpdateBanner();
       }
     });
   });
   setInterval(()=>reg.update().catch(()=>{}), 5*60*1000);
 }).catch(()=>{});
 navigator.serviceWorker.addEventListener('message',event=>{
   if(event.data && event.data.type==='APP_UPDATED') showUpdateBanner();
 });
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
   if(!sessionStorage.getItem('gp_reloaded_after_update')){
     sessionStorage.setItem('gp_reloaded_after_update','1');
     location.reload();
   }
 });
 window.addEventListener('focus',()=>{
   navigator.serviceWorker.getRegistration().then(reg=>reg&&reg.update()).catch(()=>{});
 });
}
const admin=()=>PROFILE?.role==='administrator';
const allowedEmployee=['cos','verificare','inventar','etichete'];
function mustConfig(){return !window.GP_CONFIG||!GP_CONFIG.SUPABASE_URL||GP_CONFIG.SUPABASE_URL.includes('PROIECTUL_TAU')||!GP_CONFIG.SUPABASE_ANON_KEY||GP_CONFIG.SUPABASE_ANON_KEY.includes('CHEIA')}
function init(){
 if(mustConfig()){document.body.innerHTML='<div class="login card"><h2>Configurare necesară</h2><p>Copiază <b>config.example.js</b> în <b>config.js</b> și completează SUPABASE_URL și SUPABASE_ANON_KEY.</p></div>';return}
 sb=supabase.createClient(GP_CONFIG.SUPABASE_URL,GP_CONFIG.SUPABASE_ANON_KEY);
 registerAutoUpdate();
 sb.auth.getSession().then(async({data})=>{if(data.session){USER=data.session.user;await loadProfile();render()}else renderLogin()});
}
function renderLogin(){document.getElementById('app').innerHTML=`<div class="login card"><h1>Login angajați</h1><input class="input" id="email" placeholder="email"><input class="input" id="pass" type="password" placeholder="parolă"><button onclick="login()">Intră</button><p class="muted">Conturile se creează de administrator în Supabase Authentication. Parola trebuie setată înainte.</p></div>`}
async function login(){const {data,error}=await sb.auth.signInWithPassword({email:$('email').value.trim(),password:$('pass').value}); if(error)return toast('Login eșuat: '+error.message); USER=data.user; await loadProfile(); render();}
async function logout(){await sb.auth.signOut(); USER=null; PROFILE=null; renderLogin()}
async function loadProfile(){let {data,error}=await sb.from('profiles').select('*').eq('id',USER.id).single(); if(error){toast('Profil lipsă. Verifică tabelul profiles.');} PROFILE=data||{email:USER.email,role:'angajat',active:true};}
function navBtn(id,label){if(!admin()&&!allowedEmployee.includes(id))return'';return `<button id="nav-${id}" onclick="go('${id}')">${label}</button>`}
function render(){document.getElementById('app').innerHTML=`<div class="wrap"><aside class="side"><div class="row"><div class="brand">Gestiune<span>Pro</span></div><button class="secondary" onclick="logout()">Ieșire</button></div><p class="muted">${PROFILE.email}<br><span class="pill ${admin()?'admin':''}">${PROFILE.role}</span></p><div class="nav">${navBtn('dashboard','📊 Dashboard')}${navBtn('cos','🛒 Coș cumpărături')}${navBtn('verificare','🔍 Verificare preț')}${navBtn('preturi','🏷 Prețuri schimbate')}${navBtn('inventar','📦 Inventar')}${navBtn('intrari','📥 Intrări')}${navBtn('iesiri','📤 Ieșiri')}${navBtn('etichete','🏷 Etichete preț')}${navBtn('receptie','🚚 Recepție marfă')}${navBtn('magazie','🚛 Fișă magazie')}${navBtn('utilizatori','👥 Utilizatori')}${navBtn('audit','🧾 Audit log')}${navBtn('backup','💾 Backup')}</div></aside><main class="main" id="main"></main></div>`; go(admin()?'dashboard':'cos'); realtime();}
function go(p){if(!admin()&&!allowedEmployee.includes(p))return toast('Acces interzis pentru angajat'); PAGE=p; document.querySelectorAll('.nav button').forEach(b=>b.classList.remove('active')); if($('nav-'+p))$('nav-'+p).classList.add('active'); ({dashboard,cos,verificare,preturi,inventar,intrari,iesiri,etichete,receptie,magazie,utilizatori,audit,backup}[p])();}
async function dashboard(){
 const [pr,vz,rec,inv]=await Promise.all([
  sb.from('produse').select('id',{count:'exact',head:true}),
  sb.from('vanzari').select('total,created_at').gte('created_at',new Date(new Date().setHours(0,0,0,0)).toISOString()),
  sb.from('receptii').select('id',{count:'exact',head:true}),
  sb.from('inventar_sesiuni').select('id',{count:'exact',head:true})
 ]);
 const total=(vz.data||[]).reduce((s,x)=>s+Number(x.total),0);
 $('main').innerHTML=`<h1>Dashboard Administrator</h1>
 <div class="grid"><div class="card"><div class="stat">${pr.count||0}</div><div class="muted">Produse</div></div><div class="card"><div class="stat">${lei(total)}</div><div class="muted">Vânzări azi</div></div><div class="card"><div class="stat">${rec.count||0}</div><div class="muted">Recepții</div></div><div class="card"><div class="stat">${inv.count||0}</div><div class="muted">Inventare</div></div></div>
 <div class="grid2">
  <div class="card"><h3>🛒 Coș cumpărături</h3><p>Vânzare produse, Cash/Card, scădere automată stoc.</p><button onclick="go('cos')">Deschide coș</button></div>
  <div class="card"><h3>🔍 Verificare preț</h3><p>Caută după cod de bare, PLU sau denumire.</p><button onclick="go('verificare')">Verifică preț</button></div>
  <div class="card"><h3>📦 Inventar</h3><p>Stoc scriptic, cantitate inventariată, diferență, blocare conflicte.</p><button onclick="go('inventar')">Deschide inventar</button></div>
  <div class="card"><h3>📥 Intrări</h3><p>Recepții: data, furnizor, produs, cantitate, preț.</p><button onclick="go('intrari')">Vezi intrări</button></div>
  <div class="card"><h3>🚛 Fișă magazie</h3><p>Transport marfă între magazine, cu produse din MAMA, SGR, export Excel și Word.</p><button onclick="go('magazie')">Deschide fișă magazie</button></div>
  <div class="card"><h3>📤 Ieșiri</h3><p>Vânzări: data, produs, cantitate, metoda plată.</p><button onclick="go('iesiri')">Vezi ieșiri</button></div>
  <div class="card"><h3>⬆ Import produse Excel</h3><input class="input" type="file" accept=".xlsx,.xls" onchange="importProduse(event)"><p class="muted">Poți încărca zilnic fișierul MAMA exact cum este: denumire, um, pret_v_tva, cod_bare, plu. Aplicația compară automat prețurile și trimite modificările în Prețuri schimbate.</p></div>
 </div>`;
}
async function searchProducts(q){if(!q)return[]; q=q.trim(); let safe=q.replaceAll(',',' ').trim(); let res=await sb.from('produse').select('*').or(`cod_bare.eq.${safe},plu.eq.${safe},denumire.ilike.%${safe}%`).limit(25); return res.data||[]}
function productPicker(id,onpick){return `<div style="position:relative"><input class="input" id="${id}" placeholder="Cod bare / PLU / denumire" oninput="pickSearch('${id}','${onpick}')"><div class="suggest hide" id="${id}-s"></div></div>`}
window.pickSearch=async(id,onpick)=>{const q=$(id).value; const s=$(id+'-s'); const arr=await searchProducts(q); if(!arr.length){s.classList.add('hide');return}s.classList.remove('hide');s.innerHTML=arr.map(p=>`<div onclick="${onpick}(${p.id})"><b>${p.cod_bare}</b>${p.plu?` · PLU ${p.plu}`:''} — ${p.denumire} <span style="float:right">${lei(p.pret)}</span></div>`).join('')}
async function pickCart(id){const {data}=await sb.from('produse').select('*').eq('id',id).single(); addCart(data); document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'))}
function addCart(p){let e=CART.find(x=>x.id===p.id); if(e)e.cantitate++; else CART.push({...p,cantitate:1}); renderCart()}
function cos(){ $('main').innerHTML=`<h1>Coș cumpărături</h1><div class="grid2"><div class="card"><h3>Adaugă produs</h3>${productPicker('cart-q','pickCart')}<button onclick="startCamera('cart')">📷 Scanează cu camera</button><div id="reader" class="scanBox hide"></div><p class="muted">Caută după denumire, cod de bare sau PLU. SGR se recunoaște automat din denumirea produsului.</p></div><div class="card"><h3>Plată</h3><div id="cart-subtotal" class="muted">Produse: 0 lei</div><div id="cart-sgr" class="muted">SGR: 0 lei</div><div id="cart-total" class="stat">0 lei</div><button class="green" onclick="pay('cash')">Plată Cash</button> <button onclick="pay('card')">Plată Card</button> <button class="red" onclick="CART=[];renderCart()">Golește</button><div style="margin-top:12px"><button class="secondary" onclick="exportCosExcel()">Export coș Excel</button> <button class="secondary" onclick="exportCosWord()">Export coș Word</button> <button class="secondary" onclick="shareCos()">Trimite coș</button></div></div></div><div class="card"><table><thead><tr><th>Cod</th><th>PLU</th><th>Denumire</th><th>SGR</th><th>Cant.</th><th>Preț</th><th>Valoare produse</th><th>SGR</th><th>Total</th><th></th></tr></thead><tbody id="cart-body"></tbody></table></div>`; renderCart()}
function renderCart(){if(!$('cart-body'))return; let subtotal=0,totalSgr=0,total=0; $('cart-body').innerHTML=CART.map((i,idx)=>{let qty=Number(i.cantitate)||1;let base=lineBase(i,qty);let sgr=sgrVal(i,qty);let line=base+sgr;subtotal+=base;totalSgr+=sgr;total+=line;return`<tr><td>${i.cod_bare}</td><td>${i.plu||''}</td><td>${i.denumire}</td><td>${isSGR(i)?'<span class="pill">SGR</span>':'—'}</td><td><input style="width:80px" class="input" type="number" step="0.001" value="${i.cantitate}" onchange="CART[${idx}].cantitate=Number(this.value)||1;renderCart()"></td><td>${lei(i.pret)}</td><td>${lei(base)}</td><td>${sgr?lei(sgr):'—'}</td><td><b>${lei(line)}</b></td><td><button class="red" onclick="CART.splice(${idx},1);renderCart()">X</button></td></tr>`}).join('')||'<tr><td colspan="10">Coș gol</td></tr>'; if($('cart-subtotal'))$('cart-subtotal').textContent='Produse: '+lei(subtotal); if($('cart-sgr'))$('cart-sgr').textContent='SGR: '+lei(totalSgr); if($('cart-total'))$('cart-total').textContent=lei(total)}
async function pay(m){if(!CART.length)return toast('Coș gol'); const items=CART.map(x=>({cod_bare:x.cod_bare,cantitate:x.cantitate})); const {data,error}=await sb.rpc('finalize_sale',{p_metoda:m,p_items:items}); if(error)return toast('Eroare plată: '+error.message); CART=[]; renderCart(); toast('Vânzare salvată #'+data)}
function verificare(){ $('main').innerHTML=`<h1>Verificare preț</h1><div class="card"><button onclick="startCamera('price')">📷 Scanează cu camera</button>${productPicker('price-q','showPrice')}<div id="reader" class="scanBox hide"></div><div id="price-result"></div></div>`}
async function showPrice(id){const {data:p}=await sb.from('produse').select('*').eq('id',id).single(); const sgr=isSGR(p); $('price-result').innerHTML=`<div class="card"><h2>${p.denumire}</h2><div class="stat">${lei(p.pret)}</div>${sgr?`<p><span class="pill">SGR</span> + ${lei(SGR_PRICE)} ambalaj returnabil · Total/bucată: <b>${lei(Number(p.pret||0)+SGR_PRICE)}</b></p>`:''}<p>Cod: ${p.cod_bare} · PLU: ${p.plu||'—'} · Stoc: ${p.stoc} · Categorie: ${p.categorie||'—'}</p></div>`; document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'))}

async function preturi(){
  const {data,error}=await sb.from('price_changes').select('*').order('created_at',{ascending:false}).limit(1000);
  if(error)return toast('Rulează migration_v4_price_changes.sql în Supabase: '+error.message);
  $('main').innerHTML=`<h1>Prețuri schimbate</h1>
  <div class="card"><p class="muted">Aici apar automat produsele la care prețul s-a schimbat la importul zilnic MAMA. Poți trimite toate direct în Etichete preț.</p><button onclick="addChangedPricesToLabels()">Adaugă toate la etichete</button> <button onclick="exportPreturiSchimbateExcel()">Export Excel</button> <button class="secondary" onclick="markPriceChangesPrinted()">Marchează ca tipărite</button></div>
  <div class="card"><table><thead><tr><th>Data</th><th>Cod</th><th>PLU</th><th>Denumire</th><th>Preț vechi</th><th>Preț nou</th><th>Diferență</th><th>Status</th><th>Acțiune</th></tr></thead><tbody>${(data||[]).map(x=>`<tr><td>${roDate(x.created_at)}</td><td>${x.cod_bare}</td><td>${x.plu||''}</td><td>${x.denumire}</td><td>${lei(x.pret_vechi)}</td><td>${lei(x.pret_nou)}</td><td>${lei(Number(x.pret_nou)-Number(x.pret_vechi))}</td><td>${x.printed?'tipărit':'de tipărit'}</td><td><button onclick="addChangedOne('${x.id}')">Etichetă</button></td></tr>`).join('')}</tbody></table></div>`;
}
async function addChangedPricesToLabels(){const {data}=await sb.from('price_changes').select('*').eq('printed',false).order('created_at',{ascending:false}).limit(1000); window.LABELS=window.LABELS||[]; (data||[]).forEach(x=>LABELS.push({cod_bare:x.cod_bare,plu:x.plu,denumire:x.denumire,pret:x.pret_nou})); toast('Adăugate la etichete: '+(data||[]).length); etichete();}
async function addChangedOne(id){const {data:x}=await sb.from('price_changes').select('*').eq('id',id).single(); if(!x)return; window.LABELS=window.LABELS||[]; LABELS.push({cod_bare:x.cod_bare,plu:x.plu,denumire:x.denumire,pret:x.pret_nou}); toast('Adăugat la etichete'); etichete();}
async function markPriceChangesPrinted(){const {error}=await sb.from('price_changes').update({printed:true}).eq('printed',false); if(error)return toast(error.message); toast('Marcate ca tipărite'); preturi();}
async function exportPreturiSchimbateExcel(){const {data}=await sb.from('price_changes').select('created_at,cod_bare,plu,denumire,pret_vechi,pret_nou,printed').order('created_at',{ascending:false}).limit(200000); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,sheetWithHeaders(data||[],['created_at','cod_bare','plu','denumire','pret_vechi','pret_nou','printed']),'preturi_schimbate'); XLSX.writeFile(wb,'preturi_schimbate.xlsx')}

async function inventar(){const {data:sesiuni}=await sb.from('inventar_sesiuni').select('*').eq('status','deschis').order('created_at',{ascending:false}).limit(20); $('main').innerHTML=`<h1>Inventar</h1><div class="grid2"><div class="card"><h3>Sesiune</h3><input class="input" id="inv-name" placeholder="Ex: Inventar ${new Date().toLocaleDateString('ro-RO')}"><button onclick="newInv()">Deschide inventar</button><select class="input" id="inv-sel" onchange="INV_SESSION=this.value">${(sesiuni||[]).map(s=>`<option value="${s.id}">${s.nume}</option>`).join('')}</select></div><div class="card"><h3>Scanare produs</h3><input class="input" id="inv-code" placeholder="Cod bare sau PLU" onkeydown="if(event.key==='Enter')lockInv()"><button onclick="lockInv()">Verifică produs</button> <button onclick="startCamera('inv')">📷 Camera</button><div id="reader" class="scanBox hide"></div></div></div><div id="inv-work"></div><div class="card"><button onclick="showInvLines()">Vezi linii inventar</button> <button onclick="exportInventarExcel()">Export inventar Excel</button> <button class="secondary" onclick="exportInventarWord()">Export Word</button></div><div id="inv-lines"></div>`; if(sesiuni?.[0]&&!INV_SESSION)INV_SESSION=sesiuni[0].id;}
async function newInv(){const nume=$('inv-name').value||('Inventar '+new Date().toLocaleString('ro-RO')); const {data,error}=await sb.from('inventar_sesiuni').insert({nume,created_by:USER.id}).select().single(); if(error)return toast(error.message); INV_SESSION=data.id; inventar();}
async function lockInv(){if(!INV_SESSION)return toast('Alege/deschide sesiune inventar'); const cod=$('inv-code').value.trim(); if(!cod)return; const {data,error}=await sb.rpc('lock_inventory_line',{p_sesiune:INV_SESSION,p_cod:cod}); if(error)return $('inv-work').innerHTML=`<div class="card"><h2 style="color:#f87171">${error.message.includes('PRODUS_INEXISTENT')?'Produs inexistent':error.message}</h2></div>`; INV_LINE=data; const dif=(Number(data.stoc_faptic||0)-Number(data.stoc_scriptic||0)); $('inv-work').innerHTML=`<div class="card"><h2>${data.denumire}</h2><p>Cod: ${data.cod_bare} · PLU: ${data.plu||'—'} · Stoc scriptic: ${data.stoc_scriptic}</p><input class="input" id="inv-qty" type="number" step="0.001" placeholder="Cantitate inventariată / stoc faptic"><button onclick="saveInvQty()">Salvează cantitatea</button></div>`}
async function saveInvQty(){const {error}=await sb.rpc('save_inventory_qty',{p_line:INV_LINE.id,p_qty:Number($('inv-qty').value)}); if(error)return toast(error.message); toast('Inventar salvat'); $('inv-code').value=''; $('inv-work').innerHTML=''; showInvLines();}
async function showInvLines(){if(!INV_SESSION)return toast('Alege sesiune'); const {data}=await sb.from('inventar_linii').select('*').eq('sesiune_id',INV_SESSION).order('created_at',{ascending:false}).limit(500); $('inv-lines').innerHTML=`<div class="card"><h3>Linii inventar</h3><table><thead><tr><th>Cod</th><th>PLU</th><th>Denumire</th><th>Stoc scriptic</th><th>Cantitate inventariată</th><th>Diferență</th></tr></thead><tbody>${(data||[]).map(x=>`<tr><td>${x.cod_bare}</td><td>${x.plu||''}</td><td>${x.denumire}</td><td>${x.stoc_scriptic??''}</td><td>${x.stoc_faptic??''}</td><td>${x.stoc_faptic==null?'':(Number(x.stoc_faptic)-Number(x.stoc_scriptic||0)).toFixed(3)}</td></tr>`).join('')}</tbody></table></div>`}
async function intrari(){const {data,error}=await sb.from('receptii_linii').select('*, receptii(created_at,furnizor,document)').order('id',{ascending:false}).limit(1000); if(error)return toast(error.message); $('main').innerHTML=`<h1>Intrări marfă</h1><div class="card"><button onclick="go('receptie')">Adaugă recepție</button> <button onclick="exportIntrariExcel()">Export intrări Excel</button></div><div class="card"><table><thead><tr><th>Data</th><th>Furnizor</th><th>Document</th><th>Cod</th><th>PLU</th><th>Produs</th><th>SGR</th><th>Cantitate</th><th>Preț</th></tr></thead><tbody>${(data||[]).map(x=>`<tr><td>${roDate(x.receptii?.created_at)}</td><td>${x.receptii?.furnizor||''}</td><td>${x.receptii?.document||''}</td><td>${x.cod_bare}</td><td>${x.plu||''}</td><td>${x.denumire}</td><td>${isSGR(x)?'<span class="pill">SGR</span>':'—'}</td><td>${x.cantitate}</td><td>${lei(x.pret)}</td></tr>`).join('')}</tbody></table></div>`}
async function iesiri(){const {data,error}=await sb.from('vanzari_linii').select('*, vanzari(created_at,metoda_plata)').order('id',{ascending:false}).limit(1000); if(error)return toast(error.message); $('main').innerHTML=`<h1>Ieșiri / Vânzări</h1><div class="card"><button onclick="exportIesiriExcel()">Export ieșiri Excel</button></div><div class="card"><table><thead><tr><th>Data</th><th>Metodă plată</th><th>Cod</th><th>PLU</th><th>Produs</th><th>SGR</th><th>Cantitate</th><th>Preț</th><th>Total</th></tr></thead><tbody>${(data||[]).map(x=>`<tr><td>${roDate(x.vanzari?.created_at)}</td><td>${x.vanzari?.metoda_plata||''}</td><td>${x.cod_bare}</td><td>${x.plu||''}</td><td>${x.denumire}</td><td>${isSGR(x)?'<span class="pill">SGR</span>':'—'}</td><td>${x.cantitate}</td><td>${lei(x.pret)}</td><td>${lei(x.total)}</td></tr>`).join('')}</tbody></table></div>`}
function etichete(){
  $('main').innerHTML=`<h1>Etichete preț</h1>
  <div class="card">
    <h3>Adaugă produs pentru etichetă</h3>
    ${productPicker('lab-q','addLabel')}
    <div class="row">
      <button onclick="addLabelByText()">Adaugă etichetă</button>
      <button class="secondary" onclick="startCamera('label')">📷 Scanează</button>
      <label class="row">Copii/etichetă:
        <input class="input" id="lab-copies" type="number" min="1" step="1" value="1" style="max-width:90px">
      </label>
      <label class="row">Text denumire:
        <input class="input" id="lab-name-size" type="number" value="12" min="7" max="20" step="0.5" style="max-width:90px" oninput="renderLabels()"> pt
      </label>
      <label class="row">Preț:
        <input class="input" id="lab-price-size" type="number" value="34" min="18" max="60" step="1" style="max-width:90px" oninput="renderLabels()"> pt
      </label>
    </div>
    <div class="row">
      <button class="secondary" onclick="printLabels()">Tipărește previzualizare</button>
      <button class="green" onclick="exportLabelsWordSmall()">Word mici 40×21 mm</button>
      <button class="green" onclick="exportLabelsWordLarge()">Word mari 50×35 mm</button>
      <button class="secondary" onclick="exportLabelsExcel()">Export Excel</button>
      <button class="red" onclick="LABELS=[];renderLabels()">Golește etichete</button>
    </div>
    <p class="muted">Etichete raft fără cod de bare. Codul din fața denumirii rămâne text. SGR apare doar unde denumirea conține SGR.</p>
  </div>
  <div id="labels" class="labels-a4"></div>`;
  window.LABELS=window.LABELS||[];
  renderLabels();
}

async function addLabelByText(){
  const q=$('lab-q')?.value?.trim();
  if(!q) return;
  const arr=await searchProducts(q);
  const p=arr && arr[0];
  if(!p) return toast('Produs inexistent');
  addLabel(p.id);
  $('lab-q').value='';
}

async function addLabel(id){
  const {data:p}=await sb.from('produse').select('*').eq('id',id).single();
  if(!p) return toast('Produs inexistent');
  window.LABELS=window.LABELS||[];
  const copies=Math.max(1,Math.round(Number($('lab-copies')?.value||1)));
  for(let i=0;i<copies;i++) window.LABELS.push(p);
  renderLabels();
  document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'));
}

function labelParts(n){
  const s=(Number(n)||0).toFixed(2).replace('.',',');
  const a=s.split(',');
  return {lei:a[0],bani:a[1]||'00'};
}

function labelPreviewHtml(p,i){
  const sgr=isSGR(p);
  const pret=Number(p.pret||0);
  const total=pret+(sgr?SGR_PRICE:0);
  const part=labelParts(pret);
  const ns=Number($('lab-name-size')?.value)||12;
  const ps=Number($('lab-price-size')?.value)||34;

  return `<div class="price-label-24 shelf-label-preview">
    <button class="label-x no-print" onclick="LABELS.splice(${i},1);renderLabels()">×</button>
    <input class="label-edit-name" style="font-size:${ns}px" value="${String(p.denumire||'').replace(/"/g,'&quot;')}" onchange="LABELS[${i}].denumire=this.value;renderLabels()">
    <div class="label-line"></div>
    <div class="label-price shelf-price" style="font-size:${ps}px">
      <span class="label-lei">${part.lei}</span><span class="label-bani">,${part.bani}</span><span class="label-currency">LEI</span>
    </div>
    <input class="label-edit-price" value="${pret.toFixed(2)}" onchange="LABELS[${i}].pret=Number(this.value)||0;renderLabels()">
    <div class="label-bottom label-bottom-sgr shelf-sgr-line">
      ${sgr?`<span class="label-total-sgr">TOTAL: ${total.toFixed(2).replace('.',',')} lei<br><small>cu SGR</small></span>`:'<span>BUC</span>'}
      ${sgr?`<span class="label-sgr">+ 0.50 BANI SGR</span>`:'<span></span>'}
    </div>
  </div>`;
}

function renderLabels(){
  if(!$('labels')) return;
  $('labels').innerHTML=(window.LABELS||[]).length
    ? (window.LABELS||[]).map((p,i)=>labelPreviewHtml(p,i)).join('')
    : '<div class="card">Nu ai etichete. Caută/Scanează produsul și adaugă-l.</div>';
}

function exportLabelsExcel(){
  const rows=(window.LABELS||[]).map(x=>({
    cod_bare:x.cod_bare||'',
    plu:x.plu||'',
    denumire:x.denumire||'',
    pret:Number(x.pret||0),
    sgr:isSGR(x)?'DA':'NU',
    pret_cu_sgr:Number(x.pret||0)+(isSGR(x)?SGR_PRICE:0)
  }));
  const ws=XLSX.utils.json_to_sheet(rows);
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Etichete');
  XLSX.writeFile(wb,'etichete_pret.xlsx');
}

function exportLabelsWordModel(model){
  const arr=window.LABELS||[];
  if(!arr.length) return toast('Nu ai etichete de exportat.');

  const isSmall=model==='small';
  const labelW=isSmall?40:50;   // mm
  const labelH=isSmall?21:35;   // mm
  const cols=isSmall?5:4;
  const rows=isSmall?13:8;
  const perPage=cols*rows;
  const pageW=cols*labelW;
  const pageH=rows*labelH;

  const items=arr.slice();
  while(items.length%perPage!==0) items.push(null);

  function cell(p){
    if(!p) return '<td class="cell empty"></td>';
    const sgr=isSGR(p);
    const pret=Number(p.pret||0);
    const total=pret+(sgr?SGR_PRICE:0);
    const part=labelParts(pret);
    return `<td class="cell">
      <div class="box">
        <div class="name">${String(p.denumire||'')}</div>
        <div class="sep"></div>
        <div class="price"><span class="lei">${part.lei}</span><span class="bani">,${part.bani}</span><span class="cur"> LEI</span></div>
        ${sgr?`<div class="sgr">+ 0.50 BANI SGR</div><div class="total">TOTAL: ${total.toFixed(2).replace('.',',')} lei</div>`:`<div class="unit">BUC</div>`}
      </div>
    </td>`;
  }

  const pages=[];
  for(let p=0;p<items.length;p+=perPage){
    const page=items.slice(p,p+perPage);
    let trs='';
    for(let r=0;r<rows;r++){
      let tds='';
      for(let c=0;c<cols;c++) tds+=cell(page[r*cols+c]);
      trs+=`<tr>${tds}</tr>`;
    }
    pages.push(`<table class="sheet">${trs}</table>`);
  }

  const namePt=isSmall?6.7:8.2;
  const leiPt=isSmall?15.5:22;
  const baniPt=isSmall?8:11.5;
  const curPt=isSmall?5.5:7.5;
  const sgrPt=isSmall?4.8:6.5;
  const totalPt=isSmall?5.2:7.2;

  const html=`<!doctype html><html><head><meta charset="utf-8"><style>
    @page{size:A4 portrait;margin:4mm}
    body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:0;color:#222;background:white}
    table.sheet{width:${pageW}mm;height:${pageH}mm;border-collapse:collapse;table-layout:fixed;margin:0 auto;page-break-after:always}
    table.sheet:last-child{page-break-after:auto}
    tr{height:${labelH}mm}
    td.cell{width:${labelW}mm;height:${labelH}mm;border:0.3mm solid #aeb4c0;padding:1mm;box-sizing:border-box;text-align:center;vertical-align:middle;overflow:hidden}
    td.empty{border:0.3mm solid #e5e7eb}
    .box{position:relative;width:100%;height:${labelH-2}mm;overflow:hidden;text-align:center}
    .name{font-weight:900;font-size:${namePt}pt;line-height:1.05;height:${isSmall?6.6:9.2}mm;overflow:hidden;text-align:center}
    .sep{border-top:0.25mm solid #333;margin:${isSmall?'.45mm 0 .45mm':'.75mm 0 .8mm'}}
    .price{font-weight:900;line-height:.82;white-space:nowrap;text-align:center}
    .lei{font-size:${leiPt}pt;font-weight:900}
    .bani{font-size:${baniPt}pt;font-weight:900;vertical-align:top}
    .cur{font-size:${curPt}pt;font-weight:900}
    .unit{position:absolute;left:0;bottom:0;font-size:${isSmall?5.4:7.2}pt;font-weight:900}
    .sgr{position:absolute;left:0;right:0;bottom:${isSmall?3.1:4.4}mm;background:#c8752c;color:white;font-size:${sgrPt}pt;font-weight:900;padding:${isSmall?'.25mm 0':'.45mm 0'}}
    .total{position:absolute;left:0;right:0;bottom:0;font-size:${totalPt}pt;font-weight:900;text-align:center}
  </style></head><body>${pages.join('')}</body></html>`;

  download(isSmall?'etichete_raft_mici_40x21mm.doc':'etichete_raft_mari_50x35mm.doc',html,'application/msword');
}

function exportLabelsWordSmall(){exportLabelsWordModel('small')}
function exportLabelsWordLarge(){exportLabelsWordModel('large')}

function printLabels(){window.print()}
function receptie(){if(!admin())return; window.REC=window.REC||[]; $('main').innerHTML=`<h1>Recepție marfă</h1>
<div class="card">
  <div class="grid2"><input class="input" id="rec-f" placeholder="Furnizor"><input class="input" id="rec-d" placeholder="Nr document / factură"></div>
  <div class="grid2"><input class="input" id="rec-q" placeholder="Scanează cod bare / PLU sau caută denumire" onkeydown="if(event.key==='Enter')addRecScan()" oninput="pickSearch('rec-q','pickRec')"><input class="input" id="rec-qty" type="number" step="0.001" value="1" placeholder="Cantitate scanare"></div>
  <div class="suggest hide" id="rec-q-s"></div>
  <button onclick="addRecScan()">Adaugă după cod/PLU</button> <button onclick="startCamera('rec')">📷 Camera</button> <button class="green" onclick="saveRec()">Salvează recepția</button>
  <button class="secondary" onclick="exportRecExcel()">Export Excel</button> <button class="secondary" onclick="exportRecNirWord()">Export Word tip NIR</button> <button class="secondary" onclick="shareRec()">Trimite recepție</button>
  <p class="muted">După scanare linia se adaugă automat. Dacă produsul se repetă, cantitatea se adună. Nu mai trebuie să completezi toate câmpurile. SGR se recunoaște din denumire.</p>
</div><div class="card"><table><thead><tr><th>Cod</th><th>PLU</th><th>Denumire</th><th>SGR</th><th>Categorie</th><th>Cantitate</th><th>Preț</th><th>Total</th><th></th></tr></thead><tbody id="rec-body"></tbody></table><div id="rec-total" class="stat"></div></div>`; renderRec()}
async function pickRec(id){const {data:p}=await sb.from('produse').select('*').eq('id',id).single(); addRecProduct(p, Number($('rec-qty')?.value)||1); $('rec-q').value=''; document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'))}
async function addRecScan(){const code=$('rec-q').value.trim(); if(!code)return; const p=await byScan(code); if(p){addRecProduct(p, Number($('rec-qty')?.value)||1); $('rec-q').value=''; $('rec-q').focus();}else{addRecProduct({cod_bare:code,plu:'',denumire:'PRODUS NECUNOSCUT',categorie:'',pret:0,stoc:0}, Number($('rec-qty')?.value)||1); toast('Produs inexistent în MAMA — linie adăugată pentru completare.')}}
function addRecProduct(p,qty=1){window.REC=window.REC||[]; let e=REC.find(x=>String(x.cod_bare)===String(p.cod_bare)); if(e)e.cantitate=Number(e.cantitate||0)+Number(qty||1); else REC.push({cod_bare:p.cod_bare||'',plu:p.plu||'',denumire:p.denumire||'',categorie:p.categorie||'',cantitate:Number(qty)||1,pret:Number(p.pret)||0}); renderRec()}
function renderRec(){if(!$('rec-body'))return; let total=0,sgrTotal=0; $('rec-body').innerHTML=(REC||[]).map((x,i)=>{const qty=Number(x.cantitate)||0; const base=qty*Number(x.pret||0); const sgr=sgrVal(x,qty); total+=base+sgr; sgrTotal+=sgr; return `<tr><td>${x.cod_bare}</td><td><input class="input" style="width:90px" value="${x.plu||''}" onchange="REC[${i}].plu=this.value"></td><td><input class="input" value="${String(x.denumire||'').replace(/"/g,'&quot;')}" onchange="REC[${i}].denumire=this.value;renderRec()"></td><td>${isSGR(x)?'<span class="pill">SGR</span>':'—'}</td><td><input class="input" style="width:120px" value="${x.categorie||''}" onchange="REC[${i}].categorie=this.value"></td><td><input class="input" style="width:90px" type="number" step="0.001" value="${x.cantitate}" onchange="REC[${i}].cantitate=Number(this.value)||0;renderRec()"></td><td><input class="input" style="width:90px" type="number" step="0.01" value="${x.pret}" onchange="REC[${i}].pret=Number(this.value)||0;renderRec()"></td><td><b>${lei(base+sgr)}</b>${sgr?`<br><span class="muted">SGR ${lei(sgr)}</span>`:''}</td><td><button class="red" onclick="REC.splice(${i},1);renderRec()">X</button></td></tr>`}).join('')||'<tr><td colspan="9">Nu ai linii scanate.</td></tr>'; $('rec-total').textContent=`Total recepție: ${lei(total)} · SGR: ${lei(sgrTotal)}`}
async function saveRec(){if(!REC.length)return toast('Nu ai linii'); const {data,error}=await sb.rpc('receive_goods',{p_furnizor:$('rec-f').value,p_document:$('rec-d').value,p_items:REC}); if(error)return toast(error.message); toast('Recepție salvată #'+data);}

function recRows(){return (REC||[]).map(x=>{const qty=Number(x.cantitate)||0; return {furnizor:$('rec-f')?.value||'',document:$('rec-d')?.value||'',cod_bare:x.cod_bare,plu:x.plu||'',denumire:x.denumire,sgr:isSGR(x)?'DA':'NU',cantitate:x.cantitate,pret:x.pret,valoare_sgr:sgrVal(x,qty),total:lineTotal(x,qty)}})}
function cartRows(){return (CART||[]).map(x=>{const qty=Number(x.cantitate)||1;return {cod_bare:x.cod_bare,plu:x.plu||'',denumire:x.denumire,sgr:isSGR(x)?'DA':'NU',cantitate:qty,pret:x.pret,valoare_produse:lineBase(x,qty),valoare_sgr:sgrVal(x,qty),total:lineTotal(x,qty)}})}
function exportRowsExcel(name,rows,headers){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheetWithHeaders(rows,headers),name.slice(0,31));XLSX.writeFile(wb,name+'.xlsx')}
function exportCosExcel(){exportRowsExcel('cos_cumparaturi',cartRows(),['cod_bare','plu','denumire','sgr','cantitate','pret','valoare_produse','valoare_sgr','total'])}
function exportRecExcel(){exportRowsExcel('receptie_marfa',recRows(),['furnizor','document','cod_bare','plu','denumire','sgr','cantitate','pret','valoare_sgr','total'])}
function exportRowsWord(name,rows){const keys=Object.keys(rows[0]||{});const html=`<html><body><h1>${name}</h1><table border="1"><tr>${keys.map(k=>`<th>${k}</th>`).join('')}</tr>${rows.map(r=>`<tr>${keys.map(k=>`<td>${r[k]??''}</td>`).join('')}</tr>`).join('')}</table></body></html>`;download(name+'.doc',html,'application/msword')}
function exportCosWord(){exportRowsWord('cos_cumparaturi',cartRows())}
function exportRecWord(){exportRecNirWord()}
function exportRecNirWord(){const rows=recRows(); const furn=$('rec-f')?.value||''; const doc=$('rec-d')?.value||''; const total=rows.reduce((s,r)=>s+Number(r.total||0),0); const html=`<html><head><meta charset="utf-8"><style>body{font-family:Arial}table{width:100%;border-collapse:collapse}td,th{border:1px solid #333;padding:6px;font-size:12px}.right{text-align:right}</style></head><body><h1 style="text-align:center">NIR - Notă de intrare recepție</h1><p><b>Data:</b> ${new Date().toLocaleDateString('ro-RO')}<br><b>Furnizor:</b> ${furn}<br><b>Document:</b> ${doc}</p><table><tr><th>Nr.</th><th>Cod</th><th>PLU</th><th>Denumire</th><th>SGR</th><th>Cantitate</th><th>Preț</th><th>Total</th></tr>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${r.cod_bare}</td><td>${r.plu||''}</td><td>${r.denumire}</td><td>${r.sgr}</td><td class="right">${r.cantitate}</td><td class="right">${r.pret}</td><td class="right">${r.total}</td></tr>`).join('')}<tr><td colspan="7" class="right"><b>Total</b></td><td class="right"><b>${total.toFixed(2)}</b></td></tr></table><br><p>Semnătură recepție: ____________________</p></body></html>`; download('NIR_receptie_marfa.doc',html,'application/msword')}
async function shareText(name,rows){const text=name+'\n'+rows.map(r=>Object.entries(r).map(([k,v])=>`${k}: ${v}`).join(' | ')).join('\n'); if(navigator.share){try{await navigator.share({title:name,text});return}catch(e){}} await navigator.clipboard?.writeText(text); toast('Text copiat. Îl poți lipi în email sau Drive.')}
function shareCos(){shareText('Coș cumpărături',cartRows())}
function shareRec(){shareText('Recepție marfă',recRows())}


function magazie(){if(!admin())return; window.MAG=window.MAG||MAG||[]; MAG=window.MAG; $('main').innerHTML=`<h1>Fișă magazie / Transport între magazine</h1>
<div class="card">
  <div class="grid"><input class="input" id="mag-src" placeholder="Magazin sursă"><input class="input" id="mag-dst" placeholder="Magazin destinație"><input class="input" id="mag-nr" placeholder="Nr. transport / a câta cursă azi"><input class="input" id="mag-resp" placeholder="Responsabil / șofer"></div>
  <div class="grid2"><input class="input" id="mag-q" placeholder="Scanează cod bare / PLU sau caută denumire" onkeydown="if(event.key==='Enter')addMagScan()" oninput="pickSearch('mag-q','pickMag')"><input class="input" id="mag-qty" type="number" step="0.001" value="1" placeholder="Cantitate"></div>
  <div class="suggest hide" id="mag-q-s"></div>
  <button onclick="addMagScan()">Adaugă produs</button> <button onclick="startCamera('mag')">📷 Camera</button> <button class="green" onclick="saveMagazie()">Salvează fișa</button> <button class="secondary" onclick="exportMagExcel()">Export Excel</button> <button class="secondary" onclick="exportMagWord()">Export Word</button>
  <p class="muted">Produsele se iau din fișierul MAMA încărcat în baza de date. Dacă produsul se repetă, cantitatea se adună. SGR se calculează separat.</p>
</div><div class="card"><table><thead><tr><th>Cod</th><th>PLU</th><th>Denumire</th><th>SGR</th><th>Cantitate</th><th>Preț</th><th>Valoare</th><th>SGR</th><th></th></tr></thead><tbody id="mag-body"></tbody></table><div id="mag-total" class="stat"></div></div>`; renderMag()}
async function pickMag(id){const {data:p}=await sb.from('produse').select('*').eq('id',id).single(); addMagProduct(p, Number($('mag-qty')?.value)||1); $('mag-q').value=''; document.querySelectorAll('.suggest').forEach(x=>x.classList.add('hide'))}
async function addMagScan(){const code=$('mag-q').value.trim(); if(!code)return; const p=await byScan(code); if(p){addMagProduct(p, Number($('mag-qty')?.value)||1); $('mag-q').value=''; $('mag-q').focus();}else toast('Produs inexistent în MAMA: '+code)}
function addMagProduct(p,qty=1){window.MAG=window.MAG||[]; MAG=window.MAG; let e=MAG.find(x=>String(x.cod_bare)===String(p.cod_bare)); if(e)e.cantitate=Number(e.cantitate||0)+Number(qty||1); else MAG.push({cod_bare:p.cod_bare||'',plu:p.plu||'',denumire:p.denumire||'',cantitate:Number(qty)||1,pret:Number(p.pret)||0}); renderMag()}
function renderMag(){if(!$('mag-body'))return; let total=0,sgrTotal=0; $('mag-body').innerHTML=(MAG||[]).map((x,i)=>{const qty=Number(x.cantitate)||0; const base=lineBase(x,qty); const sgr=sgrVal(x,qty); total+=base+sgr; sgrTotal+=sgr; return `<tr><td>${x.cod_bare}</td><td>${x.plu||''}</td><td>${x.denumire}</td><td>${isSGR(x)?'<span class="pill">SGR</span>':'—'}</td><td><input class="input" style="width:90px" type="number" step="0.001" value="${x.cantitate}" onchange="MAG[${i}].cantitate=Number(this.value)||0;renderMag()"></td><td>${lei(x.pret)}</td><td>${lei(base)}</td><td>${sgr?lei(sgr):'—'}</td><td><button class="red" onclick="MAG.splice(${i},1);renderMag()">X</button></td></tr>`}).join('')||'<tr><td colspan="9">Nu ai produse adăugate.</td></tr>'; $('mag-total').textContent=`Total marfă: ${lei(total)} · SGR: ${lei(sgrTotal)}`}
function magRows(){return (MAG||[]).map(x=>{const qty=Number(x.cantitate)||0;return {magazin_sursa:$('mag-src')?.value||'',magazin_destinatie:$('mag-dst')?.value||'',nr_transport:$('mag-nr')?.value||'',responsabil:$('mag-resp')?.value||'',cod_bare:x.cod_bare,plu:x.plu||'',denumire:x.denumire,sgr:isSGR(x)?'DA':'NU',cantitate:x.cantitate,pret:x.pret,valoare_produse:lineBase(x,qty),valoare_sgr:sgrVal(x,qty),total:lineTotal(x,qty)}})}
function exportMagExcel(){exportRowsExcel('fisa_magazie_transport',magRows(),['magazin_sursa','magazin_destinatie','nr_transport','responsabil','cod_bare','plu','denumire','sgr','cantitate','pret','valoare_produse','valoare_sgr','total'])}
function exportMagWord(){const rows=magRows(); const total=rows.reduce((s,r)=>s+Number(r.total||0),0); const html=`<html><head><meta charset="utf-8"><style>body{font-family:Arial}table{width:100%;border-collapse:collapse}td,th{border:1px solid #333;padding:6px;font-size:12px}.right{text-align:right}</style></head><body><h1 style="text-align:center">Fișă de magazie - Transport marfă</h1><p><b>Data:</b> ${new Date().toLocaleDateString('ro-RO')}<br><b>Magazin sursă:</b> ${$('mag-src')?.value||''}<br><b>Magazin destinație:</b> ${$('mag-dst')?.value||''}<br><b>Nr. transport:</b> ${$('mag-nr')?.value||''}<br><b>Responsabil:</b> ${$('mag-resp')?.value||''}</p><table><tr><th>Nr.</th><th>Cod</th><th>PLU</th><th>Denumire</th><th>SGR</th><th>Cant.</th><th>Preț</th><th>SGR</th><th>Total</th></tr>${rows.map((r,i)=>`<tr><td>${i+1}</td><td>${r.cod_bare}</td><td>${r.plu||''}</td><td>${r.denumire}</td><td>${r.sgr}</td><td class="right">${r.cantitate}</td><td class="right">${r.pret}</td><td class="right">${r.valoare_sgr}</td><td class="right">${r.total}</td></tr>`).join('')}<tr><td colspan="8" class="right"><b>Total</b></td><td class="right"><b>${total.toFixed(2)}</b></td></tr></table><br><p>Predat: ____________________ &nbsp;&nbsp;&nbsp; Primit: ____________________</p></body></html>`; download('fisa_magazie_transport.doc',html,'application/msword')}
async function saveMagazie(){if(!MAG.length)return toast('Nu ai produse în fișa de magazie'); const payload={p_sursa:$('mag-src')?.value||'',p_destinatie:$('mag-dst')?.value||'',p_nr:$('mag-nr')?.value||'',p_responsabil:$('mag-resp')?.value||'',p_items:MAG}; const {data,error}=await sb.rpc('save_magazie_transport',payload); if(error)return toast(error.message); toast('Fișă magazie salvată #'+data)}

async function utilizatori(){const {data}=await sb.from('profiles').select('*').order('email'); $('main').innerHTML=`<h1>Utilizatori și roluri</h1><div class="card"><p>Adminul poate transforma orice utilizator în administrator sau angajat. Poți avea minim 2 administratori sau mai mulți.</p><table><thead><tr><th>Email</th><th>Rol</th><th>Activ</th><th>Acțiuni</th></tr></thead><tbody>${(data||[]).map(u=>`<tr><td>${u.email}</td><td>${u.role}</td><td>${u.active?'Da':'Nu'}</td><td><button onclick="setRole('${u.id}','administrator')">Fă admin</button> <button class="secondary" onclick="setRole('${u.id}','angajat')">Fă angajat</button></td></tr>`).join('')}</tbody></table></div>`}
async function setRole(id,role){const {error}=await sb.from('profiles').update({role}).eq('id',id); if(error)return toast(error.message); utilizatori()}
async function audit(){const {data}=await sb.from('audit_log').select('*,profiles(email)').order('created_at',{ascending:false}).limit(200); $('main').innerHTML=`<h1>Audit log</h1><div class="card"><table><thead><tr><th>Data</th><th>Acțiune</th><th>Detalii</th></tr></thead><tbody>${(data||[]).map(x=>`<tr><td>${roDate(x.created_at)}</td><td>${x.actiune}</td><td><pre>${JSON.stringify(x.detalii)}</pre></td></tr>`).join('')}</tbody></table></div>`}
function backup(){ $('main').innerHTML=`<h1>Backup</h1><div class="card"><p>Backup recomandat: Supabase Dashboard → Database → Backups. Pentru backup local:</p><button onclick="exportProduseExcel()">Export produse Excel</button> <button class="secondary" onclick="exportBackupJson()">Backup JSON produse</button></div>`}
function normRow(r){
  const get=(...names)=>{for(const n of names){if(r[n]!==undefined&&r[n]!==null&&String(r[n]).trim()!=='')return r[n]} return ''};
  const cod=String(get('cod_bare','Cod Bare','COD_BARE','barcode','EAN')).trim();
  const den=String(get('denumire','Denumire','DENUMIRE','nume','Produs')).trim();
  const pretRaw=get('pret','pret_v_tva','Preț','Pret','PRET','pret cu tva');
  return {cod_bare:cod,plu:get('plu','PLU')?String(get('plu','PLU')).trim():null,denumire:den,pret:Number(String(pretRaw).replace(',','.'))||0,stoc:Number(String(get('stoc','Stoc','cantitate','Cantitate')).replace(',','.'))||0,categorie:String(get('categorie','Categorie')).trim(),um:String(get('um','UM')).trim()||'BUC'};
}
async function importProduse(e){
  const f=e.target.files[0]; if(!f)return;
  const buf=await f.arrayBuffer(); const wb=XLSX.read(buf);
  const sheet=wb.Sheets['TABEL']||wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(sheet,{defval:''});
  const payload=rows.map(normRow).filter(r=>r.cod_bare&&r.denumire);
  if(!payload.length)return toast('Nu am găsit produse. Verifică foaia TABEL și coloanele denumire/cod_bare/pret_v_tva.');
  let changed=[];
  for(let i=0;i<payload.length;i+=1000){
    const chunk=payload.slice(i,i+1000);
    const codes=chunk.map(x=>x.cod_bare);
    const {data:old}=await sb.from('produse').select('cod_bare,pret,denumire,plu').in('cod_bare',codes);
    const oldMap=new Map((old||[]).map(x=>[String(x.cod_bare),x]));
    for(const p of chunk){const o=oldMap.get(String(p.cod_bare)); if(o && Number(o.pret)!==Number(p.pret)){changed.push({cod_bare:p.cod_bare,plu:p.plu,denumire:p.denumire,pret_vechi:Number(o.pret)||0,pret_nou:Number(p.pret)||0,created_by:USER?.id||null});}}
    const {error}=await sb.from('produse').upsert(chunk,{onConflict:'cod_bare'}); if(error)return toast(error.message);
  }
  if(changed.length){
    const {error:chgErr}=await sb.from('price_changes').insert(changed);
    if(chgErr) toast('Produse importate, dar lipsește tabelul price_changes. Rulează migration_v4_price_changes.sql.');
  }
  toast(`Import finalizat: ${payload.length}. Prețuri schimbate: ${changed.length}`);
}
function sheetWithHeaders(data,headers){return XLSX.utils.json_to_sheet((data&&data.length)?data:[Object.fromEntries(headers.map(h=>[h,'']))],{header:headers})}
async function exportProduseExcel(){const {data,error}=await sb.from('produse').select('cod_bare,plu,denumire,categorie,um,pret,stoc').limit(200000); if(error)return toast(error.message); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,sheetWithHeaders(data||[],['cod_bare','plu','denumire','categorie','um','pret','stoc']),'produse'); XLSX.writeFile(wb,'produse.xlsx')}
async function exportInventarExcel(){if(!INV_SESSION)return toast('Alege sesiune'); const {data}=await sb.from('inventar_linii').select('cod_bare,plu,denumire,stoc_scriptic,stoc_faptic').eq('sesiune_id',INV_SESSION).limit(200000); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,sheetWithHeaders(data||[],['cod_bare','plu','denumire','stoc_scriptic','stoc_faptic']),'inventar'); XLSX.writeFile(wb,'inventar.xlsx')}
async function exportInventarWord(){if(!INV_SESSION)return toast('Alege sesiune'); const {data}=await sb.from('inventar_linii').select('*').eq('sesiune_id',INV_SESSION).limit(200000); const html=`<html><body><h1>Inventar</h1><table border="1"><tr><th>Cod</th><th>PLU</th><th>Denumire</th><th>Stoc scriptic</th><th>Cantitate inventariată</th></tr>${(data||[]).map(x=>`<tr><td>${x.cod_bare}</td><td>${x.plu||''}</td><td>${x.denumire}</td><td>${x.stoc_scriptic}</td><td>${x.stoc_faptic||''}</td></tr>`).join('')}</table></body></html>`; download('inventar.doc',html,'application/msword')}
async function exportIntrariExcel(){const {data}=await sb.from('receptii_linii').select('cod_bare,plu,denumire,cantitate,pret,receptii(created_at,furnizor,document)').limit(200000); const rows=(data||[]).map(x=>({data:x.receptii?.created_at||'',furnizor:x.receptii?.furnizor||'',document:x.receptii?.document||'',cod_bare:x.cod_bare,plu:x.plu,denumire:x.denumire,cantitate:x.cantitate,pret:x.pret})); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,sheetWithHeaders(rows,['data','furnizor','document','cod_bare','plu','denumire','cantitate','pret']),'intrari'); XLSX.writeFile(wb,'intrari.xlsx')}
async function exportIesiriExcel(){const {data}=await sb.from('vanzari_linii').select('cod_bare,plu,denumire,cantitate,pret,total,valoare_sgr,vanzari(created_at,metoda_plata)').limit(200000); const rows=(data||[]).map(x=>({data:x.vanzari?.created_at||'',metoda_plata:x.vanzari?.metoda_plata||'',cod_bare:x.cod_bare,plu:x.plu,denumire:x.denumire,sgr:isSGR(x)?'DA':'NU',cantitate:x.cantitate,pret:x.pret,valoare_produse:Number(x.pret||0)*Number(x.cantitate||0),valoare_sgr:x.valoare_sgr||0,total:x.total})); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,sheetWithHeaders(rows,['data','metoda_plata','cod_bare','plu','denumire','sgr','cantitate','pret','valoare_produse','valoare_sgr','total']),'iesiri'); XLSX.writeFile(wb,'iesiri.xlsx')}
async function exportBackupJson(){const {data}=await sb.from('produse').select('*').limit(200000); download('backup-produse.json',JSON.stringify(data,null,2),'application/json')}
function download(name,content,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function startCamera(mode){if(SCANNER){try{await SCANNER.stop()}catch(e){}} const r=$('reader'); if(!r)return; r.classList.remove('hide'); SCANNER=new Html5Qrcode('reader'); const cams=await Html5Qrcode.getCameras().catch(e=>{toast('Camera nu este disponibilă. Pe iOS trebuie HTTPS și Safari.');return[]}); if(!cams.length)return; const back=cams.find(c=>/back|rear|environment/i.test(c.label))||cams[0]; await SCANNER.start(back.id,{fps:10,qrbox:{width:260,height:160}},async code=>{await SCANNER.stop(); r.classList.add('hide'); handleScan(mode,code)},err=>{}).catch(e=>toast('Nu pot porni camera: '+e.message));}
async function byScan(code){let {data}=await sb.from('produse').select('*').eq('cod_bare',code).maybeSingle(); if(!data){let r=await sb.from('produse').select('*').eq('plu',code).maybeSingle(); data=r.data} return data}
async function handleScan(mode,code){if(mode==='cart'){const data=await byScan(code); if(data)addCart(data); else toast('Produs inexistent: '+code)} if(mode==='price'){const data=await byScan(code); if(data){$('price-result').innerHTML=`<div class="card"><h2>${data.denumire}</h2><div class="stat">${lei(data.pret)}</div>${isSGR(data)?`<p><span class="pill">SGR</span> + ${lei(SGR_PRICE)} · Total/bucată: <b>${lei(Number(data.pret||0)+SGR_PRICE)}</b></p>`:''}<p>Cod: ${data.cod_bare} · PLU: ${data.plu||'—'} · Stoc: ${data.stoc}</p></div>`}else toast('Produs inexistent')} if(mode==='inv'){$('inv-code').value=code; lockInv()} if(mode==='label'){const data=await byScan(code); if(data){window.LABELS=window.LABELS||[];LABELS.push(data);renderLabels()}else toast('Produs inexistent')} if(mode==='rec'){const data=await byScan(code); if(data)addRecProduct(data,Number($('rec-qty')?.value)||1); else {addRecProduct({cod_bare:code,denumire:'PRODUS NECUNOSCUT',pret:0},Number($('rec-qty')?.value)||1);toast('Produs inexistent în MAMA — linie adăugată.')}} if(mode==='mag'){const data=await byScan(code); if(data)addMagProduct(data,Number($('mag-qty')?.value)||1); else toast('Produs inexistent în MAMA: '+code)}}
function realtime(){sb.channel('gp-live').on('postgres_changes',{event:'*',schema:'public',table:'produse'},()=>{}).subscribe()}
init();
