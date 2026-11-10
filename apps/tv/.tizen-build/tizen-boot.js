/**
 * Arranque del widget en Samsung TV (Tizen). Se carga ANTES del bundle de Expo;
 * lo copia e inyecta scripts/tizen-install.sh.
 *
 * Cuatro cosas, todas propias de correr bajo file:// en un TV viejo:
 *  1. Polyfills de APIs que el Chromium del TV no tiene (el AU7090 es M76). La
 *     sintaxis moderna la baja esbuild en el build; esto cubre lo que es
 *     runtime y no se puede transpilar.
 *  2. Reporte de errores VISIBLE. Sin inspector remoto ni dlog en un TV retail,
 *     un error de arranque es una pantalla negra muda; acá se pinta en pantalla
 *     (y, si se definió BMO_LOG_URL en el build, se manda a la Mac).
 *  3. history.pushState con rutas absolutas tira SecurityError (el documento
 *     tiene origen opaco) y expo-router lo usa en cada navegación.
 *  4. La tecla RETURN del control llega como `tizenhwkey`, no como "atrás".
 */
(function () {
  if (typeof window === 'undefined') return

  // ── 1. Polyfills de runtime ───────────────────────────────────────────────
  if (typeof window.structuredClone !== 'function') {
    window.structuredClone = function (value) {
      return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
    }
  }
  if (typeof Object.hasOwn !== 'function') {
    Object.hasOwn = function (obj, key) {
      return Object.prototype.hasOwnProperty.call(obj, key)
    }
  }
  if (typeof String.prototype.replaceAll !== 'function') {
    String.prototype.replaceAll = function (search, replacement) {
      if (search instanceof RegExp) return this.replace(search, replacement)
      return this.split(search).join(replacement)
    }
  }
  if (typeof Array.prototype.at !== 'function') {
    Array.prototype.at = function (i) {
      var n = Math.trunc(i) || 0
      if (n < 0) n += this.length
      return n < 0 || n >= this.length ? undefined : this[n]
    }
  }

  // ── 1b. Escala de la interfaz ─────────────────────────────────────────────
  // El widget abre un viewport de 1920 CSS px, pero TODA la UI de BMO TV está
  // calibrada contra los ~960 dp que reporta un TV 1080p en nativo (lo dice el
  // comentario de src/bmo/theme.ts): sin corregirlo la app se dibuja a la mitad
  // de tamaño, apretada contra el borde superior izquierdo. El <meta viewport>
  // no sirve — el WebView del TV es de clase escritorio y lo ignora—, así que
  // se escala con `zoom`, que sí achica el espacio de layout a 960 dp.
  var DESIGN_WIDTH = 960
  var baseW = document.documentElement.clientWidth || window.innerWidth
  var baseH = document.documentElement.clientHeight || window.innerHeight
  var scale = Math.max(1, baseW / DESIGN_WIDTH)
  document.documentElement.style.zoom = String(scale)

  // Con `zoom` el layout ya vive en 960 dp, pero react-native-web sigue leyendo
  // el viewport real para `Dimensions`/`useWindowDimensions` (lo usan el Hero y
  // la lista de episodios para calcular altos). Se lo corregimos en la fuente:
  // primero sacando visualViewport, que es lo que mira primero.
  try {
    Object.defineProperty(window, 'visualViewport', { get: function () { return undefined } })
  } catch (e) { /* si no se deja redefinir, queda el fallback de abajo */ }
  try {
    Object.defineProperty(document.documentElement, 'clientWidth', {
      get: function () { return Math.round((window.innerWidth || baseW) / scale) },
    })
    Object.defineProperty(document.documentElement, 'clientHeight', {
      get: function () { return Math.round((window.innerHeight || baseH) / scale) },
    })
  } catch (e) { /* idem */ }

  // ── 2. Errores a la vista ─────────────────────────────────────────────────
  // El endpoint lo reemplaza el instalador con BMO_LOG_URL (ej.
  // http://192.168.0.131:9999/log); si queda vacío, sólo se pinta en pantalla.
  var ENDPOINT = ''
  var box = null

  function beacon(kind, msg) {
    if (ENDPOINT.indexOf('http') !== 0) return
    try {
      // GET por <img>: no dispara preflight ni depende de CORS.
      new Image().src =
        ENDPOINT + '?k=' + encodeURIComponent(kind) + '&m=' + encodeURIComponent(String(msg).slice(0, 900))
    } catch (e) { /* sin red no hay nada que hacer */ }
  }

  function paint(msg) {
    if (!document.body) return
    if (!box) {
      box = document.createElement('div')
      box.setAttribute('style', [
        'position:fixed', 'left:0', 'top:0', 'right:0', 'z-index:99999',
        'max-height:60%', 'overflow:auto', 'background:rgba(120,0,0,0.92)',
        'color:#fff', 'font:16px monospace', 'padding:16px', 'white-space:pre-wrap',
      ].join(';'))
      document.body.appendChild(box)
    }
    box.appendChild(document.createTextNode(msg + '\n'))
  }

  function report(kind, msg) {
    paint('[' + kind + '] ' + msg)
    beacon(kind, msg)
  }

  window.addEventListener('error', function (e) {
    // Un <script> que no parsea llega sin `message` útil pero sí con filename.
    report('error', (e.message || 'script error') + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0))
  })
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason
    report('reject', (r && (r.stack || r.message)) || String(r))
  })
  // La CSP del widget bloquea en silencio (no es un error de JS): sin esta
  // escucha, un `style-src` restrictivo se ve sólo como una app en blanco.
  document.addEventListener('securitypolicyviolation', function (e) {
    report('csp', e.violatedDirective + ' ← ' + (e.blockedURI || 'inline'))
  })
  beacon('boot', window.innerWidth + 'x' + window.innerHeight + ' zoom=' + scale +
    ' dp=' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight +
    ' | ' + navigator.userAgent)

  // Sin pantalla a la vista, "no hubo errores" no alcanza para saber si la app
  // realmente pintó: a los 8s reportamos qué hay colgando de #root.
  if (ENDPOINT.indexOf('http') === 0) {
    setTimeout(function () {
      var root = document.getElementById('root')
      var text = root ? (root.textContent || '').replace(/\s+/g, ' ').slice(0, 60) : ''
      beacon('mount', root ? root.childElementCount + ' hijos | ' + text : 'sin #root')

      // Diagnóstico de estilos: si el CSS de react-native-web no entra, el árbol
      // queda con texto blanco sobre fondo blanco (o sea, pantalla en blanco).
      var rules = 0
      for (var i = 0; i < document.styleSheets.length; i++) {
        try { rules += document.styleSheets[i].cssRules.length } catch (e) { /* opaco */ }
      }
      var first = root && root.firstElementChild
      var cs = first ? window.getComputedStyle(first) : null
      var rnss = document.getElementById('react-native-stylesheet')
      beacon('css2', [
        'styles=' + document.querySelectorAll('style').length,
        'rnss=' + (rnss ? 'si' : 'NO'),
        'rnssReglas=' + (rnss && rnss.sheet ? rnss.sheet.cssRules.length : -1),
        'rnssTexto=' + (rnss ? String(rnss.textContent).length : -1),
        'head=' + document.head.innerHTML.length,
      ].join(' | '))
      beacon('css', [
        'hojas=' + document.styleSheets.length,
        'reglas=' + rules,
        'body=' + window.getComputedStyle(document.body).backgroundColor,
        'root1=' + (cs ? cs.backgroundColor + ' color:' + cs.color : 'n/a'),
        'clases=' + (first ? (first.className || '').slice(0, 60) : 'n/a'),
      ].join(' | '))
    }, 8000)
  }

  // ── 3. Routing bajo file:// ───────────────────────────────────────────────
  try {
    window.history.pushState({}, '', window.location.href)
  } catch (e) {
    var noop = function () {}
    window.history.pushState = noop
    window.history.replaceState = noop
    beacon('boot', 'history.pushState deshabilitado: ' + e)
  }

  // ── 4. Tecla RETURN del control remoto ────────────────────────────────────
  document.addEventListener('tizenhwkey', function (e) {
    if (e.keyName !== 'back') return
    var ev = new KeyboardEvent('keydown', { keyCode: 10009, bubbles: true })
    var consumed = !document.dispatchEvent(ev)
    if (consumed) return
    // Nadie manejó el back: en el TV lo esperado es salir al menú de apps.
    try {
      window.tizen.application.getCurrentApplication().exit()
    } catch (err) {
      /* fuera de Tizen (probando en un navegador) no hay nada que cerrar */
    }
  })
})()
