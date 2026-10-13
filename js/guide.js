"use strict";
// Beginner mode: a guided wizard that asks plain questions, runs the right workflow automatically
// and shows the outcome in a few sentences with obvious next actions.
const GUIDE_CHAINS=['1','56','8453','42161','137','10','5042','43114','59144','130'];
const Guide={
  goal:null,
  open(){ $('guide').style.display='flex'; this.home(); },
  close(){ $('guide').style.display='none'; store.set('ci_guide_seen',true); },
  set(html){ $('guideBody').innerHTML=html; $('guideBody').scrollTop=0; },
  home(){
    this.set(`<h2>Hai! Apa yang ingin kamu lakukan?</h2>
      <p class="g-sub">Pilih salah satu. Kamu tidak perlu paham blockchain, tool ini yang akan membacakannya untukmu.</p>
      <button class="g-choice" data-g="victim"><span>😟</span><div><b>Crypto saya dicuri / saya kena tipu</b><small>Lacak ke mana uangmu pergi dan apakah sampai ke exchange</small></div></button>
      <button class="g-choice" data-g="check"><span>🛡</span><div><b>Cek apakah sebuah wallet aman</b><small>Sebelum mengirim uang ke seseorang</small></div></button>
      <button class="g-choice" data-g="trace"><span>🔍</span><div><b>Selidiki sebuah wallet</b><small>Uangnya dari mana dan ke mana</small></div></button>
      <button class="g-choice" data-g="watch"><span>🔔</span><div><b>Kabari saya kalau wallet ini bergerak</b><small>Notifikasi saat ada transaksi baru</small></div></button>
      <p class="g-foot"><a href="#" data-g="close">Saya sudah paham, buka tampilan lengkap →</a></p>`);
  },
  needKey(next){
    if(next.chain==='btc') return false; // mempool.space needs no key
    const sol=next.chain==='sol';
    const has=sol?store.get('ci_hkey',''):store.get('ci_key','');
    if(has) return false;
    this.set(`<h2>Satu langkah persiapan (sekali saja)</h2>
      <p>Tool ini perlu "kunci" gratis supaya bisa membaca data blockchain. Caranya:</p>
      <ol class="g-steps">
        <li>Buka <a href="${sol?'https://dashboard.helius.dev/':'https://etherscan.io/register'}" target="_blank" rel="noopener"><b>${sol?'dashboard.helius.dev':'etherscan.io'}</b></a> lalu daftar akun (gratis, cukup email).</li>
        <li>${sol?'Setelah masuk, salin <b>API Key</b> yang muncul di dashboard.':'Setelah masuk, buka menu <b>API Keys</b> → klik <b>Add</b> → salin kodenya.'}</li>
        <li>Tempel di bawah ini:</li>
      </ol>
      <input id="gKey" class="g-input mono" placeholder="Tempel API key di sini">
      <div class="g-row"><button class="g-back" data-g="home">← Kembali</button><button class="g-go" id="gKeySave">Simpan & lanjut</button></div>`);
    $('gKeySave').onclick=()=>{
      const v=$('gKey').value.trim(); if(!v) return;
      store.set(sol?'ci_hkey':'ci_key',v); Audit.log('user','api key diisi',sol?'Helius':'Etherscan');
      this.run(next);
    };
    return true;
  },
  ask(goal){
    this.goal=goal;
    const q={
      victim:['Tempel alamat wallet kamu (yang uangnya hilang), atau link/hash transaksi saat uang itu terkirim.','Contoh: 0x1234… atau link dari Etherscan/Solscan'],
      check:['Tempel alamat wallet yang mau kamu cek.','Contoh: alamat yang diberikan seseorang untuk kamu kirimi uang'],
      trace:['Tempel alamat wallet yang mau diselidiki.','Bisa juga link dari explorer'],
      watch:['Tempel alamat wallet yang mau dipantau.','Kamu akan dapat notifikasi selama halaman ini terbuka'],
    }[goal];
    this.set(`<h2>${q[0]}</h2><p class="g-sub">${q[1]}</p>
      <input id="gAddr" class="g-input mono" placeholder="Tempel di sini" spellcheck="false">
      <label class="g-label">Jaringan (blockchain)</label>
      <select id="gChain" class="g-input"><option value="auto">Saya tidak tahu, deteksi otomatis</option><option value="1">Ethereum</option><option value="56">BNB Chain (BSC)</option><option value="8453">Base</option><option value="42161">Arbitrum</option><option value="137">Polygon</option><option value="10">Optimism</option><option value="5042">Arc</option><option value="sol">Solana</option><option value="btc">Bitcoin</option></select>
      <div class="g-row"><button class="g-back" data-g="home">← Kembali</button><button class="g-go" id="gGo">Mulai</button></div>`);
    $('gAddr').focus();
    const go=()=>this.start($('gAddr').value.trim(),$('gChain').value);
    $('gGo').onclick=go; $('gAddr').onkeydown=e=>{ if(e.key==='Enter') go(); };
  },
  async start(input,chainSel){
    if(!input) return;
    const btcTx=/(^|[^0-9a-fA-Fx])[0-9a-fA-F]{64}(?![0-9a-fA-F])/.test(input)&&!/0x[0-9a-fA-F]{64}/.test(input);
    const isTx=btcTx||/0x[0-9a-fA-F]{64}/.test(input)||(/[1-9A-HJ-NP-Za-km-z]{80,90}/.test(input)&&!/0x/i.test(input));
    const p=isTx?null:parseInput(input);
    if(!isTx&&!p){ this.error('Itu sepertinya bukan alamat wallet. Alamat biasanya diawali 0x (42 karakter), diawali 1, 3, atau bc1 untuk Bitcoin, atau 32–44 huruf dan angka acak untuk Solana.'); return; }
    let chain=(p&&p.chain)||(chainSel!=='auto'?chainSel:null);
    if(isTx&&/[1-9A-HJ-NP-Za-km-z]{80,90}/.test(input)&&!/0x/i.test(input)) chain='sol';
    if(btcTx) chain='btc';
    this.run({input,isTx,addr:p&&p.addr,chain:chain||(isTx?(chainSel!=='auto'?chainSel:null):null)});
  },
  async run(job){
    if(job.chain&&this.needKey(job)) return;
    if(!job.chain&&!store.get('ci_key','')){ job.chain='1'; if(this.needKey(job)) return; job.chain=null; }
    try{
      if(!job.chain){
        this.progress('Mencari di jaringan mana wallet ini aktif…');
        job.chain=job.isTx?await this.detectTxChain(job.input):await this.detectChain(job.addr);
        if(!job.chain){ this.error('Tidak ada aktivitas yang ditemukan di jaringan-jaringan utama. Coba pilih jaringannya secara manual, atau pastikan alamatnya benar.'); return; }
      }
      if(job.chain!==S.chainId){ S.chainId=job.chain; $('chain').value=job.chain; store.set('ci_chain',job.chain); }
      const g=this.goal;
      if(g==='check'){ this.progress('Memeriksa wallet…'); await this.check(job.addr); return; }
      if(g==='watch'){ await Watch.add(job.addr,job.chain); this.done(`<h2>🔔 Wallet sedang dipantau</h2><p>Kamu akan mendapat notifikasi setiap kali wallet <span class="mono">${short(job.addr)}</span> mengirim atau menerima uang, <b>selama halaman ini terbuka</b>.</p><p>Klik "Izinkan" kalau browser meminta izin notifikasi.</p>`); try{ if('Notification' in window&&Notification.permission==='default') Notification.requestPermission(); }catch(e){} return; }
      this.progress('Membaca transaksi… (bisa 10–60 detik)');
      if(job.isTx){ $('addr').value=job.input; await investigate(false); }
      else { $('addr').value=job.addr; await investigate(false); }
      if(g==='victim'||g==='trace'){
        const start=job.isTx?(this.mainReceiver()||S.roots[0]):S.roots[0];
        this.progress(g==='victim'?'Mengikuti uangmu ke wallet-wallet berikutnya…':'Menelusuri ke mana uangnya pergi…');
        if(start) await runPlaybook(g==='victim'?'scam':'exits',start).catch(()=>{});
      }
      this.result();
    }catch(err){ this.error(err.message); }
  },
  mainReceiver(){
    const best=(S._edges||[]).slice().sort((a,b)=>(b.usd||0)-(a.usd||0)||b.amount-a.amount)
      .find(e=>{const n=S.nodes.get(e.to); return n&&n.kind!=='contract';});
    return best&&best.to;
  },
  async detectChain(addr){
    if(BTC_ADDR_RE.test(addr)) return 'btc';
    if(!/^0x/i.test(addr)) return 'sol';
    for(const c of GUIDE_CHAINS){
      this.progress(`Mencari di jaringan mana wallet ini aktif… (${Labels.chainName(c)})`);
      try{ const r=await api({module:'account',action:'txlist',address:addr,page:1,offset:1,sort:'desc'},c); if(r&&r.length) return c; }catch(e){}
      try{ const r=await api({module:'account',action:'tokentx',address:addr,page:1,offset:1,sort:'desc'},c); if(r&&r.length) return c; }catch(e){}
    }
    return null;
  },
  async detectTxChain(input){
    const h=(input.match(/0x[0-9a-fA-F]{64}/)||[])[0]; if(!h) return null;
    for(const c of GUIDE_CHAINS){
      this.progress(`Mencari transaksi ini… (${Labels.chainName(c)})`);
      try{ const r=await api({module:'proxy',action:'eth_getTransactionByHash',txhash:h},c); if(r) return c; }catch(e){}
    }
    return null;
  },
  progress(msg){ this.set(`<div class="g-wait"><div class="g-spin"></div><h2>${esc(msg)}</h2><p class="g-sub">Jangan tutup halaman ini.</p></div>`); },
  error(msg){ this.set(`<h2>😕 Ada kendala</h2><p>${esc(msg)}</p><div class="g-row"><button class="g-back" data-g="home">← Mulai lagi</button></div>`); },
  done(html){ this.set(html+`<div class="g-row"><button class="g-back" data-g="home">← Menu awal</button><button class="g-go" data-g="close">Tutup</button></div>`); },
  async check(addr){
    $('screenOut').innerHTML='';
    await quickScreen(addr);
    const box=$('screenOut').cloneNode(true);
    box.querySelectorAll('.btns').forEach(b=>b.remove());
    this.done(`<h2>Hasil pengecekan</h2>${box.innerHTML}
      <p class="g-sub">Artinya: "risiko rendah" hanya berarti tidak ditemukan hubungan dengan penjahat yang sudah dikenal. Penipu baru bisa saja belum tercatat, jadi tetap hati-hati dengan tawaran yang terlalu bagus.</p>`);
  },
  result(){
    render();
    const nodes=[...S.nodes.values()].filter(n=>!n.hidden);
    const seed=S.roots[0];
    const inTo=a=>(S._edges||[]).filter(e=>e.to===a&&e.from!==a);
    const sumTxt=list=>{ const o={}; let usd=0; for(const e of list){ o[e.sym]=(o[e.sym]||0)+e.amount; usd+=e.usd||0; } return Object.entries(o).map(([s,v])=>fmtNum(v)+' '+s).join(' + ')+(usd?` (sekitar ${fmtUsd(usd).replace('≈','')})`:''); };
    const exits=nodes.filter(n=>n._cat==='cex'&&inTo(n.addr).length);
    const mixers=nodes.filter(n=>n._cat==='mixer'&&inTo(n.addr).length);
    const bridges=nodes.filter(n=>n._cat==='bridge'&&inTo(n.addr).length);
    const bad=nodes.filter(n=>['hack','scam','sanction'].includes(n._cat));
    const open=nodes.filter(n=>!n.expanded&&!TERMINAL.has(n._cat)&&n.kind!=='contract'&&n._exposure>=0.25);
    const firstOut=(S._edges||[]).filter(e=>e.from===seed).sort((a,b)=>(b.usd||0)-(a.usd||0)||b.amount-a.amount).slice(0,3);
    const L=[];
    if(firstOut.length) L.push(`<div class="g-line">💸 Dari wallet awal, uang terbesar dikirim ke ${firstOut.map(e=>`<b>${esc(nameOf(e.to))}</b> (${sumTxt([e])})`).join(', ')}.</div>`);
    for(const n of exits) L.push(`<div class="g-line good">✅ <b>Uang sampai ke exchange ${esc(nameOf(n.addr))}</b>: ${sumTxt(inTo(n.addr))}. Exchange menyimpan identitas pemilik akun, jadi ini <b>petunjuk paling penting</b>.
      <div><button class="g-mini" data-freeze="${n.addr}">📄 Buat surat laporan ke exchange ini</button></div></div>`);
    for(const n of mixers) L.push(`<div class="g-line warn">⚠ Sebagian uang masuk <b>mixer</b> (${esc(nameOf(n.addr))}): ${sumTxt(inTo(n.addr))}. Mixer mencampur uang banyak orang, jadi jejaknya sulit diikuti setelah ini.</div>`);
    for(const n of bridges) L.push(`<div class="g-line">🌉 Sebagian uang <b>dipindah ke blockchain lain</b> lewat ${esc(nameOf(n.addr))}: ${sumTxt(inTo(n.addr))}.
      ${isSol()?'':`<div><button class="g-mini" data-gx="${n.addr}">Cari di blockchain lain</button></div>`}</div>`);
    if(bad.length) L.push(`<div class="g-line warn">⛔ Ada hubungan dengan alamat yang tercatat sebagai <b>${[...new Set(bad.map(n=>CAT_NAME[n._cat].toLowerCase()))].join(', ')}</b>.</div>`);
    if(!exits.length) L.push(`<div class="g-line">🔎 <b>Belum ketemu exchange.</b> ${open.length?`Masih ada ${open.length} wallet yang belum ditelusuri.`:'Uangnya mungkin masih disimpan di wallet pelaku.'}
      ${open.length?`<div><button class="g-mini" id="gMore">Telusuri lebih jauh</button></div>`:''}</div>`);
    const steps=[];
    steps.push('Klik <b>Simpan laporan</b> di bawah. Laporan ini berisi semua bukti transaksi.');
    if(this.goal==='victim') steps.push('Bawa laporan itu ke polisi. Di Indonesia: lapor ke <b>Bareskrim Polri (Direktorat Tindak Pidana Siber)</b> atau lewat patrolisiber.id.');
    if(exits.length) steps.push('Kirim surat laporan ke exchange lewat halaman bantuan/compliance mereka, dan sertakan nomor laporan polisi. Exchange biasanya bertindak setelah ada permintaan resmi dari polisi.');
    steps.push('Klik <b>Pantau wallet pelaku</b> supaya kamu tahu kalau uangnya bergerak lagi.');
    this.set(`<h2>${this.goal==='victim'?'Ini yang terjadi dengan uangmu':'Hasil penelusuran'}</h2>
      ${L.join('')||'<div class="g-line">Belum ada perpindahan uang yang terlihat dari wallet ini.</div>'}
      <h3 class="g-h3">Apa yang bisa kamu lakukan sekarang?</h3>
      <ol class="g-steps">${steps.map(s=>`<li>${s}</li>`).join('')}</ol>
      <div class="g-row wrap">
        <button class="g-go" id="gReport">📑 Simpan laporan</button>
        <button class="g-back" id="gWatch">🔔 Pantau wallet pelaku</button>
        <button class="g-back" data-brief="">📋 Salin untuk ditanyakan ke Claude</button>
        <button class="g-back" data-g="story">📖 Baca ceritanya lengkap</button>
        <button class="g-back" data-g="close">Lihat graph</button>
      </div>
      <p class="g-sub">Ini hasil analisis otomatis dari data publik, bukan kesimpulan hukum. Masih bingung? Klik <b>Salin untuk ditanyakan ke Claude</b>, lalu tempel di chat claude.ai. Claude akan menjelaskannya untukmu.</p>`);
    $('gReport').onclick=()=>exportReport();
    $('gWatch').onclick=async()=>{
      const targets=nodes.filter(n=>!S.roots.includes(n.addr)&&!TERMINAL.has(n._cat)&&n.kind!=='contract'&&n._exposure>=0.5).sort((a,b)=>b._exposure-a._exposure).slice(0,5);
      for(const n of targets) await Watch.add(n.addr);
      $('gWatch').textContent=`🔔 ${targets.length} wallet dipantau`;
    };
    if($('gMore')) $('gMore').onclick=async()=>{
      this.progress('Menelusuri lebih jauh…');
      for(const n of open.slice(0,3)) await runPlaybook('exits',n.addr).catch(()=>{});
      this.result();
    };
  },
};

document.addEventListener('click',async e=>{
  const g=e.target.closest('[data-g]'); if(g&&$('guide').contains(g)){
    e.preventDefault();
    const v=g.dataset.g;
    if(v==='home') Guide.home();
    else if(v==='close') Guide.close();
    else if(v==='story'){ Guide.close(); setTab('story'); }
    else Guide.ask(v);
    return;
  }
  const gx=e.target.closest('[data-gx]'); if(gx){
    const sender=(S._edges||[]).find(x=>x.to===gx.dataset.gx);
    if(!sender) return;
    Guide.progress('Mencari uangnya di blockchain lain…');
    try{
      const r=await XChain.search(sender.from);
      const m=r.matches[0];
      Guide.done(m?`<h2>🌉 Ketemu!</h2><p>Uang yang masuk bridge kemungkinan <b>tiba di ${esc(Labels.chainName(m.chain))}</b>: ${fmtNum(m.row.amount)} ${esc(m.row.sym)}, sekitar ${dur(m.dt)} setelah dikirim (keyakinan ${m.conf}).</p>
        <p><a href="${XChain.openUrl(m.chain,m.addr)}" target="_blank" rel="noopener"><b>Lanjut menelusuri di ${esc(Labels.chainName(m.chain))} →</b></a></p>`
        :`<h2>Belum ketemu</h2><p>Uangnya tidak muncul di alamat yang sama di blockchain lain. Kemungkinan dikirim ke alamat berbeda. Tanyakan ke 🤖 Agent untuk bantuan selanjutnya.</p>`);
    }catch(err){ Guide.error(err.message); }
  }
});
