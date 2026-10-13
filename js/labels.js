"use strict";
// Lookup into the bundled public label database (js/labels-data.js, built by tools/update_labels.py).
// Categories: X exchange · D exchange deposit address · S sanctioned · M mixer · H exploiter/hacker
//             P phishing/scam · B bridge · V MEV bot · Q other named protocol/service
const DB_CAT_NAME={X:'Exchange',D:'Alamat deposit exchange',S:'Tersanksi OFAC',M:'Mixer',H:'Exploiter / hacker',P:'Phishing / scam',B:'Bridge',V:'Bot MEV',Q:'Protokol / layanan'};
// Hand-checked labels for chains the public datasets barely cover. Only add an address after confirming it in at
// least one public explorer name tag or the exchange's own disclosure; a wrong exchange label misleads a whole case.
const CURATED_LABELS={
  sol:{
    '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9':'X|Binance 2',                 // Solscan name tag
    HXsKP7wrBWaQ8T2Vtjry3Nj3oUgwYcqq9vrHDM12G664:'X|Binance 1',                   // Helius identity docs example
    '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM':'X|Binance (hot wallet)',      // Vybe labeled-wallets docs example
  },
  btc:{
    '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo':'X|Binance (cold wallet)',              // Arkham / Binance proof-of-reserves
  },
};
const CURATED_SRC='Label kurasi manual (name tag explorer / dokumentasi publik)';
const Labels={
  maps:{},
  map(chain){
    if(!this.maps[chain]){
      const m=new Map(), s=(typeof LABEL_DATA!=='undefined'&&LABEL_DATA.chains[chain])||'';
      if(s) for(const line of s.split('\n')){ const i=line.indexOf('|'); m.set(line.slice(0,i),line.slice(i+1)); }
      this.maps[chain]=m;
    }
    return this.maps[chain];
  },
  // Exact chain first, then cross-chain lists (OFAC/ScamSniffer), then the same address labeled on another
  // EVM chain — only for categories that are usually EOAs (exchange wallets, attackers), since a private key
  // controls the same address on every EVM chain while contract addresses differ.
  lookup(addr,chain=S.chainId){
    if(!addr||typeof LABEL_DATA==='undefined') return null;
    if(!/^0x[0-9a-fA-F]{40}$/.test(addr)){ // Solana / Bitcoin: no cross-chain fallback (address formats differ)
      const c=String(chain); if(c!=='sol'&&c!=='btc') return null;
      let v=this.map(c).get(addr), src='';
      if(!v&&CURATED_LABELS[c]&&CURATED_LABELS[c][addr]){ v=CURATED_LABELS[c][addr]; src=CURATED_SRC; }
      if(!v&&c==='sol'&&typeof Sol!=='undefined'&&Sol.ids[addr]){ const r=Sol.ids[addr]; v=r.cat+'|'+r.name; src='Helius Wallet Identity (database label Orb explorer)'; }
      if(!v) return null;
      const i=v.indexOf('|'); return {cat:v.slice(0,i),name:v.slice(i+1),chain:c,cross:false,src};
    }
    if(String(chain)==='sol'||String(chain)==='btc') return null;
    const a=addr.slice(2).toLowerCase();
    let v=this.map(String(chain)).get(a), from=String(chain), cross=false;
    if(!v){ v=this.map('*').get(a); from='*'; }
    if(!v) for(const c of Object.keys(LABEL_DATA.chains)){
      if(c==='sol'||c==='btc') continue;
      if(c===String(chain)||c==='*') continue;
      const x=this.map(c).get(a);
      if(x&&'XDSHPM'.includes(x[0])){ v=x; from=c; cross=true; break; }
    }
    if(!v) return null;
    const i=v.indexOf('|');
    return {cat:v.slice(0,i),name:v.slice(i+1),chain:from,cross};
  },
  chainName(id){ if(id==='*') return 'daftar lintas chain'; const c=S.chains.find(c=>c.chainid===id); return c?c.chainname:'chain '+id; },
  describe(db){
    if(!db) return '';
    return `${db.name} · ${DB_CAT_NAME[db.cat]}`+(db.cross?` (label dari ${this.chainName(db.chain)}, keyakinan sedang)`:'');
  },
};
