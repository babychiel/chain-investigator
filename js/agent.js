"use strict";
// Co-case agent: Claude with tools that read and drive the investigation graph.
// Runs in the browser with the user's own Anthropic API key (stored locally only).
const SDK_URL='https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';
const AGENT_MODEL='claude-opus-5-5';

const AGENT_SYSTEM=`You are the investigation co-pilot inside Chain Investigator, a personal on-chain forensics tool for EVM chains (data: Etherscan API V2), Solana (data: Helius; addresses are case-sensitive, counterparties may be program-owned accounts such as DEX pools; a wallet whose fees are paid by another address is likely a temporary account of a relayer-based service) and Bitcoin (data: mempool.space; UTXO model: transfers from multi-input transactions are pro-rata estimates, addresses spent together in one transaction are likely one owner unless it is a CoinJoin). The user is an independent investigator without access to commercial platforms like TRM or Chainalysis. They are not technical and don't read raw blockchain data, so you are their translator: explain what happened in plain everyday language (who sent how much to whom, when, and what it means), avoid jargon or explain it in one simple sentence, and lead with the conclusion. Reply in the user's language (usually Indonesian).

Your tools let you read the case graph, expand addresses, run multi-hop traces, read the heuristic findings, label addresses and focus the graph. Work like a careful analyst:
- Follow the money toward custodial exit points (centralized exchanges, OTC desks, payment processors), because those hold KYC records and make a case actionable. Flag bridges (funds left this chain: name the bridge and tell the user to open the tx on the explorer to find the destination chain and address) and mixers.
- Attribution comes from: a bundled public label database (eth-labels: ~95k Etherscan-family name tags incl. exchange hot wallets and exchange deposit addresses; OFAC sanctioned addresses; ScamSniffer phishing addresses), verified contract names, the user's own labels, and behavioural heuristics. It is far smaller than TRM's attribution data and has no labels for some chains (e.g. Arc); a label carried over from another chain is medium confidence. For every attribution state your confidence (high/medium/low) and the evidence. Never present a heuristic as fact and never claim to know a real person's identity.
- follow_bridge asks the bridge operators themselves (Wormhole, deBridge, Circle CCTP, THORChain, Mayan, Across, Relay, LayerZero) where a wallet's outgoing transactions went: destination chain, recipient address and destination tx. These answers are recorded facts from the bridge (high confidence) and work from EVM, Solana and Bitcoin, even when the recipient address differs. If no bridge recognises the transactions, say so; on EVM you may then fall back to same_address_guess (same address on other EVM chains, low–medium confidence).
- Use identify_address for any address you want to check (exchange? sanctioned? phishing? contract?), even if it is not in the graph.
- Don't trace through DEX routers, pool managers, exchanges or other shared contracts as if the funds still belong to one owner; follow the swap output in the same transaction instead.
- Etherscan calls are rate-limited, so expand selectively and prefer trace_funds with modest hops/branches. Say briefly what you are about to do before long operations.
- Write addresses and tx hashes in full so the interface can link them.
- Teach as you go: when a concept matters (peel chain, deposit address, haircut exposure, address poisoning, EIP-7702 sweepers), explain it in a sentence or two.
- When asked for next steps, give a short prioritized list of concrete actions.
- For questions about an exchange/VASP (licensing, KYC, adverse media), use web search when it is available and cite sources; otherwise say you can't verify it.
- Findings are investigative leads, not legal conclusions. When victims are involved, remind the user to report to the exchange and the police with the tx hashes.`;

const CATEGORY_COLOR={suspect:'#e5484d',mixer_bridge:'#f76b15',exchange:'#30a46c',important:'#ffd166',irrelevant:'#6b7280',none:''};
const addrProp={type:'string',description:'Address on the current chain: EVM 0x + 40 hex, or a Solana base58 address (case-sensitive)'};
const AGENT_TOOLS=[
  {name:'get_case_overview',description:'Overview of the current case: chain, seed addresses, node/edge counts, labeled and highest-risk addresses, largest flows, and how many findings exist. Call this first when you need context.',
    input_schema:{type:'object',properties:{},additionalProperties:false}},
  {name:'get_address',description:'Details for one address in the graph: type (EOA/contract/7702), verified contract name, user label, category, risk score with reasons, exposure to the source, inflow/outflow per token, top counterparties, related findings, and whether it has been expanded.',
    input_schema:{type:'object',properties:{address:addrProp},required:['address'],additionalProperties:false}},
  {name:'get_transfers',description:'Individual transfers involving an address (newest first) with tx hash, direction, counterparty, amount, token and time.',
    input_schema:{type:'object',properties:{address:addrProp,limit:{type:'integer',description:'Max rows, default 40, max 150'}},required:['address'],additionalProperties:false}},
  {name:'expand_address',description:'Fetch the transfers of an address from Etherscan and add its main counterparties to the graph. Costs 3 API calls.',
    input_schema:{type:'object',properties:{address:addrProp},required:['address'],additionalProperties:false}},
  {name:'trace_funds',description:'Automatically follow funds over multiple hops. forward = where money went, backward = where it came from. Stops at contracts, DEXes, bridges, mixers and exchanges. Each expanded address costs ~3 API calls (max 40 per trace).',
    input_schema:{type:'object',properties:{address:addrProp,direction:{type:'string',enum:['forward','backward']},hops:{type:'integer',description:'1-6, default 3'},branches:{type:'integer',description:'Counterparties followed per hop, 1-5, default 2'},oldest_first:{type:'boolean',description:'Use the oldest transactions (good for finding the original funder)'}},required:['address','direction'],additionalProperties:false}},
  {name:'get_findings',description:'Heuristic findings for the whole case: exit points, deposit-address patterns, peel chains, pass-through hops, fan-out, swaps, bridges, mixers, address poisoning, the graph review (possible tracing mistakes) and suggested next steps.',
    input_schema:{type:'object',properties:{},additionalProperties:false}},
  {name:'label_address',description:'Set a label and category on an address. The label is saved to the user\'s label database. Only label with evidence; include your confidence in the label text when it is not certain, e.g. "Kemungkinan deposit Binance (medium)".',
    input_schema:{type:'object',properties:{address:addrProp,label:{type:'string'},category:{type:'string',enum:['suspect','mixer_bridge','exchange','important','irrelevant','none']}},required:['address','label','category'],additionalProperties:false}},
  {name:'identify_address',description:'Identify any EVM address on the current chain, even if it is not in the graph: label from the public database (exchange, exchange deposit address, sanctioned, phishing, exploiter, bridge, protocol), OFAC/phishing screening result, and whether it is a wallet (EOA), a contract (with verified name) or an EIP-7702 delegated wallet. Costs 1-2 API calls.',
    input_schema:{type:'object',properties:{address:addrProp},required:['address'],additionalProperties:false}},
  {name:'follow_bridge',description:'For an address in the graph, ask the bridge operators (Wormhole, deBridge, Circle CCTP, THORChain, Mayan, Across, Relay, LayerZero) where its outgoing transactions went: destination chain, recipient and destination tx. Works on EVM, Solana and Bitcoin. Checks up to 12 outgoing transactions plus the wallet\'s full Relay history.',
    input_schema:{type:'object',properties:{address:addrProp},required:['address'],additionalProperties:false}},
  {name:'same_address_guess',description:'EVM only, fallback when follow_bridge finds nothing: look for the same address on ~15 other EVM chains receiving a similar amount within 6 hours after a bridge transfer. A guess with confidence levels, not bridge data. Costs ~5 API calls per chain.',
    input_schema:{type:'object',properties:{address:addrProp},required:['address'],additionalProperties:false}},
  {name:'add_to_graph',description:'Add an address that appears in the fetched transfers (or a finding) to the graph without expanding it.',
    input_schema:{type:'object',properties:{address:addrProp},required:['address'],additionalProperties:false}},
  {name:'focus_address',description:'Select and center an address on the user\'s graph, optionally highlighting the directed path from the seed.',
    input_schema:{type:'object',properties:{address:addrProp,show_path_from_seed:{type:'boolean'}},required:['address'],additionalProperties:false}},
];

const Agent={
  messages:[], log:[], busy:false, client:null, webSearch:store.get('ci_websearch',false),

  init(){
    $('agentSend').onclick=()=>this.send();
    $('agentInput').addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); this.send(); } });
    $('agentWeb').checked=this.webSearch;
    $('agentWeb').onchange=e=>{ this.webSearch=e.target.checked; store.set('ci_websearch',this.webSearch); };
    $('agentReset').onclick=()=>{ if(confirm('Mulai percakapan baru dengan agent?')){ this.reset(); Audit.log('user','agent reset',''); } };
    document.querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>{ $('agentInput').value=b.dataset.q; this.send(); });
  },
  reset(){ this.messages=[]; this.log=[]; this.renderPanel(); },
  serialize(){ return {messages:this.messages,log:this.log}; },
  load(d){ this.messages=(d&&d.messages)||[]; this.log=(d&&d.log)||[]; this.renderPanel(); },

  async getClient(){
    const key=store.get('ci_akey','');
    if(!key){ openKey(); throw new Error('Isi Anthropic API key dulu (tombol 🔑).'); }
    if(!this.client){
      const mod=await import(SDK_URL);
      this.Anthropic=mod.default;
      this.client=new this.Anthropic({apiKey:key,dangerouslyAllowBrowser:true});
    }
    return this.client;
  },

  push(kind,text){ this.log.push({kind,text}); this.renderLog(); },

  async send(){
    const text=$('agentInput').value.trim();
    if(!text||this.busy) return;
    if(!store.get('ci_akey','')){ // no paid API key: offer the subscription routes instead
      this.push('user',text);
      this.push('choice',text);
      $('agentInput').value='';
      return;
    }
    if(!S.nodes.size&&!/^(apa|bagaimana|jelaskan|what|how|explain)/i.test(text)){ /* allow concept questions without a case */ }
    $('agentInput').value='';
    this.busy=true; this.setBusy(true);
    this.push('user',text);
    Audit.log('user','agent prompt',text);
    const ctx=`[Konteks UI] chain=${chainInfo().chainname}; seed=${S.roots.join(',')||'-'}; node terpilih=${selected||'-'}; node di graph=${S.nodes.size}`;
    this.messages.push({role:'user',content:[{type:'text',text:ctx},{type:'text',text}]});
    try{ await this.loop(); }
    catch(err){ this.push('error',this.describeError(err)); Audit.log('system','agent error',String(err.message||err)); }
    finally{ this.busy=false; this.setBusy(false); autosave(); }
  },

  describeError(err){
    const A=this.Anthropic;
    if(A){
      if(err instanceof A.AuthenticationError) return 'Anthropic API key tidak valid. Periksa lewat tombol 🔑.';
      if(err instanceof A.PermissionDeniedError) return 'API key tidak punya akses ke model ini.';
      if(err instanceof A.RateLimitError) return 'Terkena rate limit Anthropic. Tunggu sebentar lalu coba lagi.';
      if(err instanceof A.BadRequestError) return 'Permintaan ditolak API: '+err.message;
      if(err instanceof A.APIConnectionError) return 'Gagal terhubung ke Anthropic API. Cek koneksi internet.';
      if(err instanceof A.APIError) return 'Error API ('+(err.status||'?')+'): '+err.message;
    }
    return String(err.message||err);
  },

  async loop(){
    const client=await this.getClient();
    const tools=[...AGENT_TOOLS];
    if(this.webSearch) tools.push({type:'web_search_20260209',name:'web_search',max_uses:5});
    for(let turn=0;turn<25;turn++){
      const res=await client.beta.messages.create({
        model:AGENT_MODEL, max_tokens:16000, system:AGENT_SYSTEM, tools, messages:this.messages,
        output_config:{effort:'medium'},
        betas:['server-side-fallback-2026-07-01'], fallbacks:'default',
      });
      this.messages.push({role:'assistant',content:res.content});
      for(const b of res.content){
        if(b.type==='text'&&b.text.trim()) this.push('assistant',b.text);
        else if(b.type==='server_tool_use') this.push('tool',`🔎 web search: ${b.input&&b.input.query||''}`);
      }
      const uses=res.content.filter(b=>b.type==='tool_use');
      if(res.stop_reason==='pause_turn') continue;
      if(res.stop_reason==='tool_use'){
        const results=[];
        for(const u of uses){
          this.push('tool',`🔧 ${u.name}(${this.argText(u.input)})`);
          Audit.log('agent','tool: '+u.name,JSON.stringify(u.input));
          try{
            const out=await this.exec(u.name,u.input||{});
            let s=JSON.stringify(out); if(s.length>14000) s=s.slice(0,14000)+'…(dipotong)';
            results.push({type:'tool_result',tool_use_id:u.id,content:s});
          }catch(err){
            results.push({type:'tool_result',tool_use_id:u.id,content:'Error: '+(err.message||err),is_error:true});
          }
        }
        this.messages.push({role:'user',content:results});
        continue;
      }
      // any unanswered tool calls (e.g. cut off by max_tokens) must still get a result before the next turn
      if(uses.length) this.messages.push({role:'user',content:uses.map(u=>({type:'tool_result',tool_use_id:u.id,content:'Dibatalkan.',is_error:true}))});
      if(res.stop_reason==='refusal') this.push('error','Permintaan ini ditolak oleh model.');
      else if(res.stop_reason==='max_tokens') this.push('error','Jawaban terpotong (batas token). Minta agent melanjutkan.');
      const final=res.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
      if(final) Audit.log('agent','jawaban',final.slice(0,1500));
      return;
    }
    this.push('error','Agent berhenti setelah 25 langkah. Minta lanjutkan kalau perlu.');
  },

  argText(i){ return Object.entries(i||{}).map(([k,v])=>`${k}=${typeof v==='string'&&isAddr(v)?short(v):JSON.stringify(v)}`).join(', '); },

  needNode(a){
    if(!isAddr(a)) throw new Error('Alamat tidak valid: '+a);
    const n=S.nodes.get(norm(a));
    if(!n||n.hidden) throw new Error('Alamat belum ada di graph. Expand alamat terdekat atau jalankan trace dulu.');
    return n;
  },

  async exec(name,i){
    const nodes=()=>[...S.nodes.values()].filter(n=>!n.hidden);
    const brief=n=>({address:n.addr,label:n.label||null,database_label:n.db?`${n.db.name} (${DB_CAT_NAME[n.db.cat]})`:null,contract_name:n.autoLabel||null,type:n.kind||'unknown',category:n._cat||null,risk:n._risk||0,expanded:n.expanded});
    switch(name){
      case 'get_case_overview':{
        if(!S.nodes.size) return {case:'kosong. Minta user memasukkan alamat seed.'};
        const edges=(S._edges||[]).slice().sort((a,b)=>b.w-a.w).slice(0,25);
        return {chain:chainInfo().chainname,native:nativeSym(),seeds:S.roots,nodes:nodes().length,edges:(S._edges||[]).length,transfers_fetched:S.tx.size,
          exposure_source:A.sourceName,
          labeled:nodes().filter(n=>n.label||n.autoLabel).map(brief).slice(0,40),
          highest_risk:nodes().filter(n=>n._risk>0).sort((a,b)=>b._risk-a._risk).slice(0,15).map(n=>({...brief(n),reasons:n._why})),
          largest_flows:edges.map(e=>({from:e.from,to:e.to,amount:+e.amount.toPrecision(8),token:e.sym,transfers:e.count,first:new Date(e.first*1000).toISOString(),last:new Date(e.last*1000).toISOString()})),
          findings:A.findings.length,review_issues:A.review.length,unexpanded:nodes().filter(n=>!n.expanded).length};
      }
      case 'get_address':{
        const n=this.needNode(i.address), a=n.addr;
        const txs=[...S.tx.values()].filter(t=>!t.spam&&(t.from===a||t.to===a));
        const sums={}; for(const t of txs){const d=t.from===a?'out':'in'; sums[t.sym]=sums[t.sym]||{in:0,out:0}; sums[t.sym][d]+=t.amount;}
        const cps=rankCounterparties(a,txs).slice(0,15).map(c=>({address:c.addr,label:nameOf(c.addr),in_graph:S.nodes.has(c.addr),transfers:c.n,received_from_it:c.in,sent_to_it:c.out}));
        return {...brief(n),delegate_7702:n.delegate||null,proxy_impl:n.impl||null,notes:n.notes||null,risk_reasons:n._why,
          exposure_pct:Math.round((n._exposure||0)*100),exposure_source:A.sourceName,is_seed:S.roots.includes(a),
          transfers_fetched:n.txCount||0,data_truncated:!!n.truncated,hidden_counterparties:n.hiddenCps.length,
          totals:sums,top_counterparties:cps,related_findings:A.findings.filter(f=>f.addrs.includes(a)).map(f=>({severity:f.sev,title:f.title,detail:f.detail}))};
      }
      case 'get_transfers':{
        const n=this.needNode(i.address), a=n.addr, lim=Math.min(150,Math.max(1,i.limit||40));
        return [...S.tx.values()].filter(t=>!t.spam&&(t.from===a||t.to===a)).sort((x,y)=>y.ts-x.ts).slice(0,lim)
          .map(t=>({time:new Date(t.ts*1000).toISOString(),dir:t.from===a?'out':'in',counterparty:t.from===a?t.to:t.from,counterparty_label:nameOf(t.from===a?t.to:t.from),amount:t.amount,token:t.sym,kind:t.kind,tx:t.hash}));
      }
      case 'expand_address':{
        if(!isAddr(i.address)) throw new Error('Alamat tidak valid.');
        const a=norm(i.address);
        if(!S.nodes.has(a)){ ensureNode(a,0); }
        const n=await expand(a,{silent:true,actor:'agent'});
        if(n.errs&&n.errs.length&&!n.expanded) throw new Error(n.errs[0]);
        return {address:a,transfers:n.txCount,truncated:!!n.truncated,hidden_counterparties:n.hiddenCps.length,graph_nodes:S.nodes.size};
      }
      case 'trace_funds':{
        const n=this.needNode(i.address);
        const hops=Math.min(6,Math.max(1,i.hops||3)), per=Math.min(5,Math.max(1,i.branches||2));
        const r=await trace(n.addr,i.direction==='backward'?'in':'out',hops,per,{sort:i.oldest_first?'asc':undefined,actor:'agent',playbook:'agent'});
        return {...r,stoppedAt:r.stoppedAt.map(a=>({address:a,label:nameOf(a),category:(S.nodes.get(a)||{})._cat||null})),
          new_findings:A.findings.filter(f=>f.sev==='high'||f.type==='deposit').map(f=>f.title)};
      }
      case 'get_findings':
        return {findings:A.findings.map(f=>({severity:f.sev,type:f.type,title:f.title,detail:f.detail,addresses:f.addrs.slice(0,10),advice:f.step})),
          review:A.review.map(r=>({severity:r.sev,title:r.title,detail:r.detail,addresses:r.addrs.slice(0,10)})),next_steps:A.steps.map(s=>s.text)};
      case 'label_address':{
        const n=this.needNode(i.address);
        if(!(i.category in CATEGORY_COLOR)) throw new Error('Kategori tidak dikenal.');
        n.label=String(i.label||'').slice(0,80); n.color=CATEGORY_COLOR[i.category];
        saveLabel(n); Audit.log('agent','label',`${n.addr} = "${n.label}" (${i.category})`); render();
        return {ok:true,address:n.addr,label:n.label,category:i.category};
      }
      case 'identify_address':{
        if(!isAddr(i.address)) throw new Error('Alamat tidak valid.');
        const a=norm(i.address);
        const n=S.nodes.get(a)||{addr:a,kind:''};
        if(!n.kind) await identifyOne(n);
        const db=Labels.lookup(a);
        return {address:a,in_graph:S.nodes.has(a),type:n.kind||'unknown',contract_name:n.autoLabel||null,delegate_7702:n.delegate||null,
          database_label:db?{name:db.name,category:DB_CAT_NAME[db.cat],from_other_chain:db.cross?Labels.chainName(db.chain):null}:null,
          ofac_sanctioned:!!(db&&db.cat==='S'),phishing_or_hacker:!!(db&&'PH'.includes(db.cat)),user_label:(S.labels[labelKey(a)]||{}).label||null};
      }
      case 'follow_bridge':{
        const n=this.needNode(i.address);
        const r=await Bridges.scanAddress(n.addr,{actor:'agent'});
        Bridges.render(r,`Lacak bridge: ${nameOf(n.addr)}`);
        return {transactions_checked:r.checkedTx,errors:r.errors.slice(0,5),
          transfers:r.hits.slice(0,25).map(h=>({bridge:h.bridge,status:h.status,destination_chain:Bridges.chainName(h.dstChain,h.dstName),destination_chain_id:h.dstChain,
            recipient:h.recipient,amount:h.amount!=null?`${h.amount} ${h.sym}`:null,source_tx:h.srcTx,destination_tx:h.dstTx,
            sent:h.leg?`${h.leg.amount} ${h.leg.sym} at ${new Date(h.leg.ts*1000).toISOString()}`:null,
            continue_url:h.dstChain&&h.recipient?Bridges.openUrl(h.dstChain,{addr:h.recipient}):null}))};
      }
      case 'same_address_guess':{
        const n=this.needNode(i.address);
        const r=await XChain.search(n.addr,{actor:'agent'});
        XChain.render(r);
        return {chains_checked:r.chainsChecked,bridge_transfers:r.legs,errors:r.errors.slice(0,5),
          matches:r.matches.slice(0,10).map(m=>({chain:Labels.chainName(m.chain),chain_id:m.chain,confidence:m.conf,direction:m.leg.dir==='out'?'left via bridge, arrived on that chain':'came from that chain via bridge',
            bridged:`${m.leg.amount} ${m.leg.sym}`,matched:`${m.row.amount} ${m.row.sym}`,delay_minutes:Math.round(m.dt/60),tx:m.row.hash,
            continue_url:XChain.openUrl(m.chain,m.addr)}))};
      }
      case 'add_to_graph':{
        if(!isAddr(i.address)) throw new Error('Alamat tidak valid.');
        const a=norm(i.address); ensureNode(a,1); Audit.log('agent','tambah ke graph',a); render();
        if(S.settings.autoId) identify([S.nodes.get(a)]);
        return {ok:true,address:a,label:nameOf(a)};
      }
      case 'focus_address':{
        const n=this.needNode(i.address);
        focusNode(n.addr);
        const path=i.show_path_from_seed?highlightPath(n.addr):null;
        return {focused:n.addr,path:path};
      }
    }
    throw new Error('Tool tidak dikenal: '+name);
  },

  setBusy(b){ $('agentSend').disabled=b; $('agentSend').textContent=b?'…':'Kirim'; $('agentStatus').style.display=b?'block':'none'; },

  renderPanel(){ $('agentWeb').checked=this.webSearch; this.renderLog(); },
  renderLog(){
    const el=$('agentLog'); if(!el) return;
    if(!this.log.length){
      el.innerHTML=store.get('ci_akey','')
        ?`<div class="muted" style="padding:6px 2px">Tanya apa saja tentang case ini. Agent bisa membaca graph, expand alamat, menjalankan trace multi-hop, memberi label, dan menjelaskan temuan beserta alasannya. (Memakai Anthropic API key-mu.)</div>`
        :`<div class="msg bot">${SUBSCRIPTION_HELP}<div class="btns"><button class="small primary" data-brief="">📋 Salin ringkasan case</button></div></div>`;
      return;
    }
    el.innerHTML=this.log.map(m=>{
      if(m.kind==='user') return `<div class="msg user">${esc(m.text)}</div>`;
      if(m.kind==='tool') return `<div class="msg tool">${esc(m.text)}</div>`;
      if(m.kind==='error') return `<div class="msg err">${esc(m.text)}</div>`;
      if(m.kind==='choice') return `<div class="msg bot">${SUBSCRIPTION_HELP}<div class="btns"><button class="small primary" data-brief="${esc(m.text)}">📋 Salin ringkasan case + pertanyaan ini</button></div></div>`;
      return `<div class="msg bot">${md(m.text)}</div>`;
    }).join('');
    el.scrollTop=el.scrollHeight;
  },
};

const SUBSCRIPTION_HELP=`<b>Pakai langganan Claude kamu (tanpa biaya API tambahan):</b>
  <div class="li">1️⃣ <b>Lewat claude.ai / aplikasi Claude:</b> klik tombol di bawah untuk menyalin ringkasan case, buka chat Claude, tempel (Ctrl+V), lalu kirim. Claude akan menjelaskannya dengan bahasa sederhana.</div>
  <div class="li">2️⃣ <b>Lewat Claude Code di aplikasi Claude desktop:</b> minta Claude <i>"buka Chain Investigator di panel browser"</i>, lalu bertanya seperti biasa. Claude bisa membaca dan menjalankan tool ini langsung (expand, trace, label).</div>
  <div class="muted" style="margin-top:6px">Agent otomatis di tab ini (bisa menelusuri sendiri) butuh Anthropic API key berbayar terpisah, isi lewat tombol 🔑 kalau mau. Langganan claude.ai tidak bisa dipakai sebagai API key.</div>`;

// minimal markdown + clickable addresses / tx hashes
function md(src){
  let h=esc(src);
  h=h.replace(/```([\s\S]*?)```/g,(m,c)=>`<pre>${c}</pre>`);
  h=h.replace(/`([^`\n]+)`/g,'<code>$1</code>');
  h=h.replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>');
  h=h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  h=h.replace(/(^|[^\w\/"])(0x[0-9a-fA-F]{64})(?![0-9a-fA-F])/g,(m,p,tx)=>`${p}<a href="${explorer('tx',tx)}" target="_blank" rel="noopener" class="mono">${tx.slice(0,12)}…</a>`);
  h=h.replace(/(^|[^\w\/"])(0x[0-9a-fA-F]{40})(?![0-9a-fA-F])/g,(m,p,a)=>`${p}<span class="mono cp chip" data-sel="${a.toLowerCase()}" title="${a}">${short(a)}</span>`);
  if(isBtc()) h=h.replace(/(^|[^\w\/"=])(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})(?![\w])/g,(m,p,a)=>`${p}<span class="mono cp chip" data-sel="${a}" title="${a}">${short(a)}</span>`);
  if(isSol()) h=h.replace(/(^|[^\w\/"=])([1-9A-HJ-NP-Za-km-z]{32,44})(?![\w])/g,(m,p,a)=>/\d/.test(a)&&/[A-Z]/.test(a)&&/[a-z]/.test(a)?`${p}<span class="mono cp chip" data-sel="${a}" title="${a}">${short(a)}</span>`:m);
  h=h.split('\n').map(l=>{
    if(/^#{1,4} /.test(l)) return `<div class="h">${l.replace(/^#+ /,'')}</div>`;
    if(/^\s*[-*] /.test(l)) return `<div class="li">• ${l.replace(/^\s*[-*] /,'')}</div>`;
    if(/^\s*\d+\. /.test(l)) return `<div class="li">${l.trim()}</div>`;
    return l?`<div>${l}</div>`:'<div class="sp"></div>';
  }).join('');
  return h;
}
