"use strict";
// Solana adapter (Helius). Produces the same transfer records as the EVM path so the graph,
// analysis, story, agent and report work unchanged. Solana addresses are case-sensitive.
const SOL_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SOL_SIG_RE=/^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
const SOL_SYSTEM='11111111111111111111111111111111';
const SOL_KNOWN_MINTS={
  So11111111111111111111111111111111111111112:{sym:'wSOL',dec:9},
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:{sym:'USDC',dec:6},
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB:{sym:'USDT',dec:6},
};
// program ids → readable owner names for program-derived accounts (pools, vaults, bridges).
// Names must keep words that analysis.js CAT_RE matches (raydium, swap, bridge, …) so the account is categorised.
const SOL_PROGRAMS={
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4:'Jupiter Aggregator',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8':'Raydium AMM',
  CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK:'Raydium CLMM',
  CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C:'Raydium CPMM',
  LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj:'Raydium LaunchLab',
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P':'pump.fun',
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA:'pump.fun AMM (PumpSwap)',
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc:'Orca Whirlpool',
  '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP':'Orca Swap v2',
  LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo:'Meteora DLMM',
  Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB:'Meteora Pools',
  cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG:'Meteora DAMM v2',
  dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN:'Meteora Bonding Curve',
  PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY:'Phoenix',
  opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb:'OpenBook v2',
  srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX:'OpenBook (Serum)',
  SoLFiHG9TfgtdUXUjWAxi3LtvYuFyDLVhBWxdMZxyCe:'Lifinity Swap v2',
  SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ:'Saber Swap',
  DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH:'DFlow Swap',
  wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb:'Wormhole Token Bridge',
  worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth:'Wormhole Core Bridge',
  src5qyZHqTqecJV4aY6Cb6zDZLMDzrDKKezs22MPHr4:'deBridge DLN (bridge)',
  dst5MGcFPoBeREFAA5E3tU5ij8m5uVYwkzkSAbsLbNo:'deBridge DLN (bridge)',
  CCTPiPYPc6AsJuwueEnWgSgucamXDZwBd53dQ11YiKX3:'Circle CCTP (bridge)',
  CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd:'Circle CCTP (bridge)',
  BrdgN2RPzEMWF96ZbnnJaUtQDQx7VRXYaHHbYCBvceWB:'Allbridge (bridge)',
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA:'SPL Token Program',
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb:'Token-2022 Program',
};
const SOL_TOKEN_PROGRAMS=new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
// Helius Wallet Identity (paid plans only) → label-database category
function solIdCat(r){
  const t=[r.type,r.category,...(r.tags||[])].join(' ');
  if(/sanction|ofac/i.test(t)) return 'S';
  if(/hack|exploit/i.test(t)) return 'H';
  if(/scam|phish|drain|fraud|malicious|rug/i.test(t)) return 'P';
  if(/mixer|tumbler/i.test(t)) return 'M';
  if(/deposit/i.test(t)&&/exchange|cex/i.test(t)) return 'D';
  if(/exchange|cex/i.test(t)&&!/decentral/i.test(t)) return 'X';
  if(/bridge/i.test(t)) return 'B';
  if(/mev|sandwich|arbitrage bot/i.test(t)) return 'V';
  return 'Q';
}

const Sol={
  last:0, gate:Promise.resolve(),
  meta:store.get('ci_solmeta',{}),
  ids:store.get('ci_solid',{}), // Helius identity cache: addr → {cat,name} or 0 (no identity)
  key(){ const k=store.get('ci_hkey',''); if(!k){ openKey(); throw new Error('Isi Helius API key dulu (tombol 🔑) untuk menyelidiki Solana.'); } return k; },
  throttle(){ const p=this.gate.then(async()=>{const w=this.last+150-Date.now(); if(w>0) await sleep(w); this.last=Date.now();}); this.gate=p; return p; },
  async req(url,opts){
    for(let attempt=0;attempt<5;attempt++){
      await this.throttle(); S.calls++; stats();
      let r; try{ r=await fetch(url,opts); }catch(e){ await sleep(800); continue; }
      if(r.status===429){ await sleep(1500); continue; }
      const j=await r.json().catch(()=>null);
      if(!r.ok) throw new Error((j&&(j.error&&j.error.message||j.error||j.message))||('HTTP '+r.status));
      return j;
    }
    throw new Error('Terkena rate limit Helius berulang kali.');
  },
  rest(path,params={}){ return this.req(`https://api.helius.xyz${path}?`+new URLSearchParams({'api-key':this.key(),...params})); },
  async rpc(method,params){
    const j=await this.req(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(this.key())}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    if(j.error) throw new Error(j.error.message||'RPC error');
    return j.result;
  },
  async metas(mints){
    const need=[...new Set(mints)].filter(m=>!SOL_KNOWN_MINTS[m]&&!this.meta[m]);
    for(let i=0;i<need.length;i+=100){
      try{
        const res=await this.rpc('getAssetBatch',{ids:need.slice(i,i+100)});
        for(const a of res||[]){
          if(!a||!a.id) continue;
          const ti=a.token_info||{}, md=(a.content&&a.content.metadata)||{};
          this.meta[a.id]={sym:(ti.symbol||md.symbol||'').trim()||('?'+short(a.id)),name:md.name||'',dec:ti.decimals??0};
        }
      }catch(e){ /* metadata is cosmetic */ }
    }
    store.set('ci_solmeta',this.meta);
  },
  symOf(mint){ const m=SOL_KNOWN_MINTS[mint]||this.meta[mint]; return m?m.sym:'?'+short(mint); },
  // Helius enhanced transaction → transfer records
  parse(tx){
    if(tx.transactionError) return [];
    const out=[], sig=tx.signature, ts=tx.timestamp||0, payer=tx.feePayer||'';
    (tx.nativeTransfers||[]).forEach((nt,i)=>{
      const amount=(nt.amount||0)/1e9; if(!(amount>0)||!nt.fromUserAccount||!nt.toUserAccount) return;
      out.push({key:`n:${sig}:${i}`,hash:sig,from:nt.fromUserAccount,to:nt.toUserAccount,sym:'SOL',token:'native',amount,ts,kind:'native',src:tx.source,payer,spam:amount<0.001});
    });
    (tx.tokenTransfers||[]).forEach((tt,j)=>{
      if(/NonFungible/i.test(tt.tokenStandard||'')) return;
      const from=tt.fromUserAccount, to=tt.toUserAccount; if(!from||!to) return;
      const amount=+tt.tokenAmount||0;
      out.push({key:`t:${sig}:${j}`,hash:sig,from,to,sym:'',token:tt.mint,amount,ts,kind:'token',src:tx.source,payer,spam:false});
    });
    return out;
  },
  finishTokens(list){
    for(const t of list) if(t.kind==='token'){
      t.sym=this.symOf(t.token);
      const m=this.meta[t.token]||{};
      t.name=m.name||'';
      t.spam=isSpam(t.sym,t.name,t.amount);
    }
    return list;
  },
  async fetchTransfers(addr){
    const errs=[], out=[]; let before='', fetched=0;
    const want=Math.max(100,S.settings.offset);
    // who paid the network fee for this wallet's transactions: a different, shared fee payer is the signature of
    // relayer-based services (privacy trading apps, trading bots, gasless wallets)
    const payers={}; let txs=0;
    try{
      while(fetched<want){
        const page=await this.rest(`/v0/addresses/${addr}/transactions`,{limit:100,...(before?{before}:{})});
        if(!Array.isArray(page)||!page.length) break;
        for(const tx of page){
          // a swap/route tx also lists transfers between pools and other users; keep only this wallet's own legs
          const own=this.parse(tx).filter(t=>t.from===addr||t.to===addr);
          if(!own.length) continue;
          out.push(...own); txs++;
          if(tx.feePayer&&tx.feePayer!==addr) payers[tx.feePayer]=(payers[tx.feePayer]||0)+1;
        }
        fetched+=page.length; before=page[page.length-1].signature;
        if(page.length<100) break;
      }
    }catch(e){ errs.push(e.message); }
    await this.metas(out.filter(t=>t.kind==='token').map(t=>t.token));
    this.finishTokens(out);
    return {out,errs,truncated:fetched>=want,extra:{payers,txs}};
  },
  async identify(n){
    if(n.kind) return n;
    try{
      const r=await this.rpc('getAccountInfo',[n.addr,{encoding:'jsonParsed'}]);
      const v=r&&r.value;
      if(!v||v.owner===SOL_SYSTEM){
        n.kind='eoa'; n.balance=v?v.lamports/1e9:0;
        await this.activity(n);
      }
      else if(v.executable){ n.kind='contract'; n.autoLabel=SOL_PROGRAMS[n.addr]||'Program'; }
      else if(SOL_TOKEN_PROGRAMS.has(v.owner)&&v.data&&v.data.parsed&&v.data.parsed.type==='account'){
        // a token account belongs to a wallet: show whose it is instead of the generic token program
        const i=v.data.parsed.info; n.kind='contract'; n.tokenOwner=i.owner;
        await this.metas([i.mint]);
        n.autoLabel=`Akun token ${this.symOf(i.mint)} milik ${short(i.owner)}`;
      }
      else { n.kind='contract'; n.owner=v.owner; n.autoLabel=SOL_PROGRAMS[v.owner]?`Akun ${SOL_PROGRAMS[v.owner]}`:`Akun milik program ${short(v.owner)}`; }
    }catch(e){ n.kind='?'; }
    this.identities([n.addr]);
    scheduleRender();
    return n;
  },
  // A wallet used by many people (exchange hot wallet, service hub, relayer) shows hundreds of transactions per day.
  // One cheap call: if the newest 1,000 signatures span less than 2 days, treat it as a busy service.
  async activity(n){
    try{
      const s=await this.rpc('getSignaturesForAddress',[n.addr,{limit:1000}]);
      if(!s||!s.length) return;
      const span=(s[0].blockTime||0)-(s[s.length-1].blockTime||0);
      n.recentTx=s.length; n.firstSeen=s[s.length-1].blockTime; n.lastSeen=s[0].blockTime;
      if(s.length>=1000&&span<2*86400) n.busy={perDay:Math.round(1000/Math.max(span,60)*86400)};
    }catch(e){ /* activity is a hint only */ }
  },
  // Helius Wallet Identity (exchanges, protocols, scammers). Needs a paid Helius plan; on 403 it is switched off for a week.
  async identities(addrs){
    const off=store.get('ci_solid_off',0);
    if(off&&Date.now()-off<7*86400e3) return;
    const need=addrs.filter(a=>SOL_RE.test(a)&&!(a in this.ids));
    if(!need.length) return;
    for(const a of need) this.ids[a]=0;
    try{
      for(let i=0;i<need.length;i+=100){
        const res=await fetch(`https://api.helius.xyz/v1/wallet/batch-identity?api-key=${encodeURIComponent(this.key())}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({addresses:need.slice(i,i+100)})});
        if(res.status===403||res.status===401){ store.set('ci_solid_off',Date.now()); for(const a of need) delete this.ids[a]; return; }
        if(!res.ok) return;
        for(const r of await res.json()||[]) if(r&&r.address&&r.name) this.ids[r.address]={cat:solIdCat(r),name:r.name};
      }
      store.set('ci_solid',this.ids);
      for(const a of need){ const n=S.nodes.get(a); if(n&&this.ids[a]) n.db=Labels.lookup(a); }
      scheduleRender();
    }catch(e){ for(const a of need) delete this.ids[a]; }
  },
  async investigateTx(sig){
    setMsg('Membaca transaksi Solana '+sig.slice(0,10)+'…');
    const res=await this.req(`https://api.helius.xyz/v0/transactions?api-key=${encodeURIComponent(this.key())}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({transactions:[sig]})});
    const tx=res&&res[0]; if(!tx) throw new Error('Transaksi tidak ditemukan.');
    resetCase();
    const transfers=this.parse(tx);
    await this.metas(transfers.filter(t=>t.kind==='token').map(t=>t.token));
    this.finishTokens(transfers);
    for(const t of transfers) S.tx.set(t.key,t);
    const senders=new Set(transfers.map(t=>t.from));
    const payer=tx.feePayer||transfers[0]&&transfers[0].from;
    S.roots=[payer]; ensureNode(payer,0);
    for(const a of senders) ensureNode(a,0);
    for(const t of transfers) if(!senders.has(t.to)) ensureNode(t.to,1);
    Audit.log('user','case dari transaksi',`${sig} · ${transfers.length} transfer · fee payer ${payer}`);
    render(); layout(true);
    await Promise.all([...S.nodes.values()].map(n=>this.identify(n)));
    render();
    showTx(sig,{from:payer,to:null,desc:tx.description},transfers.filter(t=>!t.spam),{status:tx.transactionError?'0x0':'0x1'});
    setMsg(`Transaksi dibaca: ${transfers.length} perpindahan dana.`);
  },
  async watchRows(addr){
    const page=await this.rest(`/v0/addresses/${addr}/transactions`,{limit:25});
    const rows=[];
    for(const tx of page||[]) rows.push(...this.parse(tx));
    await this.metas(rows.filter(t=>t.kind==='token').map(t=>t.token));
    return this.finishTokens(rows).filter(t=>!t.spam);
  },
};
