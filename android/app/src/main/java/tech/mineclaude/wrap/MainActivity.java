package tech.mineclaude.wrap;

import android.annotation.SuppressLint;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.net.Uri;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import android.app.Activity;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * mineClaude paneli icin ince bir WebView sarmalayici.
 *
 * Varolus sebebi tek bir sorun: tarayicilar Ctrl+S / Ctrl+X gibi kisayollari
 * kendi isliyor ("sayfayi kaydet", "kes") ve sayfaya hic birakmiyor — Opera'da
 * Ctrl+S dogrudan "offline pages"e gidiyordu. Claude Code'da bu tuslar mesaj
 * gondermek icin gerekiyor. WebView'in tarayici kabugu olmadigi icin boyle bir
 * kapma yok, tuslar sayfaya geliyor.
 *
 * Adres koda gomulu DEGIL: depo public, gomulu bir tailnet adresi herkese acik
 * olurdu. Ilk acilista soruluyor ve cihazda saklaniyor.
 */
public class MainActivity extends Activity {

  private static final String PREFS = "mineclaude";
  private static final String KEY_URL = "url";
  private static final String KEY_ZOOM = "zoom";   // yuzde

  private TermWebView web;
  /**
   * Tus teshisi. Kapali: eslesen kombinasyonlar zaten sessizce calisiyor,
   * her basista bildirim gostermek gunluk kullanimda rahatsiz ediyor. Acmak
   * gerekirse true yapip yeniden derlemek yeterli — eslenemeyen Ctrl'lu
   * kombinasyonlari keyCode ve unicode degeriyle gosteriyor.
   */
  private boolean tehis = false;

  /**
   * Odak terminalde mi. Sayfa focusin/focusout ile bildiriyor (term.js).
   * Ctrl+<harf>'i yalniz terminal odaktayken kapiyoruz; odak bir web
   * sekmesindeki metin kutusundaysa Ctrl+C/V/A oraya gitmeli. Varsayilan true:
   * eski bir sayfa surumu bildirmiyorsa davranis eskisi gibi kalsin.
   */
  private volatile boolean termOdakta = true;

  /** Panelin kendi adresi: iframe basliklarini yalniz BASKA sitelerde temizliyoruz. */
  private String panelHost = "";
  /** https://makine.ts.net — gorsel yuklemesi icin. */
  private String panelKok = "";

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    String url = prefs().getString(KEY_URL, null);
    if (url == null || url.isEmpty()) showUrlPrompt(null);
    else showWeb(url);
  }

  private SharedPreferences prefs() {
    return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  /** Ilk acilis ya da adres yanlis: tek alanli bir ekran. */
  private void showUrlPrompt(String hata) {
    LinearLayout kok = new LinearLayout(this);
    kok.setOrientation(LinearLayout.VERTICAL);
    kok.setPadding(48, 96, 48, 48);
    kok.setBackgroundColor(Color.parseColor("#0e1013"));

    TextView etiket = new TextView(this);
    etiket.setText(getString(R.string.url_label));
    etiket.setTextColor(Color.parseColor("#e7eaef"));
    etiket.setTextSize(16);
    kok.addView(etiket);

    if (hata != null) {
      TextView h = new TextView(this);
      h.setText(hata);
      h.setTextColor(Color.parseColor("#f2b53b"));
      h.setPadding(0, 16, 0, 0);
      kok.addView(h);
    }

    final EditText giris = new EditText(this);
    giris.setHint(R.string.url_hint);
    giris.setSingleLine(true);
    giris.setTextColor(Color.parseColor("#e7eaef"));
    giris.setHintTextColor(Color.parseColor("#6b7482"));
    String mevcut = prefs().getString(KEY_URL, "");
    if (!mevcut.isEmpty()) giris.setText(mevcut);
    kok.addView(giris);

    Button dugme = new Button(this);
    dugme.setText(R.string.connect);
    dugme.setOnClickListener(v -> {
      String u = giris.getText().toString().trim();
      if (u.isEmpty()) return;
      if (!u.startsWith("http://") && !u.startsWith("https://")) u = "https://" + u;
      prefs().edit().putString(KEY_URL, u).apply();
      showWeb(u);
    });
    kok.addView(dugme);

    setContentView(kok, new ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
  }

  @SuppressLint("SetJavaScriptEnabled")
  private void showWeb(String url) {
    web = new TermWebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    // Panel tercihleri (tema, sutun, tus seridi) localStorage'da duruyor.
    s.setDomStorageEnabled(true);
    // Durum sesleri kullanici dokunmadan calabilsin.
    s.setMediaPlaybackRequiresUserGesture(false);
    // WebView yakinlastirmasi KAPALI. Denendi ve geri alindi: setInitialScale
    // ile zoomBy birlikte tutarsiz davraniyor (arayuz kucuk kalip buyumuyordu)
    // ve dahili zoom'u acmak fare/parmak hareketlerini de yakinlastirmaya
    // bagliyordu. Boyut ayari artik panelin kendi Ayarlar'inda — orada xterm
    // yazi boyutu dogrudan degistigi icin gorüntü de net kaliyor.
    s.setSupportZoom(false);
    s.setBuiltInZoomControls(false);
    // Onceki surumde saklanmis bozuk olcek varsa temizliyoruz.
    if (prefs().contains(KEY_ZOOM)) prefs().edit().remove(KEY_ZOOM).apply();
    web.setBackgroundColor(Color.parseColor("#0e1013"));

    // Baglantilari disari atmiyoruz: panel kendi icinde geziyor.
    panelHost = hostOf(url);
    try {
      Uri pu = Uri.parse(url);
      panelKok = pu.getScheme() + "://" + pu.getEncodedAuthority();
    } catch (Exception ex) { panelKok = url; }
    // Cerceve icindeki siteler cerezsiz kalmasin (oturum acilan siteler).
    CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        // Cerceveden kurtulmaya calisan siteler (top.location = ...) paneli
        // komple o siteye goturmesin: baska bir siteye ust seviye gezinme ust
        // katmandaki tarayiciya gidiyor, panel yerinde kaliyor.
        Uri u = r.getUrl();
        if (r.isForMainFrame() && u != null && !panelHost.isEmpty()
            && !panelHost.equalsIgnoreCase(u.getHost())) {
          miniTarayiciAc(u.toString());
          return true;
        }
        return false;
      }
      @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
        return cerceveyeIzinVer(r);
      }
      @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
        // Yalniz ana belge hatasi ilgilendiriyor; alt istekler (ikon vb.) degil.
        if (r != null && r.isForMainFrame()) {
          showUrlPrompt("Bağlanılamadı: " + (e != null ? e.getDescription() : "bilinmeyen hata"));
        }
      }
    });
    // Konsol/izin koprusu: pano ve bildirim gibi seyler icin gerekli.
    web.setWebChromeClient(new WebChromeClient());
    // Panelin mini tarayicisi icin kopru. Tarayicida o sekmeler <iframe> ile
    // aciliyor ve cogu site X-Frame-Options ile cerceveyi reddediyor —
    // "blocked". Burada gercek bir WebView actigimiz icin o kisit yok:
    // cerceve degil, ust seviye yukleme.
    web.addJavascriptInterface(new Kopru(), "mineClaudeAndroid");

    setContentView(web, new ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    // Ekran terminal acikken sonmesin.
    web.setKeepScreenOn(true);
    web.loadUrl(url);
  }

  /**
   * Tus zincirinin en ust halkasi. Tarayicida Ctrl+S/Ctrl+X'i tarayici kendi
   * isliyor ve sayfaya hic birakmiyordu; WebView'da da hicbiri calismadi.
   * Burada olay DOM'a girmeden once elimize geliyor: Ctrl varsa kontrol
   * karakterini uretip dogrudan terminale yaziyoruz (MTerm.sendKey), araya
   * girecek kimse kalmiyor.
   *
   * TESHIS: Ctrl'un kendisine basildiginda da kisa bir bildirim gosteriyoruz.
   * Hicbir bildirim cikmiyorsa olay uygulamaya HIC ulasmiyor demektir — o
   * zaman sorun WebView'da degil, cihazin kendisinde (uretici katmani tusu
   * kendine aliyor) ve yazilimla cozulemez.
   */
  /**
   * Ctrl+<harf> ancak IME'DEN ONCE yakalanabiliyor.
   *
   * Olculdu: Ctrl tek basina Activity.dispatchKeyEvent'e ulasiyordu
   * (keyCode=113 ctrl=true), ama Ctrl+C hic ulasmiyordu. Android'de donanim
   * tuslari once IME'ye gidiyor; klavye uygulamasi Ctrl+C/S/X'i kendi
   * kopyala/kaydet/kes kisayolu sayip tuketiyor ve uygulamaya hic birakmiyor.
   * Ctrl tek basina tam bir komut olmadigi icin tuketilmiyordu — bu yuzden o
   * goruluyor, kombinasyon gorulmuyordu.
   *
   * dispatchKeyEventPreIme IME'den once calisiyor: burada yakalayip kontrol
   * karakterini dogrudan terminale yaziyoruz, olay IME'ye hic gitmiyor.
   */
  private class TermWebView extends WebView {
    TermWebView(android.content.Context c) { super(c); }

    /**
     * Hizli yazarken harf kayboluyordu. Fiziksel klavyenin tuslari da once
     * klavye uygulamasindan geciyor; o, oneri/otomatik duzeltme icin yazilani
     * "olusturulan sozcuk" (composition) olarak tutuyor ve xterm hizli yazimda
     * bu olaylarin bir kismini kaciriyor. Termux'un yolu: alani "gorunur
     * parola, oneri yok" diye tanitmak — klavye uygulamasi o zaman sozcuk
     * olusturmuyor, her tus dogrudan geliyor. Yalniz terminal odaktayken;
     * web sekmesindeki metin kutularinda oneriler kalsin.
     */
    @Override
    public android.view.inputmethod.InputConnection onCreateInputConnection(
        android.view.inputmethod.EditorInfo outAttrs) {
      android.view.inputmethod.InputConnection ic = super.onCreateInputConnection(outAttrs);
      if (termOdakta && outAttrs != null) {
        outAttrs.inputType = android.text.InputType.TYPE_CLASS_TEXT
            | android.text.InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
            | android.text.InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;
        outAttrs.imeOptions |= android.view.inputmethod.EditorInfo.IME_FLAG_NO_EXTRACT_UI
            | android.view.inputmethod.EditorInfo.IME_FLAG_NO_FULLSCREEN;
      }
      return ic;
    }

    @Override
    public boolean dispatchKeyEventPreIme(KeyEvent e) {
      if (e.getAction() == KeyEvent.ACTION_DOWN && e.isCtrlPressed() && termOdakta) {
        int kc = e.getKeyCode();
        boolean ctrlTusu = kc == KeyEvent.KEYCODE_CTRL_LEFT || kc == KeyEvent.KEYCODE_CTRL_RIGHT;
        // Ctrl+V: bkz. yapistir().
        if (kc == KeyEvent.KEYCODE_V && !e.isAltPressed()) {
          yapistir();
          return true;
        }
        // Ctrl+C: secim varsa kopyala, yoksa ^C — karari sayfa veriyor, secim
        // xterm'de. Eskiden her zaman ^C gidiyordu ve kopyalamaya calisirken
        // calisan Claude'u durduruyordu.
        if (kc == KeyEvent.KEYCODE_C && !e.isAltPressed()) {
          web.evaluateJavascript("window.MTerm && MTerm.ctrlC()", null);
          return true;
        }
        if (!ctrlTusu) {
          int u = e.getUnicodeChar(0);              // degistiricisiz temel karakter
          int buyuk = u > 0 ? Character.toUpperCase(u) : 0;
          if (buyuk >= 64 && buyuk <= 95) {         // @ A-Z ve bitisik isaretler
            yazTerminale(buyuk & 31);
            return true;                            // IME'ye hic gitmesin
          }
          if (tehis) {
            Toast.makeText(MainActivity.this,
                "preIme: keyCode=" + kc + " unicode=" + u + " (eslenemedi)",
                Toast.LENGTH_SHORT).show();
          }
        }
      }
      return super.dispatchKeyEventPreIme(e);
    }
  }


  private ClipData.Item panoOgesi() {
    try {
      ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
      if (cm == null || !cm.hasPrimaryClip()) return null;
      ClipData c = cm.getPrimaryClip();
      if (c == null || c.getItemCount() == 0) return null;
      return c.getItemAt(0);
    } catch (Exception ex) {
      return null;
    }
  }

  /**
   * Panodaki METIN. coerceToText KULLANMIYORUZ: panoda gorsel varken o,
   * gorselin content:// adresini metin olarak donduruyor ve terminale o adres
   * yapistiriliyordu.
   */
  private String panoOku() {
    ClipData.Item o = panoOgesi();
    if (o == null || o.getText() == null) return null;
    return o.getText().toString();
  }

  /**
   * Ctrl+V (ve seritteki Yapistir).
   *  - Metin: xterm'in paste yolundan (MTerm.pasteText, korumali yapistirma).
   *    Eskiden \x16 gidiyordu, Claude Code onu "gorsel yapistir" sayiyordu.
   *  - Gorsel: Claude Code gorseli calistigi makinenin (Mac) panosundan
   *    okuyor, tabletin panosu ona hic ulasmiyor. Gorseli sunucuya
   *    yukleyip (/api/paste-image) gecici dosyanin yolunu yapistiriyoruz;
   *    Claude Code mesajdaki gorsel yolunu kendisi ekliyor. Masaustu
   *    uygulamasinin Ctrl+V'si de boyle (electron/main.js).
   *  - Hicbiri: \x16 — Claude Code Mac'in panosuna baksin (eski davranis).
   */
  private void yapistir() {
    ClipData.Item o = panoOgesi();
    if (o != null && o.getText() != null && o.getText().length() > 0) {
      web.evaluateJavascript("window.MTerm && MTerm.pasteText(" + JSONObject.quote(o.getText().toString()) + ")", null);
      return;
    }
    Uri uri = o != null ? o.getUri() : null;
    String tur = null;
    if (uri != null) {
      try { tur = getContentResolver().getType(uri); } catch (Exception ex) { /* izin yok */ }
    }
    if (uri != null && tur != null && tur.startsWith("image/")) {
      Toast.makeText(this, "Görsel yükleniyor…", Toast.LENGTH_SHORT).show();
      final Uri u = uri;
      final String t = tur;
      new Thread(() -> gorselYukle(u, t)).start();
      return;
    }
    yazTerminale(0x16);
  }

  private void gorselYukle(Uri uri, String tur) {
    String hata = null;
    try {
      byte[] veri;
      try (InputStream in = getContentResolver().openInputStream(uri)) {
        if (in == null) throw new Exception("görsel okunamadı");
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
        byte[] tampon = new byte[16384];
        int n;
        while ((n = in.read(tampon)) > 0) b.write(tampon, 0, n);
        veri = b.toByteArray();
      }
      // Sunucu png/jpeg/webp/gif kabul ediyor; HEIC gibi digerlerini PNG'ye
      // ceviriyoruz.
      if (!tur.equals("image/png") && !tur.equals("image/jpeg") && !tur.equals("image/webp") && !tur.equals("image/gif")) {
        android.graphics.Bitmap bmp = android.graphics.BitmapFactory.decodeByteArray(veri, 0, veri.length);
        if (bmp == null) throw new Exception("desteklenmeyen görsel: " + tur);
        java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
        bmp.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, b);
        veri = b.toByteArray();
        tur = "image/png";
      }
      HttpURLConnection c = (HttpURLConnection) new URL(panelKok + "/api/paste-image").openConnection();
      c.setRequestMethod("POST");
      c.setDoOutput(true);
      c.setConnectTimeout(15000);
      c.setReadTimeout(60000);
      c.setRequestProperty("Content-Type", tur);
      c.setFixedLengthStreamingMode(veri.length);
      try (java.io.OutputStream out = c.getOutputStream()) { out.write(veri); }
      int kod = c.getResponseCode();
      InputStream yanit = kod < 400 ? c.getInputStream() : c.getErrorStream();
      java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
      if (yanit != null) {
        byte[] tampon = new byte[4096];
        int n;
        while ((n = yanit.read(tampon)) > 0) b.write(tampon, 0, n);
        yanit.close();
      }
      JSONObject j = new JSONObject(new String(b.toByteArray(), StandardCharsets.UTF_8));
      if (!j.optBoolean("ok")) throw new Exception(j.optString("error", "HTTP " + kod));
      final String yol = "\"" + j.getString("path") + "\"";
      runOnUiThread(() -> web.evaluateJavascript(
          "window.MTerm && MTerm.pasteText(" + JSONObject.quote(yol) + ")", null));
    } catch (Exception ex) {
      hata = ex.getMessage() != null ? ex.getMessage() : ex.toString();
    }
    if (hata != null) {
      final String h = hata;
      runOnUiThread(() -> Toast.makeText(this, "Görsel yapıştırılamadı: " + h, Toast.LENGTH_LONG).show());
    }
  }

  private static String hostOf(String url) {
    try { String h = Uri.parse(url).getHost(); return h == null ? "" : h; }
    catch (Exception ex) { return ""; }
  }

  /**
   * Mini tarayici sekmeleri sayfada <iframe>; cogu site X-Frame-Options ya da
   * CSP frame-ancestors ile cerceveye girmeyi reddediyor ve sekme bos kaliyor
   * (signal360.carvist.org: XFO SAMEORIGIN). Normal tarayicida acilan site
   * burada acilmiyordu.
   *
   * Cozum: cerceve BELGESI istegini (ana cerceve degil, GET, Accept text/html,
   * panelin kendisi degil) kendimiz yapip yaniti bu iki baslik cikarilmis
   * olarak WebView'a veriyoruz. Gorseller, betikler, XHR dokunulmadan WebView'in
   * kendi yolundan gidiyor — cerceve kisiti yalniz belgenin yanitina bakiyor.
   *
   * Sinirlar: POST ile gelen sayfalar (form gonderimi) yakalanamiyor — WebView
   * istek govdesini vermiyor; onlar eskisi gibi. Yonlendirmeyi WebView'a 3xx
   * olarak veremiyoruz (WebResourceResponse 3xx kabul etmiyor): hedefe
   * location.replace yapan kucuk bir sayfa donuyoruz, o istek de buradan gecip
   * dogru adresle yukleniyor. Cerezler CookieManager ile iki yonlu esleniyor.
   */
  private WebResourceResponse cerceveyeIzinVer(WebResourceRequest r) {
    try {
      if (r.isForMainFrame() || !"GET".equalsIgnoreCase(r.getMethod())) return null;
      Uri u = r.getUrl();
      String sema = u.getScheme();
      if (!"https".equalsIgnoreCase(sema) && !"http".equalsIgnoreCase(sema)) return null;
      if (panelHost.equalsIgnoreCase(u.getHost())) return null;
      Map<String, String> h = r.getRequestHeaders();
      String accept = null;
      for (Map.Entry<String, String> en : h.entrySet()) {
        if ("accept".equalsIgnoreCase(en.getKey())) accept = en.getValue();
      }
      if (accept == null || !accept.contains("text/html")) return null;

      String adres = u.toString();
      HttpURLConnection c = (HttpURLConnection) new URL(adres).openConnection();
      c.setInstanceFollowRedirects(false);
      c.setConnectTimeout(15000);
      c.setReadTimeout(30000);
      for (Map.Entry<String, String> en : h.entrySet()) {
        String k = en.getKey().toLowerCase();
        // Sikistirmayi HttpURLConnection kendisi cozuyor (basligi biz koyarsak
        // cozmuyor); kosullu istek 304 dondurur, o da bos bir cerceve demek.
        if (k.equals("accept-encoding") || k.equals("if-none-match") || k.equals("if-modified-since")
            || k.equals("cookie") || k.equals("host")) continue;
        c.setRequestProperty(en.getKey(), en.getValue());
      }
      CookieManager cm = CookieManager.getInstance();
      String cerez = cm.getCookie(adres);
      if (cerez != null && !cerez.isEmpty()) c.setRequestProperty("Cookie", cerez);

      int kod = c.getResponseCode();
      Map<String, List<String>> yb = c.getHeaderFields();
      for (Map.Entry<String, List<String>> en : yb.entrySet()) {
        if (en.getKey() != null && en.getKey().equalsIgnoreCase("set-cookie")) {
          for (String v : en.getValue()) cm.setCookie(adres, v);
        }
      }
      cm.flush();

      if (kod >= 300 && kod < 400) {
        String hedef = c.getHeaderField("Location");
        c.disconnect();
        if (hedef == null) return null;
        hedef = new URL(new URL(adres), hedef).toString();
        String sayfa = "<!doctype html><meta charset=utf-8><script>location.replace("
            + JSONObject.quote(hedef) + ")</script>";
        return new WebResourceResponse("text/html", "utf-8", 200, "OK",
            new HashMap<>(), new ByteArrayInputStream(sayfa.getBytes(StandardCharsets.UTF_8)));
      }

      Map<String, String> cikis = new HashMap<>();
      for (Map.Entry<String, List<String>> en : yb.entrySet()) {
        String k = en.getKey();
        if (k == null || en.getValue().isEmpty()) continue;
        String kl = k.toLowerCase();
        if (kl.equals("x-frame-options") || kl.equals("set-cookie") || kl.equals("content-encoding")
            || kl.equals("content-length") || kl.equals("transfer-encoding") || kl.equals("connection")) continue;
        String v = String.join(", ", en.getValue());
        if (kl.equals("content-security-policy")) {
          v = cspTemizle(v);
          if (v.isEmpty()) continue;
        }
        cikis.put(k, v);
      }

      String tur = c.getContentType();
      String mime = "text/html", kodlama = null;
      if (tur != null) {
        String[] p = tur.split(";");
        mime = p[0].trim();
        for (int i = 1; i < p.length; i++) {
          String q = p[i].trim();
          if (q.toLowerCase().startsWith("charset=")) kodlama = q.substring(8).replace("\"", "").trim();
        }
      }
      InputStream govde = kod >= 400 ? c.getErrorStream() : c.getInputStream();
      if (govde == null) govde = new ByteArrayInputStream(new byte[0]);
      String neden = c.getResponseMessage();
      if (neden == null || neden.isEmpty()) neden = "OK";
      return new WebResourceResponse(mime, kodlama, kod, neden, cikis, govde);
    } catch (Exception ex) {
      return null;   // bir sey ters giderse WebView kendi yolundan yuklesin
    }
  }

  /** CSP'den yalniz frame-ancestors yonergesini cikariyoruz; gerisi yerinde. */
  private static String cspTemizle(String csp) {
    StringBuilder b = new StringBuilder();
    for (String y : csp.split(";")) {
      String t = y.trim();
      if (t.isEmpty() || t.toLowerCase().startsWith("frame-ancestors")) continue;
      if (b.length() > 0) b.append("; ");
      b.append(t);
    }
    return b.toString();
  }

  /** Kontrol karakterini sayfaya, DOM olayina hic dokunmadan veriyoruz. */
  private void yazTerminale(int kod) {
    web.evaluateJavascript(
        "window.MTerm && MTerm.sendKey(String.fromCharCode(" + kod + "))", null);
  }

  /** Sayfadan cagrilan tek yontem: bir adresi ust katmanda ac. */
  private class Kopru {
    @JavascriptInterface
    public void setTermFocus(boolean odak) {
      if (termOdakta == odak) return;
      termOdakta = odak;
      // Klavye uygulamasi alan turunu baglanirken okuyor: odak terminal ile
      // web kutusu arasinda gecince yeniden baglansin ki oneri kipi dogru olsun.
      runOnUiThread(() -> {
        android.view.inputmethod.InputMethodManager imm =
            (android.view.inputmethod.InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
        if (imm != null && web != null) imm.restartInput(web);
      });
    }

    /** Seritteki Yapistir: Ctrl+V ile ayni yol (metin ya da gorsel). */
    @JavascriptInterface
    public void paste() { runOnUiThread(() -> yapistir()); }

    @JavascriptInterface
    public void copyText(final String metin) {
      if (metin == null) return;
      runOnUiThread(() -> {
        ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("mineClaude", metin));
      });
    }

    /** Pano okumasi Android 10+'da odak istiyor; UI is parcacigindan okuyoruz. */
    @JavascriptInterface
    public String readClipboard() {
      final String[] sonuc = { null };
      final java.util.concurrent.CountDownLatch bitti = new java.util.concurrent.CountDownLatch(1);
      runOnUiThread(() -> { sonuc[0] = panoOku(); bitti.countDown(); });
      try { bitti.await(2, java.util.concurrent.TimeUnit.SECONDS); } catch (InterruptedException ex) { /* */ }
      return sonuc[0];
    }

    @JavascriptInterface
    public void openUrl(final String url) {
      if (url == null || url.isEmpty()) return;
      runOnUiThread(() -> miniTarayiciAc(url));
    }

    /**
     * Sayfadaki tam ekran dugmesi icin. Tarayicinin Fullscreen API'si WebView'da
     * sistem cubuklarini gizlemiyor — dugme hicbir ise yaramiyordu. Burada
     * gercek immersive kipe geciyoruz: durum ve gezinme cubuklari kayboluyor,
     * kenardan cekince gecici olarak geri geliyor.
     */
    /**
     * Sunucu adresini degistirmek icin giris ekranini geri getirir. Adres
     * yanlissa zaten onReceivedError bunu kendiliginden yapiyor; bu ise
     * "calisan bir sunucudan baskasina gecmek" durumu icin — panel acilabiliyor
     * ama baska bir makineye baglanmak isteniyor.
     */
    @JavascriptInterface
    public void changeServer() {
      runOnUiThread(() -> {
        tamEkranAyarla(false);
        showUrlPrompt(null);
      });
    }

    @JavascriptInterface
    public boolean toggleFullscreen() {
      final boolean hedef = !tamEkran;
      runOnUiThread(() -> tamEkranAyarla(hedef));
      return hedef;
    }
  }

  private boolean tamEkran = false;

  private void tamEkranAyarla(boolean ac) {
    tamEkran = ac;
    if (android.os.Build.VERSION.SDK_INT >= 30) {
      WindowInsetsController c = getWindow().getInsetsController();
      if (c == null) return;
      if (ac) {
        c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
        c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
      } else {
        c.show(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
      }
    } else {
      // API 30 oncesi: eski bayraklar. minSdk 26 oldugu icin duruyor.
      View d = getWindow().getDecorView();
      d.setSystemUiVisibility(ac
          ? (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
             | View.SYSTEM_UI_FLAG_FULLSCREEN
             | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
             | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
             | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
             | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION)
          : 0);
    }
  }

  private FrameLayout ustKatman;

  /**
   * Panelin uzerine tam ekran bir tarayici katmani. Yan yana degil ust uste:
   * tablette yan yana zaten dar kaliyor, ustelik yan yana olmasi icin WebView'i
   * pane'in geometrisiyle surekli hizalamak gerekirdi.
   */
  private void miniTarayiciAc(String url) {
    miniTarayiciKapat();

    ustKatman = new FrameLayout(this);
    ustKatman.setBackgroundColor(Color.parseColor("#0e1013"));

    LinearLayout kok = new LinearLayout(this);
    kok.setOrientation(LinearLayout.VERTICAL);

    LinearLayout cubuk = new LinearLayout(this);
    cubuk.setOrientation(LinearLayout.HORIZONTAL);
    cubuk.setGravity(Gravity.CENTER_VERTICAL);
    cubuk.setPadding(24, 16, 24, 16);
    cubuk.setBackgroundColor(Color.parseColor("#16191e"));

    Button kapat = new Button(this);
    kapat.setText("✕");
    kapat.setOnClickListener(v -> miniTarayiciKapat());
    cubuk.addView(kapat);

    TextView adres = new TextView(this);
    adres.setText(url);
    adres.setTextColor(Color.parseColor("#9aa3b0"));
    adres.setSingleLine(true);
    adres.setPadding(16, 0, 0, 0);
    cubuk.addView(adres);

    final WebView mini = new WebView(this);
    mini.getSettings().setJavaScriptEnabled(true);
    mini.getSettings().setDomStorageEnabled(true);
    mini.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return false; }
    });
    mini.setWebChromeClient(new WebChromeClient());

    kok.addView(cubuk, new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    kok.addView(mini, new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
    ustKatman.addView(kok);

    addContentView(ustKatman, new ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    mini.loadUrl(url);
  }

  private void miniTarayiciKapat() {
    if (ustKatman == null) return;
    ViewGroup ebeveyn = (ViewGroup) ustKatman.getParent();
    if (ebeveyn != null) ebeveyn.removeView(ustKatman);
    ustKatman = null;
  }

  /**
   * Arka plandan donunce WebView'i ve zamanlayicilarini acikca uyandiriyoruz.
   * Android bazi durumlarda arka plandaki WebView'in JS zamanlayicilarini
   * durduruyor; o zaman WebSocket sessizlesiyor ve sayfa kaldigi yerde
   * donuyor. Sayfa tarafinda ayrica visibilitychange ile tuval yeniden
   * ciziliyor (bkz. term.js) — ikisi farkli katmanlar, ikisi de gerekiyor.
   */
  @Override
  protected void onResume() {
    super.onResume();
    if (web != null) { web.onResume(); web.resumeTimers(); }
  }

  /** Geri tusu sayfada geri gitsin, uygulamadan cikmasin. */
  @Override
  public void onBackPressed() {
    if (ustKatman != null) { miniTarayiciKapat(); return; }
    if (web != null && web.canGoBack()) web.goBack();
    else super.onBackPressed();
  }

  /** Adresi degistirmek icin: uygulama verisini silmeden basit bir yol. */
  @Override
  protected void onNewIntent(android.content.Intent intent) {
    super.onNewIntent(intent);
    if (intent != null && intent.getBooleanExtra("reset", false)) {
      prefs().edit().remove(KEY_URL).apply();
      showUrlPrompt(null);
      Toast.makeText(this, "Adres sıfırlandı", Toast.LENGTH_SHORT).show();
    }
  }
}
