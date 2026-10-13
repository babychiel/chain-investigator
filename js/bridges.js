"use strict";
// Bridge resolvers: ask the bridge itself where a deposit went. Each bridge runs a public API (CORS-enabled) that
// maps a source transaction to the destination chain, recipient and destination transaction. This is a recorded
// fact from the bridge operator, unlike XChain.search() (same address + similar amount + time window), which is a
// guess and only works between EVM chains.
// Every resolver returns a list of {bridge, status, dstChain (our chain id or null), dstName, recipient, amount, sym,
// dstTx, srcTx, url}. A resolver that finds nothing returns []; one that fails throws (shown as "tidak bisa dicek").

const WH_CHAIN={1:'sol',2:'1',4:'56',5:'137',6:'43114',10:'250',13:'8217',14:'42220',16:'1284',23:'42161',24:'10',30:'8453',34:'534352',35:'5000',36:'81457',37:'196',38:'59144',44:'80094',45:'480',46:'130',47:'999'};
const WH_NAME={3:'Terra',8:'Algorand',15:'NEAR',18:'Terra 2',21:'Sui',22:'Aptos',32:'Sei'};
const CCTP_DOMAIN={0:'1',1:'43114',2:'10',3:'42161',5:'sol',6:'8453',7:'137',10:'130',11:'59144'};
const LZ_EID={30101:'1',30102:'56',30106:'43114',30109:'137',30110:'42161',30111:'10',30168:'sol',30183:'59144',30184:'8453'};
const THOR_CHAIN={BTC:'btc',ETH:'1',BSC:'56',AVAX:'43114',BASE:'8453',ARB:'42161',SOL:'sol'};
const THOR_NAME={GAIA:'Cosmos Hub',DOGE:'Dogecoin',LTC:'Litecoin',BCH:'Bitcoin Cash',THOR:'THORChain',XRP:'XRP Ledger',TRON:'Tron',MAYA:'Maya'};
const RELAY_CHAIN={792703809:'sol',8253038:'btc'};
const ACROSS_SOLANA=34268394551451;

const Bridges={
  // our chain id → the id each bridge uses for the SOURCE chain
  srcIds(){
    const c=S.chainId;
    const wh=Object.entries(WH_CHAIN).find(([,v])=>v===c), cctp=Object.entries(CCTP_DOMAIN).find(([,v])=>v===c);
    return {wh:wh&&+wh[0], cctp:cctp&&+cctp[0], evm:isEvm()?+c:null};
  },
  chainName(id,fallback){
    if(id==='sol') return 'Solana'; if(id==='btc') return 'Bitcoin';
    if(id) return Labels.chainName(String(id));
    return fallback||'jaringan lain';
  },
  async json(url,opts){
    let r;
    try{ r=await fetch(url,opts); }
    catch(e){ // blocked by CORS or network: retry through the local helper server (tools/serve.py), if it is the one running
      r=await fetch('/proxy?url='+encodeURIComponent(url),opts).catch(()=>null);
      if(!r||r.status===404&&!(r.headers.get('content-type')||'').includes('json')) throw new Error('tidak bisa dihubungi dari browser');
    }
    if(r.status===404) return null;
    if(r.status===429) throw new Error('dibatasi (rate limit), coba lagi nanti');
    const j=await r.json().catch(()=>null);
    if(!r.ok) { if(j&&/not found|unknown_order/i.test(JSON.stringify(j))) return null; throw new Error((j&&(j.message||j.errorMessage||j.error))||('HTTP '+r.status)); }
    return j;
  },
  num(v,dec){ return v==null?null:(dec?units(String(v),dec):+v); },

  resolvers:{
    async wormhole(h){
      const j=await Bridges.json(`https://api.wormholescan.io/api/v1/operations?txHash=${encodeURIComponent(h)}`);
      return ((j&&j.operations)||[]).map(o=>{
        const p=(o.content&&o.content.standarizedProperties)||{}, d=o.data||{}, t=o.targetChain||{};
        const dst=WH_CHAIN[p.toChain]||null;
        return {bridge:'Wormhole',status:t.status||(o.vaa?'menunggu klaim di tujuan':'diproses'),dstChain:dst,dstName:dst?null:(WH_NAME[p.toChain]||`Wormhole chain ${p.toChain}`),
          recipient:p.toAddress||'',amount:d.tokenAmount!=null?+d.tokenAmount:null,sym:d.symbol||'',dstTx:t.transaction&&t.transaction.txHash||'',
          url:`https://wormholescan.io/#/tx/${h}`};
      }).filter(r=>r.recipient||r.dstTx);
    },
    async debridge(h){
      const j=await Bridges.json(`https://dln.debridge.finance/v1.0/dln/tx/${encodeURIComponent(h)}/order-ids`);
      const out=[];
      for(const id of (j&&j.orderIds)||[]){
        const o=await Bridges.json(`https://stats-api.dln.trade/api/Orders/${id}`); if(!o) continue;
        const tk=o.takeOfferWithMetadata||{}, cid=+((tk.chainId||{}).bigIntegerValue||0);
        const dst=cid===7565164?'sol':cid&&cid<1e8?String(cid):null;
        const sv=x=>x&&(x.stringValue||x.Base64Value)||'';
        out.push({bridge:'deBridge (DLN)',status:o.state||'',dstChain:dst,dstName:dst?null:`deBridge chain ${cid}`,recipient:sv(o.receiverDst),
          amount:tk.amount?units((tk.amount.bigIntegerValue??tk.amount.stringValue)+'',(tk.metadata||{}).decimals||tk.decimals||0):null,sym:(tk.metadata||{}).symbol||'',
          dstTx:sv((o.fulfilledDstEventMetadata||{}).transactionHash),url:`https://app.debridge.finance/order?orderId=${id}`});
      }
      return out;
    },
    async cctp(h){
      const dom=Bridges.srcIds().cctp; if(dom==null) return [];
      const j=await Bridges.json(`https://iris-api.circle.com/v2/messages/${dom}?transactionHash=${encodeURIComponent(h)}`);
      return ((j&&j.messages)||[]).map(m=>{
        const d=m.decodedMessage||{}, b=d.decodedMessageBody||{}, dst=CCTP_DOMAIN[d.destinationDomain]||null;
        return {bridge:'Circle CCTP (USDC)',status:m.status||'',dstChain:dst,dstName:dst?null:`CCTP domain ${d.destinationDomain}`,
          recipient:b.mintRecipient||d.recipient||'',amount:b.amount?units(b.amount,6):null,sym:'USDC',dstTx:'',url:''};
      }).filter(r=>r.recipient);
    },
    async thorchain(h){
      const id=h.replace(/^0x/i,'').toUpperCase();
      const j=await Bridges.json(`https://gateway.liquify.com/chain/thorchain_midgard/v2/actions?txid=${id}`);
      const out=new Map();
      for(const a of (j&&j.actions)||[]){
        for(const o of a.out||[]){
          const asset=((o.coins||[])[0]||{}).asset||'', m=asset.match(/^([A-Z0-9]+)([.~/-])([^-]+)/)||[];
          const ch=m[1]||asset, kept=m[2]==='~'||m[2]==='/'||/^thor1/.test(o.address||''); // trade/synth assets and thor1… addresses stay on THORChain
          const dst=kept?null:(THOR_CHAIN[ch]||null);
          const real=o.txID&&!/^0{6}/.test(o.txID); // internal THORChain events get zero-padded ids
          const r={bridge:'THORChain',status:a.status||'',dstChain:dst,dstName:dst?null:kept?'THORChain (akun di dalam THORChain)':(THOR_NAME[ch]||ch),recipient:o.address||'',
            amount:o.coins&&o.coins[0]?+o.coins[0].amount/1e8:null,sym:m[3]||asset,dstTx:real?o.txID:'',url:`https://thorchain.net/tx/${id}`};
          const k=r.recipient+'|'+asset+'|'+r.amount, prev=out.get(k);
          if(!prev||(!prev.dstTx&&r.dstTx)) out.set(k,r);
        }
      }
      return [...out.values()].filter(r=>r.recipient);
    },
    async mayan(h){
      const s=await Bridges.json(`https://explorer-api.mayan.finance/v3/swap/trx/${encodeURIComponent(h)}`);
      if(!s||!s.destAddress) return [];
      const dst=WH_CHAIN[s.destChain]||null;
      return [{bridge:'Mayan',status:s.clientStatus||s.status||'',dstChain:dst,dstName:dst?null:`Mayan chain ${s.destChain}`,recipient:s.destAddress,
        amount:s.toAmount!=null?+s.toAmount:null,sym:s.toTokenSymbol||'',dstTx:s.fulfillTxHash||'',url:`https://explorer.mayan.finance/swap/${h}`}];
    },
    async across(h){
      const src=isSol()?ACROSS_SOLANA:Bridges.srcIds().evm; if(!src) return [];
      const s=await Bridges.json(`https://app.across.to/api/deposit/status?depositTxHash=${encodeURIComponent(h)}&originChainId=${src}`);
      if(!s||!s.destinationChainId) return [];
      const d=+s.destinationChainId, dst=d===ACROSS_SOLANA?'sol':String(d);
      return [{bridge:'Across',status:s.status||'',dstChain:dst,dstName:null,recipient:s.recipient||'',amount:null,sym:'',
        dstTx:s.fillTx||s.fillTxnRef||'',url:`https://app.across.to/transactions`,note:'Across tidak menyebut penerima lewat API ini. Klik "Buka tx tujuan" untuk melihat wallet yang menerima dana.'}];
    },
    async relay(h){
      const j=await Bridges.json(`https://api.relay.link/requests/v2?hash=${encodeURIComponent(h)}`);
      return ((j&&j.requests)||[]).map(Bridges.relayRow);
    },
    async layerzero(h){
      const j=await Bridges.json(`https://scan.layerzero-api.com/v1/messages/tx/${encodeURIComponent(h)}`);
      return ((j&&j.data)||[]).map(m=>{
        const p=m.pathway||{}, d=m.destination||{}, dst=LZ_EID[p.dstEid]||null;
        return {bridge:`LayerZero${p.sender&&p.sender.name?' · '+p.sender.name:''}`,status:d.status||'',dstChain:dst,dstName:dst?null:((p.receiver||{}).chain||`LayerZero eid ${p.dstEid}`),
          recipient:'',amount:null,sym:'',dstTx:(d.tx||{}).txHash||'',url:`https://layerzeroscan.com/tx/${h}`,
          note:'LayerZero hanya mencatat kontrak penerima. Buka tx tujuan untuk melihat wallet yang menerima token.'};
      });
    },
  },
  relayRow(q){
    const d=q.data||{}, m=d.metadata||{}, co=m.currencyOut||{}, cur=co.currency||{}, ci=m.currencyIn||{}, ot=(d.outTxs||[])[0]||{}, it=(d.inTxs||[])[0]||{};
    const cid=+(ot.chainId||cur.chainId||0), dst=RELAY_CHAIN[cid]||(cid?String(cid):null), sid=+(it.chainId||0);
    return {bridge:'Relay',status:q.status||'',dstChain:dst,dstName:null,recipient:q.recipient||'',amount:co.amountFormatted!=null?+co.amountFormatted:null,sym:cur.symbol||'',
      dstTx:ot.hash||'',srcTx:it.hash||'',user:q.user||'',srcChain:RELAY_CHAIN[sid]||(sid?String(sid):null),
      sent:ci.amountFormatted!=null?`${fmtNum(+ci.amountFormatted)} ${(ci.currency||{}).symbol||''}`:'',
      ts:q.createdAt?Math.floor(Date.parse(q.createdAt)/1000):0,url:`https://relay.link/transaction/${it.hash||q.id}`};
  },
  forChain(){
    if(isBtc()) return ['thorchain','relay'];
    if(isSol()) return ['wormhole','debridge','mayan','relay','cctp','layerzero','across'];
    return ['wormhole','debridge','across','relay','layerzero','cctp','mayan','thorchain'];
  },
  // one transaction: ask every bridge that serves this chain
  async resolveTx(h){
    const names=this.forChain(), errors=[];
    const res=await Promise.all(names.map(n=>this.resolvers[n](h).catch(e=>{ errors.push(`${n}: ${e.message}`); return []; })));
    return {hits:res.flat().map(r=>({...r,srcTx:r.srcTx||h})),errors,checked:names.length};
  },
  // Relay can be asked for every request of a wallet in one call (cheapest way to cover all its bridges/swaps)
  async relayByUser(addr){
    const j=await this.json(`https://api.relay.link/requests/v2?user=${encodeURIComponent(addr)}&limit=50`);
    return ((j&&j.requests)||[]).map(this.relayRow).filter(r=>r.srcTx||r.dstTx);
  },
  // candidate source txs of a wallet: its outgoing transfers to bridges, busy services, programs/contracts and
  // unlabelled hubs, largest first (a bridge deposit address rarely carries a label)
  candidates(addr,max=12){
    const by=new Map();
    for(const t of S.tx.values()){
      if(t.from!==addr||t.spam) continue;
      const n=S.nodes.get(t.to), cat=n?n._cat:'';
      if(cat==='dex'||cat==='cex') continue;
      const u=Prices.usd(t.sym,t.amount,t.token);
      if(u!=null&&u<1) continue;
      const score=(cat==='bridge'?1e9:0)+(cat==='service'?1e8:0)+(u||0);
      const prev=by.get(t.hash); if(!prev||prev.score<score) by.set(t.hash,{hash:t.hash,ts:t.ts,score,leg:t});
    }
    return [...by.values()].sort((a,b)=>b.score-a.score).slice(0,max);
  },
  async scanAddress(addr,{actor='user'}={}){
    const errors=[], hits=[], seen=new Set();
    const add=list=>{ for(const r of list){ const k=r.bridge+'|'+r.srcTx+'|'+r.dstTx+'|'+r.recipient; if(!seen.has(k)){ seen.add(k); hits.push(r); } } };
    Audit.log(actor,'lacak bridge mulai',addr);
    if(!isBtc()){ try{ add(await this.relayByUser(addr)); }catch(e){ errors.push('relay: '+e.message); } }
    const cands=this.candidates(addr);
    const names=this.forChain().filter(n=>n!=='relay');
    for(const [i,c] of cands.entries()){
      if(typeof Busy!=='undefined'&&Busy.cancelled) break;
      setMsg(`Bertanya ke ${names.length} bridge: transaksi ${i+1}/${cands.length}…`);
      const res=await Promise.all(names.map(n=>this.resolvers[n](c.hash).catch(e=>{ errors.push(`${n}: ${e.message}`); return []; })));
      add(res.flat().map(r=>({...r,srcTx:r.srcTx||c.hash,leg:c.leg})));
    }
    // attach the source leg (time/amount) where we have it
    for(const r of hits) if(!r.leg){ const t=[...S.tx.values()].find(t=>t.hash===r.srcTx&&t.from===addr); if(t) r.leg=t; }
    const same=(x,y)=>x&&y&&norm(x)===norm(y);
    for(const r of hits) r.dir=same(r.recipient,addr)&&!same(r.user,addr)?'in':'out'; // Relay also lists requests that paid INTO this wallet
    hits.sort((a,b)=>(b.ts||(b.leg||{}).ts||0)-(a.ts||(a.leg||{}).ts||0));
    const uniqErr=[...new Set(errors)];
    Audit.log(actor,'lacak bridge selesai',`${addr} · ${hits.length} transfer lintas jaringan · ${cands.length} tx dicek`);
    return {addr,hits,errors:uniqErr,checkedTx:cands.length};
  },
  openUrl(chain,{addr,tx}){ return `${location.pathname}?chain=${encodeURIComponent(chain)}${addr?`&addr=${encodeURIComponent(addr)}`:''}${tx?`&tx=${encodeURIComponent(tx)}`:''}`; },
  // a Solana recipient from Wormhole/CCTP may be a token account; the user can still open it (the app shows its owner)
  render(res,title){
    setTab('detail');
    const byDst={}, rcpt={};
    for(const r of res.hits){ if(r.dir==='in') continue; const k=this.chainName(r.dstChain,r.dstName); byDst[k]=(byDst[k]||0)+1; if(r.recipient) rcpt[r.recipient]=(rcpt[r.recipient]||0)+1; }
    const nIn=res.hits.filter(r=>r.dir==='in').length;
    const card=r=>{
      const dn=this.chainName(r.dstChain,r.dstName), sup=r.dstChain&&(r.dstChain==='sol'||r.dstChain==='btc'||S.chains.some(c=>c.chainid===r.dstChain));
      const leg=r.leg?`${fmtNum(r.leg.amount)} ${esc(r.leg.sym)} · ${fmtDate(r.leg.ts)}`:r.sent?`${esc(r.sent)}${r.ts?' · '+fmtDate(r.ts):''}`:'';
      if(r.dir==='in'){
        const sn=this.chainName(r.srcChain), ssup=r.srcChain&&(r.srcChain==='sol'||r.srcChain==='btc'||S.chains.some(c=>c.chainid===r.srcChain));
        return `<div class="finding low"><div><span class="sev low">Masuk</span> <b>${esc(r.bridge)}</b> dari <b>${esc(sn)}</b>${r.status?` <span class="muted">(${esc(r.status)})</span>`:''}</div>
          <div class="muted">Dikirim: ${leg||'-'}</div>
          <div>Pengirim di ${esc(sn)}: <span class="mono">${esc(r.user)}</span>${r.amount!=null?` · diterima <b>${fmtNum(r.amount)} ${esc(r.sym)}</b>`:''}</div>
          <div class="btns">${ssup&&r.user?`<a href="${this.openUrl(r.srcChain,{addr:r.user})}" target="_blank" rel="noopener"><button class="small">Selidiki pengirim di ${esc(sn)} ↗</button></a>`:''}
          ${r.url?`<a href="${r.url}" target="_blank" rel="noopener"><button class="small">Lihat di explorer bridge ↗</button></a>`:''}</div></div>`;
      }
      return `<div class="finding high"><div><span class="sev high">Keluar</span> <b>${esc(r.bridge)}</b> → <b>${esc(dn)}</b>${r.status?` <span class="muted">(${esc(r.status)})</span>`:''}</div>
        ${leg?`<div class="muted">Berangkat: ${leg}</div>`:''}
        ${r.recipient?`<div>Penerima di ${esc(dn)}: <span class="mono">${esc(r.recipient)}</span>${r.amount!=null?` · <b>${fmtNum(r.amount)} ${esc(r.sym)}</b>`:''}</div>`:r.amount!=null?`<div>Jumlah: <b>${fmtNum(r.amount)} ${esc(r.sym)}</b></div>`:''}
        ${r.note?`<div class="muted" style="font-size:12px">${esc(r.note)}</div>`:''}
        <div class="btns">
          ${sup&&r.recipient?`<a href="${this.openUrl(r.dstChain,{addr:r.recipient})}" target="_blank" rel="noopener"><button class="small primary">Lanjut investigasi penerima di ${esc(dn)} ↗</button></a>`:''}
          ${sup&&r.dstTx?`<a href="${this.openUrl(r.dstChain,{tx:r.dstTx})}" target="_blank" rel="noopener"><button class="small">Buka tx tujuan ↗</button></a>`:''}
          ${r.url?`<a href="${r.url}" target="_blank" rel="noopener"><button class="small">Lihat di explorer bridge ↗</button></a>`:''}
          ${r.srcTx?`<a href="${explorer('tx',r.srcTx)}" target="_blank" rel="noopener"><button class="small">Tx asal ↗</button></a>`:''}
        </div>
        ${!sup?`<div class="muted" style="font-size:12px">${esc(dn)} belum didukung tool ini. Lanjutkan di explorer bridge.</div>`:''}</div>`;
    };
    $('tab_detail').innerHTML=`<div class="card"><h3>${esc(title||'Lacak bridge')}</h3>
      <p style="margin:0">Hasil ini diambil langsung dari data operator bridge (Wormhole, deBridge, Circle CCTP, THORChain, Mayan, Across, Relay, LayerZero), bukan tebakan.${res.checkedTx!=null?` ${res.checkedTx} transaksi keluar dicek${isBtc()?'':', ditambah semua riwayat Relay wallet ini'}.`:''}</p>
      ${Object.keys(byDst).length?`<div style="margin-top:6px"><b>Ringkasan keluar:</b> ${Object.entries(byDst).map(([k,v])=>`${esc(k)} (${v}×)`).join(', ')}</div>
        <div class="muted">Penerima: ${Object.entries(rcpt).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([a,v])=>`<span class="mono">${esc(short(a))}</span> (${v}×)`).join(', ')}</div>`:''}
      ${nIn?`<div class="muted">${nIn} transfer masuk lewat bridge (dana yang datang dari jaringan lain ke wallet ini).</div>`:''}
      <details><summary>Apa artinya?</summary>${esc(GLOSSARY.bridge)} Setiap bridge mencatat ke mana dana dikirim. Tool ini menanyakan catatan itu memakai hash transaksi asal, sehingga alamat penerima di jaringan tujuan diketahui pasti, meskipun berbeda dari alamat pengirim.</details></div>
      ${res.hits.map(card).join('')||'<p class="muted">Tidak ada bridge yang mengenali transaksi ini. Kemungkinan dana tidak lewat bridge, lewat bridge yang belum didukung, atau lewat layanan swap terpusat (FixedFloat, ChangeNOW, dll.) yang tidak punya data publik.</p>'}
      ${isEvm()&&res.addr?`<div class="btns"><button class="small" data-xfollow="${res.addr}">Coba juga tebakan "alamat sama" di chain EVM lain</button></div>`:''}
      ${res.errors.length?`<details class="card"><summary>${res.errors.length} sumber tidak bisa dicek</summary><div class="muted" style="font-size:12px">${res.errors.slice(0,20).map(esc).join('<br>')}</div></details>`:''}`;
  },
};
