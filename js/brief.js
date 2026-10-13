"use strict";
// "Ask Claude with your subscription": the local tool cannot use a claude.ai subscription directly,
// so we produce a self-contained case brief the user can paste into claude.ai / the Claude app,
// and document how Claude Code can drive the tool in the app's browser pane (see CLAUDE.md).
function caseBrief(question){
  render();
  const nodes=[...S.nodes.values()].filter(n=>!n.hidden);
  const edges=(S._edges||[]).slice().sort((a,b)=>a.first-b.first);
  const big=edges.slice().sort((a,b)=>(b.usd||0)-(a.usd||0)||b.amount-a.amount).slice(0,40);
  const keep=new Set(big.map(e=>e.id));
  const flows=edges.filter(e=>keep.has(e.id)).map(e=>
    `- ${fmtStamp(e.first)}: ${nameOf(e.from)} (${e.from}) → ${nameOf(e.to)} (${e.to}): ${fmtNum(e.amount)} ${e.sym}${e.usd?` (${fmtUsd(e.usd)})`:''}${e.count>1?`, ${e.count} transfer`:''}`);
  const who=nodes.filter(n=>n.label||n.db||n.autoLabel||n._risk>=30).sort((a,b)=>(b._risk||0)-(a._risk||0)).slice(0,30).map(n=>
    `- ${n.addr}: ${[n.label&&`label saya "${n.label}"`,n.db&&`database: ${n.db.name} (${DB_CAT_NAME[n.db.cat]}${n.db.cross?', dari chain lain':''})`,n.autoLabel&&`kontrak: ${n.autoLabel}`].filter(Boolean).join('; ')||'tanpa label'} · risiko ${n._risk||0}/100${n._why&&n._why.length?` (${n._why.slice(0,3).join('; ')})`:''}`);
  const finds=A.findings.slice(0,25).map(f=>`- [${f.sev}] ${f.title}${f.detail?`: ${f.detail}`:''}`);
  const text=`Saya orang awam yang sedang menyelidiki aliran dana crypto memakai tool pribadi "Chain Investigator". Di bawah ini ringkasan data case saya. Tolong jelaskan dengan bahasa sehari-hari yang sederhana (bahasa Indonesia): apa yang terjadi, uangnya ke mana, apa artinya, seberapa yakin kesimpulannya, dan apa langkah konkret yang sebaiknya saya lakukan. Jangan menganggap heuristik sebagai fakta.

${question?`Pertanyaan saya: ${question}\n\n`:''}=== CASE ===
Judul: ${S.meta.title||'-'}
Jaringan: ${chainInfo().chainname}
Wallet awal (seed): ${S.roots.join(', ')||'-'}
Catatan saya: ${S.meta.notes||'-'}
Data: ${S.tx.size} transfer dibaca (${isSol()?'Helius':isBtc()?'mempool.space':'Etherscan'}), ${nodes.length} alamat di graph. Semua waktu dalam ${tzName()}.${isBtc()?' Catatan Bitcoin: transfer dari transaksi dengan beberapa alamat input dibagi proporsional (perkiraan).':''}

=== ALIRAN DANA TERBESAR (urut waktu) ===
${flows.join('\n')||'-'}

=== ALAMAT PENTING ===
${who.join('\n')||'-'}

=== TEMUAN OTOMATIS (heuristik) ===
${finds.join('\n')||'-'}

=== SARAN LANGKAH DARI TOOL ===
${A.steps.map(s=>'- '+s.text).join('\n')||'-'}

Catatan sumber label: eth-labels (name tag explorer), daftar sanksi OFAC, ScamSniffer, label kurasi manual, ${isSol()?'Helius Wallet Identity (kalau paket Helius mendukung), pemilik program/akun token, ':''}nama kontrak terverifikasi, deteksi alamat "layanan ramai" dari jumlah transaksi, dan label buatan saya. Skor risiko hanya naik karena terkait tersangka/alamat berisiko, bukan karena menerima dana dari seed. Nilai dolar = perkiraan harga saat ini.`;
  return text.length>60000?text.slice(0,60000)+'\n…(dipotong)':text;
}
async function copyBrief(btn,question){
  if(!S.nodes.size){ alert('Belum ada case. Mulai investigasi dulu.'); return; }
  const t=caseBrief(question);
  try{ await navigator.clipboard.writeText(t); }
  catch(e){ // clipboard blocked: fall back to a download
    download('ringkasan-case-untuk-claude.txt',t,'text/plain');
  }
  Audit.log('user','salin ringkasan untuk Claude',`${t.length} karakter`);
  if(btn){ const o=btn.textContent; btn.textContent='✓ Tersalin! Tempel di claude.ai'; setTimeout(()=>btn.textContent=o,3000); }
}
