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

[DMG'yi indirip](https://github.com/ferhatural/mineClaude/releases/latest) elle de sürükleyebilirsin
ama o zaman tarayıcı indirmesinin taşıdığı karantina işaretini temizlemen gerekiyor, yoksa macOS
açmıyor:

```bash
xattr -dr com.apple.quarantine /Applications/mineClaude.app
```

Uygulama ad-hoc imzalı ama notarize değil; notarize etmek ücretli Apple Developer hesabı
istiyor. Bu yüzden Gatekeeper, uygulamayı derlemeyen bir makinede "kötü amaçlı yazılım içerip
içermediği denetlenemedi" diyerek reddediyor; yukarıdaki satır ya da Gizlilik ve Güvenlik
altındaki "Yine de Aç" bunu aşıyor. `install.sh` zaten senin yerine yapıyor.

Ad-hoc imza süs değil. İmzalamayı tamamen atlarsan bundle'da yalnız Electron ikilisinin
linker'dan gelen imzası kalıyor, kaynaklar mühürlenmiyor ve macOS *bunu* "uygulama bozuk" diye
okuyup çöpe atmayı öneriyor — buradaki ilk sürümlerin başına tam olarak bu geldi.

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

Menüler, tray menüsü ve diyaloglar sistemin dilini izliyor — Electron'un hazır menü rolleri
zaten öyle geliyor. Başlıktaki TR/EN anahtarı panelin kendi metinlerini ilgilendiriyor, pencere
kromunu değil.

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

## Uygulama içinde terminal

Uygulama artık Claude session'larını kendisi çalıştırabiliyor, seni Terminal.app'e geri
göndermiyor. **Terminaller** görünümünde her session bir sekme; karttaki terminal düğmesi o
session'ın klasöründe bir tane açıyor, `+` ise klasör soruyor. Her sekme senin login kabuğunu
çalıştırıyor — `PATH`, nvm, alias'lar hep alışık olduğun gibi — `claude`'u başlatıyor ve session
bitince elinde bir kabuk bırakıyor. Böyle başlatılan session'lar panelde de görünüyor, çünkü
Claude Code hangi yoldan açılırsa açılsın aynı dosyaları yazıyor.

Bu gerçek bir pty, boru değil: Claude Code'un arayüzü ham mod, alternatif ekran ve fare bildirimi
için tty istiyor. `node-pty` onu veriyor, `xterm.js` çiziyor. `node-pty` **isteğe bağlı** bir
bağımlılık: N-API ile önceden derlenmiş ikili getirdiği için kurulumda hiçbir şey derlenmiyor ve
aynı ikili hem Node'da hem Electron'da çalışıyor. Kurulu değilse Terminaller görünümü hiç
çıkmıyor, `node server.js` eskisi gibi bağımlılıksız kalıyor.

Bu sekmelerden birinde çalışan bir session'ın kartında **tek** düğme oluyor ve o sekmeye
götürüyor. Eskiden iki düğme vardı ve ikisi de yanlıştı: biri Terminal.app'ten yalnız bu
uygulamanın içinde var olan bir sekmeyi öne getirmesini istiyordu, diğeri zaten terminali olan
klasörde ikincisini açıyordu. Eşleştirme tty üzerinden — pty onu bildiriyor, panel de zaten
`ps`'ten okuyor — yani kesin. O kartlarda terminal adı yerine `mineClaude terminal` yazıyor.

Sekme ya da ızgara: şeridin sağındaki düğme, tek terminalin ekranı doldurduğu görünüm ile
hepsinin aynı anda kareye yakın bir ızgarada durduğu görünüm arasında geçiş yapıyor. ⌘T yeni
açar, ⌘1–⌘9 arasında geçer, ⌘W ise pencereyi değil odaktaki terminali kapatır — sonuncusu da
kapanınca ⌘W yine pencereyi gizlemeye döner, her yerdeki alışkanlık bozulmaz.

Terminaller uygulamanın sürecinde yaşıyor, yani uygulamayı kapatınca kapanıyorlar — ama önce
soruyor, kapanacak klasörleri sayıyor ve varsayılan düğme vazgeçmek.
`claude --resume` ile kaldığın yerden devam edilir.

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

Sürükleme odayı döndürür, tekerlek yakınlaştırır, space basılıyken sürükleme kaydırmaya
dönüşür — yakınlaşmadan önce ilgilendiğin yeri ortaya alabilirsin — çift tık kamerayı
başa döndürür. İmleç bir mesaj kutusundayken space hiçbir şey yapmaz.

Bir kedi var. Lounge ile masaların arasındaki koridorları kapsayan yavaş bir tur atıyor, her
durakta birkaç saniye oturuyor. Tıklayınca oturup kafasını kaldırıyor ve kuyruğunu dikiyor;
ses açıksa mırlıyor da. Mırıltı diğer sesler gibi sayfada sentezleniyor — gerçek bir mırıltı
~25 Hz'lik bir genlik titremesi, yani alçak geçiren filtreden geçmiş gürültünün 25 Hz'de
titretilmesi; repoda hâlâ tek bir ses dosyası yok.

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
- Durum kutucuklarına tıklayarak filtre. Kart görünümünde alışılmış kutular; ofis, 3D ve
  terminal görünümlerinde aynı satır tek sıra rozete iniyor — solda rakam, sağda etiket — ve
  yaklaşık kırk piksel sahneye geri dönüyor
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
