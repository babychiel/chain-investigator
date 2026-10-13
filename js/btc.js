"use strict";
// Bitcoin adapter (mempool.space public API, no key needed). Produces the same transfer records as the EVM and
// Solana paths so the graph, analysis, story, agent and report work unchanged.
// Bitcoin has no "from → to" transfers: a transaction spends inputs (owned by one or more addresses) and creates
// outputs. We turn each tx into address-to-address transfers: every input address sends to every output address
// other than itself (an output back to the same address is change and dropped). With several input addresses the
// amount is split pro rata to what each contributed, so those transfers are estimates (t.est). A consolidation into
// one of the inputs therefore shows as the other inputs paying that address, which is what happened on-chain.
const BTC_ADDR_RE=/^(bc1[02-9ac-hj-np-z]{11,87}|BC1[02-9AC-HJ-NP-Z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/;
const BTC_TXID_RE=/^[0-9a-fA-F]{64}$/;
const Btc={
  base:'https://mempool.space/api',
  last:0, gate:Promise.resolve(),
  throttle(){ const p=this.gate.then(async()=>{const w=this.last+250-Date.now(); if(w>0) await sleep(w); this.last=Date.now();}); this.gate=p; return p; },
  async get(path){
    for(let attempt=0;attempt<5;attempt++){
      await this.throttle(); S.calls++; stats();
      let r; try{ r=await fetch(this.base+path); }catch(e){ await sleep(1000); continue; }
      if(r.status===429){ await sleep(2000+attempt*1500); continue; }
      if(r.status===400||r.status===404) throw new Error((await r.text()).slice(0,120)||('HTTP '+r.status));
      if(!r.ok){ await sleep(1000); continue; }
      return r.json();
    }
    throw new Error('mempool.space sedang membatasi request (rate limit). Coba lagi sebentar lagi.');
  },
  parse(tx,focus){
    const ins=new Map(); let totalIn=0;
    for(const v of tx.vin||[]){
      if(v.is_coinbase||!v.prevout||!v.prevout.scriptpubkey_address) continue;
      const a=norm(v.prevout.scriptpubkey_address);
      ins.set(a,(ins.get(a)||0)+v.prevout.value); totalIn+=v.prevout.value;
    }
    if(!totalIn) return [];
    const ts=(tx.status&&tx.status.block_time)||Math.floor(Date.now()/1000);
    const est=ins.size>1, out=[];
    (tx.vout||[]).forEach((o,i)=>{
      const b=o.scriptpubkey_address&&norm(o.scriptpubkey_address);
      if(!b||!o.value) return;
      for(const [a,v] of ins){
        if(a===b||(focus&&a!==focus&&b!==focus)) continue;
        const amount=o.value*v/totalIn/1e8;
        out.push({key:`b:${tx.txid}:${i}:${a}`,hash:tx.txid,from:a,to:b,sym:'BTC',token:'native',amount,ts,kind:'native',est,spam:amount<0.00001});
      }
    });
    return out;
  },
  async fetchTransfers(addr){
    const errs=[], out=[], cospend={}; let fetched=0, last='';
    const want=Math.max(25,S.settings.offset);
    const take=list=>{
      for(const tx of list){
        out.push(...this.parse(tx,addr));
        // common-input ownership: addresses spent together with this one in one tx are usually the same wallet
        const inA=new Set((tx.vin||[]).map(v=>v.prevout&&v.prevout.scriptpubkey_address).filter(Boolean).map(norm));
        if(inA.has(addr)&&inA.size>1&&inA.size<=50) for(const a of inA) if(a!==addr) cospend[a]=(cospend[a]||0)+1;
      }
    };
    try{
      const first=await this.get(`/address/${addr}/txs`);
      take(first); fetched=first.length;
      const conf=first.filter(t=>t.status&&t.status.confirmed);
      last=conf.length?conf[conf.length-1].txid:'';
      let more=conf.length>=25;
      while(more&&last&&fetched<want){
        const page=await this.get(`/address/${addr}/txs/chain/${last}`);
        if(!Array.isArray(page)||!page.length) break;
        take(page); fetched+=page.length; last=page[page.length-1].txid;
        more=page.length>=25;
      }
      return {out,errs,truncated:more&&fetched>=want,extra:{cospend,txs:fetched}};
    }catch(e){ errs.push(e.message); }
    return {out,errs,truncated:false,extra:{cospend,txs:fetched}};
  },
  async identify(n){
    if(n.kind) return n;
    try{
      const r=await this.get(`/address/${n.addr}`);
      const c=r.chain_stats||{}, m=r.mempool_stats||{};
      n.kind='eoa';
      n.balance=((c.funded_txo_sum||0)-(c.spent_txo_sum||0)+(m.funded_txo_sum||0)-(m.spent_txo_sum||0))/1e8;
      n.txTotal=(c.tx_count||0)+(m.tx_count||0);
      if(n.txTotal>=5000) n.busy={total:n.txTotal};
      // script type is shown in the detail panel only; it is not a name (thousands of unrelated wallets share it)
      n.scriptType=/^3/.test(n.addr)?'P2SH, sering multisig/exchange':/^bc1p/.test(n.addr)?'Taproot':/^bc1q/.test(n.addr)?'SegWit':/^1/.test(n.addr)?'Legacy':'';
    }catch(e){ n.kind='?'; }
    scheduleRender();
    return n;
  },
  async investigateTx(txid){
    setMsg('Membaca transaksi Bitcoin '+txid.slice(0,10)+'…');
    const tx=await this.get(`/tx/${txid}`);
    resetCase();
    const transfers=this.parse(tx);
    for(const t of transfers) S.tx.set(t.key,t);
    const ins=[...new Set(transfers.map(t=>t.from))];
    const main=ins[0]||norm(((tx.vin||[])[0]||{}).prevout?.scriptpubkey_address||'');
    S.roots=main?[main]:[];
    for(const a of ins) ensureNode(a,0);
    for(const t of transfers) if(!ins.includes(t.to)) ensureNode(t.to,1);
    Audit.log('user','case dari transaksi',`${txid} · ${transfers.length} transfer · ${ins.length} alamat input`);
    render(); layout(true);
    await Promise.all([...S.nodes.values()].map(n=>this.identify(n)));
    render();
    showTx(txid,{from:main,to:null,desc:ins.length>1?`Transaksi ini memakai ${ins.length} alamat input sekaligus. Alamat yang dibelanjakan bersama biasanya dikendalikan oleh wallet yang sama.`:''},transfers,{status:'0x1'});
    setMsg(`Transaksi dibaca: ${transfers.length} perpindahan dana${tx.status&&!tx.status.confirmed?' (belum terkonfirmasi)':''}.`);
  },
  async watchRows(addr){
    const page=await this.get(`/address/${addr}/txs`);
    return page.flatMap(tx=>this.parse(tx,addr)).filter(t=>!t.spam);
  },
};
