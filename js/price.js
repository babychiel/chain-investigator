"use strict";
// Rough USD values: stablecoins at $1, a few majors at today's CoinGecko price.
// Current price, not the price at transaction time, and only for the dominant contract of a symbol
// (fake tokens often copy symbols like "USDT").
const STABLE_RE=/^(USDC|USDT|DAI|USDT0|USD₮0|USDe|PYUSD|FDUSD|TUSD|USDC\.e|USDbC|USDS|BUSD|USDP|GUSD|LUSD|crvUSD|GHO|USDB|USDT\.e|DOLA|RLUSD)$/i;
const CG_ID={SOL:'solana',wSOL:'solana',ETH:'ethereum',WETH:'ethereum',stETH:'ethereum',BNB:'binancecoin',WBNB:'binancecoin',POL:'polygon-ecosystem-token',WPOL:'polygon-ecosystem-token',
  MATIC:'polygon-ecosystem-token',AVAX:'avalanche-2',WAVAX:'avalanche-2',MNT:'mantle',CELO:'celo',HYPE:'hyperliquid',SEI:'sei-network',APE:'apecoin',
  BTC:'bitcoin',WBTC:'wrapped-bitcoin',cbBTC:'coinbase-wrapped-btc',BTCB:'bitcoin',xDAI:'xdai',ARB:'arbitrum',OP:'optimism',LINK:'chainlink',UNI:'uniswap'};
// Official contracts of the most-copied stablecoins. Without this, a fake "USDC" that shows up more often than the
// real one in a case would be treated as the real one (and priced), and the real one flagged as fake.
const CANONICAL={
  sol:{USDC:'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',USDT:'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',wSOL:'So11111111111111111111111111111111111111112'},
  1:{USDC:'0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',USDT:'0xdac17f958d2ee523a2206206994597c13d831ec7'},
  56:{USDC:'0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',USDT:'0x55d398326f99059ff775485246999027b3197955'},
  8453:{USDC:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'},
  42161:{USDC:'0xaf88d065e77c8cc2239327c5edb3a432268e5831',USDT:'0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9'},
  137:{USDC:'0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',USDT:'0xc2132d05d31c914a87c6611c10748aeb04b58e8f'},
  10:{USDC:'0x0b2c639c533813f4aa9d7837caf62653d097ff85',USDT:'0x94b008aa00579c1307b0ef2c499ad98a8ce58e58'},
};
const Prices={
  p:store.get('ci_prices',{}),
  async load(){
    if(this.p._t&&Date.now()-this.p._t<30*60e3) return;
    try{
      const ids=[...new Set(Object.values(CG_ID))].join(',');
      const j=await (await fetch('https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids='+ids)).json();
      const p={_t:Date.now()}; for(const k in j) p[k]=j[k].usd;
      this.p=p; store.set('ci_prices',p); scheduleRender();
    }catch(e){ /* offline or rate-limited: values stay unknown */ }
  },
  dominant:{},
  // most-used contract per symbol among fetched transfers
  refresh(){
    const c={};
    for(const t of S.tx.values()){ if(t.token==='native') continue; c[t.sym]=c[t.sym]||{}; c[t.sym][t.token]=(c[t.sym][t.token]||0)+1; }
    this.dominant={}; this.duplicates=[];
    const canon=CANONICAL[S.chainId]||{};
    for(const s in c){
      const e=Object.entries(c[s]).sort((a,b)=>b[1]-a[1]);
      const off=canon[s];
      this.dominant[s]=off||e[0][0];
      if(e.length>1||(off&&e[0][0]!==off)){
        const list=e.map(x=>x[0]); if(off) list.sort((a,b)=>(b===off)-(a===off));
        this.duplicates.push({sym:s,contracts:list,official:off&&list.includes(off)?off:'',offMissing:!!off&&!list.includes(off)});
      }
    }
  },
  usd(sym,amount,token){
    if(token&&token!=='native'&&this.dominant[sym]&&this.dominant[sym]!==token) return null;
    if(STABLE_RE.test(sym)) return amount;
    const id=CG_ID[sym]; return id&&this.p[id]?amount*this.p[id]:null;
  },
};
function fmtUsd(v){
  if(v==null||!isFinite(v)) return '';
  if(v>=1e6) return '≈$'+(v/1e6).toFixed(2)+' jt';
  if(v>=1e3) return '≈$'+Math.round(v).toLocaleString('en-US');
  return '≈$'+v.toFixed(v<1?2:0);
}
