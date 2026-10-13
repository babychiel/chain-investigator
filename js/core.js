"use strict";
// ---------- constants ----------
const FALLBACK_CHAINS=[
  {chainname:'Ethereum Mainnet',chainid:'1',blockexplorer:'https://etherscan.io/'},
  {chainname:'Arc Mainnet',chainid:'5042',blockexplorer:'https://arc.etherscan.io/'},
  {chainname:'BNB Smart Chain Mainnet',chainid:'56',blockexplorer:'https://bscscan.com/'},
  {chainname:'Base Mainnet',chainid:'8453',blockexplorer:'https://basescan.org/'},
  {chainname:'Arbitrum One Mainnet',chainid:'42161',blockexplorer:'https://arbiscan.io/'},
  {chainname:'Polygon Mainnet',chainid:'137',blockexplorer:'https://polygonscan.com/'},
  {chainname:'OP Mainnet',chainid:'10',blockexplorer:'https://optimistic.etherscan.io/'},
];
const NATIVE={1:'ETH',11155111:'ETH',56:'BNB',97:'BNB',137:'POL',80002:'POL',43114:'AVAX',43113:'AVAX',100:'xDAI',5000:'MNT',5003:'MNT',
  42220:'CELO',146:'S',14601:'S',80094:'BERA',80069:'BERA',143:'MON',10143:'MON',999:'HYPE',1329:'SEI',1328:'SEI',50:'XDC',51:'XDC',
  33139:'APE',33111:'APE',5042:'USDC',sol:'SOL',btc:'BTC',199:'BTT',1029:'BTT',252:'FRAX',9745:'XPL',9746:'XPL',4352:'M',204:'BNB',5611:'BNB',988:'USDT0',2201:'USDT0'};
const NODE_COLORS=[
  ['#e5484d','Tersangka / exploit'],['#f76b15','Mixer / bridge'],['#30a46c','Exchange / CEX'],
  ['#ffd166','Penting'],['#3e63dd','Wallet (EOA)'],['#8e4ec6','Kontrak'],['#12a594','EIP-7702 wallet'],['#6b7280','Tidak relevan'],
];
const TOKEN_PALETTE=['#e5484d','#3e63dd','#30a46c','#f76b15','#8e4ec6','#12a594','#d6409f','#ffd166','#7ce2fe','#a18072','#99d52a','#ff8b8b'];
const SPAM_RE=/https?:|www\.|\.(com|io|xyz|org|net|app|site|top|vip)\b|visit|claim|reward|airdrop|voucher|\bgift\b|\$ ?\d/i;
const PLAYBOOKS={
  hack:   {name:'Hack / exploit',            dir:'out',hops:4,per:3,desc:'Ikuti dana curian maju 4 hop × 3 cabang. Berhenti di bridge, mixer, DEX, dan exchange.'},
  scam:   {name:'Penipuan (dari korban)',     dir:'out',hops:5,per:2,desc:'Seed = wallet korban. Ikuti dana keluar ke penipu lalu terus maju sampai titik keluar.'},
  exits:  {name:'Cari exchange',              dir:'out',hops:6,per:2,desc:'Telusuri jalur terbesar sedalam mungkin untuk menemukan alamat deposit exchange.'},
  funding:{name:'Sumber dana',                dir:'in', hops:3,per:2,sort:'asc',desc:'Telusuri mundur dengan transaksi terlama dulu untuk menemukan siapa yang pertama mendanai wallet ini.'},
};

// ---------- storage ----------
const store={
  get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
};

// ---------- state ----------
const S={
  chainId:'1', chains:[],
  roots:[], nodes:new Map(), tx:new Map(), hiddenTokens:new Set(), order:0,
  custom:new Map(), links:[], meta:{title:'',notes:''},
  settings:Object.assign({offset:500,sort:'desc',topK:15,autoId:true,hideSpam:true,minAmt:0,from:'',to:'',allLabels:false,valueOnly:true,minUsd:1,group:true,layout:'flow'},store.get('ci_settings',{})),
  labels:store.get('ci_labels',{}),
  calls:0,
};
const tokenColor={};
function colorForToken(sym){ if(!tokenColor[sym]) tokenColor[sym]=TOKEN_PALETTE[Object.keys(tokenColor).length%TOKEN_PALETTE.length]; return tokenColor[sym]; }

// ---------- helpers ----------
const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const short=a=>a? a.slice(0,6)+'…'+a.slice(-4) : '';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function units(v,d){
  v=String(v||'0').replace(/^-/,''); d=+d||0;
  if(!d) return Number(v);
  v=v.padStart(d+1,'0');
  return Number(v.slice(0,-d)+'.'+v.slice(-d).slice(0,12));
}
function fmtNum(x){
  if(!isFinite(x)) return '?';
  if(x>=1000) return x.toLocaleString('en-US',{maximumFractionDigits:2});
  if(x>=1) return x.toLocaleString('en-US',{maximumFractionDigits:4});
  if(x===0) return '0';
  return x.toPrecision(4).replace(/0+$/,'').replace(/\.$/,'');
}
// every time shown to the user is local time with an explicit zone (WIB/WITA/WIT) so UI, story and brief agree
const tzName=()=>{const o=-new Date().getTimezoneOffset()/60; return {7:'WIB',8:'WITA',9:'WIT',0:'UTC'}[o]||('UTC'+(o>=0?'+':'')+o);};
const fmtDate=ts=>new Date(ts*1000).toLocaleString('id-ID',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})+' '+tzName();
const fmtStamp=ts=>{const d=new Date(ts*1000), p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())} ${tzName()}`;};
const chainInfo=()=>S.chains.find(c=>c.chainid===S.chainId)||{blockexplorer:'https://etherscan.io/',chainname:'?'};
const explorer=(kind,v)=>chainInfo().blockexplorer.replace(/\/?$/,'/')+(isSol()&&kind==='address'?'account':kind)+'/'+v;
const nativeSym=()=>NATIVE[S.chainId]||'ETH';
const labelKey=a=>S.chainId+':'+a;
const isSol=(c=S.chainId)=>c==='sol';
const isBtc=(c=S.chainId)=>c==='btc';
const isEvm=(c=S.chainId)=>c!=='sol'&&c!=='btc';
const isAddr=a=>isSol()?/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a||''):isBtc()?BTC_ADDR_RE.test(a||''):/^0x[0-9a-fA-F]{40}$/.test(a||'');
// EVM and bech32 (bc1…) addresses are case-insensitive; Solana and legacy Bitcoin (base58) addresses are not
const norm=a=>a&&/^(0x|bc1)/i.test(a)?a.toLowerCase():a;
function setMsg(m){ $('st_msg').textContent=m; if(typeof Busy!=='undefined') Busy.detail(m); }
function stats(){ $('st_tx').textContent=S.tx.size; $('st_calls').textContent=S.calls; }
function download(name,content,type){
  const a=document.createElement('a');
  a.href=typeof content==='string'&&content.startsWith('data:')?content:URL.createObjectURL(new Blob([content],{type}));
  a.download=name; a.click();
}

// ---------- Etherscan API (rate-limited) ----------
let lastCall=0, gate=Promise.resolve();
function throttle(){ const p=gate.then(async()=>{const w=lastCall+360-Date.now(); if(w>0) await sleep(w); lastCall=Date.now();}); gate=p; return p; }
async function api(params,chainId=S.chainId){
  const key=store.get('ci_key','');
  if(chainId==='sol'||chainId==='btc') throw new Error('Fungsi ini khusus EVM.');
  if(!key){ openKey(); throw new Error('API key Etherscan belum diisi.'); }
  for(let attempt=0;attempt<5;attempt++){
    await throttle();
    S.calls++; stats();
    const url='https://api.etherscan.io/v2/api?'+new URLSearchParams({chainid:chainId,...params,apikey:key});
    let j;
    try{ j=await (await fetch(url)).json(); }catch(e){ await sleep(800); continue; }
    if('jsonrpc' in j){ if(j.error) throw new Error(j.error.message||'RPC error'); if(typeof j.result==='string'&&/rate limit/i.test(j.result)){await sleep(1200);continue;} return j.result; }
    if(j.status==='1') return j.result;
    const msg=typeof j.result==='string'?j.result:j.message;
    if(/no (transactions|records) found/i.test(j.message)||(Array.isArray(j.result)&&!j.result.length)) return [];
    if(/rate limit/i.test(msg)){ await sleep(1200); continue; }
    throw new Error(msg);
  }
  throw new Error('Terkena rate limit berulang kali.');
}

// ---------- graph model ----------
function ensureNode(addr,level){
  addr=norm(addr);
  let n=S.nodes.get(addr);
  if(!n){ n={addr,level,order:S.order++,expanded:false,label:'',autoLabel:'',kind:'',color:'',notes:'',hidden:false,hiddenCps:[]}; S.nodes.set(addr,n); }
  const L=S.labels[labelKey(addr)];
  if(L){ if(!n.label) n.label=L.label||''; if(!n.color) n.color=L.color||''; }
  if(n.db===undefined) n.db=Labels.lookup(addr);
  return n;
}
const isSpam=(sym,name,amount)=>amount===0||SPAM_RE.test(sym||'')||SPAM_RE.test(name||'');

async function fetchTransfers(addr,sort){
  if(isSol()) return Sol.fetchTransfers(addr);
  if(isBtc()) return Btc.fetchTransfers(addr);
  const base={module:'account',address:addr,page:1,offset:S.settings.offset,sort:sort||S.settings.sort,startblock:0,endblock:999999999};
  const out=[], errs=[], nat=nativeSym();
  const safe=async p=>{try{return await api(p)}catch(e){errs.push(e.message);return []}};
  const normal=await safe({...base,action:'txlist'});
  const tokens=await safe({...base,action:'tokentx'});
  const internal=await safe({...base,action:'txlistinternal'});
  const tokenSeen=new Set();
  for(const t of tokens){
    let sym=t.tokenSymbol;
    if(!sym){ if(S.chainId==='5042') continue; sym='?'+short(t.contractAddress); } // Arc: unnamed 18-dec mirror of native USDC
    const amount=units(t.value,t.tokenDecimal);
    const from=t.from.toLowerCase(), to=(t.to||'').toLowerCase(); if(!to) continue;
    out.push({key:'t:'+t.hash+':'+(t.logIndex??(from+to+t.value)),hash:t.hash,from,to,sym,token:t.contractAddress.toLowerCase(),name:t.tokenName,amount,ts:+t.timeStamp,kind:'token',spam:isSpam(sym,t.tokenName,amount)});
    tokenSeen.add(t.hash+from+to+sym+amount.toFixed(6));
  }
  for(const t of normal){
    if(t.isError==='1') continue;
    const amount=units(t.value,18); if(!(amount>0)) continue;
    const from=t.from.toLowerCase(), to=(t.to||'').toLowerCase(); if(!to) continue;
    if(tokenSeen.has(t.hash+from+to+nat+amount.toFixed(6))) continue; // native also emitted as token event (e.g. Arc USDC)
    out.push({key:'n:'+t.hash,hash:t.hash,from,to,sym:nat,token:'native',amount,ts:+t.timeStamp,kind:'native',spam:false});
  }
  for(const t of internal){
    if(t.isError==='1') continue;
    const amount=units(t.value,18); if(!(amount>0)) continue;
    const from=t.from.toLowerCase(), to=(t.to||t.contractAddress||'').toLowerCase(); if(!to) continue;
    if(tokenSeen.has(t.hash+from+to+nat+amount.toFixed(6))) continue;
    out.push({key:'i:'+t.hash+':'+(t.traceId||from+to+t.value),hash:t.hash,from,to,sym:nat,token:'native',amount,ts:+t.timeStamp,kind:'internal',spam:false});
  }
  const truncated=[normal,tokens,internal].some(a=>a.length>=S.settings.offset);
  return {out,errs,truncated};
}

function rankCounterparties(addr,list){
  const cps=new Map(), maxBySym={};
  for(const t of list){
    if(S.settings.hideSpam&&t.spam) continue;
    if(t.from!==addr&&t.to!==addr) continue;
    const cp=t.from===addr?t.to:t.from; if(cp===addr) continue;
    const dir=t.from===addr?'out':'in';
    let c=cps.get(cp); if(!c){c={addr:cp,n:0,in:{},out:{}};cps.set(cp,c)}
    c.n++; c[dir][t.sym]=(c[dir][t.sym]||0)+t.amount;
  }
  for(const c of cps.values()) for(const d of ['in','out']) for(const s in c[d]) maxBySym[s]=Math.max(maxBySym[s]||0,c[d][s]);
  for(const c of cps.values()){
    const sc=d=>Math.max(0,...Object.entries(c[d]).map(([s,v])=>maxBySym[s]?v/maxBySym[s]:0));
    c.inScore=sc('in'); c.outScore=sc('out');
    c.dir=c.outScore>=c.inScore?'out':'in';
    c.score=Math.max(c.inScore,c.outScore)+0.02*c.n;
  }
  return [...cps.values()].sort((a,b)=>b.score-a.score);
}

const inflight=new Map();
function expand(addr,opts={}){
  addr=norm(addr);
  if(inflight.has(addr)) return inflight.get(addr);
  const p=doExpand(addr,opts).finally(()=>inflight.delete(addr));
  inflight.set(addr,p); return p;
}
async function doExpand(addr,{topK=S.settings.topK,silent=false,sort,actor='user'}={}){
  const n=ensureNode(addr,0);
  if(n.expanded) return n;
  const job=Busy.start(`Menelusuri ${nameOf(addr)}`,{node:addr});
  try{
  setMsg('Mengambil riwayat transaksi '+short(addr)+'… (bisa beberapa detik)');
  const {out,errs,truncated,extra}=await fetchTransfers(addr,sort);
  if(errs.length&&!out.length){
    n.errs=errs; setMsg('Gagal: '+errs[0]);
    Audit.log(actor,'expand gagal',`${addr} · ${errs[0]}`);
    if(!silent) alert('Gagal mengambil data '+addr+':\n'+errs[0]);
    return n;
  }
  for(const t of out) if(!S.tx.has(t.key)) S.tx.set(t.key,t);
  const added=[];
  let forced=0;
  rankCounterparties(addr,out).forEach((c,i)=>{
    if(S.nodes.has(c.addr)) return;
    const db=Labels.lookup(c.addr);
    const important=db&&'XDSHPMB'.includes(db.cat)&&forced<30; // always surface exchanges, deposits, attackers, mixers, bridges
    if(i<topK||important){ if(i>=topK) forced++; added.push(ensureNode(c.addr,n.level+(c.dir==='out'?1:-1))); }
    else n.hiddenCps.push({addr:c.addr,dir:c.dir,n:c.n});
  });
  n.expanded=true; n.truncated=truncated; n.txCount=out.length; n.errs=errs;
  if(extra){ if(extra.payers) n.payers=extra.payers; if(extra.cospend) n.cospend=extra.cospend; n.ownTx=extra.txs; }
  if(isSol()) Sol.identities(added.map(m=>m.addr)); // one batched label lookup instead of one per node
  const msg=`${short(addr)}: ${out.length} transfer, ${added.length} counterparty baru`+(n.hiddenCps.length?`, ${n.hiddenCps.length} disembunyikan`:'')+(truncated?' · data terpotong':'');
  setMsg(msg+(errs.length?' · sebagian error: '+errs[0]:''));
  Audit.log(actor,'expand',`${addr} · ${out.length} transfer · ${added.length} counterparty baru${truncated?' · terpotong':''}`);
  render();
  if(S.settings.autoId) identify([n,...added]);
  return n;
  } finally { Busy.end(job); }
}

function showHiddenCps(addr){
  const n=S.nodes.get(addr); if(!n) return;
  const list=n.hiddenCps; n.hiddenCps=[];
  const added=list.filter(c=>!S.nodes.has(c.addr)).map(c=>ensureNode(c.addr,n.level+(c.dir==='out'?1:-1)));
  Audit.log('user','tampilkan counterparty',`${addr} · +${added.length}`);
  render(); if(S.settings.autoId) identify(added); selectNode(addr);
}

// ---------- identify contracts / EOAs / 7702 ----------
const idQueue=[]; let idRunning=false;
async function identifyOne(n){
  if(n.kind) return n;
  if(isSol()) return Sol.identify(n);
  if(isBtc()) return Btc.identify(n);
  try{
    const code=await api({module:'proxy',action:'eth_getCode',address:n.addr,tag:'latest'});
    if(!code||code==='0x') n.kind='eoa';
    else if(/^0xef0100/i.test(code)){ n.kind='7702'; n.delegate='0x'+code.slice(8,48).toLowerCase(); }
    else{
      n.kind='contract';
      const src=await api({module:'contract',action:'getsourcecode',address:n.addr});
      const r=src&&src[0];
      if(r&&r.ContractName){ n.autoLabel=r.ContractName; if(r.Proxy==='1'&&r.Implementation) n.impl=r.Implementation; }
    }
  }catch(e){ n.kind='?'; }
  scheduleRender();
  return n;
}
function identify(nodes){
  for(const n of nodes) if(n&&!n.kind&&!idQueue.includes(n)) idQueue.push(n);
  if(!idRunning) runIdentify();
}
async function runIdentify(){
  idRunning=true;
  while(idQueue.length){ $('st_id').textContent=`🔎 Mengenali ${idQueue.length} alamat…`; await identifyOne(idQueue.shift()); }
  $('st_id').textContent='';
  idRunning=false;
}

// ---------- automatic multi-hop tracing ----------
let tracing=false;
async function trace(addr,dir,hops,perHop,{sort,actor='user',playbook=''}={}){
  if(tracing) throw new Error('Trace lain sedang berjalan.');
  tracing=true;
  const job=Busy.start(playbook&&playbook!=='agent'?`Playbook: ${playbook}`:`Menelusuri ${dir==='out'?'ke mana uang pergi':'dari mana uang datang'}`,{detail:`${hops} langkah × ${perHop} cabang`,cancel:true});
  addr=norm(addr);
  Audit.log(actor,'trace mulai',`${playbook?playbook+' · ':''}${addr} · ${dir==='out'?'maju':'mundur'} ${hops} hop × ${perHop} cabang`);
  let frontier=[addr], expansions=0; const stops=[];
  try{
    for(let h=0;h<hops&&frontier.length;h++){
      const next=[];
      for(const a of frontier){
        if(expansions>=40||Busy.cancelled) break;
        Busy.detail(`Langkah ${h+1} dari ${hops} · ${expansions} wallet sudah ditelusuri · sekarang: ${nameOf(a)}`);
        const n=await expand(a,{silent:true,sort,actor}); expansions++;
        const cps=rankCounterparties(a,[...S.tx.values()].filter(t=>t.from===a||t.to===a))
          .filter(c=>dir==='out'?c.outScore>0:c.inScore>0)
          .sort((x,y)=>dir==='out'?y.outScore-x.outScore:y.inScore-x.inScore);
        let picked=0;
        for(const c of cps){
          if(picked>=perHop) break;
          let m=S.nodes.get(c.addr);
          if(!m){ m=ensureNode(c.addr,n.level+(dir==='out'?1:-1)); n.hiddenCps=n.hiddenCps.filter(x=>x.addr!==c.addr); }
          if(m.hidden) continue;
          picked++;
          if(!m.kind) await identifyOne(m);
          const cat=categoryOf(m);
          if(TERMINAL.has(cat)||m.kind==='contract'){ stops.push(m.addr); continue; } // don't trace through shared contracts / services
          if(!m.expanded) next.push(m.addr);
        }
        render();
        setMsg(`Trace ${dir==='out'?'maju':'mundur'}: hop ${h+1}/${hops}, ${expansions} alamat di-expand`);
      }
      frontier=[...new Set(next)];
    }
    const msg=(Busy.cancelled?'Dibatalkan. ':'')+`Trace selesai: ${expansions} alamat di-expand, ${stops.length} berhenti di kontrak/layanan.`;
    setMsg(msg); Audit.log(actor,'trace selesai',msg);
    return {expanded:expansions,stoppedAt:[...new Set(stops)],openFrontier:frontier};
  }finally{ tracing=false; Busy.end(job); render(); if(S.settings.autoId) identify([...S.nodes.values()]); }
}
function runPlaybook(id,addr,actor='user'){
  const p=PLAYBOOKS[id];
  return trace(addr,p.dir,p.hops,p.per,{sort:p.sort,actor,playbook:p.name});
}

// ---------- rendering ----------
let cy, renderT;
function scheduleRender(){ clearTimeout(renderT); renderT=setTimeout(render,150); }
function visibleTx(){
  const from=S.settings.from?Date.parse(S.settings.from)/1000:0;
  const to=S.settings.to?Date.parse(S.settings.to)/1000+86400:Infinity;
  const res=[]; let noValue=0;
  for(const t of S.tx.values()){
    const a=S.nodes.get(t.from), b=S.nodes.get(t.to);
    if(!a||!b||a.hidden||b.hidden||t.from===t.to) continue;
    if(S.settings.hideSpam&&t.spam) continue;
    if(S.hiddenTokens.has(t.sym)) continue;
    if(t.ts<from||t.ts>to) continue;
    if(S.settings.valueOnly&&!hasValue(t)){ noValue++; continue; }
    res.push(t);
  }
  S._noValue=noValue;
  return res;
}
// a transfer "has value" when it is the native coin or a token we can price (stablecoins, majors, dominant contract only)
const hasValue=t=>t.token==='native'||Prices.usd(t.sym,1,t.token)!=null;

// one edge per wallet pair (what TRM draws): tokens are merged, value shown in USD
function buildPairs(edges){
  const m=new Map();
  for(const e of edges){
    const k='p:'+e.from+'|'+e.to;
    let p=m.get(k); if(!p){ p={id:k,from:e.from,to:e.to,parts:[],usd:0,usdKnown:false,count:0,first:e.first,last:e.last}; m.set(k,p); }
    p.parts.push(e); p.count+=e.count; p.first=Math.min(p.first,e.first); p.last=Math.max(p.last,e.last);
    if(e.usd!=null){ p.usd+=e.usd; p.usdKnown=true; }
  }
  const minUsd=+S.settings.minUsd||0;
  const pairs=[...m.values()].filter(p=>!(minUsd&&p.usdKnown&&p.parts.every(e=>e.usd!=null)&&p.usd<minUsd));
  for(const p of pairs) p.parts.sort((a,b)=>(b.usd||0)-(a.usd||0)||b.amount-a.amount);
  return pairs;
}
function pairLabel(p){
  const main=p.parts[0];
  const val=p.usdKnown?fmtUsd(p.usd).replace('≈',''):(main?`${fmtNum(main.amount)} ${main.sym}`:'');
  return val+(p.count>1?` · ${p.count}×`:'');
}
function pairColor(p){
  const a=S.nodes.get(p.from)||{}, b=S.nodes.get(p.to)||{};
  if(b._cat==='cex') return '#30a46c';
  if(['mixer','sanction','hack','scam','bridge'].includes(b._cat)) return '#f76b15';
  if((BAD.has(a._cat)||(a._exposure||0)>=0.5)&&!TERMINAL.has(a._cat)) return '#e5484d';
  return '#6b7489';
}
// collapse small unlabelled leaf wallets into one "+N wallet lain" box per parent and direction
function groupLeaves(vis,pairs){
  S._groups=new Map();
  if(!S.settings.group) return {vis,pairs};
  const nb=new Map(), byLeaf=new Map();
  const addNb=(x,y)=>{ if(!nb.has(x)) nb.set(x,new Set()); nb.get(x).add(y); };
  for(const p of pairs){ addNb(p.from,p.to); addNb(p.to,p.from); }
  for(const p of pairs) for(const leaf of [p.from,p.to]){ if(!byLeaf.has(leaf)) byLeaf.set(leaf,[]); byLeaf.get(leaf).push(p); }
  const cand=new Map();
  for(const [leaf,set] of nb){
    if(set.size!==1) continue;
    const parent=[...set][0], n=S.nodes.get(leaf), par=S.nodes.get(parent);
    if(!n||!par||!par.expanded||n.expanded||n.pin||S.roots.includes(leaf)||selected===leaf) continue;
    if(n.label||n.db||n.color||n._cat||(n._sig&&n._sig.length)) continue; // keep anything with a real signal
    const ps=byLeaf.get(leaf), usd=ps.reduce((s,p)=>s+(p.usd||0),0);
    if(!cand.has(parent)) cand.set(parent,[]);
    cand.get(parent).push({addr:leaf,ps,usd,count:ps.reduce((s,p)=>s+p.count,0),level:n.level});
  }
  const drop=new Set(), dropPairs=new Set(), extra=[];
  for(const [parent,list] of cand){
    if(list.length<=8) continue;
    list.sort((a,b)=>b.usd-a.usd);
    const rest=list.slice(6), gid='g:'+parent, par=S.nodes.get(parent);
    const lvl=rest.filter(x=>x.level>par.level).length>=rest.length/2?par.level+1:par.level-1;
    let outUsd=0,inUsd=0,outN=0,inN=0;
    for(const x of rest) for(const p of x.ps){ if(p.from===parent){ outUsd+=p.usd||0; outN+=p.count; } else { inUsd+=p.usd||0; inN+=p.count; } dropPairs.add(p.id); }
    rest.forEach(x=>drop.add(x.addr));
    S._groups.set(gid,{id:gid,addr:gid,parent,members:rest.map(x=>({addr:x.addr,usd:x.usd,count:x.count,main:x.ps[0].parts[0]})),usd:outUsd+inUsd,count:outN+inN,level:lvl,order:1e6});
    if(outN) extra.push({id:'p:'+gid+'|out',from:parent,to:gid,parts:[],usd:outUsd,usdKnown:outUsd>0,count:outN,group:true});
    if(inN) extra.push({id:'p:'+gid+'|in',from:gid,to:parent,parts:[],usd:inUsd,usdKnown:inUsd>0,count:inN,group:true});
  }
  return {vis:new Set([...vis].filter(a=>!drop.has(a))),pairs:[...pairs.filter(p=>!dropPairs.has(p.id)),...extra]};
}

function buildEdges(list){
  const m=new Map();
  for(const t of list){
    const k=t.from+'|'+t.to+'|'+t.token+'|'+t.sym;
    let e=m.get(k);
    if(!e){
      const fake=t.token!=='native'&&Prices.dominant[t.sym]&&Prices.dominant[t.sym]!==t.token;
      e={id:k,from:t.from,to:t.to,sym:t.sym+(fake?' (kontrak lain)':''),token:t.token,amount:0,count:0,first:t.ts,last:t.ts,keys:[]}; m.set(k,e);
    }
    e.amount+=t.amount; e.count++; e.first=Math.min(e.first,t.ts); e.last=Math.max(e.last,t.ts); e.keys.push(t.key);
  }
  for(const e of m.values()) e.usd=Prices.usd(e.sym,e.amount,e.token);
  const min=+S.settings.minAmt||0;
  const edges=[...m.values()].filter(e=>e.amount>=min);
  const maxBy={}; for(const e of edges) maxBy[e.sym]=Math.max(maxBy[e.sym]||0,e.amount);
  for(const e of edges) e.w=1.2+5*Math.sqrt(e.amount/(maxBy[e.sym]||1));
  return edges;
}
function nodeColor(n){
  if(n.color) return n.color;
  if(n.kind==='contract') return '#8e4ec6';
  if(n.kind==='7702') return '#12a594';
  return '#3e63dd';
}
function nodeLabel(n){
  const l=n.label||(n.db&&n.db.name)||n.autoLabel;
  return (n._risk>=60?'⚠ ':'')+short(n.addr)+(l?'\n'+l:'');
}
const nodeData=n=>({id:n.addr,label:nodeLabel(n),color:nodeColor(n),unexp:!n.expanded,seed:S.roots.includes(n.addr),risk:n._risk||0});
function updateNodeEl(n){
  if(!cy) return; const el=cy.getElementById(n.addr);
  if(el.nonempty()) el.data(nodeData(n));
  if(selected===n.addr&&currentTab==='detail') showNode(n.addr);
}
function edgeLabel(e){
  if(!S.settings.edgeLabels) return '';
  return `${fmtNum(e.amount)} ${e.sym}`+(e.usd?` ${fmtUsd(e.usd)}`:'')+(e.count>1?` (${e.count} transfer)`:`\n${fmtDate(e.first)}`);
}

function render(){
  Prices.refresh();
  analyze();
  const txs=visibleTx(), edges=buildEdges(txs);
  let vis=new Set(S.roots);
  for(const n of S.nodes.values()) if(n.expanded&&!n.hidden) vis.add(n.addr);
  let pairs=buildPairs(edges);
  for(const p of pairs){vis.add(p.from);vis.add(p.to)}
  ({vis,pairs}=groupLeaves(vis,pairs));
  const ranked=pairs.slice().sort((a,b)=>(b.usd||0)-(a.usd||0)), top=new Set(ranked.slice(0,12).map(p=>p.id));
  const maxUsd=Math.max(1,...pairs.map(p=>p.usd||0));
  const syms={}; for(const t of S.tx.values()) if(!(S.settings.hideSpam&&t.spam)) syms[t.sym]=(syms[t.sym]||0)+1;
  renderTokens(syms);

  const keep=new Set();
  cy.batch(()=>{
    for(const a of vis){
      const n=S.nodes.get(a); if(!n||n.hidden) continue; keep.add(a);
      const el=cy.getElementById(a);
      if(el.empty()) cy.add({group:'nodes',data:nodeData(n),position:n.pos?{...n.pos}:{x:n.level*300,y:0}});
      else el.data(nodeData(n));
    }
    for(const g of S._groups.values()){
      keep.add(g.id);
      const d={id:g.id,label:`+${g.members.length} wallet lain${g.usd?'\n'+fmtUsd(g.usd).replace('≈',''):''}`,color:'#2b3142',grp:true,gw:96+String(g.members.length).length*8};
      const el=cy.getElementById(g.id);
      if(el.empty()) cy.add({group:'nodes',data:d,position:{x:g.level*300,y:0}}); else el.data(d);
    }
    for(const p of pairs){
      if(!keep.has(p.from)||!keep.has(p.to)) continue; keep.add(p.id);
      const full=pairLabel(p);
      const d={id:p.id,source:p.from,target:p.to,full,label:S.settings.allLabels||top.has(p.id)?full:'',color:p.group?'#6b7489':pairColor(p),w:1.2+5*Math.sqrt((p.usd||0)/maxUsd)};
      const el=cy.getElementById(p.id);
      if(el.empty()) cy.add({group:'edges',data:d}); else el.data(d);
    }
    for(const x of S.custom.values()){
      keep.add(x.id);
      const d={id:x.id,label:`${CUSTOM_TYPES[x.type]||'📌'} ${x.label}`,color:'#a18072',custom:true};
      const el=cy.getElementById(x.id);
      if(el.empty()) cy.add({group:'nodes',data:d,position:x.pos?{...x.pos}:{x:0,y:0}}); else el.data(d);
    }
    for(const l of S.links){
      if(!keep.has(l.from)||!keep.has(l.to)) continue; keep.add(l.id);
      const el=cy.getElementById(l.id);
      if(el.empty()) cy.add({group:'edges',data:{id:l.id,source:l.from,target:l.to,label:l.label||'',color:'#a18072',w:1.5,clink:true}});
    }
    cy.elements().forEach(el=>{ if(!keep.has(el.id())) el.remove(); });
  });
  S._edges=edges; S._pairs=pairs;
  $('empty').style.display=S.nodes.size?'none':'flex';
  $('noValueHint').textContent=S.settings.valueOnly&&S._noValue?`${S._noValue} transfer token tanpa harga (meme/spam) disembunyikan.`:'';
  $('st_nodes').textContent=cy.nodes().length; $('st_edges').textContent=cy.edges().length; stats();
  const hi=A.findings.filter(f=>f.sev==='high').length;
  $('findBadge').textContent=A.findings.length+A.review.length||'';
  $('findBadge').className='badge'+(hi?' hot':'');
  layout(false);
  if(currentTab==='find') renderFindings();
  else if(currentTab==='story') renderStory();
  else if(currentTab==='detail'&&selected&&S.nodes.has(selected)) showNode(selected);
  autosave();
}

function layout(fit){
  if(!cy.nodes().length) return;
  if(S.settings.layout==='cose'){
    cy.layout({name:'cose',animate:false,randomize:false,nodeRepulsion:()=>12000,idealEdgeLength:()=>160,fit:!!fit,padding:40}).run();
    return;
  }
  // flow layout: x = hop level from seed, y ordered by barycenter of neighbours one level closer to the seed
  const byLevel=new Map();
  const any=id=>S.nodes.get(id)||S.custom.get(id)||S._groups.get(id);
  cy.nodes().forEach(el=>{const n=any(el.id()); if(!byLevel.has(n.level)) byLevel.set(n.level,[]); byLevel.get(n.level).push(n);});
  const levels=[...byLevel.keys()].sort((a,b)=>Math.abs(a)-Math.abs(b)||a-b);
  const Y={}, GAP=110, XG=340;
  for(const L of levels){
    const arr=byLevel.get(L), ref=L>0?L-1:L+1;
    arr.forEach(n=>{
      const nb=cy.getElementById(n.addr).neighborhood('node').filter(m=>any(m.id()).level===ref&&Y[m.id()]!=null);
      n._bc=nb.length?nb.map(m=>Y[m.id()]).reduce((a,b)=>a+b,0)/nb.length:(L===0?n.order*1e-3:1e9+n.order);
    });
    arr.sort((a,b)=>a._bc-b._bc||a.order-b.order);
    arr.forEach((n,i)=>{Y[n.addr]=(i-(arr.length-1)/2)*GAP;});
  }
  cy.batch(()=>cy.nodes().forEach(el=>{
    const n=any(el.id());
    el.position(n.pos?{...n.pos}:{x:n.level*XG,y:Y[n.addr]});
  }));
  if(fit) cy.fit(undefined,40);
}

function renderTokens(syms){
  const entries=Object.entries(syms).sort((a,b)=>b[1]-a[1]);
  if(!entries.length){$('tokens').innerHTML='—';return}
  $('tokens').innerHTML=entries.map(([s,c])=>`<div class="tok cp" data-sym="${esc(s)}" style="${S.hiddenTokens.has(s)?'opacity:.35;text-decoration:line-through':''}">
    <span style="flex:1">${esc(s)}</span><span class="muted">${c}</span></div>`).join('');
}

// ---------- right panel ----------
let selected=null, currentTab='detail';
function setTab(t){
  currentTab=t;
  document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
  ['detail','find','story','agent','watch','audit'].forEach(x=>$('tab_'+x).style.display=x===t?(x==='agent'?'flex':'block'):'none');
  if(t==='find') renderFindings();
  if(t==='story') renderStory();
  if(t==='watch') Watch.render();
  if(t==='audit') renderAuditIfOpen();
  if(t==='agent') Agent.renderPanel();
  if(t==='detail') selected&&S.nodes.has(selected)?showNode(selected):showSummary();
  $('right').classList.add('open');
}
function selectNode(addr){
  selected=addr; cy.$(':selected').unselect(); cy.getElementById(addr).select();
  if(currentTab!=='agent') setTab('detail'); else showNode(addr);
}
function showNode(addr){
  const n=S.nodes.get(addr); if(!n) return;
  const txs=visibleTx().filter(t=>t.from===addr||t.to===addr).sort((a,b)=>b.ts-a.ts);
  const sums={};
  for(const t of txs){const d=t.from===addr?'out':'in'; sums[t.sym]=sums[t.sym]||{in:0,out:0}; sums[t.sym][d]+=t.amount;}
  const kind={eoa:isBtc()?`Alamat Bitcoin${n.scriptType?` (${n.scriptType})`:''}`:isSol()?'Wallet':'Wallet (EOA)',contract:isSol()?'Akun program / token':'Kontrak','7702':'EOA + EIP-7702','?':'tidak diketahui'}[n.kind]||'belum dicek';
  const bal=n.balance!=null?`<br>Saldo sekarang: <b style="color:var(--text)">${fmtNum(n.balance)} ${nativeSym()}</b> ${fmtUsd(Prices.usd(nativeSym(),n.balance))}${isSol()?' <span class="muted">(belum termasuk token)</span>':''}`:'';
  const act=n.busy?`<br><span class="warn">Sangat sibuk: ${n.busy.perDay?`±${n.busy.perDay.toLocaleString('id-ID')} transaksi/hari`:`${n.busy.total.toLocaleString('id-ID')} transaksi`}. Kemungkinan layanan yang dipakai banyak orang (exchange, hub, relayer).</span>`
    :n.firstSeen&&n.recentTx<1000?`<br>${n.recentTx} transaksi sejak ${fmtDate(n.firstSeen)}`:n.txTotal?`<br>${n.txTotal.toLocaleString('id-ID')} transaksi seumur hidup`:'';
  const tokOwner=n.tokenOwner?`<br>Pemilik akun token: <span class="mono cp" data-add="${n.tokenOwner}">${esc(nameOf(n.tokenOwner))}</span>`:'';
  const [rl,rc]=riskLevel(n._risk||0);
  const related=A.findings.filter(f=>f.addrs.includes(addr));
  const rows=txs.slice(0,300).map(t=>{
    const out=t.from===addr, cp=out?t.to:t.from;
    return `<tr><td class="muted">${fmtDate(t.ts)}</td><td class="${out?'out':'in'}">${out?'OUT':'IN'}</td>
      <td class="mono cp" data-sel="${cp}">${esc(nameOf(cp))}</td>
      <td class="r">${fmtNum(t.amount)} ${esc(t.sym)}</td><td><a href="${explorer('tx',t.hash)}" target="_blank" rel="noopener">↗</a></td></tr>`;}).join('');
  $('tab_detail').innerHTML=`
  <div class="card">
    <div class="addrline">${addr}</div>
    ${n.db?`<div class="dbtag ${'SHPM'.includes(n.db.cat)?'bad':'XD'.includes(n.db.cat)?'good':''}">🏷 ${esc(Labels.describe(n.db))}</div>`:''}
    <div class="muted" style="margin-top:4px">${kind}${n.autoLabel?` · <b style="color:var(--text)">${esc(n.autoLabel)}</b>`:''}${n._cat?` · <span class="pill">${CAT_NAME[n._cat]}</span>`:''}
      ${bal}${act}${tokOwner}
      ${n.delegate?`<br>Delegasi ke <span class="mono">${n.delegate}</span>`:''}
      ${n.impl?`<br>Implementasi <span class="mono">${short(n.impl)}</span>`:''}
      ${n.expanded?`<br>${n.txCount} transfer diambil${n.truncated?' <span class="warn">(terpotong, naikkan limit lalu Refresh)</span>':''}`:'<br><span class="warn">Belum di-expand</span>'}
      ${n.errs&&n.errs.length?`<br><span class="warn">Error: ${esc(n.errs[0])}</span>`:''}
    </div>
    <div class="btns">
      <a href="${explorer('address',addr)}" target="_blank" rel="noopener"><button class="small">Explorer ↗</button></a>
      <button class="small" data-act="copy">Salin</button>
      ${n.expanded?`<button class="small" data-act="refresh">Refresh</button>`:`<button class="small primary" data-act="expand">Expand</button>`}
      ${n.hiddenCps.length?`<button class="small" data-act="more">+${n.hiddenCps.length} counterparty</button>`:''}
      ${n.expanded&&n.kind!=='contract'?`<button class="small${XChain.bridgeLegs(addr).length?' primary':''}" data-bridges="${addr}">🌉 Lacak bridge</button>`:''}
      ${n._cat==='cex'?`<button class="small primary" data-freeze="${addr}">📄 Paket laporan ke exchange</button>`:''}
      <button class="small" data-act="watch">${Watch.has(addr)?'👁 Dipantau':'👁 Pantau'}</button>
      <button class="small" data-act="ask">🤖 Tanya agent</button>
    </div>
    <div class="screen">${screening(n)}</div>
    <div class="links">Cek di: ${externalLinks(addr)}</div>
  </div>
  <div class="card"><h3>Atribusi (siapa pemiliknya?)</h3>${attributionHtml(n)}</div>
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">Risiko</h3><span class="sev ${rc}">${rl} · ${n._risk||0}/100</span></div>
    <div class="meter"><div style="width:${n._risk||0}%" class="${rc}"></div></div>
    <div class="plain">${esc(plainRisk(n))}</div>
    ${n._why&&n._why.length?`<ul class="why">${n._why.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:'<div class="muted">Tidak ada indikator risiko dari data saat ini.</div>'}
    ${related.length?`<div class="muted" style="margin-top:6px">Terkait ${related.length} temuan · <span class="cp" data-tab="find">lihat Temuan</span></div>`:''}
  </div>
  <div class="card">
    <div class="row"><input id="lbl" placeholder="Label (mis. Exploiter 1, Binance hot wallet)" value="${esc(n.label)}" style="flex:1"></div>
    <div class="colors">${NODE_COLORS.map(([c,t])=>`<button title="${t}" data-color="${c}" class="${n.color===c?'on':''}" style="background:${c}"></button>`).join('')}
      <button title="Reset warna" data-color="" style="background:transparent;border:1px dashed var(--muted)"></button></div>
    <textarea id="notes" rows="2" placeholder="Catatan investigasi…" style="width:100%;margin-top:8px">${esc(n.notes)}</textarea>
  </div>
  <div class="card">
    <h3>Telusuri otomatis</h3>
    <div class="row"><select id="pb" style="flex:1">${Object.entries(PLAYBOOKS).map(([k,p])=>`<option value="${k}">${p.name}</option>`).join('')}</select><button class="small primary" data-act="playbook">Jalankan</button></div>
    <div class="muted" id="pbDesc" style="font-size:12px">${PLAYBOOKS.hack.desc}</div>
    <div class="row" style="margin-top:8px"><label>Manual: hop</label><input type="number" id="t_hops" value="3" min="1" max="8"><label>cabang</label><input type="number" id="t_per" value="3" min="1" max="10"></div>
    <div class="btns">
      <button class="small" data-act="tfwd">Trace maju →</button>
      <button class="small" data-act="tback">← Trace mundur</button>
      <button class="small" data-act="path">Jalur dari seed</button>
      <button class="small" data-act="exits">Jalur ke exchange</button>
      <button class="small" data-act="custom">＋ Elemen manual</button>
      <button class="small" data-act="root">Jadikan seed</button>
      <button class="small" data-act="hide">Sembunyikan</button>
    </div>
  </div>
  <div class="card">
    <h3>Ringkasan (sesuai filter)</h3>
    <table><tr><th>Token</th><th class="r">Masuk</th><th class="r">Keluar</th></tr>
    ${Object.entries(sums).map(([s,v])=>`<tr><td>${esc(s)}</td><td class="r in">${fmtNum(v.in)}</td><td class="r out">${fmtNum(v.out)}</td></tr>`).join('')||'<tr><td colspan=3 class="muted">Tidak ada transfer yang terlihat</td></tr>'}
    </table>
  </div>
  <div class="card">
    <h3>Transfer ke node di graph (${txs.length})</h3>
    <table>${rows||'<tr><td class="muted">—</td></tr>'}</table>
  </div>`;
  $('pb').onchange=e=>$('pbDesc').textContent=PLAYBOOKS[e.target.value].desc;
  $('lbl').oninput=e=>{n.label=e.target.value.trim(); saveLabel(n); updateNodeEl(n);};
  $('lbl').onchange=()=>{Audit.log('user','label',`${addr} = "${n.label}"`); render();};
  $('notes').oninput=e=>{n.notes=e.target.value; autosave();};
  $('notes').onchange=()=>Audit.log('user','catatan',`${addr}: ${n.notes.slice(0,200)}`);
}
function showGroup(gid){
  const g=S._groups.get(gid); if(!g) return;
  setTab('detail');
  $('tab_detail').innerHTML=`<div class="card"><h3>${g.members.length} wallet kecil yang bertransaksi dengan ${esc(nameOf(g.parent))}</h3>
    <p class="muted" style="margin:0 0 6px">Wallet-wallet ini dikelompokkan supaya graph tetap rapi: nilainya kecil, tanpa label, dan belum ditelusuri.</p>
    <div class="btns" style="margin-bottom:6px"><button class="small primary" data-unpin="${gid}">Tampilkan semua di graph</button></div>
    <table>${g.members.sort((a,b)=>(b.usd||0)-(a.usd||0)).map(m=>`<tr><td class="mono">${short(m.addr)}</td><td class="r">${m.usd?fmtUsd(m.usd):m.main?fmtNum(m.main.amount)+' '+esc(m.main.sym):''}</td><td><button class="small" data-pin="${m.addr}">Tampilkan</button></td></tr>`).join('')}</table></div>`;
}
function showEdge(id){
  if(id.startsWith('p:g:')){ showGroup(id.slice(2).replace(/\|(in|out)$/,'')); return; }
  if(id.startsWith('p:')){
    const p=(S._pairs||[]).find(x=>x.id===id); if(!p) return;
    setTab('detail');
    const txs=p.parts.flatMap(e=>e.keys.map(k=>S.tx.get(k))).sort((a,b)=>b.ts-a.ts);
    $('tab_detail').innerHTML=`<div class="card">
      <div><span class="cp mono" data-sel="${p.from}">${esc(nameOf(p.from))}</span> → <span class="cp mono" data-sel="${p.to}">${esc(nameOf(p.to))}</span></div>
      <div style="font-size:18px;margin-top:6px">${p.usdKnown?fmtUsd(p.usd):''}</div>
      <div class="muted">${p.count} transfer · ${fmtDate(p.first)}${p.count>1?' — '+fmtDate(p.last):''}</div>
      <table style="margin-top:6px">${p.parts.map(e=>`<tr><td>${esc(e.sym)}</td><td class="r">${fmtNum(e.amount)}</td><td class="r muted">${e.usd?fmtUsd(e.usd):''}</td></tr>`).join('')}</table></div>
      <div class="card"><table><tr><th>Waktu</th><th class="r">Jumlah</th><th></th></tr>
      ${txs.slice(0,300).map(t=>`<tr><td class="muted">${fmtDate(t.ts)}</td><td class="r">${fmtNum(t.amount)} ${esc(t.sym)}</td><td><a href="${explorer('tx',t.hash)}" target="_blank" rel="noopener">${t.hash.slice(0,10)}…</a></td></tr>`).join('')}
      </table></div>`;
    return;
  }
  const e=(S._edges||[]).find(x=>x.id===id); if(!e) return;
  setTab('detail');
  const txs=e.keys.map(k=>S.tx.get(k)).sort((a,b)=>b.ts-a.ts);
  $('tab_detail').innerHTML=`<div class="card">
    <div><span class="cp mono" data-sel="${e.from}">${esc(nameOf(e.from))}</span> → <span class="cp mono" data-sel="${e.to}">${esc(nameOf(e.to))}</span></div>
    <div style="font-size:18px;margin-top:6px">${fmtNum(e.amount)} ${esc(e.sym)}</div>
    <div class="muted">${e.count} transfer · ${fmtDate(e.first)}${e.count>1?' — '+fmtDate(e.last):''}</div></div>
    <div class="card"><table><tr><th>Waktu</th><th class="r">Jumlah</th><th>Jenis</th><th></th></tr>
    ${txs.map(t=>`<tr><td class="muted">${fmtDate(t.ts)}</td><td class="r">${fmtNum(t.amount)}</td><td class="muted">${t.kind}</td><td><a href="${explorer('tx',t.hash)}" target="_blank" rel="noopener">${t.hash.slice(0,10)}…</a></td></tr>`).join('')}
    </table></div>`;
}
function showSummary(){
  if(!S.nodes.size){$('tab_detail').innerHTML='<p class="muted">Belum ada case. Klik node untuk melihat detail.</p>';return}
  const flagged=[...S.nodes.values()].filter(n=>!n.hidden&&(n.label||n.color));
  const risky=[...S.nodes.values()].filter(n=>!n.hidden&&n._risk>=30).sort((a,b)=>b._risk-a._risk).slice(0,10);
  const item=n=>`<div class="tok cp" data-sel="${n.addr}"><span class="sw" style="background:${nodeColor(n)};border-radius:50%"></span><span class="mono">${short(n.addr)}</span> <span style="flex:1">${esc(n.label||n.autoLabel)}</span>${n._risk?`<span class="sev ${riskLevel(n._risk)[1]}">${n._risk}</span>`:''}</div>`;
  $('tab_detail').innerHTML=`<div class="card"><h3>Case</h3>
    <input id="caseTitle" placeholder="Judul case (mis. Penipuan investasi A)" value="${esc(S.meta.title)}" style="width:100%;margin-bottom:6px">
    <textarea id="caseNotes" rows="3" placeholder="Catatan case: kronologi dari korban, nomor laporan polisi, kontak…" style="width:100%">${esc(S.meta.notes)}</textarea>
    <div class="muted">${esc(chainInfo().chainname)}</div>
    <div style="margin-top:6px">Seed: ${S.roots.map(r=>`<span class="mono cp" data-sel="${r}">${short(r)}</span>`).join(', ')}</div>
    <div class="btns"><button class="small" data-tab="find">Lihat temuan (${A.findings.length})</button><button class="small" data-tab="agent">🤖 Tanya agent</button></div></div>
    <div class="card"><h3>Risiko tertinggi</h3>${risky.map(item).join('')||'<span class="muted">Belum ada.</span>'}</div>
    <div class="card"><h3>Alamat berlabel (${flagged.length})</h3>${flagged.map(item).join('')||'<span class="muted">Belum ada. Beri label lewat panel node.</span>'}</div>`;
  $('caseTitle').oninput=e=>{S.meta.title=e.target.value; autosave();};
  $('caseTitle').onchange=()=>Audit.log('user','judul case',S.meta.title);
  $('caseNotes').oninput=e=>{S.meta.notes=e.target.value; autosave();};
  $('caseNotes').onchange=()=>Audit.log('user','catatan case',S.meta.notes.slice(0,300));
}
function saveLabel(n){
  const k=labelKey(n.addr);
  if(n.label||n.color) S.labels[k]={label:n.label,color:n.color}; else delete S.labels[k];
  store.set('ci_labels',S.labels); autosave();
}

// ---------- case lifecycle ----------
function resetCase(){
  S.roots=[]; S.nodes.clear(); S.tx.clear(); S.hiddenTokens.clear(); S.order=0; idQueue.length=0;
  S.custom.clear(); S.links=[]; S.meta={title:'',notes:''};
  for(const k in tokenColor) delete tokenColor[k];
  Audit.load([]); Agent.reset();
  cy.elements().remove(); selected=null; render(); showSummary();
}
function parseInput(v){
  v=v.trim();
  let host=''; try{ host=new URL(v).host; }catch(e){}
  if(/mempool\.space|blockstream\.info|blockchair\.com|blockchain\.com|btcscan/.test(host)||(!/\s/.test(v)&&BTC_ADDR_RE.test(v)&&!/^1{8,}/.test(v))){ // ≤34-char base58 is Bitcoin: real Solana keys encode to 43–44 chars (only system ids like 1111… are shorter)
    const bm=v.match(/\b(bc1[02-9ac-hj-np-z]{11,87}|BC1[02-9AC-HJ-NP-Z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})\b/);
    if(bm&&BTC_ADDR_RE.test(bm[1])) return {addr:norm(bm[1]),chain:'btc'};
    if(host) return null;
  }
  if(/solscan\.io|solana\.fm|explorer\.solana\.com/.test(host)||(!/0x/i.test(v)&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v))){
    const sm=v.match(/[1-9A-HJ-NP-Za-km-z]{32,44}(?![1-9A-HJ-NP-Za-km-z])/g)||[];
    const a=sm.find(x=>x.length<=44&&x.length>=32);
    return a?{addr:a,chain:'sol'}:null;
  }
  const m=v.match(/0x[0-9a-fA-F]{40}/); if(!m) return null;
  try{ const host=new URL(v).host; const c=S.chains.find(c=>{try{return new URL(c.blockexplorer).host===host}catch(e){return false}}); if(c) return {addr:m[0].toLowerCase(),chain:c.chainid}; }catch(e){}
  return {addr:m[0].toLowerCase(),chain:null};
}
async function investigate(add){
  const raw=$('addr').value.trim();
  const solSig=(raw.match(/[1-9A-HJ-NP-Za-km-z]{80,90}/)||[])[0];
  if(solSig&&!/0x/i.test(raw)){
    if(!isSol()){ S.chainId='sol'; $('chain').value='sol'; store.set('ci_chain','sol'); }
    try{ await Busy.run('Membaca transaksi Solana',()=>Sol.investigateTx(solSig)); }catch(err){ alert('Gagal membaca transaksi: '+err.message); }
    return;
  }
  const btcTx=(raw.match(/(?:^|[^0-9a-fA-Fx])([0-9a-fA-F]{64})(?![0-9a-fA-F])/)||[])[1];
  if(btcTx&&!/0x[0-9a-fA-F]{64}/.test(raw)){
    if(!isBtc()){ S.chainId='btc'; $('chain').value='btc'; store.set('ci_chain','btc'); }
    try{ await Busy.run('Membaca transaksi Bitcoin',()=>Btc.investigateTx(btcTx.toLowerCase())); }catch(err){ alert('Gagal membaca transaksi: '+err.message); }
    return;
  }
  const txm=raw.match(/0x[0-9a-fA-F]{64}/);
  if(txm){
    try{ const host=new URL(raw).host; const c=S.chains.find(c=>{try{return new URL(c.blockexplorer).host===host}catch(e){return false}}); if(c&&c.chainid!==S.chainId){ S.chainId=c.chainid; $('chain').value=c.chainid; store.set('ci_chain',c.chainid); } }catch(e){}
    try{ await Busy.run('Membaca transaksi',()=>investigateTx(txm[0].toLowerCase())); }catch(err){ alert('Gagal membaca transaksi: '+err.message); }
    return;
  }
  const p=parseInput(raw);
  if(!p){alert('Alamat tidak valid. EVM: 0x + 40 karakter hex. Solana: 32–44 karakter base58. Bitcoin: diawali 1, 3, atau bc1.');return}
  if(p.chain&&p.chain!==S.chainId){
    if(add&&S.nodes.size){alert('Link ini dari chain lain. Satu case hanya bisa berisi satu chain.');return}
    S.chainId=p.chain; $('chain').value=p.chain; store.set('ci_chain',p.chain);
  }
  if(!add||!S.nodes.size){ resetCase(); Audit.log('user','case baru',`${chainInfo().chainname} · seed ${p.addr}`); }
  else Audit.log('user','tambah seed',p.addr);
  if(!S.roots.includes(p.addr)) S.roots.push(p.addr);
  const n=ensureNode(p.addr,0); n.level=0; n.pos=null;
  render(); selectNode(p.addr);
  await Busy.run('Memulai investigasi',()=>expand(p.addr),{node:p.addr});
  layout(true); selectNode(p.addr);
}

let saveT;
const caseKey=()=>S.roots[0]?`ci_case_${S.chainId}_${S.roots[0]}`:null;
let lastSave=0;
function autosave(){
  clearTimeout(saveT);
  // debounce, but never postpone longer than 3 s (identify/trace re-render many times per second)
  saveT=setTimeout(saveNow,Date.now()-lastSave>3000?0:600);
}
function saveNow(){
  lastSave=Date.now();
  {
    const key=caseKey(); if(!key) return;
    let idx=store.get('ci_cases',[]).filter(c=>c.key!==key);
    idx.unshift({key,chain:S.chainId,seed:S.roots[0],label:nameOf(S.roots[0]),nodes:S.nodes.size,ts:Date.now()});
    for(const old of idx.slice(8)) { try{localStorage.removeItem(old.key)}catch(e){} }
    idx=idx.slice(0,8);
    try{ localStorage.setItem(key,JSON.stringify(serialize())); }
    catch(e){ // storage full: drop the oldest saved cases and retry once
      for(const old of idx.slice(1)) { try{localStorage.removeItem(old.key)}catch(_){} }
      idx=idx.slice(0,1); try{ localStorage.setItem(key,JSON.stringify(serialize())); }catch(_){ setMsg('Penyimpanan browser penuh. Simpan case lewat menu Case.'); }
    }
    store.set('ci_cases',idx); store.set('ci_last',key);
  }
}
window.addEventListener('beforeunload',()=>{ if(caseKey()) saveNow(); });
function renderDbInfo(){
  if(typeof LABEL_DATA==='undefined'){ $('dbInfo').textContent='Database label publik tidak ditemukan. Jalankan tools/update_labels.py.'; return; }
  const m=LABEL_DATA.meta, here=(m.counts[S.chainId]||0)+(m.counts['*']||0);
  $('dbInfo').innerHTML=`Database label publik: <b>${Object.values(m.counts).reduce((a,b)=>a+b,0).toLocaleString('id-ID')}</b> alamat (${here.toLocaleString('id-ID')} berlaku di ${esc(chainInfo().chainname)}), diperbarui ${m.updated}. Sumber: ${m.sources.map(esc).join(', ')}. Perbarui dengan menjalankan <span class="mono">Update Database Label.bat</span>.`;
}
function renderHistory(){
  renderDbInfo();
  const idx=store.get('ci_cases',[]);
  $('history').innerHTML=idx.map(c=>`<div class="tok"><span style="flex:1"><b>${esc(c.label||short(c.seed))}</b> <span class="muted">${esc(Labels.chainName(c.chain))} · ${c.nodes} node · ${new Date(c.ts).toLocaleString('id-ID',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span></span><button class="small" data-hopen="${c.key}">Buka</button></div>`).join('')||'<span class="muted">Belum ada.</span>';
}
function serialize(){
  return {v:2,chainId:S.chainId,roots:S.roots,hiddenTokens:[...S.hiddenTokens],
    nodes:[...S.nodes.values()].map(n=>{const o={}; for(const k in n) if(k[0]!=='_') o[k]=n[k]; return o;}),
    tx:[...S.tx.values()], audit:Audit.entries, agent:Agent.serialize(),
    custom:[...S.custom.values()], links:S.links, meta:S.meta};
}
function load(d){
  if(!d||!d.nodes) return;
  S.chainId=d.chainId||'1'; $('chain').value=S.chainId;
  S.roots=d.roots||[]; S.nodes=new Map(d.nodes.map(n=>[n.addr,n]));
  for(const n of S.nodes.values()) n.db=Labels.lookup(n.addr); S.tx=new Map((d.tx||[]).map(t=>[t.key,t]));
  S.hiddenTokens=new Set(d.hiddenTokens||[]); S.order=d.nodes.length;
  S.custom=new Map((d.custom||[]).map(x=>[x.id,x])); S.links=d.links||[]; S.meta=d.meta||{title:'',notes:''};
  Audit.load(d.audit); Agent.load(d.agent);
  cy.elements().remove(); render(); layout(true); showSummary();
}

// ---------- graph interactions ----------
function clearPath(){ cy.elements().removeClass('path faded'); }
function highlightPath(target){
  clearPath();
  for(const r of S.roots){
    for(const [a,b] of [[r,target],[target,r]]){
      const p=cy.elements().dijkstra({root:cy.getElementById(a),directed:true}).pathTo(cy.getElementById(b));
      if(p.length>1){ cy.elements().addClass('faded'); p.removeClass('faded').addClass('path'); setMsg('Jalur ditemukan: '+(p.nodes().length-1)+' hop'); return p.nodes().map(x=>x.id()); }
    }
  }
  setMsg('Tidak ada jalur berarah antara seed dan node ini di graph saat ini.');
  return null;
}
function focusNode(addr){
  const el=cy.getElementById(addr); if(el.empty()) return false;
  selectNode(addr); cy.animate({center:{eles:el},zoom:Math.max(cy.zoom(),0.8)},{duration:250}); return true;
}
function initCy(){
  cy=cytoscape({
    container:$('cy'), wheelSensitivity:0.25, minZoom:0.05, maxZoom:3,
    style:[
      {selector:'node',style:{'background-color':'data(color)','label':'data(label)','color':'#e6e8ee','font-size':11,'font-family':'Consolas, monospace',
        'text-valign':'bottom','text-halign':'center','text-margin-y':6,'text-wrap':'wrap','text-max-width':200,'width':34,'height':34,
        'border-width':3,'border-color':'#0b0d12','text-background-color':'#0b0d12','text-background-opacity':0.75,'text-background-padding':2,'text-background-shape':'roundrectangle'}},
      {selector:'node[risk>=60]',style:{'underlay-color':'#e5484d','underlay-opacity':0.35,'underlay-padding':7,'underlay-shape':'ellipse'}},
      {selector:'node[?unexp]',style:{'border-style':'dashed','border-color':'#8b93a7','border-width':2}},
      {selector:'node[?custom]',style:{'shape':'diamond','width':30,'height':30,'border-color':'#d9b99b','border-width':2,'border-style':'solid'}},
      {selector:'edge[?clink]',style:{'line-style':'dashed','target-arrow-shape':'none'}},
      {selector:'node[?seed]',style:{'width':48,'height':48,'border-color':'#ffffff','border-width':3,'border-style':'double','font-weight':'bold'}},
      {selector:'node.working',style:{'border-color':'#ffd166','border-width':4,'border-style':'solid'}},
      {selector:'node.working-on',style:{'border-color':'#0b0d12','background-opacity':0.55}},
      {selector:'node:selected',style:{'border-color':'#ffd166','border-width':4,'border-style':'solid'}},
      {selector:'edge',style:{'width':'data(w)','line-color':'data(color)','target-arrow-color':'data(color)','target-arrow-shape':'triangle','arrow-scale':1,
        'curve-style':'bezier','control-point-step-size':40,'label':'data(label)','font-size':10,'color':'#e6e8ee','text-rotation':'autorotate',
        'text-background-color':'#0b0d12','text-background-opacity':0.9,'text-background-padding':3,'text-background-shape':'roundrectangle','opacity':0.75}},
      {selector:'edge.hl',style:{'label':'data(full)','opacity':1,'z-index':50}},
      {selector:'node[?grp]',style:{'shape':'round-rectangle','width':'data(gw)','height':36,'text-wrap':'wrap','text-max-width':'data(gw)','background-color':'#20263a','border-color':'#6b7489','border-style':'dashed','border-width':1.5,'text-valign':'center','text-margin-y':0,'font-size':10,'text-background-opacity':0}},
      {selector:'edge:selected',style:{'opacity':1,'line-color':'#ffd166','target-arrow-color':'#ffd166'}},
      {selector:'.faded',style:{'opacity':0.1,'text-opacity':0.15}},
      {selector:'.path',style:{'opacity':1,'line-color':'#ffd166','target-arrow-color':'#ffd166','border-color':'#ffd166','z-index':99}},
    ],
  });
  cy.on('tap','node',e=>{clearPath(); const id=e.target.id(); if(S.custom.has(id)) showCustom(id); else if(S._groups&&S._groups.has(id)) showGroup(id); else selectNode(id);});
  cy.on('dbltap','node',e=>{const n=S.nodes.get(e.target.id()); if(n&&!n.expanded) expand(n.addr).then(()=>selectNode(n.addr));});
  cy.on('tap','edge',e=>{clearPath(); selected=null; showEdge(e.target.id());});
  cy.on('tap',e=>{if(e.target===cy){clearPath(); selected=null; if(currentTab==='detail') showSummary();}});
  cy.on('dragfree','node',e=>{const n=S.nodes.get(e.target.id())||S.custom.get(e.target.id()); if(n){n.pos={...e.target.position()}; autosave();}});
  cy.on('mouseover','node',e=>{ e.target.connectedEdges().addClass('hl'); if(cy.$('.path').length) return; cy.elements().addClass('faded'); e.target.closedNeighborhood().removeClass('faded'); });
  cy.on('mouseout','node',e=>{ e.target.connectedEdges().removeClass('hl'); if(!cy.$('.path').length) cy.elements().removeClass('faded'); });
  cy.on('mouseover','edge',e=>e.target.addClass('hl'));
  cy.on('mouseout','edge',e=>e.target.removeClass('hl'));
}

// ---------- watermark on exported images ----------
const WATERMARK='Cheri';
function watermarkPng(dataUrl,dark){
  return new Promise(res=>{
    const img=new Image();
    img.onload=()=>{
      const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
      const g=c.getContext('2d'); g.drawImage(img,0,0);
      const s=Math.max(c.width,c.height);
      g.save(); g.translate(c.width/2,c.height/2); g.rotate(-24*Math.PI/180);
      g.font=`800 ${Math.round(s/7)}px system-ui,sans-serif`; g.textAlign='center'; g.textBaseline='middle';
      g.fillStyle=dark?'rgba(255,255,255,.05)':'rgba(0,0,0,.05)'; g.fillText(WATERMARK.toUpperCase(),0,0); g.restore();
      const f=Math.max(14,Math.round(s/70));
      g.font=`600 ${f}px system-ui,sans-serif`; g.textAlign='right'; g.textBaseline='bottom';
      g.fillStyle=dark?'rgba(230,232,238,.6)':'rgba(17,17,17,.55)';
      g.fillText(`Chain Investigator · by ${WATERMARK}`,c.width-f,c.height-f*0.8);
      res(c.toDataURL('image/png'));
    };
    img.onerror=()=>res(dataUrl);
    img.src=dataUrl;
  });
}

// ---------- report ----------
async function exportReport(){
  await Audit.chain; const v=await Audit.verify();
  const png=cy.nodes().length?await watermarkPng(cy.png({full:true,scale:1.5,bg:'#ffffff'}),false):'';
  const nodes=[...S.nodes.values()].filter(n=>!n.hidden);
  const labeled=nodes.filter(n=>n.label||n.autoLabel||n._risk>=30).sort((a,b)=>(b._risk||0)-(a._risk||0));
  const sevName={high:'Tinggi',med:'Sedang',low:'Rendah',info:'Info'};
  const f=x=>`<li><b>[${sevName[x.sev]}] ${esc(x.title)}</b>${x.detail?'<br>'+esc(x.detail):''}${x.addrs.length?'<br><code>'+x.addrs.join('<br>')+'</code>':''}</li>`;
  const html=`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Laporan investigasi</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:960px;margin:24px auto;padding:0 16px;color:#111}h1{margin-bottom:0}h2{border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:28px}
@media print{.noprint{display:none}}
table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}code{font-size:12px;word-break:break-all}img{max-width:100%;border:1px solid #ddd}.m{color:#666}</style></head><body>
<p class="m noprint" style="background:#fff8d6;padding:6px 10px;border-radius:6px">Teks laporan ini bisa diedit langsung (klik lalu ketik). Simpan sebagai PDF dengan Ctrl+P.</p>
<div contenteditable="true">
<h1>${esc(S.meta.title||'Laporan investigasi on-chain')}</h1>
<p class="m">Dibuat ${new Date().toLocaleString('id-ID')} · ${esc(chainInfo().chainname)} · Chain Investigator · Data: ${isSol()?'Helius':isBtc()?'mempool.space':'Etherscan API V2'} · Waktu: ${tzName()}</p>
${S.meta.notes?`<h2>Catatan</h2><p style="white-space:pre-wrap">${esc(S.meta.notes)}</p>`:''}
<h2>Seed</h2><ul>${S.roots.map(r=>`<li><code>${r}</code> ${esc(nameOf(r))}</li>`).join('')}</ul>
<h2>Graph alur dana</h2>${png?`<img src="${png}">`:'<p>—</p>'}
<h2>Langkah berikutnya</h2><ol>${A.steps.map(s=>`<li>${esc(s.text)}</li>`).join('')||'<li>—</li>'}</ol>
<h2>Temuan</h2><ul>${A.findings.map(f).join('')||'<li>—</li>'}</ul>
<h2>Review graph</h2><ul>${A.review.map(f).join('')||'<li>—</li>'}</ul>
<h2>Alamat penting</h2><table><tr><th>Alamat</th><th>Label</th><th>Risiko</th><th>Alasan</th><th>Catatan</th></tr>
${labeled.map(n=>`<tr><td><code>${n.addr}</code></td><td>${esc(n.label||n.autoLabel)}</td><td>${n._risk||0}</td><td>${esc((n._why||[]).join('; '))}</td><td>${esc(n.notes)}</td></tr>`).join('')}</table>
<h2>Alur dana (edge)</h2><table><tr><th>Dari</th><th>Ke</th><th>Jumlah</th><th>Transfer</th><th>Waktu</th></tr>
${(S._edges||[]).slice().sort((a,b)=>a.first-b.first).map(e=>`<tr><td><code>${e.from}</code><br>${esc(nameOf(e.from))}</td><td><code>${e.to}</code><br>${esc(nameOf(e.to))}</td><td>${fmtNum(e.amount)} ${esc(e.sym)}</td><td>${e.count}</td><td>${new Date(e.first*1000).toISOString()}${e.count>1?'<br>'+new Date(e.last*1000).toISOString():''}</td></tr>`).join('')}</table>
<h2>Audit log</h2><p class="m">Rantai hash: ${v.ok?`utuh (${v.n} entri, head <code>${v.head}</code>)`:`RUSAK di entri #${v.at}`}</p>
<table><tr><th>#</th><th>Waktu (UTC)</th><th>Aktor</th><th>Aksi</th><th>Detail</th><th>Hash</th></tr>
${Audit.entries.map(e=>`<tr><td>${e.i}</td><td>${e.ts}</td><td>${e.actor}</td><td>${esc(e.action)}</td><td>${esc(e.detail)}</td><td><code>${(e.hash||'').slice(0,16)}</code></td></tr>`).join('')}</table>
<p class="m">Temuan dalam laporan ini adalah hasil heuristik dari data on-chain publik dan perlu diverifikasi. Bukan kesimpulan hukum.</p></div>
<p class="m" style="text-align:right;margin-top:24px">Chain Investigator · by ${WATERMARK}</p></body></html>`;
  download(`laporan-${S.roots[0]?short(S.roots[0]).replace('…','-'):'case'}-${new Date().toISOString().slice(0,10)}.html`,html,'text/html');
  Audit.log('user','export','laporan HTML');
}

// ---------- UI wiring ----------
function bindSettings(){
  const s=S.settings;
  const map=[['s_offset','offset','num'],['s_sort','sort'],['s_topk','topK','num'],['s_autoid','autoId','bool'],['s_spam','hideSpam','bool'],
    ['s_minusd','minUsd','num'],['s_from','from'],['s_to','to'],['s_alllabels','allLabels','bool'],['s_value','valueOnly','bool'],['s_group','group','bool'],['s_layout','layout']];
  for(const [id,k,t] of map){
    const el=$(id);
    if(t==='bool') el.checked=!!s[k]; else el.value=s[k];
    el.addEventListener('change',()=>{
      s[k]=t==='bool'?el.checked:t==='num'?Number(el.value):el.value;
      store.set('ci_settings',s);
      if(['offset','sort','topK','autoId'].includes(k)) return;
      if(k==='layout'){ layout(true); return; }
      render();
    });
  }
}
function openKey(){ $('keyInput').value=store.get('ci_key',''); $('aKeyInput').value=store.get('ci_akey',''); $('hKeyInput').value=store.get('ci_hkey',''); $('keyDlg').showModal(); }

async function loadChains(){
  try{ const j=await (await fetch('https://api.etherscan.io/v2/chainlist')).json(); S.chains=(j.result||[]).filter(c=>c.status!==0); }catch(e){}
  if(!S.chains.length) S.chains=FALLBACK_CHAINS;
  S.chains.unshift({chainname:'Solana',chainid:'sol',blockexplorer:'https://solscan.io/'},{chainname:'Bitcoin',chainid:'btc',blockexplorer:'https://mempool.space/'});
  const main=S.chains.filter(c=>isEvm(c.chainid)&&!/testnet|sepolia|hoodi|amoy|fuji|apothem|curtis|bokuto|bepolia|insectarium/i.test(c.chainname));
  const test=S.chains.filter(c=>!main.includes(c)&&isEvm(c.chainid));
  $('chain').innerHTML=`<optgroup label="Non-EVM"><option value="btc">Bitcoin (via mempool.space, tanpa API key)</option><option value="sol">Solana (via Helius)</option></optgroup><optgroup label="EVM mainnet">${main.map(c=>`<option value="${c.chainid}">${esc(c.chainname)}</option>`).join('')}</optgroup>`+
    (test.length?`<optgroup label="Testnet">${test.map(c=>`<option value="${c.chainid}">${esc(c.chainname)}</option>`).join('')}</optgroup>`:'');
  $('chain').value=S.chainId;
}

document.addEventListener('click',async e=>{
  const tab=e.target.closest('[data-tab]'); if(tab){ setTab(tab.dataset.tab); return; }
  const sel=e.target.closest('[data-sel]'); if(sel){ const a=norm(sel.dataset.sel); if(!focusNode(a)) setMsg(short(a)+' tidak ada di graph.'); return; }
  const wo=e.target.closest('[data-wopen]'); if(wo){ const w=Watch.list[+wo.dataset.wopen]; if(w.chainId!==S.chainId){ S.chainId=w.chainId; $('chain').value=w.chainId; store.set('ci_chain',w.chainId); } $('addr').value=w.addr; investigate(S.nodes.has(w.addr)); return; }
  const ho=e.target.closest('[data-hopen]'); if(ho){ const d=store.get(ho.dataset.hopen,null); if(d){ load(d); $('menuDlg').close(); Audit.log('user','buka case','riwayat'); } return; }
  const pn=e.target.closest('[data-pin]'); if(pn){ const n=S.nodes.get(pn.dataset.pin); if(n){ n.pin=true; render(); focusNode(n.addr); } return; }
  const up=e.target.closest('[data-unpin]'); if(up){ const g=S._groups.get(up.dataset.unpin); if(g){ g.members.forEach(m=>{const n=S.nodes.get(m.addr); if(n) n.pin=true;}); render(); } return; }
  const br=e.target.closest('[data-brief]'); if(br){ copyBrief(br,br.dataset.brief); return; }
  const fz=e.target.closest('[data-freeze]'); if(fz){ freezePackage(fz.dataset.freeze); return; }
  const pt=e.target.closest('[data-path]'); if(pt){ highlightEdges(lastPaths[+pt.dataset.path]); return; }
  const cd=e.target.closest('[data-cdel]'); if(cd){ deleteCustom(cd.dataset.cdel); return; }
  const bz=e.target.closest('[data-bridges]'); if(bz){ withBtn(bz,async()=>Bridges.render(await Busy.run('Bertanya ke operator bridge',()=>Bridges.scanAddress(bz.dataset.bridges),{cancel:true}),`Lacak bridge: ${nameOf(bz.dataset.bridges)}`)); return; }
  const bt=e.target.closest('[data-btx]'); if(bt){ withBtn(bt,async()=>{ const r=await Busy.run('Bertanya ke operator bridge',()=>Bridges.resolveTx(bt.dataset.btx)); Bridges.render({...r,addr:null},'Cek transaksi di semua bridge'); }); return; }
  const xf=e.target.closest('[data-xfollow]'); if(xf){ withBtn(xf,async()=>XChain.render(await Busy.run('Mencari uang di blockchain lain',()=>XChain.search(xf.dataset.xfollow),{cancel:true}))); return; }
  const wd=e.target.closest('[data-wdel]'); if(wd){ Watch.remove(+wd.dataset.wdel); return; }
  const ad=e.target.closest('[data-add]'); if(ad){ const a=norm(ad.dataset.add); const base=S.nodes.get(ad.dataset.from||''); ensureNode(a,base?base.level+1:1); Audit.log('user','tambah ke graph',a); render(); if(S.settings.autoId) identify([S.nodes.get(a)]); focusNode(a); return; }
  const exp=e.target.closest('[data-exp]'); if(exp){ const a=exp.dataset.exp; withBtn(exp,async()=>{ await expand(a); focusNode(a); }); return; }
  const play=e.target.closest('[data-play]'); if(play){ withBtn(play,()=>runPlaybook(play.dataset.play,play.dataset.addr)); return; }
  const sym=e.target.closest('[data-sym]'); if(sym){ const s=sym.dataset.sym; S.hiddenTokens.has(s)?S.hiddenTokens.delete(s):S.hiddenTokens.add(s); render(); return; }
  const col=e.target.closest('[data-color]'); if(col&&selected){ const n=S.nodes.get(selected); n.color=col.dataset.color; saveLabel(n); Audit.log('user','kategori warna',`${n.addr} = ${(NODE_COLORS.find(c=>c[0]===n.color)||['','reset'])[1]}`); render(); return; }
  const act=e.target.closest('[data-act]'); if(!act||!selected) return;
  const n=S.nodes.get(selected); if(!n) return; const a=n.addr;
  await withBtn(act,async()=>{
    switch(act.dataset.act){
      case 'copy': navigator.clipboard&&navigator.clipboard.writeText(a); setMsg('Alamat disalin.'); break;
      case 'expand': await expand(a); selectNode(a); break;
      case 'refresh': n.expanded=false; n.hiddenCps=[]; await expand(a); selectNode(a); break;
      case 'more': showHiddenCps(a); break;
      case 'playbook': await runPlaybook($('pb').value,a); selectNode(a); break;
      case 'tfwd': await trace(a,'out',+$('t_hops').value||3,+$('t_per').value||3); selectNode(a); break;
      case 'tback': await trace(a,'in',+$('t_hops').value||3,+$('t_per').value||3); selectNode(a); break;
      case 'path': highlightPath(a); break;
      case 'root': if(!S.roots.includes(a)){S.roots.push(a); Audit.log('user','tambah seed',a);} render(); break;
      case 'hide': n.hidden=true; S.roots=S.roots.filter(r=>r!==a); Audit.log('user','sembunyikan',a); selected=null; render(); showSummary(); break;
      case 'watch': if(!Watch.has(a)) await Watch.add(a); showNode(a); break;
      case 'exits': showPaths(a); break;
      case 'custom': addCustom(a); break;
      case 'ask': setTab('agent'); $('agentInput').value=`Jelaskan alamat ${a}: siapa kemungkinan pengendalinya, kenapa risikonya ${n._risk||0}/100, dan apa langkah berikutnya?`; $('agentInput').focus(); break;
    }
  });
});

function wireUI(){
  $('go').onclick=()=>withBtn($('go'),()=>investigate(false));
  $('addBtn').onclick=()=>withBtn($('addBtn'),()=>investigate(true));
  $('busyCancel').onclick=()=>Busy.cancel();
  $('addr').addEventListener('keydown',e=>{if(e.key==='Enter') investigate(false)});
  $('chain').onchange=e=>{
    if(S.nodes.size&&!confirm('Ganti chain akan menutup case saat ini. Lanjut?')){e.target.value=S.chainId;return}
    S.chainId=e.target.value; store.set('ci_chain',S.chainId); resetCase();
  };
  $('keyBtn').onclick=openKey;
  $('keyCancel').onclick=()=>$('keyDlg').close();
  $('keySave').onclick=()=>{store.set('ci_key',$('keyInput').value.trim()); store.set('ci_akey',$('aKeyInput').value.trim()); store.set('ci_hkey',$('hKeyInput').value.trim()); Agent.client=null; $('keyDlg').close(); setMsg('API key disimpan.');};
  $('guideBtn').onclick=()=>Guide.open();
  $('screenBtn').onclick=()=>{ $('screenDlg').showModal(); $('screenInput').focus(); };
  $('screenClose').onclick=()=>$('screenDlg').close();
  $('screenGo').onclick=()=>quickScreen($('screenInput').value);
  $('screenInput').addEventListener('keydown',e=>{ if(e.key==='Enter') quickScreen($('screenInput').value); });
  $('menuBtn').onclick=()=>{ renderHistory(); $('menuDlg').showModal(); };
  $('menuClose').onclick=()=>$('menuDlg').close();
  $('relayout').onclick=()=>{for(const n of S.nodes.values()) n.pos=null; layout(true); autosave();};
  $('fit').onclick=()=>cy.fit(undefined,40);
  $('m_report').onclick=()=>{exportReport(); $('menuDlg').close();};
  $('m_save').onclick=()=>{download(`case-${S.roots[0]?short(S.roots[0]).replace('…','-'):'kosong'}-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(serialize()),'application/json'); Audit.log('user','export','case JSON');};
  $('m_load').onclick=()=>$('fileCase').click();
  $('fileCase').onchange=async e=>{const f=e.target.files[0]; if(!f) return; try{load(JSON.parse(await f.text())); Audit.log('user','buka case',f.name); $('menuDlg').close();}catch(err){alert('File case tidak valid.')} e.target.value='';};
  $('m_png').onclick=async()=>{download('graph.png',await watermarkPng(cy.png({full:true,scale:2,bg:'#0b0d12'}),true)); Audit.log('user','export','PNG');};
  $('m_csv').onclick=()=>{
    const nm=a=>nameOf(a).replace(/"/g,"'");
    const lines=['from,from_label,to,to_label,token,amount,transfers,first_utc,last_utc'];
    for(const e of S._edges||[]) lines.push([e.from,`"${nm(e.from)}"`,e.to,`"${nm(e.to)}"`,e.sym,e.amount,e.count,new Date(e.first*1000).toISOString(),new Date(e.last*1000).toISOString()].join(','));
    download('edges.csv',lines.join('\n'),'text/csv'); Audit.log('user','export','CSV');
  };
  $('m_limp').onclick=()=>$('fileLabels').click();
  $('fileLabels').onchange=async e=>{
    const f=e.target.files[0]; if(!f) return; let c=0;
    for(const line of (await f.text()).split(/\r?\n/)){
      const m=line.match(/^\s*"?(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})"?\s*[,;\t]\s*"?(.*?)"?\s*$/); if(!m) continue;
      S.labels[labelKey(norm(m[1]))]={label:m[2],color:''}; c++;
      const n=S.nodes.get(norm(m[1])); if(n) n.label=m[2];
    }
    store.set('ci_labels',S.labels); Audit.log('user','import label',`${c} label dari ${f.name}`); render();
    alert(c+' label diimport untuk '+chainInfo().chainname+'.'); e.target.value='';
  };
  $('m_lexp').onclick=()=>{
    const pre=S.chainId+':', lines=['address,label'];
    for(const [k,v] of Object.entries(S.labels)) if(k.startsWith(pre)&&v.label) lines.push(`${k.slice(pre.length)},"${v.label.replace(/"/g,"'")}"`);
    download(`labels-${S.chainId}.csv`,lines.join('\n'),'text/csv');
  };
  $('m_clear').onclick=()=>{ if(confirm('Tutup case ini? Simpan dulu kalau masih perlu.')){resetCase(); $('menuDlg').close();} };
  $('legend').innerHTML=NODE_COLORS.map(([c,t])=>`<div class="tok"><span class="sw" style="background:${c}"></span>${t}</div>`).join('');
}

async function init(){
  S.chainId=store.get('ci_chain','1');
  initCy(); bindSettings(); wireUI(); Agent.init(); setTab('detail');
  await loadChains();
  Prices.load(); Watch.start();
  const q=new URLSearchParams(location.search);
  const qc=q.get('chain'), qa=norm(q.get('addr')||''), qt=q.get('tx')||'';
  if(qc&&qt){ // opened from a bridge result: start from the destination transaction
    S.chainId=qc; $('chain').value=qc; store.set('ci_chain',qc); render();
    $('addr').value=qt; await investigate(false);
  } else if(qc&&isAddr(qa)){
    S.chainId=qc; $('chain').value=qc;
    const saved=store.get(`ci_case_${qc}_${qa}`,null);
    if(saved) load(saved); else { render(); $('addr').value=qa; investigate(false); }
  } else {
    const saved=store.get(store.get('ci_last',''),null)||store.get('ci_autosave',null);
    if(saved&&saved.nodes&&saved.nodes.length) load(saved); else render();
  }
  setTab('detail');
  if(isSol()&&!store.get('ci_hkey','')) setMsg('Isi Helius API key dulu (tombol 🔑) untuk Solana.');
  else if(isEvm()&&!store.get('ci_key','')) setMsg('Isi API key Etherscan dulu (tombol 🔑).');
}

// ---------- plain-language helpers ----------
function screening(n){
  const db=n.db, items=[];
  if(db&&db.cat==='S') items.push('<span class="out">⛔ Masuk daftar sanksi OFAC</span>');
  else items.push('<span class="in">✓ Tidak ada di daftar sanksi OFAC</span>');
  if(db&&db.cat==='P') items.push('<span class="out">⛔ Tercatat sebagai alamat phishing</span>');
  else if(db&&db.cat==='H') items.push('<span class="out">⛔ Tercatat sebagai exploiter/hacker</span>');
  else items.push('<span class="in">✓ Tidak ada di daftar phishing/hacker</span>');
  return items.join('<br>');
}
function plainRisk(n){
  const c=n._cat, r=n._risk||0;
  const intro={
    cex:'Ini wallet milik exchange. Exchange memegang data identitas (KYC) penggunanya, jadi dana yang masuk ke sini bisa dilacak ke akun tertentu lewat laporan resmi.',
    sanction:'Alamat ini dikenai sanksi pemerintah AS. Berinteraksi dengannya berisiko hukum.',
    hack:'Database mencatat alamat ini sebagai milik pelaku hack/exploit.',
    scam:'Database mencatat alamat ini sebagai alamat phishing/penipuan.',
    mixer:'Ini mixer. Dana yang masuk ke sini dicampur supaya asal-usulnya hilang.',
    bridge:'Ini bridge, jalur untuk memindahkan dana ke blockchain lain.',
    dex:'Ini kontrak DEX (tempat tukar token). Kontrak ini dipakai ribuan orang, jadi bukan milik pelaku.',
    mev:'Ini bot MEV (bot trading otomatis). Biasanya tidak terkait langsung dengan case.',
    service:'Alamat ini sangat sibuk (ratusan transaksi per hari), jadi hampir pasti milik layanan yang dipakai banyak orang: hot wallet exchange, hub aplikasi, atau relayer. Uang yang lewat sini tercampur dengan uang orang lain, jadi jangan menyimpulkan pemiliknya terlibat. Cek name tag-nya di explorer.',
    suspect:'Kamu menandai alamat ini sebagai tersangka.',
  }[c];
  if(intro) return intro;
  if(r>=60) return 'Alamat ini sangat mencurigakan. Lihat alasan di bawah, lalu pertimbangkan untuk menelusurinya lebih jauh.';
  if(r>=30) return 'Ada beberapa tanda mencurigakan, tapi belum kuat. Telusuri lebih jauh sebelum menyimpulkan.';
  if(!n.expanded) return 'Alamat ini belum ditelusuri, jadi penilaiannya belum lengkap. Klik Expand.';
  return 'Belum ada tanda mencurigakan dari data yang sudah ditarik.';
}

// ---------- start from a transaction hash ----------
const TRANSFER_TOPIC='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
function decodeAbiString(hex){
  if(!hex||hex==='0x') return '';
  const h=hex.slice(2);
  try{
    if(h.length>=192){ const len=parseInt(h.slice(64,128),16); const b=h.slice(128,128+len*2); return decodeURIComponent(b.replace(/(..)/g,'%$1')); }
    return decodeURIComponent(h.replace(/(00)+$/,'').replace(/(..)/g,'%$1')); // bytes32 symbols
  }catch(e){ return ''; }
}
async function tokenMeta(token){
  let sym='', dec=18;
  try{ sym=decodeAbiString(await api({module:'proxy',action:'eth_call',to:token,data:'0x95d89b41',tag:'latest'})); }catch(e){}
  try{ const d=await api({module:'proxy',action:'eth_call',to:token,data:'0x313ce567',tag:'latest'}); if(d&&d!=='0x') dec=parseInt(d,16); }catch(e){}
  return {sym:sym||('?'+short(token)),dec:isFinite(dec)&&dec<=36?dec:18};
}
async function investigateTx(hash){
  setMsg('Membaca transaksi '+hash.slice(0,12)+'…');
  const tx=await api({module:'proxy',action:'eth_getTransactionByHash',txhash:hash});
  if(!tx) throw new Error('Transaksi tidak ditemukan di '+chainInfo().chainname+'. Pastikan chain-nya benar.');
  const rc=await api({module:'proxy',action:'eth_getTransactionReceipt',txhash:hash});
  const blk=await api({module:'proxy',action:'eth_getBlockByNumber',tag:tx.blockNumber,boolean:'false'});
  const ts=parseInt(blk&&blk.timestamp||'0',16);
  resetCase();
  const transfers=[];
  const value=BigInt(tx.value||'0x0');
  if(value>0n&&tx.to) transfers.push({key:'n:'+hash,hash,from:tx.from.toLowerCase(),to:tx.to.toLowerCase(),sym:nativeSym(),token:'native',amount:units(value.toString(),18),ts,kind:'native',spam:false});
  const metas={};
  for(const lg of (rc&&rc.logs)||[]){
    if(lg.topics[0]!==TRANSFER_TOPIC||lg.topics.length!==3) continue; // ERC-20 only (ERC-721 has 4 topics)
    const token=lg.address.toLowerCase();
    if(!metas[token]) metas[token]=await tokenMeta(token);
    const raw=BigInt(lg.data&&lg.data!=='0x'?lg.data:'0x0').toString();
    const amount=units(raw,metas[token].dec);
    transfers.push({key:'t:'+hash+':'+parseInt(lg.logIndex,16),hash,from:'0x'+lg.topics[1].slice(26),to:'0x'+lg.topics[2].slice(26),sym:metas[token].sym,token,amount,ts,kind:'token',spam:isSpam(metas[token].sym,'',amount)});
  }
  for(const t of transfers) S.tx.set(t.key,t);
  const senders=new Set(transfers.map(t=>t.from)), receivers=new Set(transfers.map(t=>t.to));
  S.roots=[tx.from.toLowerCase()];
  ensureNode(tx.from,0);
  for(const a of senders) ensureNode(a,0);
  for(const a of receivers) if(!senders.has(a)) ensureNode(a,1);
  Audit.log('user','case dari transaksi',`${hash} · ${transfers.length} transfer · pengirim tx ${tx.from}`);
  render(); layout(true);
  await Promise.all([...S.nodes.values()].map(n=>identifyOne(n)));
  render(); showTx(hash,tx,transfers,rc);
  setMsg(`Transaksi dibaca: ${transfers.length} perpindahan dana.`);
}
function showTx(hash,tx,transfers,rc){
  setTab('detail');
  const ok=rc&&rc.status==='0x1';
  const recv=[...new Set(transfers.map(t=>t.to))].filter(a=>{const n=S.nodes.get(a); return n&&n.kind!=='contract';});
  $('tab_detail').innerHTML=`<div class="card"><h3>Transaksi</h3>
    <div class="addrline"><a href="${explorer('tx',hash)}" target="_blank" rel="noopener">${hash}</a></div>
    <div class="muted">${ok?'Berhasil':'<span class="out">Gagal</span>'} · dikirim oleh ${whoLink(norm(tx.from))}${tx.to?` ke ${whoLink(norm(tx.to))}`:''}</div>${tx.desc?`<div style="margin-top:4px">${esc(tx.desc)}</div>`:''}</div>
    <div class="card"><h3>Perpindahan dana dalam transaksi ini</h3>
    ${transfers.map(t=>`<div class="li">• ${whoLink(t.from)} mengirim <b>${fmtNum(t.amount)} ${esc(t.sym)}</b> ${fmtUsd(Prices.usd(t.sym,t.amount,t.token))} ke ${whoLink(t.to)}</div>`).join('')||'<span class="muted">Tidak ada perpindahan dana (mungkin hanya approval atau interaksi kontrak).</span>'}</div>
      <div class="card"><h3>Langkah berikutnya</h3>
    <div class="btns" style="margin:0 0 6px"><button class="small" data-btx="${hash}">🌉 Cek transaksi ini di semua bridge</button></div>
    <p style="margin:0 0 6px">Untuk kasus pencurian atau penipuan, <b>ikuti penerima dana</b>, yaitu wallet yang menerima uangmu. Pilih salah satu lalu Expand:</p>
    ${recv.map(a=>`<div class="btns" style="align-items:center">${whoLink(a)} <button class="small primary" data-exp="${a}">Expand</button><button class="small" data-play="exits" data-addr="${a}">Cari exchange</button></div>`).join('')||'<span class="muted">Tidak ada penerima berupa wallet biasa.</span>'}</div>`;
}

// ---------- attribution ("glass box": every label shows its source and confidence) ----------
function attrSource(db){
  if(db.src) return db.src;
  if(db.chain==='*'||db.chain==='sol'||db.chain==='btc') return db.cat==='S'?'Daftar sanksi OFAC (pemerintah AS)':'ScamSniffer (daftar alamat phishing)';
  return 'eth-labels (name tag dari explorer keluarga Etherscan)';
}
function attributionHtml(n){
  const rows=[];
  if(n.label) rows.push([n.label,'Label buatanmu','sesuai penilaianmu']);
  if(n.db) rows.push([`${n.db.name} · ${DB_CAT_NAME[n.db.cat]}`,attrSource(n.db)+(n.db.cross?`, dari ${Labels.chainName(n.db.chain)}`:''),n.db.cross?'sedang':'tinggi']);
  if(n.autoLabel) rows.push([n.autoLabel,isSol()?'Pemilik akun on-chain (program)':'Nama kontrak terverifikasi di explorer','tinggi']);
  if(n.busy&&!n.db) rows.push(['Layanan yang dipakai banyak orang (exchange / hub / relayer)','Heuristik aktivitas: jumlah transaksi sangat tinggi','sedang']);
  for(const f of A.findings.filter(f=>(f.type==='relayer'&&f.addrs[0]===n.addr)||(f.type==='cospend'&&f.addrs.includes(n.addr))||(f.type==='deposit'&&!(n.db&&n.db.cat==='D')&&f.addrs[0]===n.addr)||(f.type==='cluster'&&f.addrs.slice(0,-1).includes(n.addr))))
    rows.push([f.title,'Heuristik perilaku (pola transaksi)','rendah–sedang']);
  if(!rows.length) return '<div class="muted">Belum ada atribusi. Alamat ini tidak ada di database, bukan kontrak terverifikasi, dan belum kamu beri label. Coba cek lewat tautan "Cek di" di atas.</div>';
  return `<table><tr><th>Atribusi</th><th>Sumber</th><th>Keyakinan</th></tr>${rows.map(r=>`<tr><td>${esc(r[0])}</td><td class="muted">${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</table>`;
}
function externalLinks(a){
  const L=isSol()
    ?[['Solscan',`https://solscan.io/account/${a}`],['Orb',`https://orb.helius.dev/address/${a}`],['Chainabuse',`https://www.chainabuse.com/address/${a}`],['Arkham',`https://intel.arkm.com/explorer/address/${a}`]]
    :isBtc()?[['mempool.space',`https://mempool.space/address/${a}`],['Blockchair',`https://blockchair.com/bitcoin/address/${a}`],['Chainabuse',`https://www.chainabuse.com/address/${a}`],['Arkham',`https://intel.arkm.com/explorer/address/${a}`]]
    :[['Explorer',explorer('address',a)],['Chainabuse',`https://www.chainabuse.com/address/${a}`],['Arkham',`https://intel.arkm.com/explorer/address/${a}`],['DeBank',`https://debank.com/profile/${a}`]];
  return L.map(([t,u])=>`<a href="${u}" target="_blank" rel="noopener">${t} ↗</a>`).join(' · ');
}

// ---------- multi-route pathfinding to exits ----------
let lastPaths=[];
function findPaths(start,maxPaths=15,maxDepth=8){
  const out=new Map();
  for(const e of S._edges||[]){ if(!out.has(e.from)) out.set(e.from,[]); out.get(e.from).push(e); }
  const res=[], stack=[[start,[],new Set([start])]];
  while(stack.length&&res.length<maxPaths*4){
    const [a,path,seen]=stack.pop();
    for(const e of out.get(a)||[]){
      if(seen.has(e.to)) continue;
      const n=S.nodes.get(e.to); if(!n||n.hidden) continue;
      const p=[...path,e];
      if(['cex','bridge','mixer'].includes(n._cat)){ res.push(p); continue; }
      if(p.length<maxDepth) stack.push([e.to,p,new Set([...seen,e.to])]);
    }
  }
  return res.sort((a,b)=>a.length-b.length).slice(0,maxPaths);
}
function showPaths(addr){
  lastPaths=findPaths(addr);
  const card=`<div class="card"><h3>Jalur dari ${esc(nameOf(addr))} ke exchange / bridge / mixer</h3>
    ${lastPaths.map((p,i)=>{const end=S.nodes.get(p[p.length-1].to); return `<div class="step"><span class="num">${i+1}</span><div style="flex:1">
      <div>${[addr,...p.map(e=>e.to)].map(a=>`<span class="cp" data-sel="${a}">${esc(nameOf(a))}</span>`).join(' → ')}</div>
      <div class="muted">${p.length} hop · berakhir di ${CAT_NAME[end._cat]} · ${fmtNum(p[p.length-1].amount)} ${esc(p[p.length-1].sym)} di hop terakhir</div>
      <button class="small" data-path="${i}">Sorot di graph</button></div></div>`;}).join('')
      ||'<p class="muted">Tidak ada jalur ke exchange, bridge, atau mixer di graph saat ini. Expand alamat lain atau jalankan playbook "Cari exchange".</p>'}</div>`;
  $('tab_detail').insertAdjacentHTML('afterbegin',card);
  $('tab_detail').scrollTop=0;
  Audit.log('user','cari jalur ke exit',`${addr} · ${lastPaths.length} jalur`);
}
function highlightEdges(path){
  if(!path) return;
  clearPath(); cy.elements().addClass('faded');
  for(const e of path){ cy.getElementById('p:'+e.from+'|'+e.to).removeClass('faded').addClass('path'); cy.getElementById(e.from).removeClass('faded').addClass('path'); cy.getElementById(e.to).removeClass('faded').addClass('path'); }
}

// ---------- custom off-chain elements ----------
const CUSTOM_TYPES={person:'👤',bank:'🏦',exchange_account:'🪪',location:'📍',device:'📱',other:'📌'};
function addCustom(linkTo){
  const label=prompt('Nama elemen manual (mis. "Budi – pemilik akun Indodax", "Rekening BCA 123…", "Telegram @penipu"):'); if(!label) return;
  const t=prompt('Jenis: person / bank / exchange_account / location / device / other','person')||'other';
  const rel=prompt('Hubungan dengan alamat ini (opsional, mis. "pemilik", "menerima transfer dari"):','')||'';
  const id='x:'+Date.now().toString(36);
  const base=S.nodes.get(linkTo);
  S.custom.set(id,{id,label,type:CUSTOM_TYPES[t]?t:'other',level:base?base.level:0,order:S.order++,addr:id});
  S.links.push({id:'l:'+id,from:id,to:linkTo,label:rel});
  Audit.log('user','elemen manual',`${label} (${t}) ↔ ${linkTo}${rel?' · '+rel:''}`);
  render();
}
function showCustom(id){
  const x=S.custom.get(id); if(!x) return;
  setTab('detail');
  const links=S.links.filter(l=>l.from===id||l.to===id);
  $('tab_detail').innerHTML=`<div class="card"><h3>Elemen manual</h3>
    <div style="font-size:16px">${CUSTOM_TYPES[x.type]||'📌'} ${esc(x.label)}</div>
    <div class="muted">Data di luar blockchain yang kamu tambahkan sendiri.</div>
    ${links.map(l=>`<div class="li">↔ <span class="cp" data-sel="${l.from===id?l.to:l.from}">${esc(nameOf(l.from===id?l.to:l.from))}</span>${l.label?` · ${esc(l.label)}`:''}</div>`).join('')}
    <div class="btns"><button class="small" data-cdel="${id}">Hapus elemen</button></div></div>`;
}
function deleteCustom(id){
  const x=S.custom.get(id); if(!x) return;
  S.custom.delete(id); S.links=S.links.filter(l=>l.from!==id&&l.to!==id);
  Audit.log('user','hapus elemen manual',x.label); render(); showSummary();
}

// ---------- freeze / records request package for an exchange exit ----------
function pathFromSeed(target){
  for(const r of S.roots){
    const p=cy.elements().dijkstra({root:cy.getElementById(r),directed:true}).pathTo(cy.getElementById(target));
    if(p.length>1) return p.nodes().map(x=>x.id());
  }
  return null;
}
async function freezePackage(addr){
  const n=S.nodes.get(addr); if(!n) return;
  await Audit.chain; const v=await Audit.verify();
  const exName=(n.db&&n.db.name)||n.label||n.autoLabel||short(addr);
  const isDep=n.db&&n.db.cat==='D'||A.findings.some(f=>f.type==='deposit'&&f.addrs.includes(addr));
  const ins=[...S.tx.values()].filter(t=>t.to===addr&&!t.spam).sort((a,b)=>a.ts-b.ts);
  const total={}; for(const t of ins) total[t.sym]=(total[t.sym]||0)+t.amount;
  const path=pathFromSeed(addr);
  const chain=chainInfo().chainname;
  const rows=ins.map(t=>`<tr><td>${new Date(t.ts*1000).toISOString().replace('T',' ').slice(0,19)} UTC</td><td><code>${t.from}</code></td><td>${fmtNum(t.amount)} ${esc(t.sym)}</td><td><code>${t.hash}</code></td></tr>`).join('');
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Freeze request – ${esc(exName)}</title>
<style>body{font:14px/1.55 system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#111}table{border-collapse:collapse;width:100%;font-size:12px}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}code{font-size:11.5px;word-break:break-all}.note{background:#fff8d6;padding:8px 12px;border-radius:6px}@media print{.note{display:none}}</style></head><body>
<div class="note"><b>Panduan (bagian ini tidak ikut tercetak):</b> Isi bagian dalam [kurung siku], lalu kirim lewat formulir resmi exchange untuk penegak hukum / compliance, atau lampirkan ke laporan polisi. Exchange biasanya hanya membekukan dana dan membuka data KYC atas permintaan penegak hukum, jadi laporkan juga ke polisi (di Indonesia: Bareskrim / Direktorat Tindak Pidana Siber). Teks di bawah bisa diedit langsung; simpan sebagai PDF dengan Ctrl+P.</div>
<div contenteditable="true">
<h2>Request to freeze funds and preserve account records</h2>
<p><b>To:</b> ${esc(exName)} – Compliance / Law Enforcement Response Team<br><b>Date:</b> ${new Date().toISOString().slice(0,10)}<br><b>From:</b> [Your name], [contact e-mail / phone]<br><b>Police report:</b> [report number, agency, date]</p>
<p>I am writing regarding funds connected to [a theft / an investment scam / a phishing attack] that I believe were deposited into an account on your platform. I respectfully request that you <b>freeze the related account and balances</b>, <b>preserve all records</b> (KYC, login/IP logs, deposit and withdrawal history), and <b>cooperate with law enforcement</b> under the report referenced above.</p>
<h3>Destination on your platform</h3>
<p>Network: <b>${esc(chain)}</b><br>Address: <code>${addr}</code><br>Attribution: ${esc(Labels.describe(n.db)||n.label||'')}${isDep?' – appears to be a customer deposit address':''}</p>
<h3>Incoming transfers to this address</h3>
<table><tr><th>Time</th><th>From</th><th>Amount</th><th>Transaction</th></tr>${rows||'<tr><td colspan=4>[add transactions]</td></tr>'}</table>
<p>Total observed: ${Object.entries(total).map(([s,a])=>`${fmtNum(a)} ${esc(s)}`).join(', ')||'[amount]'}</p>
${path?`<h3>Trace from the origin of the funds</h3><ol>${path.map(a=>`<li><code>${a}</code> ${esc(nameOf(a))}</li>`).join('')}</ol>`:''}
<h3>Incident summary</h3><p>[Describe briefly: what happened, when, the victim's address, the amount lost.]</p>
${S.meta.notes?`<p style="white-space:pre-wrap">${esc(S.meta.notes)}</p>`:''}
<p>The full fund-flow analysis and a tamper-evident audit log (SHA-256 chain head <code>${v.head||''}</code>) are available on request.</p>
<p>Sincerely,<br>[Your name]</p></div></body></html>`;
  download(`freeze-request-${exName.replace(/[^\w]+/g,'-').slice(0,30)}-${new Date().toISOString().slice(0,10)}.html`,html,'text/html');
  Audit.log('user','paket laporan exchange',`${exName} · ${addr} · ${ins.length} transfer`);
}

// ---------- quick wallet screening (no graph needed) ----------
async function quickScreen(input){
  const p=parseInput(input||'');
  const out=$('screenOut');
  if(!p){ out.innerHTML='<p class="out">Alamat tidak valid.</p>'; return; }
  if(p.chain&&p.chain!==S.chainId){
    if(S.nodes.size&&!confirm('Alamat ini dari chain lain. Pindah chain? (case saat ini tetap tersimpan di Riwayat case)')) return;
    S.chainId=p.chain; $('chain').value=p.chain; store.set('ci_chain',p.chain); if(S.nodes.size) resetCase();
  }
  const a=p.addr;
  out.innerHTML='<div class="inline-wait"><span class="spin"></span> Memeriksa riwayat transaksi wallet ini… (biasanya 3–10 detik)</div>';
  try{
    const self=Labels.lookup(a);
    const tmp={addr:a,kind:''}; await identifyOne(tmp);
    const {out:txs,errs}=await fetchTransfers(a);
    const cats={};
    let total=0;
    for(const t of txs){
      if(t.spam) continue;
      const cp=t.from===a?t.to:t.from; if(cp===a) continue;
      const db=Labels.lookup(cp);
      const k=db?db.cat:'?';
      const usd=Prices.usd(t.sym,t.amount);
      const c=cats[k]||(cats[k]={n:0,usd:0,in:0,out:0,names:new Set()});
      c.n++; if(usd) { c.usd+=usd; total+=usd; } c[t.from===a?'out':'in']++; if(db) c.names.add(db.name);
    }
    const bad=['S','H','P'].filter(k=>cats[k]);
    let level, text;
    if(self&&'SHP'.includes(self.cat)){ level='high'; text=`Alamat ini sendiri tercatat sebagai ${DB_CAT_NAME[self.cat].toLowerCase()} (${self.name}). Jangan bertransaksi dengannya.`; }
    else if(bad.length){ level='high'; text=`Alamat ini pernah bertransaksi langsung dengan ${bad.map(k=>DB_CAT_NAME[k].toLowerCase()).join(', ')}. Risikonya tinggi.`; }
    else if(cats.M){ level='med'; text='Alamat ini pernah berinteraksi dengan mixer. Perlu dicurigai.'; }
    else { level='low'; text='Tidak ditemukan interaksi langsung dengan alamat berisiko yang dikenal di database. Ini bukan jaminan aman: database gratis jauh lebih kecil dari milik TRM.'; }
    const names={X:'Exchange',D:'Deposit exchange',S:'Tersanksi OFAC',H:'Exploiter/hacker',P:'Phishing',M:'Mixer',B:'Bridge',V:'Bot MEV',Q:'Protokol/layanan','?':'Tidak dikenal'};
    const order=['S','H','P','M','X','D','B','Q','V','?'];
    out.innerHTML=`<div class="finding ${level}"><b>${level==='high'?'⛔ Risiko tinggi':level==='med'?'⚠ Risiko sedang':'✓ Risiko rendah'}</b><div>${esc(text)}</div></div>
      <div class="muted" style="font-size:12px">${esc(a)}<br>${self?'🏷 '+esc(Labels.describe(self))+'<br>':''}Jenis: ${{eoa:'wallet',contract:'kontrak/program','7702':'wallet EIP-7702'}[tmp.kind]||'?'}${tmp.balance!=null?` · saldo ${fmtNum(tmp.balance)} ${nativeSym()}`:''} · ${txs.length} transfer diperiksa${errs.length?` · <span class="warn">${esc(errs[0])}</span>`:''}</div>
      <table style="margin-top:8px"><tr><th>Lawan transaksi langsung</th><th class="r">Transfer</th><th class="r">Nilai</th></tr>
      ${order.filter(k=>cats[k]).map(k=>`<tr><td>${names[k]}${cats[k].names.size?`<div class="muted" style="font-size:11px">${[...cats[k].names].slice(0,4).map(esc).join(', ')}</div>`:''}</td><td class="r">${cats[k].n}</td><td class="r">${cats[k].usd?fmtUsd(cats[k].usd):'–'}</td></tr>`).join('')}</table>
      <div class="btns"><button class="small primary" id="scInv">Investigasi alamat ini</button><button class="small" id="scWatch">👁 Pantau</button></div>`;
    $('scInv').onclick=()=>{ $('screenDlg').close(); $('addr').value=a; investigate(false); };
    $('scWatch').onclick=async()=>{ await Watch.add(a); $('scWatch').textContent='👁 Dipantau'; };
    Audit.log('user','screening',`${a} · ${level} · ${txs.length} transfer`);
  }catch(err){ out.innerHTML=`<p class="out">${esc(err.message)}</p>`; }
}
