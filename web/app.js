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

  /* ── Header, navegación móvil y estado activo ────────────── */
  const header = $('#siteHeader')
  const menuButton = $('#menuButton')
  const mainNav = $('#mainNav')

  function updateHeader() {
    header?.classList.toggle('scrolled', window.scrollY > 12)
    $('#backToTop')?.classList.toggle('visible', window.scrollY > 700)
  }
  window.addEventListener('scroll', updateHeader, { passive: true })
  updateHeader()

  menuButton?.addEventListener('click', () => {
    const open = mainNav.classList.toggle('open')
    menuButton.setAttribute('aria-expanded', String(open))
    menuButton.setAttribute('aria-label', open ? 'Cerrar navegación' : 'Abrir navegación')
  })
  $$('a', mainNav).forEach((link) => link.addEventListener('click', () => {
    mainNav.classList.remove('open')
    menuButton?.setAttribute('aria-expanded', 'false')
  }))

  $('#backToTop')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }))

  const navLinks = $$('.main-nav a')
  const observedSections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean)

  if ('IntersectionObserver' in window) {
    const navObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        navLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${entry.target.id}`))
      }
    }, { rootMargin: '-35% 0px -58% 0px' })
    observedSections.forEach((section) => navObserver.observe(section))
  }

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
