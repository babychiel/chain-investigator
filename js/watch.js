"use strict";
// Watchlist: polls watched wallets while the page is open and alerts on new transfers.
const Watch={
  list:store.get('ci_watch',[]),
  minutes:store.get('ci_watch_min',5),
  timer:null, checking:false,
  save(){ store.set('ci_watch',this.list); },
  explorerFor(chainId,kind,v){ const c=S.chains.find(c=>c.chainid===chainId); return (c?c.blockexplorer:'https://etherscan.io/').replace(/\/?$/,'/')+kind+'/'+v; },
  has(addr,chainId=S.chainId){ return this.list.some(w=>w.addr===addr&&w.chainId===chainId); },
  async add(addr,chainId=S.chainId){
    addr=norm(addr);
    if(this.has(addr,chainId)) return;
    const n=S.nodes.get(addr);
    const w={addr,chainId,label:n?nameOf(addr):'',lastTs:0,events:[],added:Date.now(),minUsd:0,onlyRisky:false};
    this.list.push(w); this.save();
    Audit.log('user','pantau',`${addr} (${Labels.chainName(chainId)})`);
    await this.check(w); this.render();
  },
  remove(i){ const w=this.list.splice(i,1)[0]; this.save(); if(w) Audit.log('user','berhenti pantau',w.addr); this.render(); },
  async check(w){
    const base={module:'account',address:w.addr,page:1,offset:25,sort:'desc',startblock:0,endblock:999999999};
    let rows=[];
    const nat=NATIVE[w.chainId]||'ETH';
    const get=async p=>{try{return await api({...base,...p},w.chainId)}catch(e){w.error=e.message;return []}};
    if(w.chainId==='sol'){ try{ rows=(await Sol.watchRows(w.addr)).map(t=>({ts:t.ts,hash:t.hash,from:t.from,to:t.to,amount:t.amount,sym:t.sym})); }catch(e){ w.error=e.message; } }
    if(w.chainId==='btc'){ try{ rows=(await Btc.watchRows(w.addr)).map(t=>({ts:t.ts,hash:t.hash,from:t.from,to:t.to,amount:t.amount,sym:t.sym})); }catch(e){ w.error=e.message; } }
    else for(const t of await get({action:'txlist'})){ const v=units(t.value,18); if(t.isError!=='1'&&v>0) rows.push({ts:+t.timeStamp,hash:t.hash,from:t.from.toLowerCase(),to:(t.to||'').toLowerCase(),amount:v,sym:nat}); }
    if(isEvm(w.chainId)) for(const t of await get({action:'tokentx'})){ const v=units(t.value,t.tokenDecimal); if(!t.tokenSymbol||isSpam(t.tokenSymbol,t.tokenName,v)) continue; rows.push({ts:+t.timeStamp,hash:t.hash,from:t.from.toLowerCase(),to:(t.to||'').toLowerCase(),amount:v,sym:t.tokenSymbol}); }
    w.lastCheck=Date.now();
    const fresh=rows.filter(r=>r.ts>w.lastTs).sort((a,b)=>a.ts-b.ts);
    if(w.lastTs===0){ w.lastTs=rows.reduce((m,r)=>Math.max(m,r.ts),1); this.save(); return; } // first check = baseline, no alert
    if(!fresh.length){ this.save(); return; }
    w.lastTs=fresh[fresh.length-1].ts;
    for(const r of fresh){
      const out=r.from===w.addr, cp=out?r.to:r.from, db=Labels.lookup(cp,w.chainId);
      const cpName=db?`${db.name} (${DB_CAT_NAME[db.cat]})`:short(cp);
      const text=`${out?'Mengirim':'Menerima'} ${fmtNum(r.amount)} ${r.sym} ${out?'ke':'dari'} ${cpName}`;
      const usd=Prices.usd(r.sym,r.amount);
      const risky=!!(db&&'XDSHPM'.includes(db.cat));
      const notify=(!w.onlyRisky||risky)&&(!w.minUsd||(usd!=null&&usd>=w.minUsd));
      w.events.unshift({ts:r.ts,text:text+(usd?` (${fmtUsd(usd)})`:''),hash:r.hash,alert:risky,notify});
    }
    w.events=w.events.slice(0,50); this.save();
    const hits=w.events.slice(0,fresh.length).filter(e=>e.notify);
    if(!hits.length) return; // nothing matches this wallet's alert rules
    w.unseen=(w.unseen||0)+hits.length; this.save();
    const title=`${w.label||short(w.addr)}: ${hits.length} transaksi baru`;
    Audit.log('system','aktivitas baru',`${w.addr} · ${fresh.length} transfer · ${w.events[0].text}`);
    setMsg('🔔 '+title);
    try{ if('Notification' in window&&Notification.permission==='granted') new Notification(title,{body:w.events[0].text}); }catch(e){}
  },
  async checkAll(){
    if(this.checking||!this.list.length) return;
    this.checking=true;
    try{ for(const w of this.list){ w.error=''; await this.check(w); } } finally{ this.checking=false; this.render(); this.badge(); }
  },
  start(){
    clearInterval(this.timer);
    this.timer=setInterval(()=>this.checkAll(),Math.max(1,this.minutes)*60e3);
    this.badge();
  },
  badge(){ const n=this.list.reduce((s,w)=>s+(w.unseen||0),0); $('watchBadge').textContent=n||''; $('watchBadge').className='badge'+(n?' hot':''); },
  render(){
    if(currentTab!=='watch') return;
    this.list.forEach(w=>w.unseen=0); this.save(); this.badge();
    const perm='Notification' in window?Notification.permission:'unsupported';
    $('tab_watch').innerHTML=`<div class="card">
      <h3>Pantau wallet</h3>
      <p class="muted" style="margin:0 0 8px">Tool mengecek wallet yang dipantau secara berkala selama halaman ini terbuka, lalu memberi tahu kalau ada transaksi baru. Tambahkan wallet lewat tombol 👁 Pantau di panel Detail.</p>
      <div class="row"><label>Cek setiap (menit)</label><input type="number" id="w_min" min="1" max="120" value="${this.minutes}"></div>
      <div class="btns"><button class="small" id="w_now">Cek sekarang</button><button class="small" id="w_case">Pantau semua alamat berisiko di case</button>${perm==='default'?'<button class="small" id="w_perm">Aktifkan notifikasi</button>':''}${perm==='denied'?'<span class="muted">Notifikasi diblokir browser.</span>':''}</div>
    </div>
    ${this.list.map((w,i)=>`<div class="card">
      <div style="display:flex;justify-content:space-between;gap:6px"><div><b>${esc(w.label||short(w.addr))}</b><div class="mono muted" style="font-size:11px;word-break:break-all">${w.addr}</div>
        <div class="muted" style="font-size:11.5px">${esc(Labels.chainName(w.chainId))} · dicek ${w.lastCheck?new Date(w.lastCheck).toLocaleTimeString('id-ID'):'belum'}</div></div>
        <div style="display:flex;flex-direction:column;gap:4px"><button class="small" data-wopen="${i}">Buka</button><button class="small" data-wdel="${i}">Hapus</button></div></div>
      <div class="row" style="font-size:12px"><label>Beri tahu jika ≥ $</label><input type="number" min="0" value="${w.minUsd||0}" data-wmin="${i}" style="width:80px"></div>
      <div class="row" style="font-size:12px"><label>Hanya jika lawan transaksi exchange/berisiko</label><input type="checkbox" data-wrisky="${i}" ${w.onlyRisky?'checked':''}></div>
      ${w.error?`<div class="warn" style="font-size:12px">Error: ${esc(w.error)}</div>`:''}
      ${w.events.length?`<table style="margin-top:6px">${w.events.slice(0,10).map(ev=>`<tr><td class="muted" style="white-space:nowrap">${fmtDate(ev.ts)}</td><td class="${ev.alert?'warn':''}">${esc(ev.text)}</td><td><a href="${this.explorerFor(w.chainId,'tx',ev.hash)}" target="_blank" rel="noopener">↗</a></td></tr>`).join('')}</table>`:'<div class="muted" style="font-size:12px;margin-top:4px">Belum ada transaksi baru sejak mulai dipantau.</div>'}
    </div>`).join('')||'<p class="muted">Belum ada wallet yang dipantau.</p>'}`;
    $('w_min').onchange=e=>{ this.minutes=Math.max(1,+e.target.value||5); store.set('ci_watch_min',this.minutes); this.start(); };
    $('w_now').onclick=()=>this.checkAll();
    $('w_case').onclick=async()=>{ const list=[...S.nodes.values()].filter(n=>!n.hidden&&(n._risk>=60||S.roots.includes(n.addr))&&!TERMINAL.has(n._cat)).slice(0,15); for(const n of list) await this.add(n.addr); this.render(); };
    document.querySelectorAll('[data-wmin]').forEach(el=>el.onchange=()=>{ this.list[+el.dataset.wmin].minUsd=+el.value||0; this.save(); });
    document.querySelectorAll('[data-wrisky]').forEach(el=>el.onchange=()=>{ this.list[+el.dataset.wrisky].onlyRisky=el.checked; this.save(); });
    if($('w_perm')) $('w_perm').onclick=async()=>{ await Notification.requestPermission(); this.render(); };
  },
};
