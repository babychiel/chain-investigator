# Chain Investigator

Tool forensik on-chain pribadi untuk **63 chain EVM** (Ethereum, Arc, Base, BNB, Arbitrum, Polygon, …), **Solana**, dan **Bitcoin**. Masukkan alamat, tx hash, atau link explorer, lalu tool ini menggambar alur dananya, mengenali exchange dan pelaku dari database label, mendeteksi pola pencucian dana, melacak lintas chain, dan menjelaskan semuanya dalam bahasa sehari-hari.

**Buka langsung di web:** https://babychiel.github.io/chain-investigator/

Versi web sama persis dengan versi lokal, kecuali pelacakan Circle CCTP yang butuh server lokal (`Buka Chain Investigator.bat`). API key yang kamu isi hanya tersimpan di browser yang kamu pakai, dan tidak dikirim ke GitHub.

## Baru pertama kali? Pakai Mode Pemula

Klik tombol biru **🧭 Mode Pemula** (otomatis muncul saat pertama dibuka). Pilih apa yang terjadi, misalnya "Crypto saya dicuri", lalu tempel alamat wallet atau link transaksi. Tool akan mencari sendiri jaringannya, melacak uangnya, lalu menjelaskan hasilnya dalam beberapa kalimat beserta langkah yang harus kamu lakukan. Kamu tidak perlu membaca graph.

## Cara pakai (tampilan lengkap)

1. Double-click **`Buka Chain Investigator.bat`**. Browser akan membuka `http://localhost:8765`. Biarkan jendela hitamnya tetap terbuka (ini server lokal `tools/serve.py`).
2. Klik **🔑 API key**:
   - **Etherscan** (untuk EVM, gratis): https://etherscan.io/myapikey. Satu key berlaku untuk semua chain EVM. Paket gratis: 3 call/detik, 100 ribu/hari, sekitar 90% chain.
   - **Helius** (untuk Solana, gratis): https://dashboard.helius.dev/
   - **Bitcoin** tidak perlu API key (data dari mempool.space).
   - **Anthropic** (opsional, untuk tab Agent): https://console.anthropic.com/settings/keys. Biayanya ditagih ke akun API-mu.
3. Paste salah satu ke kotak atas, lalu klik **Investigasi**:
   - Alamat wallet EVM (`0x…`), Solana, atau Bitcoin (`1…`, `3…`, `bc1…`)
   - **Tx hash**, misalnya transaksi saat dana kamu dicuri
   - Link explorer (Etherscan, ArcScan, Solscan, mempool.space, Blockchair, …). Chain-nya terdeteksi otomatis.
   - Tx id Bitcoin (64 karakter hex tanpa `0x`)

## Tab di panel kanan

| Tab | Isi |
|---|---|
| **Detail** | Info alamat, atribusi (siapa pemiliknya, sumber, dan tingkat keyakinan), screening sanksi/phishing, skor risiko dengan penjelasan awam, playbook trace, tautan cek ke Chainabuse/Arkham/DeBank |
| **Temuan** | Langkah berikutnya, titik keluar (exchange, alamat deposit, "satu pemilik"), pola mencurigakan, review graph. Setiap temuan punya tombol **"Apa artinya?"** |
| **Cerita** | Kronologi kasus dalam bahasa sehari-hari (uang dari mana, ke mana, berakhir di mana) + timeline |
| **🤖 Agent** | Asisten AI yang bisa menelusuri, melacak lintas chain, mengidentifikasi alamat, dan menjelaskan seperti ke orang awam |
| **Pantau** | Memantau wallet dan memberi notifikasi saat ada transaksi baru, dengan aturan (minimal $, hanya ke exchange/berisiko) |
| **Audit** | Log semua aksi yang dirantai hash SHA-256, bisa diverifikasi dan diexport |

Tombol lain: **🛡 Screening** (cek risiko alamat dalam hitungan detik tanpa membuat graph), **Case ▾** (laporan investigasi yang bisa diedit, simpan/buka case, riwayat case, export PNG/CSV, database label).

## Fitur yang meniru TRM Labs

| TRM | Di tool ini |
|---|---|
| Forensics: universal tracing, graph | Graph alur dana, expand, trace maju/mundur multi-hop, playbook (hack, penipuan, cari exchange, sumber dana) |
| Automatic cross-chain tracing | **🌉 Lacak bridge**: menanyakan langsung ke operator bridge (Wormhole, deBridge, Circle CCTP, THORChain, Mayan, Across, Relay, LayerZero/Stargate) ke jaringan, alamat penerima, dan tx tujuan mana dana dikirim. Berlaku untuk EVM, Solana, dan Bitcoin. Cadangannya, khusus EVM: tebakan "alamat sama" di ±15 chain |
| Multi-route pathfinding | **Jalur ke exchange**: semua rute dari alamat ke exchange/bridge/mixer |
| Attribution + "glass box" | Database 95 ribu label publik (exchange, alamat deposit, exploiter, bridge) + OFAC + ScamSniffer, lengkap dengan sumber dan tingkat keyakinan |
| Behavioral Signatures® | Peel chain, wallet transit, fan-out/fan-in, swap, token palsu, address poisoning, EIP-7702, "satu pemilik" (deposit address reuse) |
| Wallet Screening | **🛡 Screening** + screening otomatis di setiap node |
| Transaction Monitoring / Detect | Tab **Pantau** dengan aturan notifikasi |
| Exposure analysis | Eksposur *haircut* dari tersangka/pelaku yang dikenal |
| Co-Case Agent | Tab Agent (Claude) dengan tool graph, trace, identifikasi, lintas chain, label |
| Court-ready reports, audit log | Laporan HTML yang bisa diedit (Ctrl+P → PDF), audit log berantai hash |
| Freeze packages | **📄 Paket laporan ke exchange**: surat permintaan freeze dan penyimpanan data, berisi daftar tx |
| Custom graph elements | **＋ Elemen manual**: orang, rekening bank, akun exchange, lokasi, perangkat |
| Case management | Judul dan catatan case, riwayat 8 case terakhir, simpan/buka file case |
| Triage (scan tx/alamat) | Input tx hash EVM dan signature Solana |

**Tidak ditiru, beserta alasannya:**
- *Seed Analysis*: memasukkan seed phrase ke web sangat berbahaya, jangan pernah lakukan.
- *Beacon/Deconflict/T3*: jaringan antar lembaga dan exchange, butuh keanggotaan resmi.
- *Victim reports* (1,3 juta laporan): data milik TRM/Chainabuse. Yang tersedia di sini adalah tautan langsung ke Chainabuse.
- *Know-Your-Asset, bulk data, 184 chain*: skala enterprise.

## Cara tool membaca Solana dan Bitcoin

**Solana**
- Hanya transfer yang melibatkan wallet itu sendiri yang diambil. Transfer antar-pool dan milik pengguna lain di transaksi yang sama tidak ikut masuk graph.
- Akun milik program dikenali dari program pemiliknya (Raydium, Orca, Meteora, pump.fun/PumpSwap, Phoenix, OpenBook, Jupiter, DFlow, Wormhole, deBridge, CCTP, Allbridge, …) dan otomatis dianggap DEX/bridge.
- Akun token ditampilkan sebagai "Akun token X milik <wallet>", lengkap dengan tombol untuk menambahkan wallet pemiliknya.
- **Layanan ramai**: wallet yang 1.000 transaksi terakhirnya terjadi dalam kurang dari 2 hari dianggap layanan (hot wallet exchange, hub aplikasi, relayer). Trace berhenti di sana dan alamat itu tidak dianggap pelaku.
- **Relayer**: kalau sebagian besar ongkos transaksi wallet dibayar alamat lain, tool memberi temuan "Ongkos transaksi dibayar alamat lain". Pola ini khas aplikasi trading privat, bot, dan wallet tanpa gas.
- Label exchange: label kurasi manual, ditambah **Helius Wallet Identity** kalau paket Helius kamu berbayar (paket gratis otomatis dilewati).
- Panel detail menampilkan saldo SOL sekarang dan jumlah transaksi terakhir.

**Bitcoin**
- Satu transaksi Bitcoin punya beberapa input dan output. Tool mengubahnya jadi transfer antar-alamat: tiap alamat input "mengirim" ke tiap output yang bukan dirinya sendiri. Output yang kembali ke alamat yang sama dianggap kembalian.
- Kalau inputnya dari beberapa alamat, jumlah per alamat **dibagi proporsional** (perkiraan).
- **Kemungkinan satu pemilik (common-input ownership)**: alamat yang dibelanjakan bersama dalam satu transaksi biasanya dikendalikan wallet yang sama. Pengecualian: CoinJoin.
- Alamat dengan ≥5.000 transaksi dianggap layanan ramai. Label: daftar sanksi OFAC untuk Bitcoin + label kurasi manual.
- Kembalian ke alamat baru (bukan alamat input) belum dideteksi otomatis, jadi kadang terlihat seperti transfer ke orang lain.

**Skor risiko**: naik hanya karena hubungan dengan tersangka atau alamat berisiko (sanksi, phishing, hacker, mixer) dan pola perilaku. Menerima dana dari seed **tidak** menaikkan risiko, karena seed bisa saja korban atau wallet yang sedang dipelajari. Transfer bernilai di bawah $1 (rent, biaya, debu) diabaikan untuk deteksi fan-out, fan-in, pass-through, dan titik keluar.

**Waktu** ditampilkan dalam zona waktu komputer kamu (WIB/WITA/WIT), termasuk di ringkasan untuk Claude. Laporan resmi untuk exchange dan file CSV tetap memakai UTC.

## Batasan penting

- **Database label jauh lebih kecil dari TRM** (95 ribu vs 3,1 miliar alamat) dan tidak punya label khusus untuk beberapa chain, termasuk Arc. Solana dan Bitcoin hanya punya daftar OFAC dan beberapa label kurasi manual; sisanya dibantu deteksi "layanan ramai" dan, untuk Solana, Helius Wallet Identity (paket berbayar). Label exchange dari chain lain dipakai dengan keyakinan *sedang*. Label buatanmu tersimpan permanen dan muncul di case berikutnya.
- **Lacak bridge** hanya mengenali 8 bridge di atas. Layanan swap terpusat (FixedFloat, ChangeNOW, SideShift, dan sejenisnya) tidak punya data publik, jadi jejaknya putus di sana. Untuk Relay, riwayat per wallet memakai API lama (v2) yang dibatasi bertahap dan dihentikan Relay pada 24 Nov 2026. LayerZero dan Across tidak menyebut wallet penerima, jadi buka tx tujuannya. Circle CCTP butuh server lokal (`tools/serve.py`, otomatis dipakai oleh file .bat) karena API Circle tidak bisa dipanggil langsung dari browser.
- **Tebakan "alamat sama"** (khusus EVM) hanya bekerja kalau bridge mengirim ke alamat yang sama di chain tujuan.
- Nilai dolar adalah perkiraan memakai harga saat ini, bukan harga saat transaksi.
- Semua temuan adalah **lead investigasi, bukan kesimpulan hukum**. Exchange biasanya hanya membekukan dana atas permintaan penegak hukum, jadi laporkan juga ke polisi (di Indonesia: Bareskrim, Direktorat Tindak Pidana Siber).

## Memperbarui database label

Double-click **`Update Database Label.bat`**. Script akan mengunduh versi terbaru eth-labels, daftar sanksi OFAC, dan ScamSniffer.

## Data & privasi

Case, label, dan API key tersimpan di browser kamu (localStorage). Request hanya dikirim ke `api.etherscan.io`, `api.helius.xyz` / `mainnet.helius-rpc.com`, `mempool.space` (Bitcoin), API publik bridge (`api.wormholescan.io`, `dln.debridge.finance`, `stats-api.dln.trade`, `iris-api.circle.com`, `gateway.liquify.com` (THORChain), `explorer-api.mayan.finance`, `app.across.to`, `api.relay.link`, `scan.layerzero-api.com`) saat kamu klik Lacak bridge, `api.coingecko.com` (harga), dan, kalau Agent dipakai, `api.anthropic.com`.

Sumber data label: [eth-labels](https://github.com/dawsbot/eth-labels) (MIT), [daftar OFAC SDN](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses), [ScamSniffer](https://github.com/scamsniffer/scam-database) (GPL-3.0, tertunda 7 hari).
