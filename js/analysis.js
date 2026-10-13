"use strict";
// Heuristic analysis ("signatures"): entity categories, laundering patterns, custodial exit points,
// haircut exposure, per-address risk with reasons, graph review and next steps.
// Everything here is behavioural inference from the transfers already fetched, not ground truth.

const CAT_RE={
  mixer:/tornado|mixer|railgun|privacy ?pool|cyclone|typhoon|blender|sinbad|samourai|wasabi/i,
  bridge:/bridge|wormhole|mayan|allbridge|portal|spokepool|standardbridge|tokenmessenger|l1gatewayrouter|oftadapter|\boft\b|relaydepository|stargate|across|wormhole|layerzero|cctp|tokenmessenger|synapse|celer|debridge|orbiter|squid|axelar|relay|socket|li\.?fi|hop protocol|thorchain|chainflip|symbiosis|meson|rhino|connext|multichain/i,
  dex:/jupiter|raydium|orca|whirlpool|pump\.fun|meteora|phoenix|openbook|lifinity|router|swap|pool ?manager|pair|uniswap|sushi|curve|balancer|1inch|paraswap|aggregat|settlement|permit2|zeroex|kyber|pancake|velodrome|aerodrome|camelot|odos|openocean/i,
  cex:/binance|coinbase|kraken|okx|okex|bybit|kucoin|gate\.?io|huobi|htx|bitget|mexc|bitfinex|crypto\.com|upbit|bithumb|gemini|indodax|tokocrypto|pintu|bitstamp|bitmart|lbank|whitebit|poloniex|exchange|hot ?wallet|deposit|cex/i,
};
const SUSPECT_RE=/exploit|hack|scam|drain|phish|attacker|thief|stolen|suspect|tersangka|penipu|pelaku|scammer|launder/i;
const CAT_NAME={suspect:'Tersangka',sanction:'Tersanksi OFAC',hack:'Exploiter / hacker',scam:'Phishing / scam',mixer:'Mixer',bridge:'Bridge',cex:'Exchange (titik keluar)',dex:'DEX / router',mev:'Bot MEV',service:'Layanan ramai (dipakai banyak orang)'};
const BAD=new Set(['suspect','sanction','hack','scam']);
const SEV_ORDER={high:0,med:1,low:2,info:3};
const TERMINAL=new Set(['cex','bridge','mixer','dex','mev','service']);
let A={findings:[],review:[],steps:[]};

// user labels/colors win, then the public label database, then verified contract names
function categoryOf(n){
  const db=n.db||null;
  const t=(n.label||'')+' '+(n.autoLabel||'')+' '+(db?db.name:'');
  if(n.color==='#e5484d'||SUSPECT_RE.test(n.label||'')) return 'suspect';
  if(n.color==='#30a46c') return 'cex';
  if(n.color==='#6b7280') return '';
  if(db){ if(db.cat==='S') return 'sanction'; if(db.cat==='H') return 'hack'; if(db.cat==='P') return 'scam'; if(db.cat==='M') return 'mixer'; }
  if(CAT_RE.mixer.test(t)) return 'mixer';
  if(db&&(db.cat==='X'||db.cat==='D')) return 'cex';
  if(CAT_RE.bridge.test(t)||(db&&db.cat==='B')) return 'bridge';
  if(CAT_RE.cex.test(n.label||'')) return 'cex';
  if(db&&db.cat==='V') return 'mev';
  if(CAT_RE.dex.test(t)) return 'dex';
  if(n.color==='#f76b15') return 'bridge';
  if(n.busy) return 'service'; // hundreds of tx per day: exchange hot wallet, service hub or relayer, not a person
  return '';
}
const nameOf=a=>{const n=S.nodes.get(a); if(!n){ const db=Labels.lookup(a); return db?db.name:short(a); } return n.label||(n.db&&n.db.name)||n.autoLabel||short(a);};
const sumBy=list=>{const o={}; for(const t of list) o[t.sym]=(o[t.sym]||0)+t.amount; return o;};
const fmtSums=o=>Object.entries(o).map(([s,v])=>fmtNum(v)+' '+s).join(', ');
const usdOf=t=>Prices.usd(t.sym,t.amount,t.token);
const isDust=t=>{const u=usdOf(t); return u!=null&&u<1;}; // rent, fees and dust say nothing about where the money went

function analyze(){
  const nodes=[...S.nodes.values()].filter(n=>!n.hidden);
  const inGraph=new Set(nodes.map(n=>n.addr));
  const txs=[...S.tx.values()].filter(t=>!t.spam&&t.from!==t.to);
  const st=new Map();
  const get=a=>{let s=st.get(a); if(!s){s={in:[],out:[],senders:new Set(),receivers:new Set()}; st.set(a,s);} return s;};
  for(const t of txs){ const f=get(t.from), r=get(t.to); f.out.push(t); r.in.push(t); f.receivers.add(t.to); r.senders.add(t.from); }
  const empty={in:[],out:[],senders:new Set(),receivers:new Set()};
  const F=[];
  const add=(sev,type,title,detail,addrs,step)=>F.push({sev,type,title,detail,addrs:[...new Set(addrs||[])],step:step||''});
  for(const n of nodes){ n._cat=categoryOf(n); n._sig=[]; }
  const sig=(a,w,txt)=>{const n=S.nodes.get(a); if(n&&!n.hidden&&!n._sig.some(s=>s.txt===txt)) n._sig.push({w,txt});};

  // --- entity categories & exit points
  for(const n of nodes){
    const s=st.get(n.addr)||empty;
    const fromGraph=s.in.filter(t=>inGraph.has(t.from)&&t.from!==n.addr);
    const senders=fromGraph.map(t=>t.from);
    if(n._cat==='mixer'){
      add('high','mixer',`Dana masuk mixer: ${nameOf(n.addr)}`,fromGraph.length?`Diterima dari graph: ${fmtSums(sumBy(fromGraph))}`:'',[n.addr,...senders],
        'Mixer memutus jejak on-chain. Catat jumlah dan waktu tiap deposit, lalu cari withdrawal dengan denominasi dan waktu yang berdekatan.');
      senders.forEach(a=>sig(a,35,'Mengirim dana ke mixer'));
    }
    if(n._cat==='bridge'){
      add('med','bridge',`Lintas chain lewat ${nameOf(n.addr)}`,fromGraph.length?`Masuk dari graph: ${fmtSums(sumBy(fromGraph))}`:'',[n.addr,...senders],
        'Klik "Lacak bridge" untuk menanyakan langsung ke operator bridge ke jaringan dan alamat mana dana ini dikirim.');
      F[F.length-1].xfollow=[...new Set(senders)].filter(a=>{const m=S.nodes.get(a); return m&&m.kind!=='contract';}).slice(0,4);
      senders.forEach(a=>sig(a,10,'Mengirim dana lewat bridge'));
    }
    if(n._cat==='sanction'||n._cat==='hack'||n._cat==='scam'){
      add('high',n._cat==='sanction'?'sanction':'risky',`${CAT_NAME[n._cat]}: ${nameOf(n.addr)}`,`${Labels.describe(n.db)||'Ditandai oleh kamu'}${fromGraph.length?` · menerima dari graph: ${fmtSums(sumBy(fromGraph))}`:''}`,[n.addr,...senders],
        n._cat==='sanction'?'Catat semua interaksi dengan alamat ini. Exchange resmi wajib membekukan dana yang terkait alamat tersanksi.':'Alamat ini sudah dikenal sebagai pelaku. Telusuri ke mana dananya pergi untuk menemukan titik keluar.');
    }
    if(n._cat==='cex'&&n.db&&n.db.cat==='D'){
      add('high','deposit',`Alamat deposit exchange: ${nameOf(n.addr)}`,`Database mengenali ini sebagai alamat deposit (${Labels.describe(n.db)}).${fromGraph.length?` Menerima dari graph: ${fmtSums(sumBy(fromGraph))}.`:''}`,[n.addr,...senders],
        'Alamat deposit terikat ke satu akun exchange. Laporkan tx hash setoran ke exchange/polisi untuk meminta identitas pemilik akun.');
    } else if(n._cat==='cex'&&fromGraph.length&&fromGraph.every(isDust)){
      add('low','exit',`Hanya transfer debu ke ${nameOf(n.addr)}`,`Masuk dari graph: ${fmtSums(sumBy(fromGraph))} (${fromGraph.length} transfer, masing-masing di bawah $1).`,[n.addr,...senders],
        'Nilai sekecil ini biasanya spam/dusting atau sisa biaya, bukan pencairan dana. Jangan jadikan bukti utama.');
    } else if(n._cat==='cex'){
      add('high','exit',`Titik keluar: ${nameOf(n.addr)}`,fromGraph.length?`Masuk dari graph: ${fmtSums(sumBy(fromGraph))} (${fromGraph.length} transfer)`:'',[n.addr,...senders],
        'Exchange menyimpan data KYC. Kumpulkan tx hash deposit, waktu, dan jumlah, lalu serahkan lewat laporan resmi ke exchange atau polisi.');
    }
    if(n._cat==='service'&&fromGraph.length&&!fromGraph.every(isDust)){
      add('med','service',`Dana masuk ke layanan ramai: ${nameOf(n.addr)}`,`Masuk dari graph: ${fmtSums(sumBy(fromGraph))} (${fromGraph.length} transfer). Alamat ini memproses ${n.busy.perDay?`±${n.busy.perDay.toLocaleString('id-ID')} transaksi per hari`:`${n.busy.total.toLocaleString('id-ID')} transaksi`}.`,[n.addr,...senders],
        'Di sini dana tercampur dengan uang banyak orang, jadi jejak on-chain biasanya putus. Cek name tag alamat ini di explorer: kalau exchange, beri label Exchange (punya data KYC); kalau aplikasi/relayer, tanyakan atau laporkan ke layanan tersebut dengan tx hash-nya.');
    }
    if(n.kind==='7702'){
      add('med','7702',`EIP-7702 aktif: ${nameOf(n.addr)}`,`Didelegasikan ke ${n.delegate}`,[n.addr],
        'Delegasi 7702 sering dipakai sweeper/drainer. Kalau pemilik tidak pernah mengatur ini, kemungkinan private key-nya bocor. Cek kontrak delegasinya di explorer.');
      sig(n.addr,10,'Memakai delegasi EIP-7702');
    }
  }

  // --- deposit-address pattern: EOA forwards ~everything to one busy address
  for(const n of nodes){
    if(!n.expanded||n._cat||n.kind==='contract') continue;
    const s=st.get(n.addr); if(!s||!s.in.length||s.receivers.size!==1) continue;
    const dest=[...s.receivers][0], dn=S.nodes.get(dest), ds=st.get(dest);
    const inS=sumBy(s.in), outS=sumBy(s.out);
    if(!Object.keys(outS).some(k=>inS[k]&&outS[k]>=0.9*inS[k])) continue;
    if(dn&&dn.db&&dn.db.cat==='D') continue; // paying INTO a known deposit address makes this the customer's wallet, not a deposit address
    const isCex=dn&&dn._cat==='cex';
    if(!(isCex||(dn&&dn.truncated)||(dn&&dn.hiddenCps.length>20)||(ds&&ds.senders.size>=3))) continue;
    add(isCex?'high':'med','deposit',`Pola alamat deposit: ${nameOf(n.addr)}`,
      `Seluruh dana diteruskan ke satu alamat sibuk, ${nameOf(dest)}${isCex?' (exchange)':''}. Pola ini khas alamat deposit exchange yang di-sweep ke hot wallet.`,[n.addr,dest],
      isCex?'Alamat deposit terikat ke satu akun exchange, jadi ini bukti kuat untuk permintaan data KYC.':'Cek alamat tujuan di explorer (name tag). Kalau itu hot wallet exchange, beri label Exchange.');
    sig(n.addr,10,'Pola alamat deposit/sweep');
  }

  // --- rapid pass-through (transit hop)
  for(const n of nodes){
    if(!n.expanded||n._cat||n.kind==='contract') continue;
    const s=st.get(n.addr); if(!s) continue;
    const inHs=new Set(s.in.map(x=>x.hash));
    for(const t of s.in){
      if(isDust(t)) continue;
      // same token contract (a fake "USDC" is not USDC), and not a swap leg: paying a pool and getting tokens back in
      // one tx is trading, not passing money on
      const outs=s.out.filter(o=>o.sym===t.sym&&o.token===t.token&&!inHs.has(o.hash)&&o.ts>=t.ts&&o.ts<=t.ts+7200&&!isDust(o));
      const sum=outs.reduce((a,o)=>a+o.amount,0);
      if(t.amount>0&&sum>=0.85*t.amount){
        const mins=Math.round((Math.max(...outs.map(o=>o.ts))-t.ts)/60);
        add('med','passthrough',`Pass-through cepat: ${nameOf(n.addr)}`,`Menerima ${fmtNum(t.amount)} ${t.sym}, lalu meneruskan ${fmtNum(sum)} ${t.sym} dalam ±${mins} menit.`,[n.addr],
          'Wallet transit dipakai untuk memperpanjang jejak dan jarang jadi tujuan akhir. Ikuti terus arah keluarnya.');
        sig(n.addr,15,'Meneruskan dana dengan cepat (wallet transit)');
        break;
      }
    }
  }

  // --- fan-out / fan-in bursts
  const burst=(list,key)=>{
    const arr=list.slice().sort((a,b)=>a.ts-b.ts); let best={n:0}, j=0;
    for(let i=0;i<arr.length;i++){
      while(arr[i].ts-arr[j].ts>86400) j++;
      const k=new Set(arr.slice(j,i+1).map(t=>t[key])).size;
      if(k>best.n) best={n:k,from:arr[j].ts};
    }
    return best;
  };
  for(const n of nodes){
    if(!n.expanded||TERMINAL.has(n._cat)||n.kind==='contract') continue;
    const s=st.get(n.addr); if(!s) continue;
    // count real sends/receipts only: a swap pays a pool and gets tokens back in the same tx, and on Solana every
    // route touches several pool accounts, which would otherwise look like "sending to 87 addresses"
    const inH=new Set(s.in.map(t=>t.hash)), outH=new Set(s.out.map(t=>t.hash));
    const isWallet=a=>{const m=S.nodes.get(a); return !m||(m.kind!=='contract'&&!TERMINAL.has(m._cat));};
    const outs=s.out.filter(t=>!inH.has(t.hash)&&!isDust(t)&&isWallet(t.to));
    const ins=s.in.filter(t=>!outH.has(t.hash)&&!isDust(t)&&isWallet(t.from));
    const fo=burst(outs,'to');
    if(fo.n>=5){
      add('med','fanout',`Pemecahan dana (fan-out): ${nameOf(n.addr)}`,`Mengirim ke ${fo.n} alamat berbeda dalam 24 jam (mulai ${fmtDate(fo.from)}).`,[n.addr],
        'Pelaku sering memecah dana ke banyak wallet. Trace maju dengan cabang lebih banyak, lalu cari titik di mana cabang-cabang itu berkumpul lagi.');
      sig(n.addr,10,'Memecah dana ke banyak alamat');
    }
    const fi=burst(ins,'from');
    if(fi.n>=5) add('low','fanin',`Konsolidasi (fan-in): ${nameOf(n.addr)}`,`Menerima dari ${fi.n} alamat berbeda dalam 24 jam.`,[n.addr],
      'Titik konsolidasi bisa jadi wallet utama pelaku atau sebuah layanan (exchange/bot). Lihat ke mana dana keluar sesudahnya.');
  }

  // --- peel chains: at each hop one large forward (≥70%) + one small "peel"
  const peel=a=>{
    const n=S.nodes.get(a); if(!n||!n.expanded) return null;
    const s=st.get(a); if(!s) return null;
    const by={};
    for(const t of s.out){ by[t.sym]=by[t.sym]||{}; by[t.sym][t.to]=(by[t.sym][t.to]||0)+t.amount; }
    for(const sym in by){
      const e=Object.entries(by[sym]); if(e.length!==2) continue;
      e.sort((x,y)=>y[1]-x[1]);
      if(e[0][1]>=0.7*(e[0][1]+e[1][1])) return {next:e[0][0],peel:e[1][0],sym};
    }
    return null;
  };
  const peelOf=new Map(); for(const n of nodes){ const p=peel(n.addr); if(p) peelOf.set(n.addr,p); }
  const isNext=new Set([...peelOf.values()].map(p=>p.next));
  for(const start of peelOf.keys()){
    if(isNext.has(start)) continue;
    const chain=[], seen=new Set(); let cur=start;
    while(cur&&peelOf.has(cur)&&!seen.has(cur)){ seen.add(cur); chain.push(cur); cur=peelOf.get(cur).next; }
    if(chain.length>=3){
      add('high','peel',`Peel chain ${chain.length} hop`,`Di setiap hop sebagian kecil dana "dikupas" ke alamat lain dan sisanya diteruskan: ${chain.map(nameOf).join(' → ')}`,
        [...chain,...chain.map(a=>peelOf.get(a).peel)],'Alamat penerima kupasan sering adalah alamat deposit exchange atau pembayaran. Expand kupasan yang terbesar.');
      chain.forEach(a=>sig(a,20,'Bagian dari peel chain'));
    }
  }

  // --- swaps (asset changes inside one tx)
  for(const n of nodes){
    if(!n.expanded||TERMINAL.has(n._cat)||n.kind==='contract') continue;
    const s=st.get(n.addr); if(!s) continue;
    const byHash=new Map();
    for(const t of s.out){ const h=byHash.get(t.hash)||{o:new Set(),i:new Set()}; h.o.add(t.sym); byHash.set(t.hash,h); }
    for(const t of s.in){ const h=byHash.get(t.hash); if(h) h.i.add(t.sym); }
    const pairs={};
    for(const h of byHash.values()) for(const a of h.o) for(const b of h.i) if(a!==b) pairs[a+' → '+b]=(pairs[a+' → '+b]||0)+1;
    const list=Object.entries(pairs);
    if(list.length) add('info','swap',`Swap token: ${nameOf(n.addr)}`,list.map(([k,v])=>`${k} (${v}×)`).join(', '),[n.addr],
      'Swap mengganti aset. Lanjutkan tracing pada token hasil swap dari alamat ini, bukan lewat kontrak DEX.');
  }

  // --- address poisoning
  const allAddrs=new Set(); for(const t of S.tx.values()){allAddrs.add(t.from);allAddrs.add(t.to);}
  const look=new Map();
  for(const a of allAddrs){ const k=(/^0x/.test(a)?a.slice(2,6):a.slice(0,4))+a.slice(-4); if(!look.has(k)) look.set(k,[]); look.get(k).push(a); }
  for(const g of look.values()) if(g.length>1)
    add('high','poison','Alamat mirip (address poisoning)',`Alamat dengan awalan dan akhiran sama: ${g.join(', ')}`,g,
      'Penyerang membuat alamat yang mirip supaya korban salah menyalin dari riwayat. Selalu cocokkan alamat lengkap.');
  const zero=[...S.tx.values()].filter(t=>t.amount===0&&(inGraph.has(t.to)||inGraph.has(t.from)));
  if(zero.length) add('low','poison',`${zero.length} transfer bernilai 0`,'Transfer token senilai 0 biasanya spam address poisoning. Tersembunyi saat filter spam aktif.',[],
    'Abaikan untuk tracing, tapi waspadai alamat pengirimnya.');

  // --- direct interactions with known-bad addresses (screening every counterparty, not just graph nodes)
  const riskyHits=new Map();
  for(const t of txs){
    for(const [me,cp] of [[t.from,t.to],[t.to,t.from]]){
      const mn=S.nodes.get(me); if(!mn||!mn.expanded) continue;
      const db=Labels.lookup(cp); if(!db||!'SHPM'.includes(db.cat)) continue;
      if(S.nodes.has(cp)&&!S.nodes.get(cp).hidden){ sig(me,db.cat==='S'?40:30,`Bertransaksi langsung dengan ${DB_CAT_NAME[db.cat].toLowerCase()} (${db.name})`); continue; } // already reported as a node finding
      const k=me+'|'+cp; const h=riskyHits.get(k)||{me,cp,db,list:[]}; h.list.push(t); riskyHits.set(k,h);
    }
  }
  for(const h of riskyHits.values()){
    const out=h.list.filter(t=>t.from===h.me);
    add('high','risky',`Berinteraksi dengan ${DB_CAT_NAME[h.db.cat].toLowerCase()}: ${h.db.name}`,
      `${nameOf(h.me)} ${out.length?'mengirim ke':'menerima dari'} ${h.cp} (${fmtSums(sumBy(h.list))}, ${h.list.length} transfer).`,[h.me,h.cp],
      S.nodes.has(h.cp)?'Lihat alamat ini di graph dan ikuti dananya.':'Alamat ini belum ada di graph. Klik namanya di Temuan untuk menambahkannya.');
    sig(h.me,h.db.cat==='S'?40:30,`Bertransaksi langsung dengan ${DB_CAT_NAME[h.db.cat].toLowerCase()} (${h.db.name})`);
  }

  // --- deposit-address reuse: several wallets paying into one exchange deposit address = likely one owner
  for(const n of nodes){
    const isDep=(n.db&&n.db.cat==='D')||F.some(f=>f.type==='deposit'&&f.addrs[0]===n.addr);
    if(!isDep) continue;
    const s=st.get(n.addr); if(!s) continue;
    const payers=[...s.senders].filter(a=>{const m=S.nodes.get(a); return m&&!m.hidden&&!TERMINAL.has(m._cat)&&m.kind!=='contract';});
    if(payers.length>=2){
      add('high','cluster',`Kemungkinan satu pemilik: ${payers.length} wallet`,`Wallet ${payers.map(short).join(', ')} sama-sama menyetor ke alamat deposit ${nameOf(n.addr)}.`,[...payers,n.addr],
        'Gabungkan wallet-wallet ini dalam laporanmu sebagai satu pelaku (keyakinan sedang–tinggi).');
      payers.forEach(a=>sig(a,10,'Berbagi alamat deposit exchange dengan wallet lain'));
    }
  }

  // --- Solana: someone else pays this wallet's fees (relayer). Typical of privacy-trading apps, trading bots and
  // custodial/gasless wallets: the wallet itself may never hold SOL, and its "real" owner sits behind the service.
  for(const n of nodes){
    if(!n.expanded||!n.payers||!n.ownTx) continue;
    const top=Object.entries(n.payers).sort((a,b)=>b[1]-a[1])[0]; if(!top) continue;
    const share=top[1]/n.ownTx; if(share<0.5) continue;
    add('med','relayer',`Ongkos transaksi dibayar alamat lain: ${nameOf(n.addr)}`,
      `${Math.round(share*100)}% transaksi wallet ini (${top[1]} dari ${n.ownTx}) dibayar dan ikut ditandatangani oleh ${top[0]}.${n.balance===0?' Saldo SOL wallet ini sendiri 0.':''}`,[n.addr,top[0]],
      'Pola ini khas aplikasi trading privat, bot trading, atau wallet tanpa gas. Wallet seperti ini sering hanya akun sementara; pemilik sebenarnya menyetor dan menarik dana lewat layanan tersebut. Cari setoran ke layanan itu yang waktunya berdekatan dengan saat wallet ini pertama diisi.');
    sig(n.addr,5,'Ongkos transaksinya dibayar pihak lain (relayer/layanan)');
  }

  // --- Bitcoin: common-input ownership. Inputs spent together in one tx need every key, so usually one wallet.
  const clustered=new Set();
  for(const n of nodes){
    if(!n.expanded||!n.cospend||clustered.has(n.addr)) continue; // one finding per cluster
    const co=Object.entries(n.cospend).sort((a,b)=>b[1]-a[1]);
    if(!co.length) continue;
    co.forEach(([a])=>clustered.add(a));
    add('high','cospend',`Kemungkinan satu pemilik: ${nameOf(n.addr)} + ${co.length} alamat lain`,
      `Alamat ini pernah dibelanjakan bersama (sebagai input di transaksi yang sama) dengan: ${co.slice(0,8).map(([a,c])=>`${short(a)} (${c}×)`).join(', ')}${co.length>8?` dan ${co.length-8} lainnya`:''}.`,[n.addr,...co.slice(0,8).map(x=>x[0])],
      'Untuk membelanjakan beberapa input sekaligus, pengirim harus memegang kunci semua alamat itu, jadi biasanya satu wallet. Pengecualian: transaksi CoinJoin (banyak input dan output bernilai sama) sengaja mencampur banyak orang.');
  }

  // --- fake tokens: one symbol, several contracts
  for(const d of Prices.duplicates||[]) add(d.offMissing?'high':'med','fake',`Token palsu kemungkinan: ${d.sym}`,
    d.offMissing?`Semua "${d.sym}" di case ini BUKAN kontrak resmi (${CANONICAL[S.chainId][d.sym]}). Kontrak yang dipakai: ${d.contracts.join(', ')}. Kemungkinan besar token tiruan tanpa nilai.`
    :d.official?`Ada ${d.contracts.length} kontrak bernama ${d.sym}. Kontrak resmi: ${d.official}. Sisanya (${d.contracts.filter(x=>x!==d.official).join(', ')}) tiruan dan nilainya tidak dihitung.`
    :`Ada ${d.contracts.length} kontrak berbeda bernama ${d.sym}. Yang paling umum: ${d.contracts[0]}.`,[],
    'Cek kontrak token di explorer. Token yang bukan kontrak resmi biasanya dipakai untuk menipu atau address poisoning.');

  // --- haircut exposure from suspects (or seeds when nothing is flagged)
  const suspects=nodes.filter(n=>BAD.has(n._cat)).map(n=>n.addr);
  const sources=new Set(suspects.length?suspects:S.roots);
  const inc=new Map();
  for(const t of txs){ if(!inGraph.has(t.from)||!inGraph.has(t.to)) continue; if(!inc.has(t.to)) inc.set(t.to,[]); inc.get(t.to).push(t); }
  const taint=new Map(nodes.map(n=>[n.addr,sources.has(n.addr)?1:0]));
  for(let it=0;it<12;it++) for(const n of nodes){
    if(sources.has(n.addr)) continue;
    if(n._cat==='dex'){ taint.set(n.addr,0); continue; }
    const tot={}, tn={};
    for(const t of inc.get(n.addr)||[]){ tot[t.sym]=(tot[t.sym]||0)+t.amount; tn[t.sym]=(tn[t.sym]||0)+t.amount*(taint.get(t.from)||0); }
    let v=0; for(const k in tot) if(tot[k]>0) v=Math.max(v,tn[k]/tot[k]);
    taint.set(n.addr,v);
  }
  const srcName=suspects.length?'tersangka':'seed';

  // --- risk score with reasons
  const BASE={suspect:85,sanction:100,hack:90,scam:90,mixer:80,bridge:25,cex:10,dex:5,mev:5};
  for(const n of nodes){
    n._exposure=taint.get(n.addr)||0;
    let r=BASE[n._cat]||0; const why=[];
    if(n._cat) why.push('Kategori: '+CAT_NAME[n._cat]);
    for(const s of n._sig){ r+=s.w; why.push(s.txt); }
    // money received from a flagged suspect raises risk; money received from the seed does not (the seed may be a
    // victim or just the wallet being studied). Contracts/pools/services take everyone's money, so they never get it.
    if(suspects.length&&n._exposure>0.01&&!sources.has(n.addr)&&!TERMINAL.has(n._cat)&&n.kind!=='contract'){
      const w=n.expanded?40:20;
      r+=Math.round(n._exposure*w);
      why.push(n.expanded?`${Math.round(n._exposure*100)}% dana masuknya berasal dari tersangka`:`Menerima dana dari tersangka (alamat ini belum ditelusuri, jadi porsinya belum pasti)`);
    }
    n._risk=Math.min(100,r); n._why=why;
  }

  // --- graph review (catch tracing mistakes)
  const R=[];
  const rv=(sev,title,detail,addrs)=>R.push({sev,title,detail,addrs:addrs||[]});
  const trunc=nodes.filter(n=>n.truncated);
  if(trunc.length) rv('med',`Data belum lengkap untuk ${trunc.length} alamat`,'Limit transaksi per alamat tercapai, jadi sebagian transfer bisa terlewat. Naikkan limit di panel kiri lalu klik Refresh di node tersebut.',trunc.map(n=>n.addr));
  const through=nodes.filter(n=>n.expanded&&!S.roots.includes(n.addr)&&(n._cat==='dex'||n._cat==='cex'||n.kind==='contract'));
  if(through.length) rv('high','Tracing melewati kontrak/layanan publik',
    'DEX, router, dan exchange menampung dana banyak orang. Counterparty di balik alamat ini kemungkinan besar tidak terkait case. Sembunyikan cabang yang tidak relevan dan ikuti output swap di tx yang sama.',through.map(n=>n.addr));
  const hubs=nodes.filter(n=>n.hiddenCps.length>40&&!n._cat&&n.kind!=='contract');
  if(hubs.length) rv('med','Alamat sangat aktif tanpa label','Ratusan counterparty biasanya menandakan layanan (exchange, bot, bridge). Cek name tag-nya di explorer lalu beri label supaya tidak salah ditelusuri.',hubs.map(n=>n.addr));
  const unid=nodes.filter(n=>!n.kind);
  if(unid.length&&!S.settings.autoId) rv('low',`${unid.length} alamat belum diidentifikasi`,'Aktifkan "Deteksi kontrak otomatis" untuk membedakan wallet biasa, kontrak, dan wallet 7702.',[]);
  if(!S.settings.hideSpam&&[...S.tx.values()].some(t=>t.spam)) rv('low','Token spam ikut ditampilkan','Transfer spam atau bernilai 0 bisa mengacaukan graph. Aktifkan filter spam.',[]);
  if(S.settings.from||S.settings.to) rv('info','Filter tanggal aktif','Sebagian alur dana tersembunyi oleh filter tanggal.',[]);
  const hiRiskUnl=nodes.filter(n=>n._risk>=60&&!n.label);
  if(hiRiskUnl.length) rv('low',`${hiRiskUnl.length} alamat berisiko tinggi belum diberi label`,'Beri label supaya laporan dan graph mudah dibaca orang lain.',hiRiskUnl.map(n=>n.addr));

  // --- prioritized next steps
  const steps=[];
  // unexplored wallets that received the most money from the sources (USD where known)
  const fromSrc=new Map();
  for(const t of txs){ if(!sources.has(t.from)||!inGraph.has(t.to)) continue; const u=usdOf(t); const v=fromSrc.get(t.to)||{usd:0,n:0}; v.usd+=u||0; v.n++; fromSrc.set(t.to,v); }
  const leaves=nodes.filter(n=>!n.expanded&&!TERMINAL.has(n._cat)&&!BAD.has(n._cat)&&n.kind!=='contract'&&n._exposure>=0.25&&fromSrc.has(n.addr))
    .sort((a,b)=>fromSrc.get(b.addr).usd-fromSrc.get(a.addr).usd||b._exposure-a._exposure).slice(0,5);
  for(const n of leaves){ const v=fromSrc.get(n.addr); steps.push({text:`Expand ${nameOf(n.addr)}: menerima ${v.usd?fmtUsd(v.usd)+' ':''}(${v.n} transfer) dari ${srcName} dan belum ditelusuri.`,addr:n.addr,act:'expand'}); }
  if(!F.some(f=>f.type==='exit'||f.type==='deposit'||f.type==='service')) steps.push({text:'Belum ada titik keluar yang teridentifikasi. Jalankan playbook "Cari exchange" dari seed, atau beri label Exchange pada hot wallet yang kamu kenali dari name tag explorer.'});
  for(const f of F.filter(f=>f.type==='bridge')) steps.push({text:`Dana menyeberang lewat ${nameOf(f.addrs[0])}. Klik "Lacak bridge" untuk menanyakan ke operator bridge alamat penerimanya di jaringan tujuan.`,addr:(f.xfollow||[])[0]||f.addrs[0],act:(f.xfollow||[]).length?'xchain':''});
  for(const r of S.roots){
    const s=st.get(r); const n=S.nodes.get(r);
    if(!n||!n.expanded||!s||!s.in.length) continue;
    // first real deposit: skip swap legs (tokens coming back from a pool in the same tx) and program accounts
    const outH=new Set((s.out||[]).map(t=>t.hash));
    const first=s.in.filter(t=>!outH.has(t.hash)&&!isDust(t)&&(S.nodes.get(t.from)||{}).kind!=='contract').sort((a,b)=>a.ts-b.ts)[0];
    if(!first) continue;
    const fn=S.nodes.get(first.from);
    if(fn&&BAD.has(fn._cat)) continue;
    if(fn&&(fn._cat==='service'||fn._cat==='cex')) steps.push({text:`Sumber dana awal ${nameOf(r)} adalah ${fn._cat==='cex'?'exchange':'layanan ramai'} ${nameOf(first.from)} (${fmtDate(first.ts)}). Jejak on-chain putus di sini karena dana banyak orang bercampur. Cari setoran ke layanan itu yang waktunya berdekatan, atau minta data ke ${fn._cat==='cex'?'exchange':'layanan'} tersebut dengan tx hash-nya.`,addr:first.from});
    else if(!fn||!fn.expanded) steps.push({text:`Cari sumber dana awal ${nameOf(r)}: pengirim pertamanya ${short(first.from)} (${fmtDate(first.ts)}). Jalankan playbook "Sumber dana".`,addr:r,act:'funding'});
  }
  if(trunc.length) steps.push({text:`Lengkapi data ${trunc.length} alamat yang terpotong (naikkan limit, lalu Refresh).`});

  F.sort((a,b)=>SEV_ORDER[a.sev]-SEV_ORDER[b.sev]);
  R.sort((a,b)=>SEV_ORDER[a.sev]-SEV_ORDER[b.sev]);
  A={findings:F,review:R,steps,sourceName:srcName};
  return A;
}

function riskLevel(r){ return r>=60?['Tinggi','high']:r>=30?['Sedang','med']:['Rendah','low']; }

function renderFindings(){
  const sevName={high:'Tinggi',med:'Sedang',low:'Rendah',info:'Info'};
  const chip=a=>S.nodes.has(a)?`<span class="mono cp chip" data-sel="${a}">${esc(nameOf(a))}</span>`:`<span class="mono cp chip" data-add="${a}" title="Tambahkan ke graph">+ ${esc(nameOf(a))}</span>`;
  const addrs=list=>list.length?`<div style="margin-top:4px">${list.slice(0,8).map(chip).join(' ')}${list.length>8?` <span class="muted">+${list.length-8}</span>`:''}</div>`:'';
  const card=f=>`<div class="finding ${f.sev}"><div><span class="sev ${f.sev}">${sevName[f.sev]}</span> <b>${esc(f.title)}</b></div>
    ${f.detail?`<div class="muted">${esc(f.detail)}</div>`:''}${addrs(f.addrs)}${f.step?`<div class="tip">💡 ${esc(f.step)}</div>`:''}
    ${(f.xfollow||[]).map(a=>`<button class="small primary" style="margin-top:6px" data-bridges="${a}">🌉 Lacak bridge: ${esc(nameOf(a))}</button>`).join(' ')}
    ${GLOSSARY[f.type]?`<details><summary>Apa artinya?</summary>${esc(GLOSSARY[f.type])}</details>`:''}</div>`;
  const EXIT_T=new Set(['exit','deposit','cluster','service','cospend']);
  const exits=A.findings.filter(f=>EXIT_T.has(f.type));
  const sigs=A.findings.filter(f=>!EXIT_T.has(f.type));
  $('tab_find').innerHTML=!S.nodes.size?'<p class="muted">Belum ada case.</p>':`
    <div class="card"><h3>Langkah berikutnya</h3>
      ${A.steps.length?A.steps.map((s,i)=>`<div class="step"><span class="num">${i+1}</span><div style="flex:1">${esc(s.text)}
        ${s.addr?`<div class="btns" style="margin-top:4px">${s.act==='expand'?`<button class="small" data-exp="${s.addr}">Expand</button>`:''}${s.act==='funding'?`<button class="small" data-play="funding" data-addr="${s.addr}">Jalankan</button>`:''}${s.act==='xchain'?`<button class="small primary" data-bridges="${s.addr}">🌉 Lacak bridge</button>`:''}<button class="small" data-sel="${s.addr}">Lihat</button></div>`:''}</div></div>`).join(''):'<span class="muted">Tidak ada saran. Graph terlihat lengkap untuk data yang ada.</span>'}
    </div>
    <h3>Titik keluar & lead (${exits.length})</h3>${exits.map(card).join('')||`<p class="muted">Belum ditemukan. Exchange dikenali dari database label (${typeof LABEL_DATA!=='undefined'?Object.values(LABEL_DATA.meta.counts).reduce((a,b)=>a+b,0).toLocaleString('id-ID'):0} alamat), label buatanmu, dan pola alamat deposit.</p>`}
    <h3>Pola terdeteksi (${sigs.length})</h3>${sigs.map(card).join('')||'<p class="muted">Tidak ada pola mencurigakan dari data saat ini.</p>'}
    <h3>Review graph (${A.review.length})</h3>${A.review.map(card).join('')||'<p class="muted">Tidak ada masalah terdeteksi.</p>'}
    <p class="muted" style="font-size:11.5px">Semua temuan adalah heuristik dari transfer yang sudah ditarik. Perlakukan sebagai lead, bukan kesimpulan hukum.</p>`;
}
