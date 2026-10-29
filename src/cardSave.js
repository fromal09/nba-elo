// Right-click (or long-press) any card for "Save card image": the card drawn to a PNG at twice its size.
// Cards carry data-card-shot="<file name>". Shift + right-click keeps the browser's own menu.
// The renderer (html-to-image, vendored in src/vendor) loads the first time someone saves.
let lib = null
const load = () => (lib ||= import('./vendor/html-to-image.js').catch(e => { lib = null; throw e }))

const slug = s => (s || 'card').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'card'

// The element to draw: a display:contents wrapper hands over to its first child
const target = el => (el && getComputedStyle(el).display === 'contents' ? el.firstElementChild : el)

// Another site's image would be left out of the drawing (no CORS), so each one is swapped for a same-origin copy
// (api/img.js) while the card is drawn, then put back
const proxied = src => `/api/img?u=${encodeURIComponent(src)}`
// The copy loads off-screen first, so a failed one never touches the card (its own onError would swap in initials)
const preload = url => new Promise(ok => {
  const im = new Image()
  im.onload = () => ok(true); im.onerror = () => ok(false)
  setTimeout(() => ok(false), 8000)
  im.src = url
})
async function localImages(el) {
  const imgs = [...el.querySelectorAll('img')].map(img => ({ img, src: img.currentSrc || img.src, set: img.getAttribute('srcset') }))
    .filter(x => /^https?:/.test(x.src) && new URL(x.src).origin !== location.origin)
  const ok = await Promise.all(imgs.map(x => preload(proxied(x.src))))
  const swapped = imgs.filter((x, i) => ok[i])
  await Promise.all(swapped.map(({ img, src }) => new Promise(done => {
    img.removeAttribute('srcset')
    img.src = proxied(src)
    img.complete ? done() : img.addEventListener('load', done, { once: true })
    setTimeout(done, 3000)
  })))
  return () => swapped.forEach(({ img, src, set }) => { if (set) img.setAttribute('srcset', set); img.src = src })
}

async function save(el, name) {
  const { toBlob } = await load()
  const restore = await localImages(el)
  try { await draw(el, name, toBlob) } finally { restore() }
}

async function draw(el, name, toBlob) {
  // Flip-card faces are turned in 3D; draw them flat and fully shown
  const blob = await toBlob(el, {
    pixelRatio: 2, cacheBust: false,
    style: { transform: 'none', margin: '0', backfaceVisibility: 'visible', opacity: '1' },
    // A headshot or logo that can't be fetched (no CORS) is left out instead of failing the whole image
    imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
    filter: n => !(n instanceof Element && n.closest?.('[data-no-shot]')),
  })
  if (!blob) throw new Error('empty')
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: `${slug(name)}.png` })
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

let menu = null
function close() { menu?.remove(); menu = null }

function show(x, y, el, name) {
  close()
  menu = document.createElement('div')
  menu.setAttribute('role', 'menu')
  Object.assign(menu.style, {
    position: 'fixed', zIndex: 5000, left: `${Math.min(x, innerWidth - 200)}px`, top: `${Math.min(y, innerHeight - 60)}px`,
    background: '#fff', borderRadius: '10px', boxShadow: '0 10px 30px rgba(0,0,0,.28)', padding: '6px', font: '600 13px Inter, Helvetica, Arial, sans-serif',
  })
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = 'Save card image'
  Object.assign(btn.style, { display: 'block', width: '100%', textAlign: 'left', border: 0, background: 'none', padding: '9px 14px', borderRadius: '7px', color: '#173657', font: 'inherit', cursor: 'pointer' })
  btn.onmouseenter = () => { btn.style.background = '#eef3f9' }
  btn.onmouseleave = () => { btn.style.background = 'none' }
  btn.onclick = async ev => {
    ev.stopPropagation()
    btn.textContent = 'Saving…'; btn.disabled = true
    try { await save(el, name); close() } catch { btn.textContent = 'Couldn’t save this card'; setTimeout(close, 1800) }
  }
  menu.appendChild(btn)
  menu.addEventListener('pointerdown', e => e.stopPropagation())
  menu.addEventListener('click', e => e.stopPropagation())
  document.body.appendChild(menu)
}

export function installCardSave() {
  const onMenu = e => {
    if (e.shiftKey) return
    const hit = e.target.closest?.('[data-card-shot]')
    if (!hit) return
    const el = target(hit)
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    show(e.clientX, e.clientY, el, hit.getAttribute('data-card-shot'))
  }
  const onDown = e => { if (menu && !menu.contains(e.target)) close() }
  const onKey = e => { if (e.key === 'Escape') close() }
  document.addEventListener('contextmenu', onMenu, true)
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('scroll', close, true)
  return () => {
    document.removeEventListener('contextmenu', onMenu, true)
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('scroll', close, true)
  }
}
