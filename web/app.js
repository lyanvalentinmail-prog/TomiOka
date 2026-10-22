/* TomiOka · Panel de despliegue (base web local, sin backend)
   - Sesión y sub-bots en localStorage.
   - La vinculación (pairing/QR) es simulada en pantalla. */
'use strict'

const MAX_BOTS = 3
const LS_USER = 'tomioka-panel-user'
const LS_BOTS = 'tomioka-panel-bots'

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => [...document.querySelectorAll(sel)]
const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value))
const digits = (value) => String(value ?? '').replace(/\D/g, '')
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))

function hashCode(text) {
  let hash = 0
  for (let i = 0; i < String(text).length; i += 1) hash = (hash * 31 + String(text).charCodeAt(i)) >>> 0
  return hash
}
const seeded = (seed, min, max) => min + (hashCode(seed) % (max - min + 1))

function toast(message) {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = message
  $('#toastBox').appendChild(el)
  setTimeout(() => el.remove(), 3600)
}

/* ════════════════ Datos de comandos (reales, src/commands/) ════════════════ */
const COMMANDS = [
  { name: 'sticker', aliases: ['s', 'stiker', 'figu'], category: 'Stickers', description: 'Crear sticker desde una imagen, video o GIF.' },
  { name: 'gif', aliases: ['stikergif', 'togif'], category: 'Stickers', description: 'Convertir un GIF o video en sticker animado.' },
  { name: 'steal', aliases: ['robar', 'copy', 'copiar'], category: 'Stickers', description: 'Copiar un sticker con el nombre del bot.' },
  { name: 'toimg', aliases: ['toimage', 'img'], category: 'Conversión', description: 'Convertir un sticker a imagen PNG.' },
  { name: 'tovideo', aliases: ['tomp4'], category: 'Conversión', description: 'Convertir un sticker a video MP4.' },
  { name: 'take', aliases: ['autor', 'rename'], category: 'Conversión', description: 'Cambiar nombre y autor de un sticker: .take Nombre | Autor' },
  { name: 'emojimix', aliases: ['mix'], category: 'Extras', description: 'Combinar dos emojis (Emoji Kitchen) o uno aleatorio.' },
  { name: 'pack', aliases: ['packsticker'], category: 'Extras', description: 'Armar un pack de stickers enviando varias fotos.' },
  { name: 'help', aliases: ['menu', 'comandos', 'ayuda', 'h'], category: 'Extras', description: 'Ver el menú de comandos o la ayuda de uno puntual.' },
  { name: 'debug', aliases: ['diag'], category: 'Extras', description: 'Diagnóstico del bot (FFmpeg, sesión, conversión). Oculto del menú.' }
]
const ALL_CATEGORIES = [...new Set(COMMANDS.map((cmd) => cmd.category))]

/* Usuarios de demostración para el panel de cada sub-bot */
const DEMO_PEOPLE = [
  ['Valentina Rodríguez', '59891234567'], ['Mateo Fernández', '59892345678'],
  ['Sofía Martínez', '59893456789'], ['Lucas Pereira', '59894567890'],
  ['Camila Torres', '59895678901'], ['Diego Sánchez', '59896789012'],
  ['Martina López', '59897890123'], ['Joaquín Silva', '59898901234'],
  ['Lucía Gómez', '59899012345'], ['Andrés Núñez', '59890123456']
]
function demoUsers(bot) {
  const offset = hashCode(bot.id) % 4
  const count = Math.min(DEMO_PEOPLE.length, 4 + (hashCode(bot.id + 'n') % 5))
  return Array.from({ length: count }, (_, i) => {
    const [name, base] = DEMO_PEOPLE[(offset + i) % DEMO_PEOPLE.length]
    const phone = base.slice(0, 8) + String(10 + ((hashCode(bot.id + name) % 89)))
    return {
      name,
      phone,
      img: 12 + ((hashCode(name + bot.id) % 55) + 1),
      commands: seeded(bot.id + name + 'c', 3, 240),
      stickers: seeded(bot.id + name + 's', 0, 90),
      daysAgo: seeded(bot.id + name + 'd', 0, 28)
    }
  })
}
const demoMetrics = (bot) => ({
  users: demoUsers(bot).length,
  commands: seeded(bot.id + 'cmd', 120, 9800) + demoUsers(bot).reduce((acc, u) => acc + u.commands, 0),
  stickers: seeded(bot.id + 'stk', 40, 3200),
  groups: seeded(bot.id + 'grp', 1, 24),
  messages: seeded(bot.id + 'msg', 300, 15000)
})

/* ════════════════ Estado ════════════════ */
let user = load(LS_USER, null)
let bots = load(LS_BOTS, [])
let dashboardBotId = null
let editingBotId = null
let consoleTimer = null
let consolePaused = false
let linkTimer = null
let pendingCreate = false
let cmdCategory = 'Todos'

const wizard = { step: 1, label: '', prefix: '.', phone: '', method: 'pairing', seed: 1 }

/* ════════════════ Sesión / login ════════════════ */
function showLoginError(id, message) {
  const el = $(id)
  el.textContent = message || ''
  el.classList.toggle('show', Boolean(message))
}

function showLanding() {
  stopConsole()
  $('#landingView').hidden = false
  $('#loginView').hidden = true
  $('#appView').hidden = true
  $('#landUserHint').textContent = user ? `Sesión iniciada como ${user.name}` : ''
  updateLandingStats()
  window.scrollTo({ top: 0 })
}

function enterApp() {
  $('#landingView').hidden = true
  $('#loginView').hidden = true
  $('#appView').hidden = false
  renderAll()
  showTab('panel')
  if (pendingCreate) {
    pendingCreate = false
    openWizard()
  }
}

$('#loginForm').addEventListener('submit', (event) => {
  event.preventDefault()
  const name = $('#loginName').value.trim()
  const contact = $('#loginContact').value.trim()
  const password = $('#loginPassword').value
  let ok = true
  showLoginError('#loginNameError', name.length >= 2 ? '' : 'Contanos tu nombre (mínimo 2 letras).'); if (name.length < 2) ok = false
  showLoginError('#loginContactError', contact.length >= 5 ? '' : 'Ingresá tu teléfono o correo.'); if (contact.length < 5) ok = false
  showLoginError('#loginPasswordError', password.length >= 4 ? '' : 'La contraseña necesita al menos 4 caracteres.'); if (password.length < 4) ok = false
  if (!ok) return

  user = { name, contact, since: user?.since || new Date().toISOString() }
  save(LS_USER, user)
  toast(`¡Hola, ${name}! Entraste al panel 🌊`)
  enterApp()
})

function logout() {
  user = null
  localStorage.removeItem(LS_USER)
  stopConsole()
  showLanding()
  toast('Sesión cerrada. Tus sub-bots quedan guardados en este navegador.')
}
$('#logoutBtn').addEventListener('click', logout)
$('#logoutBtn2').addEventListener('click', logout)

$('#profileForm').addEventListener('submit', (event) => {
  event.preventDefault()
  const name = $('#profileNameInput').value.trim()
  const contact = $('#profileContactInput').value.trim()
  if (name.length < 2 || contact.length < 5) { toast('⚠️ Revisá el nombre y el contacto.'); return }
  user = { ...user, name, contact }
  save(LS_USER, user)
  renderAll()
  toast('Perfil actualizado ✓')
})

/* ════════════════ Landing ════════════════ */
function updateLandingStats() {
  const users = bots.reduce((acc, bot) => acc + demoMetrics(bot).users, 0)
  if ($('#landBotCount')) $('#landBotCount').textContent = String(bots.length)
  if ($('#landCmdCount')) $('#landCmdCount').textContent = String(COMMANDS.length)
  if ($('#landUserCount')) $('#landUserCount').textContent = users.toLocaleString('es-UY')
}

function renderLandingCommands() {
  const box = $('#landingCommands')
  if (!box) return
  box.innerHTML = COMMANDS.map((cmd) => `
    <article class="card">
      <h3><code>.${cmd.name}</code></h3>
      <p>${esc(cmd.description)}</p>
      <p class="small muted">${esc(cmd.category)} · alias: ${cmd.aliases.map((a) => '.' + a).join(', ') || '—'}</p>
    </article>`).join('')
}

$$('[data-go-panel]').forEach((btn) => btn.addEventListener('click', () => {
  if (user) enterApp()
  else { $('#landingView').hidden = true; $('#loginView').hidden = false }
}))
$$('[data-go-create]').forEach((btn) => btn.addEventListener('click', () => {
  pendingCreate = true
  if (user) enterApp()
  else { $('#landingView').hidden = true; $('#loginView').hidden = false }
}))
$$('[data-go-landing]').forEach((btn) => btn.addEventListener('click', showLanding))
$$('[data-scroll]').forEach((link) => link.addEventListener('click', (event) => {
  const target = document.getElementById(link.dataset.scroll)
  if (!target) return
  event.preventDefault()
  target.scrollIntoView({ behavior: 'smooth' })
}))

/* ════════════════ Navegación por tabs ════════════════ */
const TAB_TITLES = {
  panel: ['Panel', 'Tus sub-bots desplegados'],
  endpoints: ['Endpoints', 'Base de rutas HTTP (sin configurar)'],
  comandos: ['Comandos', 'Todo lo que saben hacer tus sub-bots'],
  perfil: ['Perfil / Login', 'Tu cuenta del panel']
}
function greeting() {
  const hour = new Date().getHours()
  if (hour < 6) return 'BUENAS NOCHES'
  if (hour < 12) return 'BUENOS DÍAS'
  if (hour < 20) return 'BUENAS TARDES'
  return 'BUENAS NOCHES'
}

function showTab(tab) {
  $$('.tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab))
  for (const name of Object.keys(TAB_TITLES)) $(`#tab-${name}`).hidden = name !== tab
  $('#botPanel').hidden = true
  dashboardBotId = null
  stopConsole()
  const [title, subtitle] = TAB_TITLES[tab]
  $('#greetingEyebrow').textContent = tab === 'panel' && user ? `${greeting()} · HOLA, ${user.name.toUpperCase()}` : title.toUpperCase()
  $('#pageTitle').textContent = title
  $('#pageSubtitle').textContent = subtitle
  if (tab === 'comandos') renderCommands()
  if (tab === 'perfil') renderProfile()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
$$('.tab').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)))

/* ════════════════ Render general ════════════════ */
const bannerStyle = (bot) => {
  if (!bot.banner) return 'grad-ocean'
  if (bot.banner.startsWith('data:') || bot.banner.startsWith('http')) return bot.banner
  return bot.banner
}
function bannerCss(bot) {
  const value = bannerStyle(bot)
  return value.startsWith('data:') || value.startsWith('http')
    ? `background-image:url("${value}")`
    : ''
}
const bannerClass = (bot) => {
  const value = bannerStyle(bot)
  return value.startsWith('data:') || value.startsWith('http') ? '' : value
}
const botInitial = (bot) => esc((bot.label || '🌊').trim().slice(0, 1) || '🌊')

function renderAll() {
  if (!user) return
  $('#sideAvatar').textContent = (user.name || 'T').slice(0, 1).toUpperCase()
  $('#sideUserName').textContent = user.name
  $('#sideUserContact').textContent = user.contact
  renderStats()
  renderBots()
  if (dashboardBotId) renderBotPanel()
}

function renderStats() {
  const online = bots.filter((bot) => bot.status === 'online').length
  const users = bots.reduce((acc, bot) => acc + demoMetrics(bot).users, 0)
  const commands = bots.reduce((acc, bot) => acc + demoMetrics(bot).commands, 0)
  $('#statBots').textContent = `${bots.length} / ${MAX_BOTS}`
  $('#statOnline').textContent = String(online)
  $('#statUsers').textContent = users.toLocaleString('es-UY')
  $('#statCommands').textContent = commands.toLocaleString('es-UY')
  $('#sideBotCount').textContent = `${bots.length} / ${MAX_BOTS}`
  $('#sideBotBar').style.width = `${(bots.length / MAX_BOTS) * 100}%`
  $('#profileBotCount').textContent = `${bots.length} / ${MAX_BOTS}`
  const limit = bots.length >= MAX_BOTS
  $('#botsLimitMsg').hidden = !limit
  for (const btn of [$('#createBotBtn'), $('#topCreateBtn')]) btn.disabled = limit
  updateLandingStats()
}

function renderBots(highlightId = null) {
  const grid = $('#botsGrid')
  $('#botsEmpty').hidden = bots.length > 0
  grid.innerHTML = bots.map((bot) => {
    const m = demoMetrics(bot)
    const on = bot.status === 'online'
    return `
    <article class="bot-card ${bot.id === highlightId ? 'highlight' : ''}" data-bot-card="${bot.id}">
      <div class="bot-banner ${bannerClass(bot)}" style="${bannerCss(bot)}"></div>
      <div class="bot-card-body">
        <div class="bot-card-top">
          <h4>${esc(bot.label)}</h4>
          <span class="status-pill ${on ? 'status-on' : 'status-off'}">${on ? '● En línea' : '● Pausado'}</span>
        </div>
        <p class="bot-meta">
          📱 +${esc(bot.phone)} · ${bot.method === 'qr' ? '▦ QR code' : '🔢 Pairing code'}<br>
          ⌘ Prefijo <code>${esc(bot.prefix)}</code> · ${bot.menuType === 'list' ? '📋 Menú de lista' : '🖼️ Menú clásico'}<br>
          👥 ${m.users} usuarios · ⚡ ${m.commands.toLocaleString('es-UY')} comandos
        </p>
        <div class="bot-card-actions">
          <button class="btn btn-primary" type="button" data-open-panel="${bot.id}">📊 Panel del bot</button>
          <button class="btn btn-soft" type="button" data-edit-bot="${bot.id}">✏️ Editar</button>
          <button class="btn btn-ghost" type="button" data-toggle-bot="${bot.id}" title="${on ? 'Pausar' : 'Reanudar'}">${on ? '⏸' : '▶️'}</button>
        </div>
      </div>
    </article>`
  }).join('')

  grid.querySelectorAll('[data-open-panel]').forEach((btn) => btn.addEventListener('click', () => openBotPanel(btn.dataset.openPanel)))
  grid.querySelectorAll('[data-edit-bot]').forEach((btn) => btn.addEventListener('click', () => openEdit(btn.dataset.editBot)))
  grid.querySelectorAll('[data-toggle-bot]').forEach((btn) => btn.addEventListener('click', () => toggleBot(btn.dataset.toggleBot)))
}

/* ════════════════ Asistente de creación ════════════════ */
function openWizard() {
  if (bots.length >= MAX_BOTS) { toast(`⚠️ Ya tenés el máximo de ${MAX_BOTS} sub-bots.`); return }
  Object.assign(wizard, { step: 1, label: '', prefix: '.', phone: '', method: 'pairing', seed: Date.now() % 100000 })
  $('#wLabel').value = ''
  $('#wPrefix').value = '.'
  $('#wPhone').value = ''
  document.querySelector('input[name="wMethod"][value="pairing"]').checked = true
  $('#linkedCheck').checked = false
  $('#wizardFinishBtn').disabled = true
  $('#wizardCounter').textContent = `Sub-bot ${bots.length + 1} de ${MAX_BOTS}`
  syncPrefixChips('.')
  $('#wizard').hidden = false
  gotoStep(1)
  setTimeout(() => $('#wLabel').focus(), 60)
}
function closeWizard() { $('#wizard').hidden = true; stopLinkTimer() }
function gotoStep(step) {
  wizard.step = step
  $('#wizardStep1').hidden = step !== 1
  $('#wizardStep2').hidden = step !== 2
  $('#wizardStep3').hidden = step !== 3
  $$('#wizardSteps li').forEach((li) => {
    const n = Number(li.dataset.stepDot)
    li.classList.toggle('active', n === step)
    li.classList.toggle('done', n < step)
  })
  if (step === 3) renderLinkStep()
}

$('#createBotBtn').addEventListener('click', openWizard)
$('#topCreateBtn').addEventListener('click', openWizard)
document.querySelector('[data-create]')?.addEventListener('click', openWizard)
$('#wizardCloseBtn').addEventListener('click', closeWizard)
$$('[data-wizard-cancel]').forEach((btn) => btn.addEventListener('click', closeWizard))
$$('[data-wizard-back]').forEach((btn) => btn.addEventListener('click', () => gotoStep(Number(btn.dataset.wizardBack))))

function syncPrefixChips(prefix) {
  $$('.prefix-chip').forEach((chip) => chip.classList.toggle('active', chip.dataset.prefix === prefix))
  $('#wPrefixPreview').textContent = `${prefix || '.'}sticker`
}
$$('.prefix-chip').forEach((chip) => chip.addEventListener('click', () => {
  $('#wPrefix').value = chip.dataset.prefix
  syncPrefixChips(chip.dataset.prefix)
}))
$('#wPrefix').addEventListener('input', () => syncPrefixChips($('#wPrefix').value.trim()))

const validPrefix = (prefix) => /^[^\w\s]{1,3}$/u.test(prefix)

$('#wizardStep1').addEventListener('submit', (event) => {
  event.preventDefault()
  const label = $('#wLabel').value.trim()
  const prefix = $('#wPrefix').value.trim()
  let ok = true
  showLoginError('#wLabelError', label.length >= 2 ? '' : 'La etiqueta necesita al menos 2 caracteres.'); if (label.length < 2) ok = false
  showLoginError('#wPrefixError', validPrefix(prefix) ? '' : 'El prefijo debe tener 1 a 3 símbolos (ej: . ! / #).'); if (!validPrefix(prefix)) ok = false
  if (!ok) return
  wizard.label = label
  wizard.prefix = prefix
  gotoStep(2)
  setTimeout(() => $('#wPhone').focus(), 60)
})

$('#wizardStep2').addEventListener('submit', (event) => {
  event.preventDefault()
  const phone = digits($('#wPhone').value)
  const method = document.querySelector('input[name="wMethod"]:checked').value
  const ok = phone.length >= 8 && phone.length <= 15
  showLoginError('#wPhoneError', ok ? '' : 'Ingresá un número válido con código de país (8 a 15 dígitos).')
  if (!ok) return
  wizard.phone = phone
  wizard.method = method
  gotoStep(3)
})

/* Paso 3: QR o pairing */
function pairingCode(seedText) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  let hash = hashCode(seedText)
  for (let i = 0; i < 8; i += 1) {
    hash = (hash * 1103515245 + 12345) >>> 0
    out += alphabet[hash % alphabet.length]
    if (i === 3) out += '-'
  }
  return out
}
function drawQr(canvas, seedText) {
  const ctx = canvas.getContext('2d')
  const size = 25
  const cell = canvas.width / size
  let hash = hashCode(seedText) || 7
  const next = () => { hash = (hash * 1103515245 + 12345) >>> 0; return hash / 4294967295 }
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#0b141a'
  const finder = (x, y) => {
    ctx.fillRect(x * cell, y * cell, cell * 7, cell * 7)
    ctx.fillStyle = '#fff'; ctx.fillRect((x + 1) * cell, (y + 1) * cell, cell * 5, cell * 5)
    ctx.fillStyle = '#0b141a'; ctx.fillRect((x + 2) * cell, (y + 2) * cell, cell * 3, cell * 3)
  }
  const inFinder = (x, y) => (x < 8 && y < 8) || (x > size - 9 && y < 8) || (x < 8 && y > size - 9)
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (!inFinder(x, y) && next() > 0.52) ctx.fillRect(x * cell, y * cell, cell, cell)
  }
  finder(0, 0); finder(size - 7, 0); finder(0, size - 7)
}
function stopLinkTimer() { if (linkTimer) { clearInterval(linkTimer); linkTimer = null } }
function renderLinkStep() {
  stopLinkTimer()
  const isQr = wizard.method === 'qr'
  $('#pairingBox').hidden = isQr
  $('#qrBox').hidden = !isQr
  $('#linkTitle').textContent = isQr ? 'Escaneá el QR con WhatsApp' : 'Ingresá el pairing code'
  $('#linkSubtitle').textContent = `Sub-bot “${wizard.label}” · +${wizard.phone}`
  $('#pairingCode').textContent = pairingCode(wizard.phone + wizard.seed)
  if (isQr) drawQr($('#qrCanvas'), wizard.phone + wizard.seed)
  $('#linkedCheck').checked = false
  $('#wizardFinishBtn').disabled = true
  $('#linkStatusText').textContent = 'Esperando vinculación…'

  let seconds = 300
  const tick = () => {
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
    const ss = String(seconds % 60).padStart(2, '0')
    $('#linkCountdown').textContent = `${mm}:${ss}`
    if (seconds <= 0) {
      stopLinkTimer()
      $('#linkStatusText').textContent = 'El código venció: generá otro para seguir.'
    }
    seconds -= 1
  }
  tick()
  linkTimer = setInterval(tick, 1000)
}
$('#regenCodeBtn').addEventListener('click', () => { wizard.seed = Date.now() % 100000; renderLinkStep() })
$('#linkedCheck').addEventListener('change', () => {
  $('#wizardFinishBtn').disabled = !$('#linkedCheck').checked
  if ($('#linkedCheck').checked) {
    stopLinkTimer()
    $('#linkStatusText').textContent = '¡Vinculado! Ya podés finalizar.'
    $('#linkCountdown').textContent = '✓'
  }
})

$('#wizardFinishBtn').addEventListener('click', () => {
  if (bots.length >= MAX_BOTS) { toast(`⚠️ Ya tenés el máximo de ${MAX_BOTS} sub-bots.`); return }
  const bot = {
    id: `bot-${Date.now().toString(36)}`,
    label: wizard.label,
    prefix: wizard.prefix,
    phone: wizard.phone,
    method: wizard.method,
    status: 'online',
    createdAt: new Date().toISOString(),
    banner: 'grad-ocean',
    menuType: 'classic',
    categories: [...ALL_CATEGORIES]
  }
  bots.push(bot)
  save(LS_BOTS, bots)
  closeWizard()
  showTab('panel')
  renderStats()
  renderBots(bot.id)
  toast(`🎉 Sub-bot “${bot.label}” creado y en línea (${bots.length}/${MAX_BOTS})`)
  document.querySelector(`[data-bot-card="${bot.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
})

/* ════════════════ Panel del bot ════════════════ */
function openBotPanel(id) {
  dashboardBotId = id
  for (const name of Object.keys(TAB_TITLES)) $(`#tab-${name}`).hidden = true
  $('#botPanel').hidden = false
  $('#greetingEyebrow').textContent = 'PANEL DEL BOT'
  $('#pageTitle').textContent = 'Panel del bot'
  $('#pageSubtitle').textContent = 'Consola, usuarios registrados y estado'
  renderBotPanel()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
$('#backToPanelBtn').addEventListener('click', () => showTab('panel'))

function currentBot() { return bots.find((bot) => bot.id === dashboardBotId) || null }

function renderBotPanel() {
  const bot = currentBot()
  if (!bot) return
  const m = demoMetrics(bot)
  const on = bot.status === 'online'

  const heroBanner = $('#botHeroBanner')
  heroBanner.className = `bot-hero-banner ${bannerClass(bot)}`
  heroBanner.style.cssText = bannerCss(bot)
  $('#botHeroAvatar').textContent = botInitial(bot)
  $('#botHeroLabel').textContent = bot.label
  $('#botHeroMeta').textContent = `📱 +${bot.phone} · Vinculado por ${bot.method === 'qr' ? 'QR code' : 'pairing code'} · Creado el ${new Date(bot.createdAt).toLocaleDateString('es-UY')}`
  $('#botHeroChips').innerHTML = `
    <span class="badge">⌘ Prefijo <code>${esc(bot.prefix)}</code></span>
    <span class="badge">${bot.menuType === 'list' ? '📋 Menú de lista' : '🖼️ Menú clásico'}</span>
    <span class="badge ${on ? 'badge-live' : ''}">${on ? '🟢 En línea' : '🔴 Pausado'}</span>`
  $('#botToggleBtn').textContent = on ? '⏸ Pausar' : '▶️ Reanudar'

  $('#bpUsers').textContent = String(m.users)
  $('#bpCommands').textContent = m.commands.toLocaleString('es-UY')
  $('#bpStickers').textContent = m.stickers.toLocaleString('es-UY')
  $('#bpGroups').textContent = String(m.groups)
  $('#usersCountBadge').textContent = String(m.users)

  $('#botStatusList').innerHTML = [
    ['Estado', on ? '🟢 En línea' : '🔴 Pausado'],
    ['Sesión WhatsApp', `sessions/${bot.id}/ (guardada)`],
    ['Node.js', 'v20+ · Baileys 6.7.24'],
    ['FFmpeg / WebP', '✅ Disponible'],
    ['Memoria', `${seeded(bot.id + 'mem', 90, 320)} MB`],
    ['Menú', bot.menuType === 'list' ? `De lista (${bot.categories.length} categorías)` : 'Clásico con banner'],
    ['Tiempo activo', `${seeded(bot.id + 'up', 2, 96)} h ${seeded(bot.id + 'upm', 1, 59)} min`]
  ].map(([k, v]) => `<li><span>${k}</span><strong>${v}</strong></li>`).join('')

  const days = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
  $('#activityChart').innerHTML = days.map((day, i) => {
    const h = 18 + (hashCode(bot.id + day) % 75)
    return `<div class="chart-bar" style="height:${h}%" data-day="${day}"></div>`
  }).join('')

  const recent = [...COMMANDS].sort((a, b) => hashCode(bot.id + a.name) - hashCode(bot.id + b.name)).slice(0, 5)
  $('#lastCommandsList').innerHTML = recent.map((cmd) => `<li><code>${esc(bot.prefix)}${cmd.name}</code><span>${seeded(bot.id + cmd.name, 4, 420)} usos</span></li>`).join('')

  renderUsers($('#userSearch').value || '')
  startConsole(bot)
}
$('#userSearch').addEventListener('input', () => renderUsers($('#userSearch').value || ''))

function renderUsers(filterText) {
  const bot = currentBot()
  if (!bot) return
  const query = filterText.trim().toLowerCase()
  const list = demoUsers(bot).filter((u) => !query || u.name.toLowerCase().includes(query) || u.phone.includes(query))
  $('#usersList').innerHTML = list.length ? list.map((u) => `
    <div class="user-row">
      <div class="avatar">${esc(u.name.slice(0, 1))}<img src="https://i.pravatar.cc/96?img=${u.img}" alt="Foto de perfil de ${esc(u.name)}" loading="lazy" onerror="this.remove()"></div>
      <div class="user-info"><strong>${esc(u.name)}</strong><span>📱 +${esc(u.phone)} · registrado hace ${u.daysAgo === 0 ? 'hoy' : `${u.daysAgo} día${u.daysAgo === 1 ? '' : 's'}`}</span></div>
      <div class="user-nums"><strong>${u.commands} comandos</strong>${u.stickers} stickers</div>
    </div>`).join('')
    : '<p class="muted" style="padding:1rem 0">Sin usuarios que coincidan con la búsqueda.</p>'
}

/* Consola simulada */
const LOG_TEMPLATES = [
  ['info', 'esperando mensajes…'],
  ['cmd', '{p}sticker ← usuario · 84ms'],
  ['ok', 'sticker creado (512×512, 42 KB)'],
  ['cmd', '{p}menu ← usuario · menú enviado'],
  ['info', 'sesión activa OK · sin pedir código ni QR'],
  ['cmd', '{p}pack ← pack en curso (3/30)'],
  ['ok', 'pack agregado al vuelo desde foto'],
  ['cmd', '{p}emojimix 😺 🐼 ← sticker de Emoji Kitchen'],
  ['warn', 'cooldown aplicado (anti-spam 2.5s)'],
  ['cmd', '{p}toimg ← sticker convertido a PNG']
]
function stampNow() { return new Date().toLocaleTimeString('es-UY', { hour12: false }) }
function consoleLine(bot, [level, text]) {
  const log = $('#consoleLog')
  if (!log || $('#botPanel').hidden) return
  const line = document.createElement('div')
  line.innerHTML = `<span class="t">[${stampNow()}]</span> <span class="${level}">${esc(text.replaceAll('{p}', bot.prefix))}</span>`
  log.appendChild(line)
  while (log.children.length > 120) log.firstChild.remove()
  log.scrollTop = log.scrollHeight
}
function startConsole(bot) {
  stopConsole()
  consolePaused = false
  $('#consolePauseBtn').textContent = '⏸ Pausar'
  const log = $('#consoleLog')
  log.innerHTML = ''
  const boot = [
    ['info', `TomiOka Bot · sub-bot “${bot.label}”`],
    ['ok', `Sesión restaurada como +${bot.phone} (sin código ni QR)`],
    ['info', `Prefijo: ${bot.prefix} · Comandos: ${COMMANDS.length} · Esperando mensajes…`]
  ]
  boot.forEach((entry) => consoleLine(bot, entry))
  let i = 0
  consoleTimer = setInterval(() => {
    if (consolePaused || $('#botPanel').hidden) return
    consoleLine(bot, LOG_TEMPLATES[i % LOG_TEMPLATES.length])
    i += 1
  }, 2600)
}
function stopConsole() { if (consoleTimer) { clearInterval(consoleTimer); consoleTimer = null } }
$('#consolePauseBtn').addEventListener('click', () => {
  consolePaused = !consolePaused
  $('#consolePauseBtn').textContent = consolePaused ? '▶️ Reanudar' : '⏸ Pausar'
})
$('#consoleClearBtn').addEventListener('click', () => { $('#consoleLog').innerHTML = '' })

function toggleBot(id) {
  const bot = bots.find((b) => b.id === id)
  if (!bot) return
  bot.status = bot.status === 'online' ? 'paused' : 'online'
  save(LS_BOTS, bots)
  renderStats()
  renderBots()
  if (dashboardBotId === id) renderBotPanel()
  toast(bot.status === 'online' ? `▶️ “${bot.label}” está en línea` : `⏸ “${bot.label}” pausado`)
}
$('#botToggleBtn').addEventListener('click', () => { if (dashboardBotId) toggleBot(dashboardBotId) })
$('#botEditFromPanelBtn').addEventListener('click', () => { if (dashboardBotId) openEdit(dashboardBotId) })

/* ════════════════ Editar sub-bot ════════════════ */
const editing = { banner: 'grad-ocean', menuType: 'classic', categories: [...ALL_CATEGORIES] }

function openEdit(id) {
  const bot = bots.find((b) => b.id === id)
  if (!bot) return
  editingBotId = id
  editing.banner = bot.banner || 'grad-ocean'
  editing.menuType = bot.menuType || 'classic'
  editing.categories = [...(bot.categories?.length ? bot.categories : ALL_CATEGORIES)]
  $('#eLabel').value = bot.label
  $('#ePrefix').value = bot.prefix
  $('#eBannerUrl').value = editing.banner.startsWith('http') ? editing.banner : ''
  document.querySelector(`input[name="eMenuType"][value="${editing.menuType}"]`).checked = true
  $$('#bannerPresets .banner-preset').forEach((btn) => btn.classList.toggle('active', btn.dataset.banner === editing.banner))
  renderCategoryChips()
  syncEditPreview(bot)
  $('#editModal').hidden = false
}
function closeEdit() { $('#editModal').hidden = true; editingBotId = null }
$('#editCloseBtn').addEventListener('click', closeEdit)
$('#editCancelBtn').addEventListener('click', closeEdit)

function editingBot() { return bots.find((b) => b.id === editingBotId) || null }

function renderCategoryChips() {
  $('#categoryChips').innerHTML = ALL_CATEGORIES.map((cat) => {
    const on = editing.categories.includes(cat)
    return `<button type="button" class="chip toggle-chip ${on ? '' : 'off'}" data-category="${esc(cat)}">${on ? '✓' : '+'} ${esc(cat)}</button>`
  }).join('')
  $('#categoryChips').querySelectorAll('[data-category]').forEach((chip) => chip.addEventListener('click', () => {
    const cat = chip.dataset.category
    editing.categories = editing.categories.includes(cat)
      ? editing.categories.filter((c) => c !== cat)
      : [...editing.categories, cat]
    renderCategoryChips()
    syncEditPreview()
  }))
}

function syncEditPreview(fallbackBot = null) {
  const bot = editingBot() || fallbackBot || { label: 'Sub-bot', prefix: '.', categories: ALL_CATEGORIES }
  const label = $('#eLabel').value.trim() || bot.label
  const prefix = $('#ePrefix').value.trim() || bot.prefix
  const url = $('#eBannerUrl').value.trim()
  const activeBanner = url || editing.banner

  $('#previewBotName').textContent = label
  const banner = $('#previewBanner')
  banner.className = 'preview-banner'
  banner.style.cssText = ''
  if (String(activeBanner).startsWith('http') || String(activeBanner).startsWith('data:')) {
    banner.style.backgroundImage = `url("${activeBanner}")`
  } else {
    banner.classList.add(activeBanner)
  }

  const cats = editing.categories.length ? editing.categories : ALL_CATEGORIES
  const cmds = COMMANDS.filter((cmd) => cats.includes(cmd.category)).slice(0, 6)
  $('#previewCommands').textContent = cmds.map((cmd) => `${prefix}${cmd.name}`).join(' · ') || `${prefix}menu`
  $('#previewCategories').innerHTML = cats.map((cat) => {
    const inCat = COMMANDS.filter((cmd) => cmd.category === cat)
    return `<span>📂 <strong>${esc(cat)}</strong> — ${inCat.map((cmd) => `${prefix}${cmd.name}`).join(', ') || 'sin comandos'}</span>`
  }).join('')

  const isList = editing.menuType === 'list'
  $('#previewClassic').hidden = isList
  $('#previewList').hidden = !isList
  $('#categoriesField').hidden = !isList
  if (!isList) $('#previewCategories').hidden = true
}

$$('#bannerPresets .banner-preset').forEach((btn) => btn.addEventListener('click', () => {
  editing.banner = btn.dataset.banner
  $('#eBannerUrl').value = ''
  $$('#bannerPresets .banner-preset').forEach((b) => b.classList.toggle('active', b === btn))
  syncEditPreview()
}))
$('#eBannerUrl').addEventListener('input', syncEditPreview)
$('#eLabel').addEventListener('input', syncEditPreview)
$('#ePrefix').addEventListener('input', syncEditPreview)
$$('input[name="eMenuType"]').forEach((radio) => radio.addEventListener('change', () => {
  editing.menuType = document.querySelector('input[name="eMenuType"]:checked').value
  syncEditPreview()
}))
$('#previewListBtn').addEventListener('click', () => {
  const box = $('#previewCategories')
  box.hidden = !box.hidden
  $('#previewListBtn').textContent = box.hidden ? '📋 Ver lista de categorías' : '📋 Ocultar categorías'
})

/* Achica la imagen subida antes de guardarla (evita reventar localStorage) */
$('#eBannerFile').addEventListener('change', () => {
  const file = $('#eBannerFile').files?.[0]
  if (!file) return
  const img = new Image()
  img.onload = () => {
    const max = 1000
    const scale = Math.min(1, max / img.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    editing.banner = canvas.toDataURL('image/jpeg', 0.8)
    $('#eBannerUrl').value = ''
    $$('#bannerPresets .banner-preset').forEach((b) => b.classList.remove('active'))
    URL.revokeObjectURL(img.src)
    syncEditPreview()
    toast('🖼️ Banner cargado (se guarda al confirmar)')
  }
  img.src = URL.createObjectURL(file)
})

$('#deleteBotBtn').addEventListener('click', () => {
  const bot = editingBot()
  if (!bot) return
  if (!confirm(`¿Eliminar el sub-bot “${bot.label}”? Esta acción no se puede deshacer.`)) return
  bots = bots.filter((b) => b.id !== bot.id)
  save(LS_BOTS, bots)
  closeEdit()
  dashboardBotId = null
  showTab('panel')
  renderAll()
  toast(`🗑 Sub-bot “${bot.label}” eliminado (${bots.length}/${MAX_BOTS})`)
})

$('#editForm').addEventListener('submit', (event) => {
  event.preventDefault()
  const bot = editingBot()
  if (!bot) return
  const label = $('#eLabel').value.trim()
  const prefix = $('#ePrefix').value.trim()
  let ok = true
  showLoginError('#eLabelError', label.length >= 2 ? '' : 'La etiqueta necesita al menos 2 caracteres.'); if (label.length < 2) ok = false
  showLoginError('#ePrefixError', validPrefix(prefix) ? '' : 'El prefijo debe tener 1 a 3 símbolos (ej: . ! / #).'); if (!validPrefix(prefix)) ok = false
  if (!ok) return

  const url = $('#eBannerUrl').value.trim()
  bot.label = label
  bot.prefix = prefix
  bot.banner = url || editing.banner
  bot.menuType = editing.menuType
  bot.categories = editing.menuType === 'list' ? [...editing.categories] : [...ALL_CATEGORIES]
  save(LS_BOTS, bots)
  closeEdit()
  renderAll()
  toast(`✓ “${bot.label}” actualizado (${bot.menuType === 'list' ? 'menú de lista' : 'menú clásico'})`)
})

/* ════════════════ Comandos / Perfil ════════════════ */
function renderCommands() {
  const query = ($('#commandSearch').value || '').trim().toLowerCase()
  const prefix = bots[0]?.prefix || '.'
  $('#cmdPrefixHint').textContent = prefix

  const cats = ['Todos', ...ALL_CATEGORIES]
  $('#commandCats').innerHTML = cats.map((cat) => {
    const count = cat === 'Todos' ? COMMANDS.length : COMMANDS.filter((cmd) => cmd.category === cat).length
    return `<button type="button" class="chip ${cmdCategory === cat ? 'active' : ''}" data-cat="${esc(cat)}">${esc(cat)} ${count}</button>`
  }).join('')
  $('#commandCats').querySelectorAll('[data-cat]').forEach((chip) => chip.addEventListener('click', () => {
    cmdCategory = chip.dataset.cat
    renderCommands()
  }))

  const list = COMMANDS.filter((cmd) =>
    (cmdCategory === 'Todos' || cmd.category === cmdCategory) &&
    (!query || cmd.name.includes(query) || cmd.aliases.some((a) => a.includes(query)) || cmd.description.toLowerCase().includes(query)))
  $('#commandsGrid').innerHTML = list.map((cmd) => `
    <button type="button" class="command-card" data-copy="${esc(prefix + cmd.name)}">
      <code>${esc(prefix)}${cmd.name}</code>
      <p>${esc(cmd.description)}</p>
      <small>${esc(cmd.category)} · alias: ${cmd.aliases.map((a) => prefix + a).join(', ') || '—'} · tocá para copiar</small>
    </button>`).join('')
  $('#commandsEmpty').hidden = list.length > 0
  $('#commandsGrid').querySelectorAll('[data-copy]').forEach((card) => card.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(card.dataset.copy); toast(`📋 Copiado: ${card.dataset.copy}`) }
    catch { toast(`Comando: ${card.dataset.copy}`) }
  }))
}
$('#commandSearch').addEventListener('input', renderCommands)

function renderProfile() {
  if (!user) return
  $('#profileAvatar').textContent = (user.name || 'T').slice(0, 1).toUpperCase()
  $('#profileName').textContent = user.name
  $('#profileContact').textContent = user.contact
  $('#profileNameInput').value = user.name
  $('#profileContactInput').value = user.contact
  $('#profileSince').textContent = user.since ? new Date(user.since).toLocaleDateString('es-UY') : '—'
  renderStats()
}

/* Atajo `/` para buscar comandos (como en stellarwa.xyz/cmds) */
document.addEventListener('keydown', (event) => {
  if (event.key !== '/') return
  const tag = document.activeElement?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (!$('#tab-comandos').hidden) {
    event.preventDefault()
    $('#commandSearch').focus()
  }
})

/* ════════════════ Arranque: landing estilo Stellar Wa ════════════════ */
renderLandingCommands()
showLanding()
