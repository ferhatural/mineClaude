#!/bin/bash
# mineClaude'i son surumden kurar.
#
#   curl -fsSL https://raw.githubusercontent.com/ferhatural/mineClaude/main/install.sh | bash
#
# Yaptigi is: GitHub Releases'ten bu makinenin mimarisine uyan DMG'yi indirir,
# baglar, /Applications'a kopyalar, karantina isaretini kaldirir, cikarir, acar.
#
# Karantina neden kaldiriliyor: uygulama imzali degil (Apple Developer hesabi
# gerektiriyor). Imzasiz bir uygulama tarayicidan indirilince macOS onu acmayi
# reddediyor. Kodun tamami repoda; imzalamak icin hesabin varsa
# CSC_IDENTITY_AUTO_DISCOVERY'i acip kendin build alabilirsin.

set -euo pipefail

REPO="ferhatural/mineClaude"
APP="mineClaude.app"

say()  { printf '  %s\n' "$*"; }
die()  { printf '\n  hata: %s\n\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "bu betik yalniz macOS icin. Diger sistemlerde: node server.js"

case "$(uname -m)" in
  arm64)  ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *)      die "bilinmeyen mimari: $(uname -m)" ;;
esac

printf '\n'
say "mimari    : $ARCH"

# En son surumun etiketi: /releases/latest kalicilastirilmis etikete yonlendiriyor,
# JSON ayristirmaya gerek yok.
FINAL_URL="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest")" \
  || die "GitHub'a ulasilamadi"
TAG="${FINAL_URL##*/}"
case "$TAG" in
  v*) ;;
  *)  die "yayinlanmis bir surum bulunamadi (https://github.com/$REPO/releases)" ;;
esac
VERSION="${TAG#v}"
say "surum     : $TAG"

DMG_URL="https://github.com/$REPO/releases/download/$TAG/mineClaude-$VERSION-$ARCH.dmg"

TMP="$(mktemp -d)"
MOUNT=""
cleanup() {
  [ -n "$MOUNT" ] && hdiutil detach "$MOUNT" -quiet 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

say "indiriliyor: $DMG_URL"
curl -fL --progress-bar -o "$TMP/mineClaude.dmg" "$DMG_URL" || die "indirilemedi: $DMG_URL"

MOUNT="$TMP/mnt"
mkdir -p "$MOUNT"
hdiutil attach "$TMP/mineClaude.dmg" -mountpoint "$MOUNT" -nobrowse -quiet || die "DMG baglanamadi"
[ -d "$MOUNT/$APP" ] || die "DMG icinde $APP yok"

# Nereye kuralim: /Applications yazilabiliyorsa oraya, degilse kullaniciya ozel klasore
DEST="/Applications"
if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
  say "not       : /Applications yazilamiyor, $DEST kullaniliyor"
fi

# Calisan bir kopya varsa kapat, yoksa uzerine kopyalama yarim kalir
if pgrep -f "$DEST/$APP/Contents/MacOS/mineClaude" >/dev/null 2>&1; then
  say "kapatiliyor: calisan mineClaude"
  pkill -f "$DEST/$APP/Contents/MacOS/mineClaude" || true
  sleep 1
fi

if [ -e "$DEST/$APP" ]; then
  say "siliniyor : eski $DEST/$APP"
  rm -rf "${DEST:?}/$APP"
fi

# Proje 1.1.0'da ccwatch adindan mineClaude'a gecti. Eski kurulum baska bir isimde
# durdugu icin ustune yazilmiyor, ayrica silinmesi gerekiyor — yoksa Applications'ta
# ayni programin iki kopyasi kaliyor ve eskisi 7788'i kapabiliyor.
if [ -e "$DEST/ccwatch.app" ]; then
  say "siliniyor : eski adiyla kalan $DEST/ccwatch.app"
  pkill -f "$DEST/ccwatch.app/Contents/MacOS/ccwatch" 2>/dev/null || true
  sleep 1
  rm -rf "${DEST:?}/ccwatch.app"
fi

say "kopyalaniyor -> $DEST/$APP"
cp -R "$MOUNT/$APP" "$DEST/$APP"

# Imzasiz uygulama: karantina isareti kalirsa macOS acmiyor
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true

printf '\n  kuruldu: %s\n' "$DEST/$APP"
printf '  aciliyor...\n\n'
open "$DEST/$APP"
