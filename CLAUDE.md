# mineClaude (ccwatch) — CLAUDE.md

Bu makinedeki tum Claude Code oturumlarini canli izleyen panel + gomulu
terminaller. Ayrintili kullanim `README.md` / `README.tr.md`'de; burada yalniz
koda bakinca anlasilmayanlar var.

## Fork iliskisi — onemli

Hakan (`hakanngok`) kendi fork'unda gelistirip PR aciyor (su an #5,
`release/1.4.0` dali, surum etiketleri 1.3.x-1.4.x). PR'lar **merge edilmeden
kapatiliyor**, biz elle birlestiriyoruz. Her merge'de tekrar eden uc catisma:

- **`package.json > build.publish.owner`** — o `hakanngok` yapiyor, biz
  `ferhatural`. Yoksa otomatik guncelleme bizim degil onun release'lerinden
  ceker. Her merge'de kontrol et.
- **Menu mimarisi** — bizde macOS'ta Ayarlar uygulama menusunun icinde
  (`settingsSubmenu()` + `isMac`), o duz yapiya geri aliyor (`cd403a1`).
  Anlasilmadigi surece her merge'de birbirini geri alacak.
- **Dokunmatik tus seridi** — o `4ea5891`'de tamamen kaldirdi, bizde duruyor
  (tabletten calisma icin gerekli).

Bizde olup onda olmayanlar genelde tabletten calisirken sahada cikan
duzeltmeler; merge'de bunlarin korundugunu dogrula: arama (`/api/search`),
WebSocket kalp atisi, `~` genisletmesi, resume tekillestirmesi, PTY devralma.

## Iki ayri PTY havuzu (en sik yanlis anlasilan sey)

```
mineClaude.app  ──IPC──>  Electron ana surecinin pty havuzu
launchd sunucu  ──WS───>  server.js'in pty havuzu
```

`term.js` Electron icindeyken **her zaman** IPC kullaniyor (`D.term` varsa
WebSocket'e hic bakmiyor). Sonuc:

- Laptop uygulamasinda acilan terminaller **tabletten gorunmez ve erisilemez**
- `/api/terminals` yalnizca sunucu havuzunu gosteriyor
- Uygulamayi kapatinca kendi havuzu olur; launchd sunucusununkiler yasar

Tabletten calisilacaksa her seyi tabletten (ya da tarayicidan) acmak lazim.

## Oturum kopyalanmasi

Ayni konusmaya birden fazla `claude --resume <ayni id>` baglamak transcript'i
bozuyor. Iki yerde onlem var, ikisi de gerekli:

- `open()` icinde oturum kimligine gore tekillestirme
- Geri yuklemede once sunucunun canli PTY listesine bakip **devralma**
  (`adoptLive`); yoksa her sayfa yuklemesi bir kopya daha uretiyordu

Sahada tek konusmadan sekiz surec cikmisti; sebebi ikincisiydi.

## Onbellek tuzaklari

Iki yerde "degismediyse yeniden yapma" korumasi var ve ikisi de bir kez
hataya yol acti — benzer bir sey eklerken dikkat:

- `fitOne`: kutu boyutu ayni diye erken cikiyor. Yazi boyutu degisince kutu
  ayni kalir ama satir/sutun degismek zorunda → `setFont` onbellegi sifirliyor.
- `renderTermTasks`: sekme degismediyse veri cekmiyordu. Disaridan eklenen
  gorev hic gorunmuyordu → artik her ankette cekiyor, DOM'u yalniz veri
  degistiyse kuruyor.

## Gorev listesi

`<proje>/.mineclaude/tasks.json`. Panel her ankette taze okuyor, yani disaridan
yazan (CLI, Claude, baska cihaz) bir saniyede gorunuyor.

CLI: `--tasks`, `--task-add`, `--task-done`, `--task-undone`, `--task-rm`
(varsayilan klasor `process.cwd()`).

**SFTP senkronu:** projede `.vscode/sftp.json` varsa gorevler o sunucuya da
yaziliyor — ayni projede calisan iki makine ayni listeyi gorsun diye. Dosya
**ev dizinine** yaziliyor, `remotePath`'in altina DEGIL: remotePath cogu
kurulumda yayin klasoru ve oraya yazilan dosya `https://site/...` ile herkese
acik okunur hale geliyordu. Dosya adi `host+remotePath` ozetinden turetiliyor
ki farkli makinelerdeki farkli yerel yollar ayni uzak dosyaya denk gelsin.

Bu makinede 103 projede `sftp.json` var — yani panel acikken arka planda
musteri sunucularina SSH baglantisi aciliyor. Bilerek olsun.

## Tabletten calisma

Kurulum, teshisler ve elenen yollar: `docs/uzaktan-kurulum.md`. Ozet:
Tailscale (userspace kip, root'suz) + `tailscale serve` → panel HTTPS ile
tailnet'te. `android/` altinda WebView sarmalayici (tarayicilarin Ctrl+S/X'i
kapmasi icin; TWA ise yaramaz).

## Yerel servisler (bu makine)

`com.github.ferhatural.mineclaude` (panel, `--terminals`, yalniz 127.0.0.1) ve
`com.ferhatural.tailscaled`. Ikisi de kullanici LaunchAgent'i, yani **acilista
degil girise** bagli: FileVault acikken yeniden baslatma sonrasi kimse giris
yapmazsa ikisi de kalkmaz.

## Tuzaklar

- **Ayni depoda paralel Claude oturumlari** commit atiyor. Push oncesi
  `git fetch` ile bak; bir gunde uc kez build'i gecersiz kildi.
- Derleme sonrasi `dist/` ve `android/app/build/` buyuyor, ikisi de yoksayili.
- `asar: false` duruyor; electron-builder her derlemede uyariyor.
