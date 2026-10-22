'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { compactUiXml, measure, parseCentre, shortType } = require('../src/compact-ui.js')

/** Build a uiautomator-shaped node tag with the attributes that matter here. */
function node(attrs) {
  const a = {
    index: '0',
    text: '',
    'resource-id': '',
    class: 'android.widget.TextView',
    package: 'com.example',
    'content-desc': '',
    checkable: 'false',
    checked: 'false',
    clickable: 'false',
    enabled: 'true',
    focusable: 'false',
    focused: 'false',
    scrollable: 'false',
    'long-clickable': 'false',
    password: 'false',
    selected: 'false',
    bounds: '[0,0][0,0]',
    ...attrs,
  }
  const parts = Object.entries(a).map(([k, v]) => `${k}="${v}"`)
  return `<node ${parts.join(' ')} />`
}

function wrap(children) {
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${children.join('')}</hierarchy>`
}

test('parseCentre averages the corners', () => {
  assert.deepStrictEqual(parseCentre('[140,200][400,350]'), [270, 275])
})

test('parseCentre rejects degenerate and missing bounds', () => {
  assert.strictEqual(parseCentre('[10,10][10,10]'), null)
  assert.strictEqual(parseCentre('[0,0][0,0]'), null)
  assert.strictEqual(parseCentre(''), null)
  assert.strictEqual(parseCentre(undefined), null)
})

test('shortType maps known widgets and falls back to the leaf name', () => {
  assert.strictEqual(shortType('android.widget.Button'), 'btn')
  assert.strictEqual(shortType('android.widget.EditText'), 'edit')
  assert.strictEqual(shortType('android.widget.LinearLayout'), 'group')
  assert.strictEqual(shortType('com.example.CustomThing'), 'customthing')
  assert.strictEqual(shortType(''), '?')
})

test('keeps clickable nodes with their tap centre', () => {
  const xml = wrap([node({
    text: 'Settings',
    class: 'android.widget.Button',
    clickable: 'true',
    'resource-id': 'com.example:id/settings_btn',
    bounds: '[100,200][300,280]',
  })])
  const out = compactUiXml(xml)
  assert.match(out, /200,240 \| btn \| Settings \| #settings_btn/)
})

test('drops non-interactive nodes that carry no text', () => {
  const xml = wrap([
    node({ class: 'android.widget.FrameLayout', bounds: '[0,0][1080,1920]' }),
    node({ class: 'android.widget.LinearLayout', bounds: '[0,0][1080,1920]' }),
  ])
  const out = compactUiXml(xml)
  // nodeCount counts every node seen, including the ones filtered out — the
  // summary is meant to show how much noise was dropped.
  assert.match(out, /2 nodes -> 0 actionable/)
})

test('falls back to content-desc when text is empty', () => {
  const xml = wrap([node({
    'content-desc': 'Back',
    clickable: 'true',
    bounds: '[0,0][100,100]',
  })])
  assert.match(compactUiXml(xml), /50,50 \| txt \| Back/)
})

test('marks editable fields as edit', () => {
  const xml = wrap([node({
    text: 'Search',
    class: 'android.widget.EditText',
    clickable: 'true',
    bounds: '[0,0][900,100]',
  })])
  assert.match(compactUiXml(xml), /450,50 \| edit \| Search/)
})

test('scrollable containers get a scroll row with no coordinates', () => {
  const xml = wrap([node({
    class: 'androidx.recyclerview.widget.RecyclerView',
    scrollable: 'true',
    bounds: '[0,100][1080,900]',
  })])
  assert.match(compactUiXml(xml), /- \| scroll/)
})

test('de-duplicates parent/child pairs reporting the same text', () => {
  const xml = wrap([
    node({ text: 'Termux', clickable: 'true', bounds: '[100,300][300,400]' }),
    node({ text: 'Termux', clickable: 'true', bounds: '[100,300][300,400]' }),
  ])
  const out = compactUiXml(xml)
  assert.match(out, /2 nodes -> 1 actionable/)
  assert.strictEqual(out.split('\n').filter((l) => l.includes('Termux')).length, 1)
})

test('strips resource-id package prefixes', () => {
  const xml = wrap([node({
    clickable: 'true',
    'resource-id': 'com.miui.home:id/workspace',
    bounds: '[0,0][1080,1920]',
  })])
  assert.match(compactUiXml(xml), /#workspace/)
  assert.doesNotMatch(compactUiXml(xml), /com\.miui\.home:id/)
})

test('static text appears once and is not repeated after being covered', () => {
  const xml = wrap([
    node({ text: 'Weather', clickable: 'true', bounds: '[0,0][200,100]' }),
    node({ text: 'Weather', bounds: '[0,0][200,100]' }),
    node({ text: '23°C', bounds: '[0,100][200,200]' }),
  ])
  const out = compactUiXml(xml)
  assert.strictEqual(out.split('\n').filter((l) => l === 'Weather').length, 0, 'covered label must not repeat')
  assert.match(out, /# text\n23°C/)
})

test('maxText caps the trailing static list', () => {
  const nodes = []
  for (let i = 0; i < 40; i += 1) {
    nodes.push(node({ text: `label${i}`, bounds: `[0,${i * 10}][10,${i * 10 + 10}]` }))
  }
  const out = compactUiXml(wrap(nodes), { maxText: 5 })
  assert.match(out, /\.\.\. \+35/)
})

test('empty or malformed input does not throw', () => {
  assert.doesNotThrow(() => compactUiXml(''))
  assert.doesNotThrow(() => compactUiXml('<hierarchy></hierarchy>'))
  assert.match(compactUiXml(''), /0 nodes -> 0 actionable/)
})

test('measure reports the savings', () => {
  const xml = 'x'.repeat(1000)
  const compact = 'y'.repeat(100)
  const m = measure(xml, compact)
  assert.strictEqual(m.rawChars, 1000)
  assert.strictEqual(m.compactChars, 100)
  assert.strictEqual(m.savedPercent, 90)
})

test('a realistic screen compresses by well over 90%', () => {
  // 60 layout containers (pure noise) + 6 real controls
  const noise = []
  for (let i = 0; i < 60; i += 1) {
    noise.push(node({ class: 'android.widget.FrameLayout', bounds: `[0,${i}][1080,${i + 1}]` }))
  }
  const real = ['Wi-Fi', 'Bluetooth', 'Display', 'Sound', 'Battery', 'Storage'].map((t, i) => node({
    text: t,
    clickable: 'true',
    bounds: `[0,${i * 100}][1080,${i * 100 + 90}]`,
  }))
  const xml = wrap([...noise, ...real])
  const out = compactUiXml(xml)
  const m = measure(xml, out)
  assert.ok(m.savedPercent > 90, `expected >90% saved, got ${m.savedPercent}%`)
  assert.match(out, /6 actionable/)
})
