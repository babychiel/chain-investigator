"use strict";
// Cross-chain follow: most bridges (Across, Stargate, canonical L2 bridges, Relay, …) deliver to the same
// address on the destination chain by default. After funds hit a bridge we look for the same address on
// other EVM chains receiving a similar amount shortly afterwards (or, for inbound bridge funds, sending a
// similar amount shortly before).
const XCHAIN_IDS=['1','42161','8453','10','137','56','43114','59144','81457','130','480','5042','146','100','5000','42220'];
const SAME_ASSET=[['ETH','WETH'],['USDC','USDC.E','USDBC','USDC'],['USDT','USDT0','USD₮0','USDT.E'],['DAI','XDAI'],['BNB','WBNB'],['POL','MATIC','WPOL']];
const assetKey=s=>{ s=String(s||'').toUpperCase(); const g=SAME_ASSET.find(g=>g.includes(s)); return g?g[0]:s; };

const XChain={
  running:false,
  // bridge transfers touching addr in the current case
  bridgeLegs(addr){
    const legs=[];
    for(const t of S.tx.values()){
      if(t.spam) continue;
      const other=t.from===addr?t.to:t.to===addr?t.from:null; if(!other) continue;
      const n=S.nodes.get(other); const cat=n?n._cat:(()=>{const db=Labels.lookup(other); return db&&db.cat==='B'?'bridge':'';})();
      if(cat!=='bridge') continue;
      legs.push({...t,dir:t.from===addr?'out':'in',bridge:other});
    }
    return legs.sort((a,b)=>b.ts-a.ts);
  },
  async blockAt(ts,chain,closest){
    const r=await api({module:'block',action:'getblocknobytime',timestamp:Math.floor(ts),closest},chain);
    return parseInt(r,10);
  },
  async search(addr,{maxChains=XCHAIN_IDS.length,actor='user'}={}){
    if(isSol()) throw new Error('Lacak lintas chain otomatis hanya untuk chain EVM. Dari Solana, buka tx bridge di Solscan/Wormholescan untuk melihat alamat tujuan.');
    if(isBtc()) throw new Error('Lacak lintas chain otomatis hanya untuk chain EVM. Dari Bitcoin, dana biasanya pindah lewat exchange atau layanan swap; cek alamat tujuan di mempool.space.');
    if(this.running) throw new Error('Pencarian lintas chain lain sedang berjalan.');
    addr=addr.toLowerCase();
    const legs=this.bridgeLegs(addr);
    if(!legs.length) throw new Error('Alamat ini tidak punya transfer ke/dari bridge di graph.');
    this.running=true;
    const chains=XCHAIN_IDS.filter(c=>c!==S.chainId&&S.chains.some(x=>x.chainid===c)).slice(0,maxChains);
    const matches=[], errors=[];
    Audit.log(actor,'lacak lintas chain mulai',`${addr} · ${legs.length} transfer bridge · cek ${chains.length} chain`);
    try{
      for(const [ci,c] of chains.entries()){
        if(typeof Busy!=='undefined'&&Busy.cancelled) break;
        setMsg(`Lintas chain: cek ${Labels.chainName(c)} (${ci+1}/${chains.length})…`);
        const lo=Math.min(...legs.map(l=>l.dir==='out'?l.ts:l.ts-6*3600)), hi=Math.max(...legs.map(l=>l.dir==='out'?l.ts+6*3600:l.ts));
        let start, end;
        try{ start=await this.blockAt(lo,c,'before'); end=await this.blockAt(Math.min(hi,Date.now()/1000-30),c,'before'); }
        catch(e){ errors.push(`${Labels.chainName(c)}: ${e.message}`); continue; }
        if(!isFinite(start)||!isFinite(end)) continue;
        const base={module:'account',address:addr,page:1,offset:200,sort:'asc',startblock:start,endblock:end};
        const rows=[];
        const nat=NATIVE[c]||'ETH';
        const get=async p=>{try{return await api({...base,...p},c)}catch(e){errors.push(`${Labels.chainName(c)}: ${e.message}`);return []}};
        for(const t of await get({action:'txlist'})){ const v=units(t.value,18); if(t.isError!=='1'&&v>0) rows.push({ts:+t.timeStamp,hash:t.hash,from:t.from.toLowerCase(),to:(t.to||'').toLowerCase(),amount:v,sym:nat}); }
        for(const t of await get({action:'txlistinternal'})){ const v=units(t.value,18); if(t.isError!=='1'&&v>0) rows.push({ts:+t.timeStamp,hash:t.hash,from:t.from.toLowerCase(),to:(t.to||'').toLowerCase(),amount:v,sym:nat}); }
        for(const t of await get({action:'tokentx'})){ const v=units(t.value,t.tokenDecimal); if(t.tokenSymbol&&!isSpam(t.tokenSymbol,t.tokenName,v)) rows.push({ts:+t.timeStamp,hash:t.hash,from:t.from.toLowerCase(),to:(t.to||'').toLowerCase(),amount:v,sym:t.tokenSymbol}); }
        for(const leg of legs){
          for(const r of rows){
            const arrive=leg.dir==='out'; // funds left via bridge here → expect arrival there
            if(arrive&&r.to!==addr) continue;
            if(!arrive&&r.from!==addr) continue;
            const dt=arrive?r.ts-leg.ts:leg.ts-r.ts;
            if(dt<0||dt>6*3600) continue;
            const same=assetKey(r.sym)===assetKey(leg.sym);
            const ratio=arrive?r.amount/leg.amount:leg.amount/r.amount;
            if(same&&ratio>0.8&&ratio<=1.01){
              const conf=ratio>0.97&&dt<1800?'tinggi':ratio>0.9&&dt<7200?'sedang':'rendah';
              matches.push({chain:c,leg,row:r,dt,ratio,conf,addr});
            }
          }
        }
      }
    }finally{ this.running=false; }
    const rank={tinggi:0,sedang:1,rendah:2};
    matches.sort((a,b)=>rank[a.conf]-rank[b.conf]||a.dt-b.dt);
    const res={addr,legs:legs.length,chainsChecked:chains.length,matches,errors};
    this.last=res;
    Audit.log(actor,'lacak lintas chain selesai',`${addr} · ${matches.length} kecocokan${matches[0]?` · terbaik ${Labels.chainName(matches[0].chain)} (${matches[0].conf})`:''}`);
    setMsg(`Lintas chain selesai: ${matches.length} kecocokan di ${chains.length} chain.`);
    return res;
  },
  openUrl(chain,addr){ return `${location.pathname}?chain=${chain}&addr=${addr}`; },
  render(res){
    setTab('detail');
    const exp=(c,k,v)=>Watch.explorerFor(c,k,v);
    $('tab_detail').innerHTML=`<div class="card"><h3>Lacak lintas chain</h3>
      <p style="margin:0">Dicari: alamat <span class="mono">${short(res.addr)}</span> di ${res.chainsChecked} chain lain, ±6 jam dari ${res.legs} transfer bridge, dengan jumlah yang mirip.</p>
      <details><summary>Apa artinya?</summary>${esc(GLOSSARY.bridge)} Banyak bridge mengirim ke alamat yang sama di chain tujuan, jadi kita cari dana yang "muncul" di alamat yang sama pada waktu dan jumlah yang cocok. Kalau pelaku memilih alamat tujuan lain, metode ini tidak akan menemukannya. Buka tx bridge di explorer untuk melihat alamat tujuan sebenarnya.</details></div>
      ${res.matches.map(m=>`<div class="finding ${m.conf==='tinggi'?'high':m.conf==='sedang'?'med':'low'}">
        <div><span class="sev ${m.conf==='tinggi'?'high':m.conf==='sedang'?'med':'low'}">Keyakinan ${m.conf}</span> <b>${esc(Labels.chainName(m.chain))}</b></div>
        <div>${m.leg.dir==='out'?'Keluar':'Masuk'} lewat bridge: <b>${fmtNum(m.leg.amount)} ${esc(m.leg.sym)}</b> (${fmtDate(m.leg.ts)})</div>
        <div>${m.leg.dir==='out'?'Tiba':'Berangkat'} di ${esc(Labels.chainName(m.chain))}: <b>${fmtNum(m.row.amount)} ${esc(m.row.sym)}</b> (${fmtDate(m.row.ts)}, selisih ${dur(m.dt)})</div>
        <div class="btns"><a href="${exp(m.chain,'tx',m.row.hash)}" target="_blank" rel="noopener"><button class="small">Lihat tx ↗</button></a>
          <a href="${this.openUrl(m.chain,m.addr)}" target="_blank" rel="noopener"><button class="small primary">Lanjut investigasi di ${esc(Labels.chainName(m.chain))} ↗</button></a></div></div>`).join('')
        ||'<p class="muted">Tidak ada kecocokan di alamat yang sama. Kemungkinan dana dikirim ke alamat lain di chain tujuan. Buka tx bridge di explorer dan cari "recipient"/"destination".</p>'}
      ${res.errors.length?`<details class="card"><summary>${res.errors.length} chain tidak bisa dicek</summary><div class="muted" style="font-size:12px">${res.errors.slice(0,20).map(esc).join('<br>')}</div><div class="muted" style="font-size:12px;margin-top:4px">Biasanya karena chain itu tidak termasuk paket gratis Etherscan.</div></details>`:''}`;
  },
};
