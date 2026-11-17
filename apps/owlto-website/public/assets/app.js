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
  const sides = $$('[data-side]', demo)
  const chips = $$('[data-play]', demo)
  const input = $('[data-demo-input]', demo)
  const count = $('[data-demo-count]', demo)
  const send = $('[data-replay]', demo)
  let run = 0
  let current = 0

  const pause = (ms, token) =>
    new Promise((resolve, reject) => {
      setTimeout(() => (token === run ? resolve() : reject(new Error('cancelled'))), ms)
    })

  const show = (scene, step) => $(`[data-step="${step}"]`, scene)?.classList.add('is-in')

  // The sidebar and the title-bar counter are derived from the workers'
  // states (queued, working, done) so they cannot drift from the cards.
  function refresh(scene) {
    const workers = $$('.wk', scene)
    count.textContent = workers.filter((worker) => worker.dataset.state === 'working').length
    for (const row of $$('[data-project]', sides[scenes.indexOf(scene)])) {
      const mine = workers.filter((worker) => worker.dataset.project === row.dataset.project)
      const working = mine.filter((worker) => worker.dataset.state === 'working').length
      const allDone = mine.every((worker) => worker.dataset.state === 'done')
      const state = working > 0 ? 'working' : allDone ? 'done' : 'idle'
      const label = $('em', row)
      row.dataset.state = state
      label.textContent =
        state === 'working' ? `${working} ${label.dataset.working}` : label.dataset[state]
    }
  }

  function setState(worker, state) {
    worker.dataset.state = state
    const label = $('.wk-state', worker)
    label.textContent = label.dataset[state]
    refresh(worker.closest('[data-scene]'))
  }

  function reset(scene) {
    for (const step of $$('[data-step]', scene)) step.classList.remove('is-in')
    for (const worker of $$('.wk', scene)) {
      $('code', worker).textContent = ''
      setState(worker, 'queued')
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
    for (const [i, side] of sides.entries()) side.hidden = i !== index
    refresh(scenes[index])
  }

  async function type(text, token) {
    input.classList.add('is-typing')
    input.textContent = ''
    for (const char of text) {
      input.textContent += char
      await pause(char === ' ' ? 30 : 14, token)
    }
    await pause(320, token)
  }

  const wave = (scene, number) =>
    $$('.wk', scene).filter((worker) => worker.dataset.wave === String(number))

  async function start(workers, token) {
    for (const worker of workers) {
      setState(worker, 'working')
      await pause(160, token)
    }
  }

  async function log(workers, token, from, to) {
    const logs = workers.map((worker) => JSON.parse(worker.dataset.log))
    for (let line = from; line < to; line++) {
      for (const [index, worker] of workers.entries()) {
        if (logs[index][line] === undefined) continue
        $('code', worker).textContent = logs[index][line]
        await pause(200, token)
      }
      await pause(560, token)
    }
  }

  async function finish(workers, token) {
    for (const worker of workers) {
      setState(worker, 'done')
      await pause(200, token)
    }
  }

  function waitForApproval(scene, token) {
    const approval = $('.approval', scene)
    const button = $('[data-approve]', approval)
    approval.classList.add('is-waiting')
    return new Promise((resolve, reject) => {
      const done = () => {
        clearTimeout(timer)
        button.removeEventListener('click', done)
        if (token !== run) return reject(new Error('cancelled'))
        approval.classList.replace('is-waiting', 'is-approved')
        $('span', button).textContent = button.dataset.done
        resolve()
      }
      // Approve on the visitor's behalf if they just watch.
      const timer = setTimeout(done, 4200)
      button.addEventListener('click', done)
    })
  }

  async function play(index) {
    const token = ++run
    current = index
    const scene = scenes[index]
    select(index)
    reset(scene)
    const first = wave(scene, 1)
    const second = wave(scene, 2)
    try {
      await type(chips[index].dataset.prompt, token)
      send.classList.add('is-sent')
      input.classList.remove('is-typing')
      input.textContent = input.dataset.placeholder
      show(scene, 'user')
      await pause(220, token)
      send.classList.remove('is-sent')
      await pause(500, token)
      show(scene, 'plan')
      await pause(1100, token)
      show(scene, 'workers')
      await pause(700, token)
      await start(first, token)
      await log(first, token, 0, 2)
      show(scene, 'approval')
      await waitForApproval(scene, token)
      await pause(400, token)
      await log(first, token, 2, 3)
      await finish(first, token)
      await pause(300, token)
      show(scene, 'handoff')
      await pause(900, token)
      await start(second, token)
      await log(second, token, 0, 3)
      await finish(second, token)
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

// Docs: the page list starts open so it works without scripting; on narrow
// screens fold it away so the article comes first.
function initDocsMenu() {
  const menu = $('.docs-menu')
  if (menu && matchMedia('(max-width: 1000px)').matches) menu.open = false
}

initTheme()
initDocsMenu()
initScrollChrome()
initOwls()
initReveal()
initChaos()
initDemo()
initCopy()
initTilt()
