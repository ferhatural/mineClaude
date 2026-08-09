# ccwatch

> 🇬🇧 [English README](README.md)

Bu makinede açık olan **tüm Claude Code CLI session'larını** tek ekranda gösterir:
kaç tane var, hangisi hangi klasörde, hangisi çalışıyor, hangisi durmuş,
hangisi **senden input bekliyor**.

Bağımlılık yok — sadece Node.js.

## Çalıştırma

```bash
git clone https://github.com/ferhatural/ccwatch.git
cd ccwatch
node server.js            # http://localhost:7788 panelini açar
node server.js --watch    # terminalde canlı tablo (2 sn'de bir yenilenir)
node server.js --once     # tek seferlik tablo bas ve çık
node server.js --json     # ham JSON (script'lemek için)
node server.js --port 7799 --no-open
```

İstersen her yerden çağırmak için:

```bash
ln -s "$PWD/server.js" /usr/local/bin/ccwatch
```

## Durumlar

| Durum | Anlamı |
|---|---|
| **input bekliyor** (sarı) | Claude sana soru sordu / izin bekliyor, klavye sende |
| **çalışıyor** (yeşil) | Şu an düşünüyor veya tool çalıştırıyor — kartta hangi tool olduğu yazar |
| **beklemede** (mavi) | Claude cevabını verdi, sıra sende — son 15 dakika içinde konuşulmuş |
| **boşta** (gri) | 15 dakikadan uzun süredir sessiz, soğumuş |
| **bilinmiyor** (gri) | Süreç ayakta ama durum bilgisi yayınlamıyor (eski sürüm / alt-süreç) |
| **kapandı** | Süreç yok, ama transcript duruyor → `claude --resume <id>` ile devam edebilirsin |

## Veriyi nereden alıyor

| Kaynak | Ne veriyor |
|---|---|
| `~/.claude/sessions/<pid>.json` | Canlı durum: `status` (busy/waiting/idle), `waitingFor`, cwd, sessionId, sürüm |
| `ps -axo …` | Süreç gerçekten yaşıyor mu, tty'si, CPU/RAM'i, hangi uygulamanın altında (Terminal / VS Code) |
| `~/.claude/projects/**/<sessionId>.jsonl` | Başlık, son prompt, son çalıştırılan tool, model, bağlam boyutu, git branch |

Durum bilgisini öncelikle `sessions/<pid>.json` dosyasından okur (Claude Code'un kendi
yazdığı, en güvenilir kaynak). O dosyada `status` alanı yoksa — eski sürümler yazmıyor —
transcript'in son satırlarından tahmin eder ve kartta bunu belirtir.

Claude turu bitirir bitirmez dosyaya `idle` yazdığı için 5 saniyelik session ile 3 günlük
session aynı görünüyordu; bu yüzden `idle` ikiye ayrılıyor (**beklemede** / **boşta**).
Eşik `COLD_MS` (15 dk). "Son hareket" ölçütü **transcript dosyasının mtime'ı değil**, dosyanın
içindeki son olayın zaman damgasıdır — mtime mesaj gelmeden de tazelenebiliyor.

Kartta ana satır **Claude'un son mesajıdır** (markdown işaretleri ayıklanmış); senin son
prompt'un ve konu başlığı tooltip'te durur.

Ölü PID'lere ait bayat `sessions/*.json` dosyaları atlanır; sadece gerçekten koşan
süreçler "canlı" sayılır.

## Mesaj gönderme

Session'ın `messagingSocketPath`'i varsa (Claude Code'un `/tmp/cc-socks/<pid>.sock` soketi)
kartta bir mesaj kutusu çıkar; yoksa çıkmaz. Panel `POST /api/send` → sokete satır JSON yazar.

Mesaj karşı tarafa **"başka bir Claude session'ından geldi"** çerçevesiyle ulaşır; senin
klavyeden yazdığın mesaj gibi davranılmaz ve bekleyen izin promptlarını onaylatmak için
kullanılamaz (protokolün kendi güvenlik sınırı).

## Ofis görünümü

Sağ üstteki 👥 butonu kart görünümü ile 2D ofis görünümü arasında geçiş yapar (tercih saklanır).
Görseller Minecraft/voxel stilinde: karakterler Steve oranlarında (8×8 kafa, 4×12 kol) piksel
sprite'lardan, sahne blok dokularından çiziliyor (`shape-rendering: crispEdges`).

- **çalışanlar** kendi masalarının arkasında, işe dalmış
- **input bekleyenler** masasının yanında, kameraya dönük, eli havada, başında `?` balonu
- **beklemedekiler** de masasında oturur (henüz soğumadılar)
- **boştakiler** lounge'da takılıyor: kanepede oturanlar, kahve içenler, dedikodu yapanlar

Durum değişince kişi hedefine **yürür**: bacaklar ve kollar 2 kareli Minecraft adımıyla oynar,
süre mesafeye göre hesaplanır (~300 birim/sn) ve ofis ile lounge arasında geçerken duvardan
değil kapıdan dolaşır. Slotlar kişiye yapışıktır — biri masasına geçtiğinde lounge'daki
diğerleri yerinden oynamaz. `prefers-reduced-motion` açıksa tüm animasyonlar kapanır.

> Not: derinlik sıralaması için SVG'de `z-index` yok, düğümleri DOM'da yeniden dizmek gerekiyor;
> bu da çalışan CSS geçişini iptal ettiğinden sıralama yalnızca gerçekten değiştiğinde ve
> daima hareket başlatılmadan **önce** yapılır.

## Panel özellikleri

- 2 saniyede bir SSE ile canlı güncellenir, sekme başlığında bekleyen session sayısı görünür
- Bir session input beklemeye geçince masaüstü bildirimi (opsiyonel, kutucuktan aç)
- Durum kutucuklarına tıklayarak filtre
- Kolon sayısı seçilebilir (auto / 1–6, tercih saklanır), mobilde tek kolon, sağ üstte tam ekran
- Her kartta ikon butonlar: ▶ `claude --resume <id>`, 📁 `cd <klasör>`, 📄 transcript yolu (panoya kopyalar)
- Açılışta VS Code'un başlattığı, hiç konuşma geçmemiş boş süreçler varsayılan gizli
- Sağ üstte **TR / EN anahtarı**. Yalnızca arayüzü çevirir; Claude'un mesajları, proje adları, tool
  adları ve yollar veridir, asla çevrilmez. Varsayılan tarayıcının dil listesine bakar, seçimin saklanır.

## Notlar

- Panel sadece `127.0.0.1` üzerinden dinler, dışarı açık değil.
- Salt-okunur bir izleyicidir; hiçbir session'a müdahale etmez, kill etmez.
- macOS için yazıldı (`ps`/`lsof` çıktı formatına bağlı). Linux'ta `ps` satır ayrıştırması
  gözden geçirilmeli.
