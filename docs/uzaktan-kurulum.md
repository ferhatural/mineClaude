# Tabletten çalışma — kurulum notları

**Durum: park edildi.** Kod `remote-terminals` dalında hazır ve çalışıyor; eksik olan tek
şey donanım. Mac mini İstanbul'da, bir sonraki gelişte getirilecek.

Bu dosya, konuya aylar sonra dönüldüğünde konuşmayı hatırlamak zorunda kalmamak için yazıldı:
neye karar verildi, neden, neyin ölçüldüğü ve neyin hâlâ kanıtlanmadığı.

---

## Amaç

Dışarı yalnız tabletle çıkmak. Klavyeli tablet ekran olsun, Claude Code başka bir makinede
koşsun, oturumlar kapanmasın.

## Karar verilen mimari

```
tablet (Chrome / PWA)  ──Tailscale──>  Mac mini (İstanbul → Dubai)
                                        ├── claude CLI
                                        ├── mineClaude server.js --terminals
                                        └── repolar (Xcode'un açtığı dosyaların ta kendisi)
```

**Ana makine neden Mac mini:** iOS derlemesi ve Xcode macOS'a bağlı, taşınamıyor. Repolar
Mac'te durursa senkron diye bir sorun kalmıyor — Claude ile düzenlenen dosyalar Xcode'un
açtığı dosyalar oluyor. Alternatifleri (Azure VM, ucuz VPS) bu yüzden elendi: ikisi de
iOS derleyemiyor ve araya senkron sokuyor.

**Tablet ince istemci.** `server.js` nerede çalışırsa oradaki oturumları gösteriyor; tablet
hangi makineye bağlanırsa onunla çalışıyor. Tek makineye bağlı değiliz.

## Erişim: Tailscale, SSH tüneli değil

İlk deneme SSH tüneliydi (Termux + `ssh -L`). Gerçek kullanımda kırıldı: Termux arka plana
alınınca Android süreci öldürdü, tünel düştü. Overlay uygulaması yapılınca çalıştı ama bu
bir çözüm değil.

**Dubai'de du 5G ev interneti neredeyse kesin CGNAT arkasında.** Bu şu demek:

- Gelen bağlantı yok, port yönlendirme yok
- **Statik IP satın almak işe yaramaz** — CGNAT arkasında sana ait genel adres oluşmuyor

Tailscale tam olarak bu durum için var. Mobil ağda doğrudan eşler arası bağlantı kurulamazsa
DERP aktarıcısına düşüyor; gecikme artıyor ama terminal trafiği birkaç kilobayt, hissedilmiyor.

Kurulum tek satır:

```
tailscale serve https / http://127.0.0.1:7788
```

Bunun üç faydası var ve üçü de önemli:

1. `server.js` **yine yalnız `127.0.0.1` dinliyor** — kimlik doğrulama kodu yazmıyoruz
2. Tablette SSH istemcisi, tünel, Termux gerekmiyor; Tailscale Android'de VPN servisi olarak
   çalışıyor ve işletim sistemi onu ayakta tutuyor
3. **HTTPS bedava geliyor ve bu şart:** Clipboard API güvenli bağlam istiyor. Düz HTTP ile
   uzak bir adrese bağlanılsaydı kopyala/yapıştır düğmeleri sessizce çalışmayacaktı

Uyarı: tailnet'teki her cihaz o adrese ulaşır, yani kabuk alır. Yalnız kendi cihazlarınsa
sorun değil ama bilerek olsun.

---

## Mac mini geldiğinde yapılacaklar

1. **Uyku kapatılacak.** Uyursa her şey ölür ve dışarıdayken düzeltilemez:
   ```
   sudo pmset -a sleep 0 disablesleep 1
   ```
2. **Tailscale'in bağımsız paketi** kurulacak — App Store sürümü sandbox'lı ve CLI'ı kısıtlı,
   `tailscale serve` için yetmiyor
3. `claude` CLI kurulu ve giriş yapılmış olacak
4. mineClaude kurulacak (`install.sh`) ve servis olarak:
   ```
   mineclaude --install --terminals
   ```
   `--terminals` bayrağı servise işleniyor, açılışta terminallerle beraber geliyor
5. `tailscale serve https / http://127.0.0.1:7788`
6. **Mobil veriyle test** — ev wifi'sinde değil. Asıl sınav orası

## Çelik'in Linux kutusu (sonra)

Aynı mimari. İki fark var:

- **`node-pty` Linux'ta kaynaktan derleniyor.** Paket yalnız `darwin-*` ve `win32-*` ikilisi
  getiriyor, linux yok → `build-essential` ve `python3` gerekiyor
- **`--install` şu an yalnız launchd yazıyor**, systemd karşılığı yok. O kutuya gelince
  yazılacak; buradan test edilemediği için körlemesine gönderilmedi

Gerisi aynı: Tailscale, `claude`, `node server.js --terminals`, `tailscale serve`.

---

## Bu dalda hazır olan iş

`remote-terminals` üç commit:

- **PTY'ler `server.js`'e taşındı**, WebSocket'ten yayınlanıyor. Aynı `pty.js`, aynı mesaj
  şekilleri; `term.js` hangi taşımayı bulursa onu kullanıyor (Electron IPC ya da WebSocket),
  geri kalan kod farkı bilmiyor. Electron yolu bozulmadı
- **`--terminals` bayrağı**, varsayılan kapalı. Süreç izleyen bir panel zararsız; aynı sürecin
  kabuk dağıtması ayrı bir karar, açıkça istenmeli
- **Tablet ergonomisi:** yüzen tuş şeridi (`esc · tab · ^C · ^D · ^Z · oklar · kopyala ·
  yapıştır · A− · A+`), yazı boyutu kontrolü, tarayıcı için klasör seçici
- **Sekme rengi:** o sekmedeki oturum input beklerken başlık amber, yanında yanıp sönen nokta
- **⌘F ile tamponda arama** (4 Eylül 2026 eklendi): xterm `addon-search` vendor'da, şeritte
  büyüteç düğmesi (tablette ⌘F yok). Eklentinin 0.16'daki hatası — seçenek değişince vurguların
  yenilenmemesi — `term.js`'te temizle-yeniden-ara ile aşılıyor

`ws` ve `node-pty` ikisi de `optionalDependencies`; yoksa özellik yok, panel eskisi gibi
çalışıyor. Çekirdek hâlâ bağımlılıksız.

## Ölçümler

Gerçek Claude oturumlarının belleği (bu MacBook'ta, 4 eşzamanlı oturum):

```
33 MB · 128 MB · 234 MB · 460 MB   → toplam 856 MB, ortalama 214 MB
CPU: %0–10, çoğunlukla boşta
```

Yani **bellek belirleyici, CPU değil.** Bir VPS'e taşınırsa 4 GB = rahat 4-6 oturum, 2 GB'da
2-3 oturumla sıkışılır, 1 GB olmaz. Disk asıl sürpriz: ~40 repo + `node_modules` için 40-80 GB.

## Kanıtlanmamış olanlar

Bunlar yazıldı ama gerçek koşulda sınanmadı — döndüğünde ilk bunlara bak:

- **Yeniden bağlanma.** Tünel/ağ koptuğunda PTY sunucuda yaşamaya devam ediyor ve yeni
  bağlantı `attach` ile ona geri bağlanabiliyor. Chrome'un çevrimdışı taklidi soketi kapatmak
  yerine dondurduğu için bu yol test sırasında hiç tetiklenmedi
- **Kopyala/yapıştır düğmeleri.** Kod yerinde, pano izinleri test ortamında çalışmadığı için
  denenemedi
- **Izgaradan tekliye geçince yazıların kaybolması.** Şikâyet gerçek ama ne bu dalda ne kurulu
  1.2.7'de yeniden üretilebildi. En olası sebep düzeltildi (xterm büyürken görünüm penceresi
  içeriğin dışına kalıyor → fit'ten sonra en alta dönülüyor), ama gözlenmiş bir arızanın değil
  bir tahminin düzeltmesi

## Elenen yollar ve nedenleri

- **APK / TWA:** üç şikâyeti de (tuş şeridi yeri, kopyala-yapıştır, yazı boyutu) tarayıcı
  tarafında çözdük. Native uygulama yazılabilir ama buradan test edilemiyor, her tur sideload
  gerektirir. Gerekçesi kalmadı
- **Termux'u APK'dan tetiklemek:** intent var ama Termux'un kurulu olmasını gerektiriyor ve
  asıl sorun olan arka planda öldürülmeyi çözmüyor
- **Statik IP (du):** CGNAT arkasında karşılığı yok
- **Ucuz VPS (Hetzner ~4-5 €/ay, DO ~24 $/ay):** teknik olarak yeterli ama iOS derleyemiyor,
  araya git/senkron sınırı sokuyor. Mac mini varken gereksiz
- **Çok kiracılılık:** vazgeçildi. Not olarak: `server.js` `os.homedir()` üzerinden
  `~/.claude` okuyor, yani tasarım gereği kullanıcı başına tek kiracı. İki abonelik istenirse
  doğru yol **ayrı macOS kullanıcısı + ayrı port**, kod değişikliği gerekmiyor. Aynı kullanıcıda
  `CLAUDE_CONFIG_DIR` ile ayırmak Claude tarafında çalışır ama mineClaude ikinci kiracıyı
  göremez, üstelik terminal = kabuk olduğu için iki kiracı arasında hiçbir izolasyon kalmaz
