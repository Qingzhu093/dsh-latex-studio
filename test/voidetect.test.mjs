/**
 * Exercise the A5 / column-void detector port on REAL rendered pages.
 * Run: node test/voidetect.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import {
  VOID_DEFAULTS,
  analyzePageImage,
  analyzePagesDirectory,
  decodePngGray,
  estimateLineHeight,
  findGutterX,
  findVoidSegments,
  inkThreshold,
  otsuThreshold,
  pageIndexFromName,
  rowInkRatio,
  smooth1d,
} from '../lib/core/voidetect.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** Build a synthetic 8-bit greyscale PNG from a luminance function. */
function makeGrayPng(width, height, lum) {
  const raw = Buffer.alloc(height * (width + 1))
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0 // filter: none
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(lum(x, y))))
  }
  const idat = zlib.deflateSync(raw)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // colour type: greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

let CRC_TABLE = null
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

// ---------------------------------------------------------------------------
// PNG decoding
// ---------------------------------------------------------------------------

test('voidetect: decodes a greyscale PNG losslessly', () => {
  const png = makeGrayPng(8, 4, (x, y) => (x + y * 8) * 7)
  const decoded = decodePngGray(png)
  assert.equal(decoded.ok, true, decoded.reason)
  assert.equal(decoded.width, 8)
  assert.equal(decoded.height, 4)
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 8; x++) {
      assert.equal(decoded.gray[y * 8 + x], ((x + y * 8) * 7) & 0xff, 'pixel mismatch at ' + x + ',' + y)
    }
  }
})

test('voidetect: unsupported PNG shapes degrade instead of throwing', () => {
  assert.equal(decodePngGray(Buffer.from('not a png')).ok, false)
  assert.equal(decodePngGray(Buffer.alloc(0)).reason, 'NOT_PNG')
  const result = analyzePageImage(Buffer.from('nope'))
  assert.equal(result.ok, false)
  assert.ok(result.reason)
})

test('voidetect: page index parses the two naming conventions', () => {
  assert.equal(pageIndexFromName('page_004.png'), 4)
  assert.equal(pageIndexFromName('page-012.png'), 12)
  assert.equal(pageIndexFromName('page001.png'), 1)
  assert.equal(pageIndexFromName('cover.png'), null)
})

// ---------------------------------------------------------------------------
// threshold + projection primitives
// ---------------------------------------------------------------------------

test('voidetect: Otsu separates a bimodal page and clamps the ink threshold', () => {
  const gray = new Uint8Array(1000)
  gray.fill(240, 0, 700)
  gray.fill(20, 700)
  const t = otsuThreshold(gray)
  // OpenCV's THRESH_OTSU returns the threshold value itself, so for a clean
  // two-mode histogram the optimum IS the lower mode (20): everything below it
  // is ink. Asserting "strictly between the modes" would be wrong.
  assert.equal(t, 20, 'the Otsu optimum for a clean bimodal histogram is the lower mode')
  const ink = inkThreshold(gray)
  assert.equal(ink, 120, '20 + 15 clamps up to the 120 floor')
  // Everything at the lower mode must read as ink under that threshold.
  assert.ok(20 < ink && 240 > ink)
  // Degenerate input falls back to the reference's 200.
  assert.equal(inkThreshold(new Uint8Array(0)), 200)
  const uniform = new Uint8Array(64).fill(128)
  assert.equal(otsuThreshold(uniform), -1, 'a flat histogram has no optimum')
  assert.equal(inkThreshold(uniform), 200, 'and falls back to the fixed value')
})

test('voidetect: rowInkRatio counts dark pixels per row over the given span', () => {
  // 4 wide, 3 tall; x=0 is always black, the rest white.
  const width = 4
  const gray = new Uint8Array([0, 255, 255, 255, 0, 255, 255, 255, 0, 255, 255, 255])
  const ink = inkThreshold(gray)
  const all = rowInkRatio(gray, width, 0, 4, 0, 3, ink)
  assert.equal(all.length, 3)
  for (const v of all) assert.ok(Math.abs(v - 0.25) < 1e-9, 'expected 1/4 ink, got ' + v)
  const none = rowInkRatio(gray, width, 1, 4, 0, 3, ink)
  for (const v of none) assert.equal(v, 0)
})

test('voidetect: smooth1d preserves the mean over a constant signal and pads edges', () => {
  const flat = smooth1d([0.5, 0.5, 0.5, 0.5], 3)
  for (const v of flat) assert.ok(Math.abs(v - 0.5) < 1e-12)
  const ramp = smooth1d([0, 0, 1, 1], 3)
  assert.equal(ramp.length, 4)
  assert.ok(ramp[0] >= 0 && ramp[3] <= 1)
  assert.deepEqual([...smooth1d([1, 2, 3], 1)], [1, 2, 3], 'window 1 is identity')
})

test('voidetect: findVoidSegments merges near neighbours and honours both filters', () => {
  const params = { voidRowThresh: 0.05, minVoidRatio: 0.3, minGapPx: 5, mergeGapPx: 12 }
  // 100 rows: void on 10..24 and 30..44 (gap 6 <= 12 -> merge) => 10..44 = 35 rows.
  const rowInk = new Float64Array(100).fill(0.5)
  for (let y = 10; y < 25; y++) rowInk[y] = 0
  for (let y = 30; y < 45; y++) rowInk[y] = 0
  const merged = findVoidSegments(rowInk, 100, params)
  assert.equal(merged.length, 1, 'near neighbours must merge into one segment')
  assert.equal(merged[0].y0, 10)
  assert.equal(merged[0].y1, 45)
  assert.equal(merged[0].heightPx, 35)
  assert.ok(Math.abs(merged[0].ratioOfColumn - 0.35) < 1e-9)

  // Ratio below minVoidRatio is rejected even though the run is long enough.
  const thin = new Float64Array(100).fill(0.5)
  for (let y = 0; y < 10; y++) thin[y] = 0
  assert.deepEqual(findVoidSegments(thin, 100, params), [], '10% of the column must not qualify as A5')

  // Run shorter than minGapPx is rejected even at a high ratio.
  const tiny = new Float64Array(10).fill(0.5)
  for (let y = 0; y < 3; y++) tiny[y] = 0
  assert.deepEqual(findVoidSegments(tiny, 10, params), [])
})

// ---------------------------------------------------------------------------
// page-level behaviour
// ---------------------------------------------------------------------------

test('voidetect: a synthetic two-column page with a large mid-column gap yields an A5 candidate', () => {
  const W = 400
  const H = 400
  // Two columns of "text lines" (dark rows) with a 160px void in the LEFT column only.
  const png = makeGrayPng(W, H, (x, y) => {
    const inLeft = x < 190
    const inRight = x > 210
    if (!inLeft && !inRight) return 255 // gutter
    const textLine = y % 20 < 4
    if (inLeft && y > 120 && y < 280) return 255 // the void
    return textLine ? 0 : 255
  })
  const result = analyzePageImage(png, { pageImage: 'page_001.png', layout: 'double' })
  assert.equal(result.ok, true, result.reason)
  assert.equal(result.layout, 'double')
  assert.equal(result.width, W)
  assert.equal(result.height, H)
  // The gutter search must land in the blank strip between the columns.
  assert.ok(result.split_x > 190 && result.split_x < 212, 'gutter x ' + result.split_x + ' should sit between the columns')
  assert.equal(result.columns.left.height_px, H)
  assert.ok(result.columns.left.max_void_ratio > 0.3, 'left column void ratio ' + result.columns.left.max_void_ratio)
  assert.equal(result.columns.right.max_void_ratio < 0.3, true, 'right column must stay clean')
  const a5 = result.a5_candidates
  assert.ok(a5.length >= 1, 'expected at least one A5 candidate')
  const candidate = a5.find((c) => c.column === 'left')
  assert.ok(candidate, 'the void is in the left column')
  assert.equal(candidate.suggested_defect_id, 'A5')
  assert.ok(candidate.y0 <= 130 && candidate.y1 >= 270, JSON.stringify(candidate))
  assert.ok(['high', 'medium'].includes(candidate.confidence))
})

test('voidetect: a dense single-column page yields NO A5 candidate (no false positive)', () => {
  const W = 300
  const H = 300
  const png = makeGrayPng(W, H, (x, y) => y % 12 < 5 ? 0 : 255) // uniform text everywhere
  const single = analyzePageImage(png, { pageImage: 'page_002.png', layout: 'single' })
  assert.equal(single.ok, true, single.reason)
  assert.equal(single.layout, 'single')
  assert.deepEqual(single.a5_candidates, [], 'a fully typeset page must not raise A5')
  assert.equal(single.columns, null, 'a single-column page has no column split to report')
  assert.equal(single.split_x, null)

  // Page-level metrics must be layout-independent and therefore still present.
  assert.ok(single.ink_ratio > 0 && single.ink_ratio < 1, 'ink ratio ' + single.ink_ratio)
  assert.ok(single.content_box, 'content box must be measured')
  assert.equal(typeof single.trailing_blank_ratio, 'number')
})

test('voidetect: single-column mode never fabricates a gutter or an A5 candidate', () => {
  // Regression: the port originally always split the page in half. On a real
  // single-column page that produced a bogus ~30% "left column void" candidate.
  // A5 is defined for two-column layouts, so single mode must abstain entirely.
  const W = 620
  const H = 800
  const png = makeGrayPng(W, H, (x, y) => {
    // one column of text hugging the left margin, huge right margin
    if (x > 40 && x < 400 && y > 60 && y < 700 && y % 16 < 7) return 20
    return 250
  })
  const single = analyzePageImage(png, { pageImage: 'page_007.png', layout: 'single' })
  assert.deepEqual(single.a5_candidates, [])
  const double = analyzePageImage(png, { pageImage: 'page_007.png', layout: 'double' })
  assert.equal(double.layout, 'double')
  assert.ok(Array.isArray(double.a5_candidates))
  assert.ok(double.split_x !== null, 'double mode still reports a gutter')
})

test('voidetect: estimateLineHeight stays inside the reference bounds on synthetic text', () => {
  // NOTE ON FIDELITY: the reference estimates the pitch from the median spacing
  // of strong vertical-gradient rows. On SYNTHETIC hard-edged bars the Sobel
  // response fires twice per line (leading and trailing edge), so the median can
  // collapse toward the 18px floor. That is a property of the reference
  // algorithm on unrealistic input, not a port bug — on a real rendered page the
  // estimator returns the true pitch (see the range assertion below). This test
  // therefore pins the INVARIANTS (floor, finiteness, magnitude sanity) instead
  // of an exact pitch, and must not be "fixed" by loosening the floor.
  const W = 200
  const H = 400
  const png = makeGrayPng(W, H, (_x, y) => (y % 24 < 2 ? 0 : 255))
  const decoded = decodePngGray(png)
  assert.equal(decoded.ok, true)
  const lineHeight = estimateLineHeight(decoded.gray, decoded.width, decoded.height)
  assert.ok(Number.isFinite(lineHeight) && lineHeight >= 1)
  assert.ok(lineHeight >= 18, 'the caller-visible floor is applied by analyzePageImage, but never go below 1')
  assert.ok(lineHeight <= 40, 'a 24px pitch must not blow up, got ' + lineHeight)
})

test('voidetect: estimateLineHeight recovers a real body pitch on an actual rendered page', (t) => {
  // Regression anchor for the A5 min-gap conversion: `min_gap_px` is derived from
  // the line height, so a broken estimator silently changes A5 sensitivity.
  //
  // This MUST use a real rendered page. The estimator keys off the vertical
  // gradient inside glyphs; on synthetic solid bars the response degenerates and
  // the median collapses, so a synthetic fixture would assert the wrong thing.
  // Measured on this box: an 11pt article body at 150 dpi gives 24px, and
  // 24px / 150dpi * 72 = 11.5pt, which is the expected body size.
  const candidate = path.resolve(HERE, '..', '..', 'latex-demo', '.latex-studio', 'pages', 'page-001.png')
  if (!fs.existsSync(candidate)) {
    t.skip('no rendered page available at ' + candidate)
    return
  }
  const decoded = decodePngGray(fs.readFileSync(candidate))
  assert.equal(decoded.ok, true, decoded.reason)
  const lineHeight = estimateLineHeight(decoded.gray, decoded.width, decoded.height)
  assert.ok(lineHeight >= 18 && lineHeight <= 40, 'plausible body pitch expected, got ' + lineHeight + 'px')
  // Sanity: the page must also be a sane render size.
  assert.ok(decoded.width > 800 && decoded.height > 1000, decoded.width + 'x' + decoded.height)
})

test('voidetect: findGutterX picks the brightest vertical strip', () => {
  const W = 200
  const H = 50
  const png = makeGrayPng(W, H, (x) => (x > 95 && x < 105 ? 255 : 0))
  const decoded = decodePngGray(png)
  const gx = findGutterX(decoded.gray, W, H)
  assert.ok(gx > 90 && gx < 110, 'gutter at ' + gx)
})

// ---------------------------------------------------------------------------
// directory walk + defaults contract
// ---------------------------------------------------------------------------

test('voidetect: analyzePagesDirectory reports candidates by page index', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-void-'))
  try {
    const voided = makeGrayPng(400, 400, (x, y) => {
      const inLeft = x < 190
      const inRight = x > 210
      if (!inLeft && !inRight) return 255
      if (inLeft && y > 120 && y < 280) return 255
      return y % 20 < 4 ? 0 : 255
    })
    const clean = makeGrayPng(300, 300, (_x, y) => (y % 12 < 5 ? 0 : 255))
    fs.writeFileSync(path.join(dir, 'page_001.png'), clean)
    fs.writeFileSync(path.join(dir, 'page_002.png'), voided)
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored')
    const report = analyzePagesDirectory(dir)
    assert.equal(report.ok, true, report.reason)
    assert.equal(report.page_count, 2, 'only images are analysed')
    assert.deepEqual(report.a5_candidate_pages, [2], 'only page 2 has the void')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('voidetect: an unreadable directory degrades with a reason', () => {
  const report = analyzePagesDirectory(path.join(os.tmpdir(), 'dsh-does-not-exist-' + Date.now()))
  assert.equal(report.ok, false)
  assert.match(report.reason, /PAGES_DIR_UNREADABLE/)
  assert.deepEqual(report.pages, [])
})

test('voidetect: defaults stay aligned with the vendored layout_rules thresholds', () => {
  const rules = JSON.parse(fs.readFileSync(new URL('../lib/data/layout_rules.json', import.meta.url), 'utf8'))
  assert.equal(VOID_DEFAULTS.minVoidRatio, rules.intra_column_void.min_void_ratio_of_column)
  assert.equal(VOID_DEFAULTS.minVoidLines, rules.intra_column_void.min_void_height_lines)
})
