"""Build js/labels-data.js from public label datasets.

Sources
- eth-labels (MIT) https://github.com/dawsbot/eth-labels : ~144k labeled EVM addresses (exchanges, deposit
  addresses, exploiters, phishing, bridges, protocols) scraped from Etherscan-family explorers.
- OFAC SDN digital currency addresses https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses
- ScamSniffer phishing address blacklist (GPL-3.0, 7-day delay) https://github.com/scamsniffer/scam-database

Run:  python tools/update_labels.py
"""
import csv, io, json, os, re, sys, urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "js", "labels-data.js")

EL_URL = "https://raw.githubusercontent.com/dawsbot/eth-labels/v1/data/csv/accounts.csv"
OFAC_BASE = "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/"
OFAC_FILES = ["ETH", "USDT", "USDC", "ARB", "BSC", "ETC"]
SCAM_URL = "https://raw.githubusercontent.com/scamsniffer/scam-database/main/blacklist/address.json"

# eth-labels "label" values that are noise for investigations
NOISE = {
    "friend-tech-users", "take-action", "genesis-address", "endaoment", "nonprofit", "charity", "airdrop-hunter",
    "sybil-delegate", "delegate", "buidlguidl-builders", "retropgf-recipient", "avs-operator", "proposer-fee-recipient",
    "maker-vault-owner", "compound-governance", "binance-charity", "parity-bug", "old-contract", "deprecated",
    "token-contract", "bridged-token", "binance-pegged", "the-graph", "erc-4337-bundler", "pimlico", "token-sale",
}
CEX = re.compile(r"binance|coinbase|okx|okex|kraken|kucoin|bybit|huobi|\bhtx\b|gate\.?io|\bgate\b|mexc|bitfinex|crypto\.com|"
                 r"upbit|bithumb|gemini|indodax|tokocrypto|bitstamp|bitmart|lbank|whitebit|poloniex|bitget|deribit|bilaxy|"
                 r"bittrex|hitbtc|ascendex|bitflyer|coinone|korbit|probit|bingx|blofin|phemex|bitvavo|uphold|coincheck|"
                 r"zb\.com|coinex|hotbit|cex\.io|exmo|luno|paxos|robinhood|wazirx|btcturk|bitpanda|swissborg|nexo|"
                 r"exchange|hot wallet|cold wallet|deposit funder|otc", re.I)
CEX_LABELS = {"exchange", "fiat-gateway", "otc", "cold-wallet", "derivatives"}
DEPOSIT = re.compile(r"\bdep(osit)?\b(?!\s*funder)", re.I)
BRIDGE = re.compile(r"bridge|portal|gateway|wormhole|stargate|across|layerzero|cctp|synapse|celer|debridge|orbiter|"
                    r"hop protocol|multichain|allbridge|axelar|rhino|connext|relay|thorchain|chainflip|squid", re.I)

CURATED = [
    ("0xf70da97812CB96acDF810712Aa562db8dfA3dbEF", "B", "Relay: Solver (bridge)"),  # Etherscan name tag, 2026-10-03
    ("0x4cD00E387622C35bDDB9b4c962C136462338BC31", "B", "Relay: Depository (bridge)"),  # verified RelayDepository, same address on ETH/Arb/Base/Arc
]


def fetch(url):
    print("  download", url)
    req = urllib.request.Request(url, headers={"User-Agent": "chain-investigator"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8")


def classify(label, name):
    t = f"{label} {name}"
    if label.startswith("ofac") or name.startswith("OFAC"):
        return "S"
    if re.search(r"tornado|mixer", t, re.I):
        return "M"
    if re.search(r"exploit|heist|hack", label, re.I) or re.search(r"exploiter|hacker|attacker|heist", name, re.I):
        return "H"
    if label in {"phish-hack", "scam", "brand-infringement"} or re.search(r"fake_phishing|phish|scam|drainer", name, re.I):
        return "P"
    if label == "mev-bot":
        return "V"
    if DEPOSIT.search(name) and (CEX.search(name) or CEX.search(label)):
        return "D"
    if label in CEX_LABELS or CEX.search(label) or CEX.search(name):
        return "X"
    if BRIDGE.search(t) or label in {"bridge", "layer-2"}:
        return "B"
    return "Q"


def clean_name(name, label):
    name = (name or "").strip()
    if name.lower() in ("", "null"):
        name = label.replace("-", " ").title()
    name = re.sub(r":\s*0x[0-9a-fA-F]{3,}(\.\.\.[0-9a-fA-F]+)?$", "", name)  # "Binance Dep: 0xabc…" -> "Binance Dep"
    return name.replace("|", "/").replace("\n", " ")[:60]


def main():
    chains = {}
    stats = {}

    def put(chain, addr, cat, name):
        addr = addr.lower()
        if not re.fullmatch(r"0x[0-9a-f]{40}", addr):
            return
        prev = chains.setdefault(chain, {}).get(addr)
        # sanctions/hack/phishing outrank everything else
        if prev and "SHPM".find(prev[0]) != -1 and ("SHPM".find(cat) == -1 or "SHPM".find(prev[0]) <= "SHPM".find(cat)):
            return
        chains[chain][addr] = (cat, name)

    print("eth-labels…")
    rows = list(csv.DictReader(io.StringIO(fetch(EL_URL))))
    for r in rows:
        label = r["label"].strip()
        if label in NOISE:
            continue
        name = clean_name(r["nameTag"], label)
        if label == "blocked" and name.startswith("Null"):
            continue
        cat = classify(label, name)
        put(r["chainId"].strip(), r["address"], cat, name)
        stats[cat] = stats.get(cat, 0) + 1

    print("OFAC…")
    n_ofac = 0
    for f in OFAC_FILES:
        try:
            for line in fetch(f"{OFAC_BASE}sanctioned_addresses_{f}.txt").splitlines():
                line = line.strip()
                if line.startswith("0x"):
                    put("*", line, "S", "OFAC SDN (sanksi AS)")
                    n_ofac += 1
        except Exception as e:
            print("   skip", f, e)

    try:
        for line in fetch(f"{OFAC_BASE}sanctioned_addresses_SOL.txt").splitlines():
            line = line.strip()
            if re.fullmatch(r"[1-9A-HJ-NP-Za-km-z]{32,44}", line):
                chains.setdefault("sol", {})[line] = ("S", "OFAC SDN (sanksi AS)")
                n_ofac += 1
    except Exception as e:
        print("   skip SOL", e)

    try:
        for line in fetch(f"{OFAC_BASE}sanctioned_addresses_XBT.txt").splitlines():
            line = line.strip()
            if re.fullmatch(r"(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})", line, re.I):
                chains.setdefault("btc", {})[line.lower() if line.lower().startswith("bc1") else line] = ("S", "OFAC SDN (sanksi AS)")
                n_ofac += 1
    except Exception as e:
        print("   skip XBT", e)

    print("ScamSniffer…")
    n_scam = 0
    try:
        for a in json.loads(fetch(SCAM_URL)):
            put("*", a, "P", "ScamSniffer: phishing")
            n_scam += 1
    except Exception as e:
        print("   skip", e)

    # Hand-verified labels missing from the public datasets. Solver/relayer EOAs use the same address on every
    # EVM chain, so they go in the cross-chain list.
    for addr, cat, name in CURATED:
        put("*", addr, cat, name)

    data = {c: "\n".join(f"{a if c in ('sol', 'btc') else a[2:]}|{v[0]}|{v[1]}" for a, v in sorted(m.items())) for c, m in chains.items()}
    meta = {"updated": date.today().isoformat(),
            "sources": ["eth-labels (MIT)", "OFAC SDN via 0xB10C", "ScamSniffer (GPL-3.0, 7-day delay)"],
            "counts": {c: len(m) for c, m in chains.items()}}
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write("// Generated by tools/update_labels.py. Do not edit by hand.\n")
        fh.write("const LABEL_DATA=" + json.dumps({"meta": meta, "chains": data}, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(f"\nwrote {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB)")
    print("categories:", stats, "| OFAC:", n_ofac, "| ScamSniffer:", n_scam)
    print("per chain:", meta["counts"])


if __name__ == "__main__":
    sys.exit(main())
