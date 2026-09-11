# Windows desteği — devam notu

**Durum: kısmen çalışıyor, test edilmedi.** Uygulama içi terminal (`pty.js`) artık Windows'u
tanıyor ve doğru kabuğu seçiyor, ama elimde gerçek bir Windows makine yok — hiçbiri fiilen
çalıştırılmadı. Panelin oturum listesi (kartlar/ofis) ise Windows'ta bugün **hiç çalışmıyor**,
buna hiç dokunulmadı. Bu dosya, konuya kaldığı yerden devam edecek kişi (ve onun Claude'u) için.

---

## Az önce ne düzeltildi

`pty.js`'teki `loginShell()` her platformda `/bin/zsh`'e düşüyordu — Windows'ta bu dosya yok,
`node-pty` onu bulamayınca `pty.spawn` hemen patlıyordu, yani **her** terminal açma denemesi
"terminal açılamadı" ile bitiyordu. Şimdi:

- `loginShell()`: `process.platform === 'win32'` ise `powershell.exe` dönüyor (Windows'ta hazır
  gelir, PATH'te), POSIX'te eskisi gibi `$SHELL`.
- `create()`: kabuk argümanları platforma göre kuruluyor — POSIX'te eskisi gibi
  `-l -i -c`, Windows'ta `-NoExit -Command` (komut bitince kabuk kapanmasın diye).
- Sekme geri yükleme akışındaki "resume yoksa taze `claude` aç" mantığı artık `term.js`'te bir
  kabuk string'i (`claude --resume X || claude`) olarak kurulmuyor — `||` Windows'ta hazır gelen
  PowerShell 5.1'de yok (7'de var ama her Windows'ta 7 kurulu değil). Bunun yerine istemci
  `resumeSessionId` diye düz bir alan gönderiyor, `pty.js` platforma göre doğru sözdizimini
  (`||` ya da `if ($LASTEXITCODE -ne 0) { claude }`) kendisi kuruyor. Değişen dosyalar:
  `pty.js` (`create`), `term.js` (`open`, `restoreAll`), `server.js` (WebSocket `create` mesajı).

**Kanıtlı olan:** macOS'ta hem normal açılış hem resume-yoksa-yeni-oturum akışı `pty.js`
doğrudan çağrılarak yeniden denendi, ikisi de değişiklikten önceki gibi çalışıyor. Windows
tarafında sadece komut/argüman mantığı izole edilip çıktısı gözden geçirildi — gerçek bir
Windows'ta `pty.spawn` çağrısı hiç denenmedi.

## Önce doğrulanması gerekenler

Gerçek bir Windows makinede, sırayla:

1. Panelde **+** ile bir klasör seçip terminal aç — PowerShell açılıp `claude` başlıyor mu,
   yoksa hâlâ bir hata mı var.
2. Uygulamayı açık terminallerle kapat, yeniden aç, "geri yükle" de — `resumeSessionId` yolu bu.
3. Terminaldeyken Ctrl+C: seçili metin yokken PTY'ye kesme sinyali gitmeli, seçiliyken
   kopyalamalı (`term.js`'teki `attachCustomKeyEventHandler` bunu `ctrlKey && !metaKey` ile
   ayırıyor — Windows'ta zaten `metaKey` denk gelmediği için değişmeden çalışmalı, ama
   doğrulanmadı).
4. Pencere/ızgara boyutu değişince terminal doğru satır/sütuna oturuyor mu (`resize`).
5. PowerShell profilinin (`$PROFILE`) yüklenme süresi ilk istemi geciktiriyor mu; gecikiyorsa
   bunun kullanıcı deneyimini nasıl etkilediğine bakılmalı.

## Büyük, dokunulmamış boşluk 1: panel Windows'ta hiç oturum göstermiyor

`server.js`'teki `psSnapshot()` (BSD `ps -axo ...`) ve `cwdOfPid()` (`lsof`) doğrudan bu iki
komuta bağlı. Windows'ta ikisi de yok; `psSnapshot()` `execFileSync` hatasını yutup boş bir
`Map` döndürüyor (çökme yok), ama sonucu şu: hiçbir süreç "canlı" sayılmıyor, kartlar/ofis
görünümü sürekli boş kalıyor. Bu, "terminal açılamıyor" şikayetinden tamamen ayrı ve çok daha
büyük bir iş:

- Süreç listesi için Windows eşdeğeri: `Get-CimInstance Win32_Process` (PowerShell) ya da
  benzeri; pid/ppid/komut satırı/başlangıç zamanı gerekiyor, `ps`'in verdiklerinin aynısı.
- `cwdOfPid()`'in Windows eşdeğeri yok gibi — `lsof -d cwd` kadar basit bir sistem çağrısı
  Windows'ta doğrudan erişilebilir değil; muhtemelen native bir modül ya da başka bir yol
  gerekiyor. Bu kısım araştırma istiyor, doğrudan bir "şunu şuna çevir" değil.
- Bu iş bitmeden panel Windows'ta yalnızca **Terminaller** görünümüyle (uygulama içi terminal
  açma) kullanılabilir; oturum takibi/kartlar çalışmaz.

## Büyük, dokunulmamış boşluk 2: klavye kısayolları Mac'e kilitli

`index.html`'de terminal kısayolları (⌘T yeni sekme, ⌘1–9 sekme değiştir) şu satırla başlıyor:

```js
if(!e.metaKey || e.ctrlKey || e.altKey) return;
```

`e.ctrlKey` varsa **kasıtlı olarak** çıkıyor. `term.js`'teki ⌘F / ⌘G / ⌘⇧G de aynı şekilde
yalnız `e.metaKey`'e bakıyor. Windows/Linux'ta `metaKey` (Windows tuşu) pratikte hiç basılmıyor,
yani bu kısayollar o platformlarda **hiç tetiklenmiyor** — mouse ile (+ düğmesi, sekmeye tıklama,
arama için büyüteç ikonu) hâlâ erişilebilir, kısayol yok sadece.

Bunu düzeltmek göründüğü kadar basit değil: Ctrl, bir terminalin içinde zaten dolu — Ctrl+C/D/Z
süreç denetimi, Ctrl+F/A/E/… çoğu shell'de (bash/zsh readline, kısmen PowerShell'de de) satır
düzenleme anlamına geliyor. `e.ctrlKey`'i Windows'ta doğrudan "komut tuşu" gibi kullanmak bu
satır-düzenleme kısayollarını kullanıcının burnunun dibinde kırar. VS Code'un kendi tercihi bu
yüzden Ctrl+Shift+<tuş> — macOS'ta Cmd, diğerlerinde Ctrl+Shift kullanmak. Buraya el atacak
kişi önce bu tasarım kararını vermeli (hangi kombinasyon, nasıl platform tespiti —
`navigator.platform` mi başka bir şey mi), sonra koda geçmeli.

## Büyük, dokunulmamış boşluk 3: paketlenmiş uygulama yalnız macOS

`electron/main.js` (tepsi ikonu, menü, pencere davranışı) ve `package.json`'daki `build`
bölümü tamamen macOS'a göre: yalnız `mac` hedefi var, `dmg`, entitlements, vs. Windows için
paketlenmiş bir `.exe`/kurulum isteniyorsa (`node server.js` ile çalıştırmak değil), bu ayrı bir
`electron-builder` hedefi (`nsis` ya da `portable`) eklemek ve tepsi/menü davranışını Windows'a
göre gözden geçirmek demek — hiç başlanmadı.

## Öncelik önerisi

1. Yukarıdaki "önce doğrulanması gerekenler" listesini gerçek bir Windows'ta koş, terminal
   açma gerçekten çalışıyor mu doğrula. Çalışmıyorsa önce onu düzelt.
2. Klavye kısayolları (boşluk 2) — küçük, kendi başına biten bir iş, terminal çalıştıktan
   sonra kullanıcı deneyimini hemen iyileştirir.
3. Panelin oturum listesi (boşluk 1) — en büyük parça, araştırma istiyor, ayrı bir konu olarak
   ele alınmalı.
4. Paketlenmiş uygulama (boşluk 3) — yalnız "node server.js" değil, tam uygulama isteniyorsa.
