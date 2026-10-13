// Applies the saved theme before first paint to avoid a light/dark flash.
// External (not inline) so the Content-Security-Policy can forbid inline scripts.
;(function () {
  try {
    var p = JSON.parse(localStorage.getItem('devtoolkit:prefs') || '{}')
    var t = (p.state && p.state.theme) || 'system'
    var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    if (dark) document.documentElement.classList.add('dark')
  } catch (e) {
    document.documentElement.classList.add('dark')
  }
})()
