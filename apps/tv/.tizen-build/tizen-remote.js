/**
 * Control remoto en el widget de Samsung TV.
 *
 * El WebView del TV NO trae navegación espacial: las flechas del control no
 * mueven el foco entre los `Pressable` (que react-native-web renderiza como
 * divs con tabindex=0) y el botón central tampoco los activa — probado: un
 * `keydown` de Enter sobre un Pressable enfocado no dispara `onPress`, porque
 * react-native-web escucha el sistema de responders (pointer/mouse), no teclas.
 *
 * Así que acá va lo que en la app nativa hace el motor de foco de Android TV:
 *  · flechas → elegir el enfocable más cercano en esa dirección y enfocarlo
 *  · OK      → sintetizar la secuencia pointer/mouse sobre el enfocado
 *  · si no hay nada enfocado (arranque o cambio de pantalla), enfocar el primero
 *
 * Cede el paso a la app: si la pantalla ya consumió la tecla (el player usa las
 * flechas para hacer seek y llama a preventDefault desde `src/bmo/tvEvents.web`),
 * acá no se hace nada. Por eso la decisión se toma en un setTimeout: para ese
 * momento el evento ya pasó por los listeners de la app.
 */
(function () {
  if (typeof window === 'undefined') return

  var SELECTOR = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'
  var DIRS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' }

  function isVisible(el) {
    var r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return false
    // Fuera de la pantalla (repisas laterales, filas por debajo del pliegue) no
    // se descartan: el TV hace scroll al enfocar. Sí se descarta lo colapsado.
    return true
  }

  function candidates() {
    var all = document.querySelectorAll(SELECTOR)
    var out = []
    for (var i = 0; i < all.length; i++) if (isVisible(all[i])) out.push(all[i])
    return out
  }

  function centerOf(r) {
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }

  function focusFirst() {
    var list = candidates()
    if (list.length) list[0].focus()
    return list.length > 0
  }

  function move(dir) {
    var cur = document.activeElement
    if (!cur || cur === document.body || cur === document.documentElement) return focusFirst()

    var list = candidates()
    var cr = cur.getBoundingClientRect()
    var c = centerOf(cr)
    var best = null
    var bestScore = Infinity

    for (var i = 0; i < list.length; i++) {
      var el = list[i]
      if (el === cur) continue
      var r = el.getBoundingClientRect()
      var p = centerOf(r)
      var along, across

      // "Está en esa dirección" se mide por el borde, no por el centro: dos
      // botones de distinto alto en la misma fila tienen centros desalineados.
      if (dir === 'left') {
        if (r.right > cr.left + 1) continue
        along = c.x - p.x; across = Math.abs(p.y - c.y)
      } else if (dir === 'right') {
        if (r.left < cr.right - 1) continue
        along = p.x - c.x; across = Math.abs(p.y - c.y)
      } else if (dir === 'up') {
        if (r.bottom > cr.top + 1) continue
        along = c.y - p.y; across = Math.abs(p.x - c.x)
      } else {
        if (r.top < cr.bottom - 1) continue
        along = p.y - c.y; across = Math.abs(p.x - c.x)
      }

      // La desviación lateral pesa el doble: entre un vecino pegado pero
      // corrido y uno lejano pero alineado, en TV se espera el alineado.
      var score = along + across * 2
      if (score < bestScore) { bestScore = score; best = el }
    }

    if (best) best.focus()
    return !!best
  }

  function press(el) {
    if (!el || el === document.body) return
    var r = el.getBoundingClientRect()
    var x = r.left + r.width / 2
    var y = r.top + r.height / 2
    var base = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }
    var seq = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']
    for (var i = 0; i < seq.length; i++) {
      var type = seq[i]
      var ev
      if (type.indexOf('pointer') === 0 && typeof window.PointerEvent === 'function') {
        ev = new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y,
          button: 0, pointerId: 1, isPrimary: true, pointerType: 'mouse' })
      } else if (type.indexOf('pointer') === 0) {
        continue
      } else {
        ev = new MouseEvent(type, base)
      }
      el.dispatchEvent(ev)
    }
  }

  window.addEventListener('keydown', function (e) {
    var dir = DIRS[e.keyCode]
    if (!dir && e.keyCode !== 13) return
    // Diferido: recién acá se sabe si la pantalla (el player) consumió la tecla.
    setTimeout(function () {
      if (e.defaultPrevented) return
      if (dir) move(dir)
      else press(document.activeElement)
    }, 0)
  })

  // Al arrancar y en cada cambio de pantalla el foco queda en el <body> y el
  // botón OK no tendría sobre qué actuar. Se reengancha al primer enfocable.
  function ensureFocus() {
    var cur = document.activeElement
    if (!cur || cur === document.body || cur === document.documentElement || !cur.isConnected) {
      focusFirst()
    }
  }
  window.addEventListener('load', function () { setTimeout(ensureFocus, 600) })
  if (typeof MutationObserver === 'function') {
    var pending = null
    new MutationObserver(function () {
      clearTimeout(pending)
      pending = setTimeout(ensureFocus, 250)
    }).observe(document.documentElement, { childList: true, subtree: true })
  }
})()
