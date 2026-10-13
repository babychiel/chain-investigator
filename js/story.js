"use strict";
// Plain-language explanations: a glossary for every finding type and an automatic "story" of the case,
// so the user doesn't have to read raw transactions.
const GLOSSARY={
  exit:'Exchange (seperti Binance atau Indodax) mewajibkan KYC (verifikasi KTP/identitas). Kalau dana kejahatan masuk ke exchange, exchange tahu siapa pemilik akunnya. Inilah titik paling penting untuk dilaporkan.',
  deposit:'Setiap pengguna exchange punya "alamat deposit" pribadi. Dana yang masuk ke situ otomatis dipindahkan exchange ke dompet utamanya (hot wallet). Karena alamat ini milik satu akun tertentu, exchange bisa melacak pemiliknya.',
  cluster:'Satu alamat deposit exchange hanya dimiliki satu akun. Jadi kalau beberapa wallet berbeda menyetor ke alamat deposit yang sama, besar kemungkinan semua wallet itu dikendalikan orang yang sama.',
  mixer:'Mixer (misalnya Tornado Cash) mencampur dana banyak orang lalu mengeluarkannya ke alamat baru, sehingga jejaknya terputus. Pelaku memakai ini untuk menyamarkan asal uang.',
  bridge:'Bridge memindahkan aset ke blockchain lain, misalnya dari Ethereum ke Arbitrum. Jejaknya tidak hilang, tapi pelacakan harus dilanjutkan di chain tujuan.',
  peel:'Peel chain: di setiap langkah sebagian kecil uang "dikupas" ke alamat lain (sering untuk dicairkan), lalu sisanya diteruskan ke wallet baru. Pola klasik untuk mencairkan dana curian sedikit demi sedikit.',
  passthrough:'Wallet transit: uang masuk lalu langsung dikirim keluar lagi dalam waktu singkat. Wallet seperti ini cuma "jembatan" untuk memperpanjang jejak, bukan tujuan akhir.',
  fanout:'Fan-out: uang dipecah ke banyak wallet sekaligus supaya lebih sulit dilacak.',
  fanin:'Fan-in: uang dari banyak wallet dikumpulkan ke satu wallet. Bisa wallet utama pelaku atau sebuah layanan.',
  swap:'Swap: menukar satu token dengan token lain, misalnya USDC ke ETH. Saat melacak, ikuti token hasil tukarnya.',
  poison:'Address poisoning: penipu membuat alamat yang awal dan akhirnya mirip alamat yang sering kamu pakai, lalu mengirim transaksi kecil supaya alamat palsu itu muncul di riwayatmu. Korban yang menyalin alamat dari riwayat akhirnya mengirim ke penipu.',
  fake:'Token palsu: ada lebih dari satu kontrak token dengan nama yang sama (misalnya dua "USDT"). Biasanya yang palsu dipakai untuk menipu. Nilai dalam dolar hanya dihitung untuk kontrak yang paling umum.',
  '7702':'EIP-7702 membuat wallet biasa bisa menjalankan kode kontrak. Fitur ini sah, tapi sering disalahgunakan "sweeper", yaitu skrip yang langsung menguras dana begitu masuk ke wallet yang private key-nya sudah dicuri.',
  sanction:'Alamat ini masuk daftar sanksi pemerintah AS (OFAC). Exchange resmi wajib memblokir dana dari atau ke alamat seperti ini.',
  service:'Layanan ramai: alamat yang memproses ratusan sampai ribuan transaksi per hari, misalnya hot wallet exchange, hub aplikasi trading, atau relayer. Uang banyak orang bercampur di sini, jadi pemilik alamat ini bukan pelaku dan jejak on-chain biasanya berhenti. Langkah berikutnya ada di luar blockchain: laporan ke layanan tersebut.',
  relayer:'Relayer: alamat lain membayar ongkos transaksi (gas) wallet ini dan ikut menandatanganinya. Ini dipakai aplikasi trading privat, bot trading, dan wallet tanpa gas. Akibatnya wallet tersebut sering cuma akun sementara buatan layanan, dan jejak pemilik aslinya ada di setoran/penarikan ke layanan itu.',
  cospend:'Common-input ownership (khusus Bitcoin): kalau beberapa alamat dibelanjakan bersama dalam satu transaksi, pengirimnya harus memegang kunci semua alamat itu, jadi biasanya semuanya milik satu wallet. Pengecualian: CoinJoin, transaksi yang sengaja menggabungkan banyak orang.',
  risky:'Wallet di graph pernah bertransaksi langsung dengan alamat yang tercatat di database sebagai hacker, phishing, mixer, atau tersanksi.',
};

function who(a){
  const n=S.nodes.get(a), nm=nameOf(a);
  const cat=n&&n._cat;
  if(cat) return `<b>${esc(nm)}</b> <span class="muted">(${CAT_NAME[cat]})</span>`;
  return nm===short(a)?`wallet <span class="mono">${short(a)}</span>`:`<b>${esc(nm)}</b>`;
}
const whoLink=a=>`<span class="cp" data-sel="${a}">${who(a)}</span>`;
const money=e=>`<b>${fmtNum(e.amount)} ${esc(e.sym)}</b>${e.usd?` <span class="muted">${fmtUsd(e.usd)}</span>`:''}`;
function dur(sec){
  if(sec<60) return 'kurang dari 1 menit';
  if(sec<3600) return Math.round(sec/60)+' menit';
  if(sec<86400) return Math.round(sec/3600)+' jam';
  return Math.round(sec/86400)+' hari';
}

function edgeScore(e,maxBy){ return e.usd!=null?e.usd:e.amount/(maxBy[e.sym]||1); }

function buildStory(){
  const edges=S._edges||[];
  if(!S.nodes.size) return '<p class="muted">Belum ada case.</p>';
  const out=new Map(), inc=new Map(), maxBy={};
  for(const e of edges){
    (out.get(e.from)||out.set(e.from,[]).get(e.from)).push(e);
    (inc.get(e.to)||inc.set(e.to,[]).get(e.to)).push(e);
    maxBy[e.sym]=Math.max(maxBy[e.sym]||0,e.amount);
  }
  const sortE=list=>(list||[]).slice().sort((a,b)=>edgeScore(b,maxBy)-edgeScore(a,maxBy));
  const P=[];
  P.push(`<p>Kamu sedang menyelidiki ${S.roots.map(whoLink).join(', ')} di jaringan <b>${esc(chainInfo().chainname)}</b>. Tool sudah membaca <b>${S.tx.size}</b> transfer dan memetakan <b>${cy.nodes().length}</b> alamat.</p>`);

  const endings=[];
  for(const r of S.roots){
    const ins=sortE(inc.get(r)).slice(0,3);
    if(ins.length){
      const first=(inc.get(r)||[]).slice().sort((a,b)=>a.first-b.first)[0];
      P.push(`<p><b>Dari mana uangnya?</b> Dana masuk terbesar ke ${who(r)} berasal dari: ${ins.map(e=>`${whoLink(e.from)} (${money(e)}, ${fmtDate(e.first)})`).join('; ')}. Pengirim paling awal yang terlihat: ${whoLink(first.from)} pada ${fmtDate(first.first)}.</p>`);
    }
    // follow the largest outgoing flows
    const lines=[], seen=new Set([r]);
    const walk=(a,depth,arrivedAt)=>{
      const outs=sortE(out.get(a)).filter(e=>!seen.has(e.to)).slice(0,depth===0?3:2);
      if(!outs.length){
        const n=S.nodes.get(a);
        if(depth>0){
          let end;
          if(n._cat==='cex') end='✅ <b>berakhir di exchange</b>. Ini titik keluar yang bisa dilaporkan.';
          else if(n._cat==='mixer') end='⚠ <b>masuk mixer</b>, jejaknya terputus di sini.';
          else if(n._cat==='bridge') end='↗ <b>menyeberang ke chain lain</b> lewat bridge.';
          else if(n._cat==='dex') end='🔄 <b>ditukar di DEX</b>. Ikuti token hasil tukarnya.';
          else if(['hack','scam','sanction','suspect'].includes(n._cat)) end='⛔ masuk alamat berisiko tinggi.';
          else if(!n.expanded) end='❔ <b>belum ditelusuri</b>. Klik node ini lalu Expand.';
          else end='💰 berhenti di sini: dana masih disimpan atau dikirim ke alamat yang belum tampil.';
          lines.push(`<div class="li" style="padding-left:${depth*14}px">${end}</div>`);
          endings.push({a,cat:n._cat||(n.expanded?'hold':'open')});
        }
        return;
      }
      for(const e of outs){
        seen.add(e.to);
        const wait=arrivedAt&&e.first>=arrivedAt?` <span class="muted">(${dur(e.first-arrivedAt)} setelah dana masuk)</span>`:'';
        lines.push(`<div class="li" style="padding-left:${depth*14}px">→ ${fmtDate(e.first)}: ${money(e)}${e.count>1?` dalam ${e.count} transfer`:''} dikirim ke ${whoLink(e.to)}${wait}</div>`);
        if(depth<6) walk(e.to,depth+1,e.last);
      }
    };
    walk(r,0,null);
    if(lines.length) P.push(`<p><b>Ke mana uangnya pergi?</b> Mengikuti aliran terbesar dari ${who(r)}:</p><div class="story-flow">${lines.join('')}</div>`);
    else if(S.nodes.get(r).expanded) P.push(`<p>${who(r)} belum mengirim dana ke alamat lain yang terlihat di graph.</p>`);
  }

  const cnt=k=>endings.filter(x=>x.cat===k).length;
  const ends=[];
  if(cnt('cex')) ends.push(`<b>${cnt('cex')}</b> jalur berakhir di exchange`);
  if(cnt('mixer')) ends.push(`<b>${cnt('mixer')}</b> masuk mixer`);
  if(cnt('bridge')) ends.push(`<b>${cnt('bridge')}</b> menyeberang lewat bridge`);
  if(cnt('open')) ends.push(`<b>${cnt('open')}</b> belum ditelusuri`);
  if(ends.length) P.push(`<p><b>Ringkasnya:</b> ${ends.join(', ')}.</p>`);

  const key=A.findings.filter(f=>f.sev==='high'||f.sev==='med').slice(0,6);
  if(key.length) P.push(`<p><b>Apa yang mencurigakan?</b></p>`+key.map(f=>`<div class="explain"><b>${esc(f.title)}</b><div>${esc(f.detail||'')}</div>${GLOSSARY[f.type]?`<div class="muted">Artinya: ${esc(GLOSSARY[f.type])}</div>`:''}</div>`).join(''));
  else P.push('<p><b>Apa yang mencurigakan?</b> Belum ada pola mencurigakan dari data yang sudah ditarik.</p>');

  if(A.steps.length) P.push(`<p><b>Yang bisa kamu lakukan sekarang:</b></p><ol>${A.steps.slice(0,5).map(s=>`<li>${esc(s.text)}</li>`).join('')}</ol>`);
  P.push('<p class="muted" style="font-size:11.5px">Cerita ini disusun otomatis dari data on-chain dan heuristik, bukan kesimpulan pasti. Nilai dolar adalah perkiraan memakai harga saat ini.</p>');

  const tl=edges.slice().sort((a,b)=>a.first-b.first).slice(0,300).map(e=>`<tr><td class="muted">${fmtDate(e.first)}</td><td>${whoLink(e.from)} → ${whoLink(e.to)}</td><td class="r">${fmtNum(e.amount)} ${esc(e.sym)}${e.count>1?`<div class="muted">${e.count}×</div>`:''}</td></tr>`).join('');
  return `<div class="card story">${P.join('')}</div><div class="card"><h3>Timeline (urut waktu)</h3><table>${tl||'<tr><td class="muted">—</td></tr>'}</table></div>`;
}
function renderStory(){ $('tab_story').innerHTML=buildStory(); }
