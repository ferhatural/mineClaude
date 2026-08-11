# mineClaude

> 🇬🇧 [English README](README.md)

Bu makinede açık olan **tüm Claude Code CLI session'larını** tek ekranda gösterir:
kaç tane var, hangisi hangi klasörde, hangisi çalışıyor, hangisi durmuş,
hangisi **senden input bekliyor**.

Bağımlılık yok — sadece Node.js.

## Çalıştırma

```bash
git clone https://github.com/ferhatural/mineClaude.git
cd mineClaude
node server.js            # http://localhost:7788 panelini açar
node server.js --watch    # terminalde canlı tablo (2 sn'de bir yenilenir)
node server.js --once     # tek seferlik tablo bas ve çık
node server.js --json     # ham JSON (script'lemek için)
node server.js --port 7799 --no-open
```

İstersen her yerden çağırmak için:

```bash
ln -s "$PWD/server.js" /usr/local/bin/mineclaude
```

## Menü çubuğu uygulaması (macOS)

Tarayıcı sekmesi yerine üstteki menü çubuğunda dursun istiyorsan bir Electron sarmalayıcı var.
İkona basınca tek pencere açılır, tekrar basınca kapanır. Bir session sana bir şey sorduğu anda
ikon amber olur ve yanına sayı gelir.

Yeni bir makinede klonlanacak ya da derlenecek bir şey yok:

```bash
curl -fsSL https://raw.githubusercontent.com/ferhatural/mineClaude/main/install.sh | bash
```

Son sürümden makinenin mimarisine uyan DMG'yi indirir, uygulamayı `/Applications`'a kopyalar
ve açar. Uygulama kendi Node'unu taşıyor, başka bir şey gerekmiyor.

Ya da [DMG'yi indirip](https://github.com/ferhatural/mineClaude/releases/latest) elle sürükle.
O durumda bir kez şunu çalıştırman gerekiyor, yoksa macOS açmıyor:

```bash
xattr -dr com.apple.quarantine /Applications/mineClaude.app
```

Uygulama imzalı değil — imzalamak ücretli Apple Developer hesabı istiyor — ve macOS
tarayıcıdan gelen imzasız uygulamaları karantinaya alıyor. `install.sh` bu işareti kendisi
siliyor; elle indirdiğinde yukarıdaki satır gerekiyor. Hesabın varsa imzalı derleyebilirsin.

Kullanmak değil de üstünde çalışmak için:

```bash
npm install            # sadece electron, dev bağımlılığı — `node server.js` hâlâ bağımlılıksız
npm run app            # çalıştır
npm run app:build      # dist/mineClaude-1.0.0-arm64.dmg
```

Release'leri `.github/workflows/release.yml` bir sürüm etiketinde üretiyor:

```bash
npm version 1.1.0 && git push --follow-tags
```

Uygulama `server.js`'i kendisi çocuk süreç olarak başlatır, ayrıca bir şey ayakta tutman
gerekmez. 7788'de aynı sürümden bir mineClaude varsa (aşağıdaki `--install` ya da terminalden)
ikincisini açmaz, onu benimser. *Farklı* sürümdekini benimsemez: günlerdir ayakta duran bir
launchd servisi, başladığı andaki kodu servis etmeye devam ediyor ve bu panelde özelliklerin
esrarengiz şekilde kaybolması olarak görünüyor. O durumda kendi sunucusunu bir sonraki boş
portta açar ve stderr'e yazar.

Dock ikonu pencereyle birlikte gelip gidiyor: pencere açıkken uygulama normal bir uygulama,
⌘Tab ile ona geçebiliyorsun; pencereyi gizleyince dock'tan ve uygulama değiştiriciden düşüp
yalnız menü çubuğunda kalıyor. İkona sağ tık: tarayıcıda aç, yenile, **açılışta başlat**, çık.
Pencereyi kapatmak (⌘W ya da kırmızı düğme) sadece gizler; ⌘Q çıkar.

Menü çubuğu ikonu ofis görünümündeki karakterin kafası — ikon zorunlu olarak tek renk
"template" olduğu için gözler ve ağız kendi renkleriyle değil, delik olarak duruyor.

Uygulamada kartlara bir düğme daha geliyor: terminal sekmesine git. Terminal.app da iTerm2 de
AppleScript'te sekme başına `tty` veriyor, bu da panelin zaten gösterdiği tty ile aynı; o
session'ın çalıştığı sekme öne geliyor — yeni sekme yok, yeni shell yok. Gömülü terminali olan
editörlerde (VS Code, Cursor) sekme seçtiren bir arayüz olmadığı için düğme yalnız uygulamayı
öne alıyor. macOS ilk kullanımda terminali kontrol etme izni soruyor; uygulama imzasız olduğu
için bu izin binary'ye bağlı, yani her yeni DMG'den sonra bir kez daha soruyor.

`.dmg` imzasız, ilk açılışta sağ tık → Aç gerekiyor.

## PWA olarak kurmak (macOS)

Panel aynı zamanda bir PWA: aç, sonra Safari'de **Dosya → Dock'a Ekle**,
ya da Chrome'un adres çubuğundaki kur düğmesi. Kendi penceresi, dock ikonu ve ikonun üstünde
seni bekleyen session sayısı.

Dock ikonu ancak sunucu ayaktaysa işe yarar; açılışta kendiliğinden kalksın diye:

```bash
mineclaude --install      # açılışta başlat, çökerse geri getir
mineclaude --status       # yüklü mü, pid'i ne, log nerede
mineclaude --uninstall
```

`--install`, `~/Library/LaunchAgents/com.github.ferhatural.mineclaude.plist` dosyasını yazar,
log'u `~/Library/Logs/mineclaude.log`'a düşer. Önce paketi kalıcı kur (`npm i -g mineclaude`) —
`npx` önbelleğindeki yol sonradan temizlenebilir ve servis kırılır.

## Durumlar

| Durum | Anlamı |
|---|---|
| **input bekliyor** (sarı) | Claude sana soru sordu / izin bekliyor, klavye sende |
| **soru sordu** (sarı) | Tur bitmiş ama Claude'un son mesajı soruyla bitiyor. Claude Code bunu `idle` diye yazıyor, yani bu durum onun değil bizim çıkarımımız |
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

Birine tıklayınca sağda tam boy bir kolon açılıyor. Son birkaç mesajı **tam** gösteriyor —
kartta Claude'un son mesajının ancak 400 karakterlik önizlemesi sığıyor — ve aynı düğmelerle
mesaj kutusunu taşıyor. Kolon bir kez kurulup yerinde güncelleniyor: input elementi bir daha
değiştirilmiyor, yani geri alma geçmişi, ölü tuş bileşimi ve imleç iki saniyelik tazelemeden
sağ çıkıyor. Mesajlar `/api/state` içinde taşınmıyor; kolon yalnız o session için
`/api/messages`'e soruyor, herkese akan yayın küçük kalsın diye.

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
- Bildirim, boş session'ları gizleme, ses ve kolon sayısı dişli düğmesinin arkasında; eskiden
  başlığın altında bir satır kaplıyordu, o satır ofis görünümünün ayıramayacağı bir yükseklikti
- Kolon sayısı seçilebilir (auto / 1–6, tercih saklanır), mobilde tek kolon, sağ üstte tam ekran
- Ofis görünümleri pencereye sığar: sahne kalan yüksekliği alır, sayfanın kendisi kaymaz. Kart
  görünümü liste olduğu için kaymaya devam eder
- Mesaj kutusu bir textarea. Enter gönderir, Shift+Enter yeni satır açar, yazdıkça altı satıra
  kadar büyür
- Her kartta ikon butonlar: ▶ `claude --resume <id>`, 📁 `cd <klasör>`, 📄 transcript yolu (panoya kopyalar)
- Açılışta VS Code'un başlattığı, hiç konuşma geçmemiş boş süreçler varsayılan gizli
- Sağ üstte **TR / EN anahtarı**. Yalnızca arayüzü çevirir; Claude'un mesajları, proje adları, tool
  adları ve yollar veridir, asla çevrilmez. Varsayılan tarayıcının dil listesine bakar, seçimin saklanır.

## Notlar

- Panel sadece `127.0.0.1` üzerinden dinler, dışarı açık değil.
- Salt-okunur bir izleyicidir; hiçbir session'a müdahale etmez, kill etmez.
- macOS için yazıldı (`ps`/`lsof` çıktı formatına bağlı). Linux'ta `ps` satır ayrıştırması
  gözden geçirilmeli.
