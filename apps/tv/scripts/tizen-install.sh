#!/usr/bin/env bash
# Instalación por IP en un Samsung TV (Tizen).
#
# El Samsung NO es Android: no hay adb ni APK. Corre Tizen, que instala web apps
# empaquetadas en .wgt y se conecta por red con `sdb` (el adb de Samsung) al
# puerto 26101. Así que este script exporta la app de Expo a web, la empaqueta
# como widget firmado y la instala en el TV por IP.
#
# Uso:
#   ./scripts/tizen-install.sh 192.168.0.42            # build + instalar
#   ./scripts/tizen-install.sh 192.168.0.42 --launch   # además arrancarla
#   ./scripts/tizen-install.sh 192.168.0.42 --no-build # reinstalar el .wgt ya armado
#
# Variables:
#   BMO_TV_IP            IP del TV (alternativa al primer argumento)
#   TIZEN_STUDIO         instalación de Tizen Studio (default ~/tizen-studio)
#   TIZEN_PROFILE        perfil de firma de security-profiles (default: bmo)
#   EXPO_PUBLIC_API_URL  URL del API para el bundle; sin esto el TV intenta
#                        derivarla del host de Metro, que en un .wgt no existe
#                        → pon aquí la IP de la Mac, p.ej. http://192.168.0.10:3000
#
# Requisitos de una sola vez, en TIZEN.md: Tizen Studio + TV extension,
# perfil de certificado, y Developer Mode del TV apuntando a la IP del Mac.

set -euo pipefail

cd "$(dirname "$0")/.."

APP_ID="bmostreamg.BMOTV"
PKG_ID="bmostreamg"
WEB_DIR=".tizen-web"      # export crudo de Expo
BUILD_DIR=".tizen-build"  # raíz del widget (lo que termina dentro del .wgt)
WGT_NAME="bmo-tv.wgt"
JS_TARGET="${TIZEN_JS_TARGET:-chrome63}"
PROFILE="${TIZEN_PROFILE:-bmo}"
TIZEN_STUDIO="${TIZEN_STUDIO:-$HOME/tizen-studio}"

TIZEN="$TIZEN_STUDIO/tools/ide/bin/tizen"
SDB="$TIZEN_STUDIO/tools/sdb"

IP=""
DO_BUILD=1
DO_LAUNCH=0
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --launch)   DO_LAUNCH=1 ;;
    -*)         echo "Opción desconocida: $arg"; exit 1 ;;
    *)          IP="$arg" ;;
  esac
done
IP="${IP:-${BMO_TV_IP:-}}"

if [ -z "$IP" ]; then
  echo "Falta la IP del TV. Está en Menú → Configuración → Red → Estado de la red."
  echo "  ./scripts/tizen-install.sh 192.168.0.42"
  exit 1
fi

for bin in "$TIZEN" "$SDB"; do
  [ -x "$bin" ] || {
    echo "No encuentro $bin"
    echo "Instalá Tizen Studio + la TV extension (ver TIZEN.md) o exportá TIZEN_STUDIO=<ruta>."
    exit 1
  }
done

# ── 1. Export web ────────────────────────────────────────────────────────────
# La app de TV comparte todo el código con la versión nativa; en web el motor
# VLC cae al <video> del sistema (vendor/react-native-video-vlc/VideoVLC.web.tsx)
# y expo-video usa el reproductor del navegador del TV.
if [ "$DO_BUILD" -eq 1 ]; then
  [ -d node_modules ] || { echo "Falta node_modules: npm install --legacy-peer-deps"; exit 1; }

  echo "▸ Exportando la app a web…"
  rm -rf "$WEB_DIR" "$BUILD_DIR"
  ./node_modules/.bin/expo export -p web --output-dir "$WEB_DIR"

  # ── 1b. Transpilado para el Chromium del TV ────────────────────────────────
  # Metro emite el bundle web con sintaxis moderna (`?.`, `??`, `||=`), que es
  # Chrome 80/85 para arriba. El AU7090 (Tizen 6.0) trae Chromium 76: el bundle
  # ni siquiera parsea y la app queda en NEGRO, sin error visible. esbuild lo
  # baja de nivel. Subí el target si tu TV es más nuevo (Tizen 6.5 = chrome85,
  # 7.0 = chrome94) — cuanto más alto, menos reescritura.
  echo "▸ Transpilando el bundle a $JS_TARGET…"
  for bundle in "$WEB_DIR"/_expo/static/js/web/*.js; do
    npx --yes esbuild@0.25.0 "$bundle" --target="$JS_TARGET" --minify \
      --allow-overwrite --outfile="$bundle" --log-level=warning
  done

  # ── 2. Rutas relativas ─────────────────────────────────────────────────────
  # Expo emite rutas absolutas ("/_expo/…", "/assets/…"). Dentro del widget el
  # documento se sirve por file://, donde "/" es la raíz del disco del TV y todo
  # eso da 404: hay que dejarlas relativas al index.html.
  echo "▸ Reescribiendo rutas absolutas a relativas (file:// del widget)…"
  find "$WEB_DIR" -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' \) -print0 |
    xargs -0 sed -i '' \
      -e 's|"/_expo/|"./_expo/|g' \
      -e 's|"/assets/|"./assets/|g' \
      -e 's|href="/favicon|href="./favicon|g'

  # ── 3. Armado del widget ───────────────────────────────────────────────────
  mkdir -p "$BUILD_DIR"
  cp -R "$WEB_DIR"/. "$BUILD_DIR"/
  cp tizen/config.xml "$BUILD_DIR"/config.xml
  # Arranque propio del TV (routing bajo file:// + tecla RETURN del control),
  # cargado antes del bundle de Expo.
  # BMO_LOG_URL (opcional): endpoint donde el widget deja los errores de
  # arranque. En el TV no hay dlog ni inspector, así que sin esto la única señal
  # es el overlay rojo en pantalla.
  sed -e "s|__BMO_LOG_ENDPOINT__|${BMO_LOG_URL:-}|" tizen/tizen-boot.js > "$BUILD_DIR"/tizen-boot.js
  # Navegación por cruceta y botón OK: el WebView del TV no las trae.
  cp tizen/tizen-remote.js "$BUILD_DIR"/tizen-remote.js
  sed -i '' -e 's|<script src="./_expo|<script src="./tizen-boot.js"></script><script src="./tizen-remote.js"></script><script src="./_expo|' \
    "$BUILD_DIR/index.html"
  grep -q 'tizen-boot.js' "$BUILD_DIR/index.html" || {
    echo "No pude inyectar tizen-boot.js en index.html — cambió el formato del export."
    exit 1
  }
  # Tizen quiere un PNG cuadrado; el icono de TV es 1024 y lo bajamos a 512.
  if command -v sips >/dev/null 2>&1; then
    sips -Z 512 assets/tv_icons/icon-bmo-black.png --out "$BUILD_DIR/icon.png" >/dev/null
  else
    cp assets/tv_icons/icon-bmo-black.png "$BUILD_DIR/icon.png"
  fi

  # ── 4. Firma y empaquetado ─────────────────────────────────────────────────
  echo "▸ Empaquetando .wgt con el perfil '$PROFILE'…"
  if ! "$TIZEN" security-profiles list 2>/dev/null | grep -qw "$PROFILE"; then
    echo "No existe el perfil de firma '$PROFILE'. Creá los certificados (ver TIZEN.md):"
    echo "  $TIZEN certificate -a bmo -p <clave> -n \"Rodrigo Ruiz\" -f bmo"
    echo "  $TIZEN security-profiles add -n $PROFILE -a ~/tizen-studio-data/keystore/author/bmo.p12 -p <clave>"
    exit 1
  fi
  "$TIZEN" package -t wgt -s "$PROFILE" -- "$BUILD_DIR"
  # `tizen package` nombra el .wgt con el <name> del config.xml → "BMO TV.wgt".
  # El espacio complica el paso a `tizen install -n`, así que lo normalizamos.
  built="$(ls -t "$BUILD_DIR"/*.wgt | head -1)"
  [ "$built" = "$BUILD_DIR/$WGT_NAME" ] || mv "$built" "$BUILD_DIR/$WGT_NAME"
fi

[ -f "$BUILD_DIR/$WGT_NAME" ] || {
  echo "No hay $BUILD_DIR/$WGT_NAME (corré sin --no-build)."
  exit 1
}

# ── 5. Conexión por IP ───────────────────────────────────────────────────────
# 26101 es el puerto de sdb; lo abre el Developer Mode del TV, y ese modo sólo
# acepta conexiones desde la IP que cargaste en el propio TV.
echo "▸ Conectando a $IP:26101…"
"$SDB" connect "$IP:26101" >/dev/null || true
sleep 1

TARGET="$("$SDB" devices | awk -v ip="$IP" '$1 ~ ip && $2 == "device" { print $3 }' | head -1)"
if [ -z "$TARGET" ]; then
  echo "El TV no aparece conectado. Revisá que:"
  echo "  · Developer Mode esté ON (Apps → 12345 → Developer mode) con la IP de esta Mac."
  echo "  · El TV esté en la misma red y hayas reiniciado el TV después de activarlo."
  "$SDB" devices
  exit 1
fi
echo "  conectado: $TARGET"

# ── 6. Instalación ───────────────────────────────────────────────────────────
# Se apunta por SERIAL (<ip>:26101) y no por nombre: el nombre que reporta un
# Samsung es el modelo del TV y suele traer espacios.
echo "▸ Instalando $WGT_NAME…"
"$TIZEN" install -n "$WGT_NAME" -s "$IP:26101" -- "$BUILD_DIR"

if [ "$DO_LAUNCH" -eq 1 ]; then
  echo "▸ Arrancando $APP_ID…"
  # `tizen run -p` quiere el APP id (pkgid.Nombre), no el package id, aunque la
  # ayuda del CLI diga "package ID". El fallback es el launcher de web apps del
  # propio TV.
  "$TIZEN" run -p "$APP_ID" -s "$IP:26101" ||
    "$SDB" -s "$IP:26101" shell 0 was_execute "$APP_ID"
fi

echo "✓ Listo. La app queda en la fila de apps del TV como 'BMO TV' (paquete $PKG_ID)."
