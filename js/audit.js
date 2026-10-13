"use strict";
// Tamper-evident audit log: each entry carries the SHA-256 of the previous one,
// so editing or deleting any past entry breaks the chain on verify().
const Audit={
  entries:[],
  chain:Promise.resolve(),
  log(actor,action,detail){
    const e={i:this.entries.length,ts:new Date().toISOString(),actor,action,detail:typeof detail==='string'?detail:JSON.stringify(detail??'')};
    this.entries.push(e);
    this.chain=this.chain.then(()=>this._seal(e));
    autosave(); renderAuditIfOpen();
  },
  async _seal(e){
    e.prev=e.i?this.entries[e.i-1].hash:'GENESIS';
    e.hash=await sha256([e.prev,e.ts,e.actor,e.action,e.detail].join('|'));
  },
  load(list){
    this.entries=(list||[]).map((e,i)=>({...e,i}));
    // entries saved before their hash resolved get sealed now, in order
    for(const e of this.entries) if(!e.hash) this.chain=this.chain.then(()=>this._seal(e));
  },
  async verify(){
    await this.chain;
    let prev='GENESIS';
    for(const e of this.entries){
      const h=await sha256([prev,e.ts,e.actor,e.action,e.detail].join('|'));
      if(e.prev!==prev||e.hash!==h) return {ok:false,at:e.i};
      prev=e.hash;
    }
    return {ok:true,n:this.entries.length,head:prev};
  },
};

async function sha256(s){
  if(window.crypto&&crypto.subtle){
    const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  let h=0x811c9dc5; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0;} // fallback: FNV-1a (not cryptographic)
  return 'fnv-'+h.toString(16);
}

function renderAuditIfOpen(){
  if(currentTab!=='audit') return;
  const rows=Audit.entries.slice().reverse().slice(0,500).map(e=>`<tr>
    <td class="muted">${new Date(e.ts).toLocaleString('id-ID',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</td>
    <td><span class="pill ${e.actor}">${e.actor}</span></td>
    <td><b>${esc(e.action)}</b><div class="muted" style="word-break:break-all">${esc(e.detail.slice(0,300))}</div></td></tr>`).join('');
  $('tab_audit').innerHTML=`<div class="card">
    <h3>Audit log</h3>
    <p class="muted" style="margin:0 0 8px">Setiap aksi (kamu, agent, dan sistem) dicatat dan dirantai dengan hash SHA-256. Kalau ada entri yang diubah atau dihapus, verifikasi akan gagal.</p>
    <div class="btns"><button class="small" id="a_verify">Verifikasi rantai</button><button class="small" id="a_export">Export log (.json)</button></div>
    <div id="a_result" class="muted" style="margin-top:6px"></div></div>
    <div class="card"><table>${rows||'<tr><td class="muted">Belum ada aktivitas.</td></tr>'}</table></div>`;
  $('a_verify').onclick=async()=>{const r=await Audit.verify(); $('a_result').innerHTML=r.ok?`<span class="in">✔ Rantai utuh: ${r.n} entri. Head: <span class="mono">${r.head.slice(0,16)}…</span></span>`:`<span class="out">✖ Rantai rusak di entri #${r.at}</span>`;};
  $('a_export').onclick=async()=>{await Audit.chain; const r=await Audit.verify(); download(`audit-log-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify({chain:chainInfo().chainname,verified:r,entries:Audit.entries},null,2),'application/json'); Audit.log('user','export','audit log');};
}
