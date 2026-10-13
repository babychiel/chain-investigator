"use strict";
// Visible progress for every long operation: a floating panel over the graph (what is happening,
// elapsed time, live detail, Cancel), a loading bar under the header, busy buttons and a pulsing node.
const Busy={
  stack:[], cancelled:false, timer:null, t0:0,
  start(title,{detail='',cancel=false,node=null}={}){
    const job={title,detail,cancel,node,id:Math.random()};
    if(!this.stack.length){ this.t0=Date.now(); this.cancelled=false; this.calls0=S.calls; }
    this.stack.push(job);
    if(node) this.pulse(node,true);
    this.show();
    return job;
  },
  end(job){
    const i=this.stack.indexOf(job); if(i>=0) this.stack.splice(i,1);
    if(job&&job.node) this.pulse(job.node,false);
    if(!this.stack.length) this.hide(); else this.show();
  },
  detail(text){ const top=this.stack[this.stack.length-1]; if(top){ top.detail=text; this.paint(); } },
  async run(title,fn,opts){ const j=this.start(title,opts); try{ return await fn(); } finally{ this.end(j); } },
  cancel(){ this.cancelled=true; this.paint(); },
  show(){
    $('busy').style.display='flex'; $('busyBar').style.display='block'; document.body.classList.add('is-busy');
    if(!this.timer) this.timer=setInterval(()=>this.paint(),500);
    this.paint();
  },
  hide(){
    $('busy').style.display='none'; $('busyBar').style.display='none'; document.body.classList.remove('is-busy');
    clearInterval(this.timer); this.timer=null;
  },
  paint(){
    const top=this.stack[this.stack.length-1]; if(!top) return;
    const sec=Math.round((Date.now()-this.t0)/1000);
    $('busyTitle').textContent=top.title;
    $('busyDetail').textContent=this.cancelled?'Membatalkan… (menunggu langkah yang sedang berjalan selesai)':top.detail;
    $('busyMeta').textContent=`${sec} detik · ${S.calls-this.calls0} permintaan data`+(sec>=20?' · data besar memang butuh waktu, tool tidak hang':'');
    $('busyCancel').style.display=this.stack.some(j=>j.cancel)&&!this.cancelled?'inline-block':'none';
  },
  // blink the node being worked on
  pulse(addr,on){
    if(!cy) return;
    const el=cy.getElementById(addr);
    if(on){ el.addClass('working'); if(!this.blink) this.blink=setInterval(()=>cy.$('.working').toggleClass('working-on'),450); }
    else { el.removeClass('working working-on'); if(!cy.$('.working').length){ clearInterval(this.blink); this.blink=null; } }
  },
};
// a clicked button shows it is working and can't be double-clicked
async function withBtn(btn,fn){
  if(btn&&btn.dataset.busy) return;
  const old=btn?btn.innerHTML:'';
  if(btn){ btn.dataset.busy='1'; btn.disabled=true; btn.innerHTML='⏳ Memproses…'; }
  try{ return await fn(); }
  catch(err){ alert(err.message||String(err)); }
  finally{ if(btn&&btn.isConnected){ btn.innerHTML=old; btn.disabled=false; delete btn.dataset.busy; } }
}
