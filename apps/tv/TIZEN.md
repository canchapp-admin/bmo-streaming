# BMO TV en Samsung TV (Tizen) — instalación por IP

Los Samsung **no** son Android TV: corren Tizen, que no instala APKs. Las apps
son *web apps* empaquetadas en `.wgt` y se instalan por red con `sdb` (el adb de
Samsung) contra el puerto **26101** del TV.

Por eso la instalación por IP aquí es: **export web de Expo → widget firmado →
`sdb connect <ip>` → install**. Todo eso lo hace un comando:

```bash
cd apps/tv && ./scripts/tizen-install.sh 192.168.0.166 --launch
```

## Preparación (una sola vez)

### 1. Tizen Studio en la Mac — ya instalado

Está el paquete **web-cli de Tizen Studio 6.1** (CLI 2.5.25) en `~/tizen-studio`,
que es lo que hace falta para empaquetar y para `sdb`. Si alguna vez lo mueves,
exporta `TIZEN_STUDIO=<ruta>`. Los binarios que usa el script son
`~/tizen-studio/tools/ide/bin/tizen` y `~/tizen-studio/tools/sdb`.

Para reinstalarlo en otra máquina:

```bash
curl -O http://download.tizen.org/sdk/Installer/tizen-studio_6.1/web-cli_Tizen_Studio_6.1_macos-64.bin
chmod +x web-cli_Tizen_Studio_6.1_macos-64.bin
./web-cli_Tizen_Studio_6.1_macos-64.bin --accept-license --no-java-check ~/tizen-studio
```

(El *Package Manager* con IDE y TV Extensions no hace falta para este flujo:
sirve para el emulador de TV y las plantillas.)

### 2. Certificado y perfil de firma — ya creado

Un `.wgt` sin firmar no instala. Ya está el certificado *author* local `bmo`
(`~/tizen-studio-data/keystore/author/bmo.p12`) y el perfil de firma `bmo`, que
es el que usa el script por defecto (`TIZEN_PROFILE` lo cambia). La clave del
certificado no se versiona: el perfil de firma ya la tiene guardada en la Mac.

Para rehacerlos:

```bash
~/tizen-studio/tools/ide/bin/tizen certificate -a bmo -p <clave> -n "BMO Dev" -f bmo
~/tizen-studio/tools/ide/bin/tizen security-profiles add -n bmo \
  -a ~/tizen-studio-data/keystore/author/bmo.p12 -p <clave>
```

> Para distribuir fuera de tu TV hace falta el certificado de *Samsung* (cuenta
> Samsung Developer + DUID del televisor), no este.

### 3. Developer Mode en el TV — ya hecho

En el televisor: **Apps → presionar `12345` en el control → Developer mode: On →
Host PC IP: `<IP de la Mac>` → reiniciar el TV**. Ese modo es el que abre el
puerto 26101, y sólo acepta conexiones desde la IP que cargaste ahí (esta Mac es
`192.168.0.131`). Si la IP no coincide, el TV acepta el TCP y corta el handshake:
`sdb connect` responde `failed to connect` con el puerto igual abierto.

La IP del TV está en **Configuración → Red → Estado de la red**.

## Uso

```bash
cd apps/tv
npm install --legacy-peer-deps                      # apps/tv está fuera del workspace de bun

# build + instalación en el TV de casa (192.168.0.166)
EXPO_PUBLIC_API_URL=https://bmo-streaming-api.vercel.app ./scripts/tizen-install.sh 192.168.0.166

./scripts/tizen-install.sh 192.168.0.166 --launch    # además la arranca
./scripts/tizen-install.sh 192.168.0.166 --no-build  # reinstala el .wgt ya armado
```

**`EXPO_PUBLIC_API_URL` no es opcional en el TV.** En nativo el API se deriva del
host de Metro (`packages/core/src/api.ts`); dentro de un `.wgt` no hay Metro. Lo
normal es apuntar al API de Vercel (como hace `apps/client/.env`); para usar
el API local, usa la IP de la Mac, p.ej. `http://192.168.0.131:3000`.

**Supabase queda sin configurar.** `EXPO_PUBLIC_SUPABASE_URL` y
`EXPO_PUBLIC_SUPABASE_ANON_KEY` no están ni en un `.env` de `apps/tv` ni en las
variables de EAS, así que el bundle del TV sale sin ellas y el login no puede
funcionar hasta que se pasen al build:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://<proyecto>.supabase.co \
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon> \
EXPO_PUBLIC_API_URL=https://bmo-streaming-api.vercel.app \
  ./scripts/tizen-install.sh 192.168.0.166 --launch
```

Ojo: la pantalla de login del TV sólo hace `signInWithPassword`. El alta de
usuarios está en la app de teléfono (`apps/client/app/login.tsx` usa `signUp`) o
en el panel de Supabase.

Para probar el widget sin TV, sírvelo por HTTP y ábrelo en el navegador:

```bash
cd apps/tv/.tizen-build && python3 -m http.server 8099
```

## Qué toca el pipeline

| Archivo | Para qué |
| --- | --- |
| `scripts/tizen-install.sh` | export web → rutas relativas → widget → `sdb connect` → install |
| `tizen/config.xml` | manifiesto del widget (app id `bmostreamg.BMOTV`, privilegios, landscape, CSP) |
| `tizen/tizen-boot.js` | escala de la UI, polyfills, reporte de errores, routing `file://`, tecla RETURN |
| `tizen/tizen-remote.js` | navegación por cruceta y botón OK (el WebView del TV no las trae) |
| paso de `esbuild` | baja la sintaxis del bundle al Chromium del TV (ver abajo) |
| `src/bmo/tvEvents.web.ts` | `useTVEventHandler` con las teclas del mando Samsung |
| `vendor/react-native-video-vlc/src/VideoVLC.web.tsx` | el motor VLC cae al `<video>` del TV |
| `src/app/+not-found.tsx` | `file:///…/index.html` no matchea ninguna ruta → redirige al inicio |
| `app.json` | `web.bundler: metro` y `web.output: single` (SPA, necesario para el widget) |

## Estado

Instalado y arrancando en el TV de casa: **UN43AU7090PXPA** (Samsung AU7090,
Tizen 6.0) en `192.168.0.166`, con `EXPO_PUBLIC_API_URL` apuntando al API de
Vercel. El flujo completo —export web, widget firmado, `sdb connect`, install y
launch— corre de punta a punta con un comando, y el widget monta la pantalla de
login en el TV con sus estilos aplicados (`hojas=5 | reglas=450`, los mismos
números que en Chrome de escritorio, sin errores de JS).

Los dos golpes que costaron una pantalla negra y una en blanco están abajo: el
transpilado y la CSP. Ninguno de los dos avisa con un error.

## El transpilado no es opcional

El TV reporta `Tizen 6.0 ... Chrome/76.0.3809.146`. Metro emite el bundle web con
`?.`, `??` y `||=`, que son Chrome 80/85 para arriba: el bundle **no parsea** y la
app arranca en **negro, sin ningún error a la vista**. Por eso el script pasa el
bundle por `esbuild --target=chrome63` antes de empaquetar.

Con un TV más nuevo puedes subir el target y ahorrarte reescritura:
`TIZEN_JS_TARGET=chrome85 ./scripts/tizen-install.sh <ip>` (Tizen 6.5 = chrome85,
7.0 = chrome94).

Lo que no es sintaxis sino API de runtime (`structuredClone`, `Object.hasOwn`,
`String.replaceAll`, `Array.at`) se polyfillea en `tizen/tizen-boot.js`.

## La CSP del widget

Los widgets de Tizen traen una CSP por defecto con `style-src 'self'`, y
react-native-web arma toda su hoja de estilos en un `<style>` inline. Con la CSP
por defecto el elemento se crea pero el TV no le asocia ningún `CSSStyleSheet`
(`element.sheet === null`) y **la app se ve en blanco**: el árbol queda sin una
sola regla, o sea texto negro sobre fondo blanco. No hay error de JS — el bloqueo
es silencioso.

Por eso `tizen/config.xml` declara una `<tizen:content-security-policy>` con
`'unsafe-inline'` en `style-src` (y `'unsafe-eval'` en `script-src`, que el
bundle necesita para los worklets). `tizen-boot.js` además escucha
`securitypolicyviolation` y reporta lo que la CSP bloquee.

## Escala de la interfaz

El widget abre un viewport de **1920x1080 CSS px**, pero toda la UI está
calibrada contra los ~960 dp que reporta un TV 1080p en nativo (lo explica
`src/bmo/theme.ts`). Sin corregirlo la app se dibuja a la mitad de tamaño,
amontonada arriba a la izquierda.

El `<meta viewport>` no sirve: el WebView del TV es de clase escritorio y lo
ignora. `tizen-boot.js` usa `document.documentElement.style.zoom`, que sí achica
el espacio de layout, y además parchea lo que lee react-native-web para
`Dimensions` (`visualViewport` y `documentElement.clientWidth/Height`), porque si
no el Hero y la lista de episodios calculan altos contra 1080 mientras dibujan
sobre 540. El TV confirma `zoom=2 dp=960x540`.

## Control remoto

El WebView del TV **no trae navegación espacial**: las flechas no mueven el foco
entre los `Pressable` (que react-native-web renderiza como `div[tabindex=0]`) y
el botón central tampoco los activa — un `keydown` de Enter sobre un Pressable
enfocado no dispara `onPress`, porque react-native-web escucha el sistema de
responders (pointer/mouse), no teclas.

`tizen/tizen-remote.js` hace lo que en nativo hace el motor de foco de Android
TV: elige el enfocable más cercano en la dirección de la flecha (penalizando la
desviación lateral), sintetiza `pointerdown/mousedown/pointerup/mouseup/click`
sobre el enfocado cuando llega OK, y reengancha el foco al primer enfocable
cuando cambia de pantalla. Cede el paso a la app: si la pantalla ya consumió la
flecha (el player hace seek desde `src/bmo/tvEvents.web.ts`), no interviene.

## Debug sin inspector

En un TV retail no hay `dlog` util ni inspector remoto (7011/7012 cerrados). Para
no diagnosticar a ciegas, `tizen-boot.js` pinta los errores en un overlay rojo
sobre la pantalla y, si le pasas `BMO_LOG_URL`, los manda por HTTP a la Mac:

```bash
python3 -m http.server 9999          # las URLs quedan en el log de acceso
BMO_LOG_URL=http://192.168.0.131:9999/log ./scripts/tizen-install.sh 192.168.0.166 --launch
```

Manda: `boot` (user agent), `mount` (qué hay colgando de `#root` a los 8s),
`css` / `css2` (hojas y reglas aplicadas — así se detectó el bloqueo de la CSP),
`csp`, y `error` / `reject`. Referencia de una app sana en este TV:
`hojas=5 | reglas=450`, con `rnssReglas=417` de react-native-web. Para forzar un arranque limpio hay que
matar la app primero, si no `tizen run` reusa el proceso:

```bash
~/tizen-studio/tools/sdb -s 192.168.0.166:26101 shell 0 was_kill bmostreamg.BMOTV
```

## Lo que falta verificar en el televisor

- **Worklets de Reanimated.** Quedan dos `??=` dentro de strings de worklet, que
  esbuild no puede tocar porque son código serializado. Si una animación tira
  `SyntaxError` en runtime, es eso.
- **Códecs.** En nativo las fuentes `file` van por libVLC (decodifica HEVC/DTS/mkv
  por software). En Tizen quedan en manos del decoder del TV: lo que no soporte
  dispara `onError` y el player pasa a la fuente siguiente, pero es probable que
  haya que ajustar el ranking de fuentes para el Samsung.
- **Navegación por cruceta** fuera del player: la resuelve `tizen/tizen-remote.js`
  (el WebView no trae navegación espacial), no el motor de foco nativo. Hay que
  revisar si el orden de foco queda razonable en las grillas.
- **Rutas bajo `file://`.** `tizen-boot.js` anula `history.pushState` si el TV lo
  rechaza; la navegación queda en memoria (que es lo correcto en TV), pero
  conviene confirmar que ninguna pantalla dependa de la URL.
- **Memoria.** El guard de `onTrimMemory` (`plugins/withLowMemory`) es de Android:
  en Tizen no hay equivalente.
