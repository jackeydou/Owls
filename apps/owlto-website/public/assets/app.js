// Owlto website interactions. No dependencies; every effect degrades to the
// static, fully rendered page when scripting or motion is unavailable.

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const root = document.documentElement
const $ = (selector, scope = document) => scope.querySelector(selector)
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)]
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

// Runs `update` at most once per animation frame.
function framed(update) {
  let queued = false
  return (...args) => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      update(...args)
    })
  }
}

function initTheme() {
  const toggle = $('[data-theme-toggle]')
  if (!toggle) return
  toggle.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark'
    const apply = () => {
      root.dataset.theme = next
      try {
        localStorage.setItem('owlto-theme', next)
      } catch {
        // Storage can be blocked; the theme still applies for this visit.
      }
    }
    if (reducedMotion || !document.startViewTransition) {
      apply()
      return
    }
    const box = toggle.getBoundingClientRect()
    root.style.setProperty('--tx', `${box.left + box.width / 2}px`)
    root.style.setProperty('--ty', `${box.top + box.height / 2}px`)
    document.startViewTransition(apply)
  })
}

function initScrollChrome() {
  const nav = $('[data-nav]')
  const update = framed(() => {
    const max = root.scrollHeight - innerHeight
    root.style.setProperty('--scroll', max > 0 ? (scrollY / max).toFixed(4) : '0')
    nav?.classList.toggle('is-stuck', scrollY > 24)
  })
  addEventListener('scroll', update, { passive: true })
  addEventListener('resize', update)
  update()
}

// Pupils follow the pointer; clicking an owl makes it hoot.
function initOwls() {
  const flock = $('.flock')
  if (!flock) return
  const owls = $$('[data-owl]', flock).map((button) => ({
    button,
    svg: $('.owl-svg', button),
    pupils: $$('.owl-pupil', button)
  }))
  const REACH = 26

  const look = framed((x, y) => {
    for (const { svg, pupils } of owls) {
      const box = svg.getBoundingClientRect()
      if (box.width === 0) continue
      // Eye line sits ~45% down the visible drawing.
      const dx = x - (box.left + box.width / 2)
      const dy = y - (box.top + box.height * 0.45)
      const distance = Math.hypot(dx, dy) || 1
      const pull = Math.min(1, distance / 220) * REACH
      const px = ((dx / distance) * pull).toFixed(1)
      const py = ((dy / distance) * pull).toFixed(1)
      for (const pupil of pupils) {
        pupil.style.setProperty('--px', `${px}px`)
        pupil.style.setProperty('--py', `${py}px`)
      }
    }
  })

  if (!reducedMotion) {
    addEventListener('pointermove', (event) => look(event.clientX, event.clientY), {
      passive: true
    })
  }

  let hoots = []
  try {
    hoots = JSON.parse(flock.dataset.hoots ?? '[]')
  } catch {
    hoots = []
  }
  let turn = 0
  for (const { button } of owls) {
    button.addEventListener('click', () => {
      const bubble = document.createElement('span')
      bubble.className = 'hoot'
      bubble.textContent = hoots[turn++ % hoots.length] ?? 'Hoo!'
      button.append(bubble)
      bubble.addEventListener('animationend', () => bubble.remove())
      button.classList.remove('is-hooting')
      void button.offsetWidth
      button.classList.add('is-hooting')
    })
  }
}

function initReveal() {
  const targets = $$('.reveal')
  if (!('IntersectionObserver' in window)) {
    for (const target of targets) target.classList.add('is-in')
    return
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-in')
        observer.unobserve(entry.target)
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
  )
  for (const target of targets) observer.observe(target)
}

// Scroll progress through the tall "chaos" section drives the --p variable.
function initChaos() {
  const section = $('[data-chaos]')
  if (!section) return
  if (reducedMotion) {
    section.style.setProperty('--p', '1')
    return
  }
  const update = framed(() => {
    const box = section.getBoundingClientRect()
    const travel = box.height - innerHeight
    const progress = travel > 0 ? clamp(-box.top / travel, 0, 1) : 1
    // Hold the mess for the first stretch, finish folding before the section ends.
    section.style.setProperty('--p', clamp((progress - 0.12) / 0.68, 0, 1).toFixed(3))
  })
  addEventListener('scroll', update, { passive: true })
  addEventListener('resize', update)
  update()
}

// Plays one pre-rendered scene step by step. Each run owns a token so a newer
// run (or a replay) cancels the pending steps of the previous one.
function initDemo() {
  const demo = $('[data-demo]')
  if (!demo) return
  const scenes = $$('[data-scene]', demo)
  const chips = $$('[data-play]', demo)
  const input = $('[data-demo-input]', demo)
  const project = $('[data-demo-project]', demo)
  const send = $('[data-replay]', demo)
  let run = 0
  let current = 0

  const pause = (ms, token) =>
    new Promise((resolve, reject) => {
      setTimeout(() => (token === run ? resolve() : reject(new Error('cancelled'))), ms)
    })

  const show = (scene, step) => $(`[data-step="${step}"]`, scene)?.classList.add('is-in')

  function reset(scene) {
    for (const step of $$('[data-step]', scene)) step.classList.remove('is-in')
    for (const worker of $$('.wk', scene)) {
      worker.classList.add('is-working')
      const state = $('.wk-state', worker)
      state.textContent = state.dataset.working
      $('code', worker).textContent = ''
    }
    const approval = $('.approval', scene)
    approval.classList.remove('is-approved', 'is-waiting')
    const button = $('[data-approve]', approval)
    $('span', button).textContent = button.dataset.label
  }

  function select(index) {
    for (const [i, chip] of chips.entries()) {
      chip.classList.toggle('is-active', i === index)
      chip.setAttribute('aria-pressed', String(i === index))
    }
    for (const [i, scene] of scenes.entries()) scene.hidden = i !== index
    project.textContent = chips[index].dataset.project
  }

  async function type(text, token) {
    input.classList.add('is-typing')
    input.textContent = ''
    for (const char of text) {
      input.textContent += char
      await pause(char === ' ' ? 34 : 18, token)
    }
    await pause(320, token)
  }

  async function runWorkers(scene, token, from, to) {
    const workers = $$('.wk', scene)
    const logs = workers.map((worker) => JSON.parse(worker.dataset.log))
    for (let line = from; line < to; line++) {
      for (const [index, worker] of workers.entries()) {
        if (logs[index][line] === undefined) continue
        $('code', worker).textContent = logs[index][line]
        await pause(260, token)
      }
      await pause(620, token)
    }
  }

  function waitForApproval(scene, token) {
    const approval = $('.approval', scene)
    const button = $('[data-approve]', approval)
    approval.classList.add('is-waiting')
    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer)
        button.removeEventListener('click', finish)
        if (token !== run) return reject(new Error('cancelled'))
        approval.classList.replace('is-waiting', 'is-approved')
        $('span', button).textContent = button.dataset.done
        resolve()
      }
      // Approve on the visitor's behalf if they just watch.
      const timer = setTimeout(finish, 4200)
      button.addEventListener('click', finish)
    })
  }

  async function play(index) {
    const token = ++run
    current = index
    const scene = scenes[index]
    const chip = chips[index]
    select(index)
    reset(scene)
    try {
      await type(chip.dataset.prompt, token)
      send.classList.add('is-sent')
      input.classList.remove('is-typing')
      input.textContent = input.dataset.placeholder
      show(scene, 'user')
      await pause(220, token)
      send.classList.remove('is-sent')
      await pause(500, token)
      show(scene, 'plan')
      await pause(1000, token)
      show(scene, 'workers')
      await pause(700, token)
      await runWorkers(scene, token, 0, 2)
      show(scene, 'approval')
      await waitForApproval(scene, token)
      await pause(500, token)
      await runWorkers(scene, token, 2, 3)
      for (const worker of $$('.wk', scene)) {
        worker.classList.remove('is-working')
        const state = $('.wk-state', worker)
        state.textContent = state.dataset.done
        await pause(240, token)
      }
      await pause(400, token)
      show(scene, 'report')
    } catch {
      // A newer run took over; it owns the DOM now.
    }
  }

  // Without motion the pre-rendered final state stays; chips just switch scenes.
  if (reducedMotion) {
    for (const [index, chip] of chips.entries()) {
      chip.addEventListener('click', () => select(index))
    }
    return
  }

  for (const [index, chip] of chips.entries()) chip.addEventListener('click', () => play(index))
  send.addEventListener('click', () => play(current))
  demo.classList.add('is-live')
  reset(scenes[0])
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      play(0)
    },
    { threshold: 0.6 }
  )
  observer.observe($('.app', demo))
}

function initCopy() {
  for (const button of $$('[data-copy]')) {
    const label = $('span', button)
    const idle = label.textContent
    let timer
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy)
      } catch {
        return
      }
      button.classList.add('is-copied')
      label.textContent = button.dataset.copied
      clearTimeout(timer)
      timer = setTimeout(() => {
        button.classList.remove('is-copied')
        label.textContent = idle
      }, 1600)
    })
  }
}

function initTilt() {
  if (reducedMotion || !matchMedia('(hover: hover)').matches) return
  for (const card of $$('[data-tilt]')) {
    const move = framed((event) => {
      const box = card.getBoundingClientRect()
      const x = (event.clientX - box.left) / box.width - 0.5
      const y = (event.clientY - box.top) / box.height - 0.5
      card.style.setProperty('--ry', `${(x * 7).toFixed(2)}deg`)
      card.style.setProperty('--rx', `${(-y * 7).toFixed(2)}deg`)
    })
    card.addEventListener('pointermove', move)
    card.addEventListener('pointerleave', () => {
      requestAnimationFrame(() => {
        card.style.setProperty('--rx', '0deg')
        card.style.setProperty('--ry', '0deg')
      })
    })
  }
}

// Touch has no hover: tapping an owl card toggles its "working" drawing.
function initOwlCards() {
  for (const card of $$('.owl-card')) {
    card.addEventListener('click', () => card.classList.toggle('is-busy'))
  }
}

// The shortcut keycaps press down when the visitor presses the real keys.
function initKeys() {
  const keys = new Map($$('[data-key]').map((item) => [item.dataset.key, item]))
  if (keys.size === 0) return
  addEventListener('keydown', (event) => {
    keys.get(event.key.toLowerCase())?.classList.add('is-down')
  })
  addEventListener('keyup', (event) => {
    if (event.key === 'Meta' || event.key === 'Control') {
      // Releasing the modifier swallows the letter's keyup on macOS.
      for (const item of keys.values()) item.classList.remove('is-down')
      return
    }
    keys.get(event.key.toLowerCase())?.classList.remove('is-down')
  })
  addEventListener('blur', () => {
    for (const item of keys.values()) item.classList.remove('is-down')
  })
}

initTheme()
initScrollChrome()
initOwls()
initReveal()
initChaos()
initDemo()
initCopy()
initTilt()
initOwlCards()
initKeys()
