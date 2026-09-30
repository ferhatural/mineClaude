package tech.mineclaude.wrap;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import android.app.Activity;

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

  private TermWebView web;
  /**
   * Tus teshisi. Kapali: eslesen kombinasyonlar zaten sessizce calisiyor,
   * her basista bildirim gostermek gunluk kullanimda rahatsiz ediyor. Acmak
   * gerekirse true yapip yeniden derlemek yeterli — eslenemeyen Ctrl'lu
   * kombinasyonlari keyCode ve unicode degeriyle gosteriyor.
   */
  private boolean tehis = false;

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
    s.setSupportZoom(false);
    web.setBackgroundColor(Color.parseColor("#0e1013"));

    // Baglantilari disari atmiyoruz: panel kendi icinde geziyor.
    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return false; }
      @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
        // Yalniz ana belge hatasi ilgilendiriyor; alt istekler (ikon vb.) degil.
        if (r != null && r.isForMainFrame()) {
          showUrlPrompt("Bağlanılamadı: " + (e != null ? e.getDescription() : "bilinmeyen hata"));
        }
      }
    });
    // Konsol/izin koprusu: pano ve bildirim gibi seyler icin gerekli.
    web.setWebChromeClient(new WebChromeClient());

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

    @Override
    public boolean dispatchKeyEventPreIme(KeyEvent e) {
      if (e.getAction() == KeyEvent.ACTION_DOWN && e.isCtrlPressed()) {
        int kc = e.getKeyCode();
        boolean ctrlTusu = kc == KeyEvent.KEYCODE_CTRL_LEFT || kc == KeyEvent.KEYCODE_CTRL_RIGHT;
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

  /** Kontrol karakterini sayfaya, DOM olayina hic dokunmadan veriyoruz. */
  private void yazTerminale(int kod) {
    web.evaluateJavascript(
        "window.MTerm && MTerm.sendKey(String.fromCharCode(" + kod + "))", null);
  }

  /** Geri tusu sayfada geri gitsin, uygulamadan cikmasin. */
  @Override
  public void onBackPressed() {
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
