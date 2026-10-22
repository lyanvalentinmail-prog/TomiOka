/* ════════════════════════════════════════════════════════════════
   TomiOka Web — interacciones locales
   Sin llamadas a backend, sin cuentas y sin datos de telemetría.
   Solo mejora la navegación y las herramientas del navegador.
   ════════════════════════════════════════════════════════════════ */
(() => {
  'use strict'

  document.documentElement.classList.add('js')

  const $ = (selector, scope = document) => scope.querySelector(selector)
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)]

  /* ── Toast accesible ─────────────────────────────────────── */
  const toast = $('#toast')
  let toastTimer
  function showToast(message) {
    if (!toast) return
    toast.textContent = message
    toast.classList.add('visible')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2800)
  }

  /* ── Copiar texto / código ───────────────────────────────── */
  async function copyText(text, message = 'Copiado al portapapeles') {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    showToast(message)
  }

  $$('[data-copy-text]').forEach((button) => {
    button.addEventListener('click', () => copyText(button.dataset.copyText))
  })
  $$('[data-copy-target]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.dataset.copyTarget)
      if (target) copyText(target.textContent.trim(), 'Ejemplo copiado')
    })
  })

  /* ── Header y tabs inferiores (estado activo) ────────────── */
  const header = $('#siteHeader')

  function updateHeader() {
    header?.classList.toggle('scrolled', window.scrollY > 12)
    $('#backToTop')?.classList.toggle('visible', window.scrollY > 700)
  }
  window.addEventListener('scroll', updateHeader, { passive: true })
  updateHeader()

  $('#backToTop')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }))

  /* ── Páginas individuales: una vista por vez, como una app ── */
  const pages = $$('.page')
  const navLinks = $$('.header-link, .bottom-nav-item')
  const pageTitles = {
    inicio: 'TomiOka — Plataforma para bots de WhatsApp',
    subbots: 'Sub-Bots · TomiOka',
    endpoints: 'Endpoints · TomiOka',
    herramientas: 'Herramientas · TomiOka',
    proyectos: 'Proyectos · TomiOka',
    documentacion: 'Documentación · TomiOka',
    repositorio: 'Repositorio · TomiOka',
    contacto: 'Contacto · TomiOka'
  }

  function pageFromHash() {
    const id = window.location.hash.replace('#', '')
    return pages.some((page) => page.id === id) ? id : 'inicio'
  }

  function showPage(id) {
    pages.forEach((page) => page.classList.toggle('is-active', page.id === id))
    navLinks.forEach((link) => link.classList.toggle('is-active', link.getAttribute('href') === `#${id}`))
    if (pageTitles[id]) document.title = pageTitles[id]
    window.scrollTo({ top: 0, behavior: 'auto' })
    // Los elementos con .reveal de la página recién mostrada deben verse
    $$(`.page#${id} .reveal`).forEach((item) => item.classList.add('visible'))
  }

  window.addEventListener('hashchange', () => showPage(pageFromHash()))
  showPage(pageFromHash())

  /* ── Aparición suave al hacer scroll ─────────────────────── */
  const revealItems = $$('.reveal')
  if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible')
          revealObserver.unobserve(entry.target)
        }
      }
    }, { threshold: 0.12 })
    revealItems.forEach((item) => revealObserver.observe(item))
  } else {
    revealItems.forEach((item) => item.classList.add('visible'))
  }

  /* ── Panel local: generador de configuración ─────────────── */
  const fields = {
    name: $('#botName'),
    prefix: $('#customPrefix'),
    packName: $('#packName'),
    packAuthor: $('#packAuthor'),
    quality: $('#stickerQuality'),
    qualityValue: $('#qualityValue'),
    fps: $('#stickerFps'),
    menuStyle: $('#menuStyle'),
    groups: $('#respondGroups'),
    output: $('#configOutput'),
    commandPreview: $('#commandPreview'),
    stickerPreview: $('#stickerPreview')
  }

  function currentConfig() {
    const prefix = (fields.prefix.value || '.').slice(0, 3)
    return {
      bot: {
        name: fields.name.value.trim() || 'TomiOka',
        prefix
      },
      stickers: {
        packName: fields.packName.value.trim() || 'TomiOka',
        packAuthor: fields.packAuthor.value.trim() || 'TomiOka Team',
        quality: Number(fields.quality.value),
        fps: Number(fields.fps.value)
      },
      menu: {
        showDescriptions: fields.menuStyle.value === 'detailed'
      },
      behavior: {
        respondInGroups: fields.groups.checked,
        cooldownMs: 2500
      }
    }
  }

  function renderConfig() {
    if (!fields.output) return
    const config = currentConfig()
    fields.output.textContent = JSON.stringify(config, null, 2)
    fields.qualityValue.textContent = fields.quality.value
    fields.commandPreview.textContent = `${config.bot.prefix}menu`
    fields.stickerPreview.textContent = `${config.bot.prefix}sticker`
  }

  ;[fields.name, fields.prefix, fields.packName, fields.packAuthor, fields.quality, fields.fps, fields.menuStyle, fields.groups]
    .filter(Boolean)
    .forEach((field) => field.addEventListener('input', renderConfig))

  $$('[data-prefix]').forEach((button) => {
    button.addEventListener('click', () => {
      $$('[data-prefix]').forEach((item) => item.classList.toggle('active', item === button))
      fields.prefix.value = button.dataset.prefix
      renderConfig()
    })
  })
  fields.prefix?.addEventListener('input', () => {
    $$('[data-prefix]').forEach((item) => item.classList.toggle('active', item.dataset.prefix === fields.prefix.value))
  })

  $('#copyConfig')?.addEventListener('click', () => copyText(fields.output.textContent, 'Configuración copiada'))
  $('#downloadConfig')?.addEventListener('click', () => {
    const blob = new Blob([`${fields.output.textContent}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'tomioka-config.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast('Fragmento JSON descargado')
  })
  renderConfig()

  /* ── Sub-Bots: creador local, sin backend ────────────────── */
  // No hay servidor: "crear" genera la config y los comandos de arranque.
  // La lista vive solo en esta pestaña; cada sub-bot se vincula en un
  // Termux/VPS con su propia carpeta de sesión (SESSION_DIR).
  const subbotForm = $('#subbotForm')
  const subbotList = $('#subbotList')
  const subbotEmpty = $('#subbotEmpty')
  const subbotCount = $('#subbotCount')
  const subBots = []

  function slugifySubbot(name) {
    const base = String(name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return base || 'subbot'
  }

  function subbotCommands(bot) {
    return [
      `git clone https://github.com/lyanvalentinmail-prog/TomiOka.git ${bot.slug}`,
      `cd ${bot.slug}`,
      'npm install',
      '# Guarda el config.json descargado en esta carpeta, y luego vincula:',
      `SESSION_DIR=sessions/${bot.slug} PAIRING_PHONE=${bot.phone} npm run pair`
    ].join('\n')
  }

  function downloadSubbotConfig(bot) {
    const blob = new Blob([`${JSON.stringify(bot.config, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${bot.slug}-config.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    showToast(`Config de ${bot.name} descargada`)
  }

  function metaItem(label, value) {
    const wrap = document.createElement('div')
    const dt = document.createElement('dt')
    dt.textContent = label
    const dd = document.createElement('dd')
    dd.textContent = value
    wrap.append(dt, dd)
    return wrap
  }

  function renderSubbots() {
    if (!subbotList) return
    subbotList.querySelectorAll('.subbot-card').forEach((card) => card.remove())
    if (subbotEmpty) subbotEmpty.hidden = subBots.length > 0
    if (subbotCount) subbotCount.textContent = `${subBots.length} en esta sesión`

    for (const bot of subBots) {
      const card = document.createElement('article')
      card.className = 'subbot-card'

      const head = document.createElement('div')
      head.className = 'subbot-card-head'
      const title = document.createElement('h4')
      title.textContent = bot.name
      const badge = document.createElement('span')
      badge.className = 'badge badge-local'
      badge.textContent = 'Configuración lista'
      head.append(title, badge)

      const meta = document.createElement('dl')
      meta.className = 'subbot-meta'
      meta.append(
        metaItem('Prefijo', bot.prefix),
        metaItem('Teléfono', bot.phone),
        metaItem('Sesión', `sessions/${bot.slug}`),
        metaItem('Pack', bot.config.stickers.packName)
      )

      const actions = document.createElement('div')
      actions.className = 'subbot-actions'
      const copyButton = document.createElement('button')
      copyButton.type = 'button'
      copyButton.className = 'button button-small button-primary'
      copyButton.textContent = 'Copiar comandos'
      copyButton.addEventListener('click', () => copyText(subbotCommands(bot), 'Comandos del sub-bot copiados'))
      const downloadButton = document.createElement('button')
      downloadButton.type = 'button'
      downloadButton.className = 'button button-small button-ghost'
      downloadButton.textContent = 'Descargar config'
      downloadButton.addEventListener('click', () => downloadSubbotConfig(bot))
      const deleteButton = document.createElement('button')
      deleteButton.type = 'button'
      deleteButton.className = 'button button-small button-ghost'
      deleteButton.textContent = 'Eliminar'
      deleteButton.addEventListener('click', () => {
        const index = subBots.indexOf(bot)
        if (index >= 0) subBots.splice(index, 1)
        renderSubbots()
        showToast(`Sub-bot ${bot.name} eliminado de la lista`)
      })
      actions.append(copyButton, downloadButton, deleteButton)

      card.append(head, meta, actions)
      subbotList.appendChild(card)
    }
  }

  subbotForm?.addEventListener('submit', (event) => {
    event.preventDefault()
    const name = $('#subbotName')?.value.trim() || ''
    const phone = ($('#subbotPhone')?.value || '').replace(/\D/g, '')
    const prefix = ($('#subbotPrefix')?.value || '.').trim().slice(0, 3) || '.'
    const packName = $('#subbotPack')?.value.trim() || 'TomiOka'
    const groups = Boolean($('#subbotGroups')?.checked)

    if (!name) {
      showToast('Escribe un nombre para tu sub-bot')
      $('#subbotName')?.focus()
      return
    }
    if (phone.length < 8 || phone.length > 15) {
      showToast('Escribe un número válido con código de país (8 a 15 dígitos)')
      $('#subbotPhone')?.focus()
      return
    }

    let slug = slugifySubbot(name)
    if (subBots.some((bot) => bot.slug === slug)) {
      let suffix = 2
      while (subBots.some((bot) => bot.slug === `${slug}-${suffix}`)) suffix += 1
      slug = `${slug}-${suffix}`
    }

    subBots.push({
      name,
      phone,
      prefix,
      slug,
      config: {
        bot: { name, prefix },
        pairingPhone: phone,
        session: { dir: `sessions/${slug}` },
        stickers: { packName, packAuthor: name },
        behavior: { respondInGroups: groups }
      }
    })
    renderSubbots()
    subbotForm.reset()
    const prefixInput = $('#subbotPrefix')
    if (prefixInput) prefixInput.value = '.'
    const packInput = $('#subbotPack')
    if (packInput) packInput.value = 'TomiOka'
    const groupsInput = $('#subbotGroups')
    if (groupsInput) groupsInput.checked = true
    showToast(`Sub-bot ${name} creado: copia sus comandos para vincularlo`)
  })
  renderSubbots()

  /* ── Catálogo: filtros + búsqueda local ──────────────────── */
  const projectCards = $$('.project-card')
  const filterButtons = $$('[data-filter]')
  const catalogSearch = $('#catalogSearch')
  const emptyResults = $('#emptyResults')
  let activeFilter = 'all'

  function applyCatalogFilter() {
    const query = (catalogSearch?.value || '').trim().toLowerCase()
    let visible = 0

    for (const card of projectCards) {
      const matchesCategory = activeFilter === 'all' || card.dataset.category === activeFilter
      const matchesSearch = !query || `${card.textContent} ${card.dataset.search || ''}`.toLowerCase().includes(query)
      const show = matchesCategory && matchesSearch
      card.hidden = !show
      if (show) visible += 1
    }
    if (emptyResults) emptyResults.hidden = visible !== 0
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter
      filterButtons.forEach((item) => item.classList.toggle('active', item === button))
      applyCatalogFilter()
    })
  })
  catalogSearch?.addEventListener('input', applyCatalogFilter)

  /* ── Documentación: pestañas ─────────────────────────────── */
  const docTabs = $$('[data-doc]')
  const docPanels = $$('[data-panel]')

  function openDoc(name) {
    docTabs.forEach((tab) => {
      const active = tab.dataset.doc === name
      tab.classList.toggle('active', active)
      tab.setAttribute('aria-selected', String(active))
    })
    docPanels.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name))
  }
  docTabs.forEach((tab) => tab.addEventListener('click', () => openDoc(tab.dataset.doc)))

  /* Atajo `/`: lleva a buscar en el catálogo, como en sitios de docs */
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
    const tag = document.activeElement?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    event.preventDefault()
    document.getElementById('proyectos')?.scrollIntoView({ behavior: 'smooth' })
    setTimeout(() => catalogSearch?.focus(), 450)
  })

  /* ── Año dinámico ────────────────────────────────────────── */
  const year = $('#currentYear')
  if (year) year.textContent = String(new Date().getFullYear())
})()
