/**
 * 页图机检：列内竖向空洞（A5）与版面占用度量。
 *
 * 这是 PaperFit `scripts/detect_column_void.py` 的**行为等价移植**（MIT）。
 * 移植的是算法，不是代码：原版依赖 `opencv-python-headless` + `numpy`，本机
 * **没有 cv2**（只有 numpy/PIL），而且本插件的硬不变量是 `dependencies: {}`，
 * 因此这里用 Node 内置 `zlib` 自己解 PNG，并用纯 JS 实现原版的每一步。
 *
 * 原版算法步骤（`detect_column_void.py`，行号指原文件）：
 *   1. 读图转灰度                        (:179-180)
 *   2. Otsu 阈值求墨迹分界，再放宽 15，夹在 [120,220]  (:149-156)
 *   3. 中缝检测：横向 33%–67% 区间里找**最亮**的竖带中心  (:62-80)
 *   4. 逐栏「行向墨迹占比」+ 移动平均平滑            (:83-87, :89-97)
 *   5. 低于 void_row_thresh 视为无墨迹，成段、合并近邻、
 *      过滤 (>= min_void_ratio 且 >= min_gap_px)      (:100-146)
 *   6. 用 Sobel 纵向梯度峰值间距估计行高，换算 min_gap_px (:194-203)
 *   7. 输出 a5_candidates（含 y0/y1 分数与 confidence） (:228-243)
 *
 * 与 PaperFit 的架构关系（`agents/layout-detective-agent.md:130, :180, :240`）：
 * 机检产出的**只是候选**。页图仍是判据主体，模型看完图后**确认**才写入 defects；
 * 若模型看图后否定，机检结果记为误报。所以本模块绝不自行判定缺陷存在。
 *
 * 纯 Node ESM，零第三方依赖，零 DSH 依赖。
 * @module dsh-latex-studio/core/voidetect
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/** 与 `config/layout_rules.yaml` 的 `intra_column_void` 对齐的默认参数。 */
export const VOID_DEFAULTS = Object.freeze({
  minVoidRatio: 0.30, // min_void_ratio_of_column
  minVoidLines: 8, // min_void_height_lines
  voidRowThresh: 0.035, // 平滑后一行墨迹占比低于此值算「无墨迹」
  smoothRows: 7, // 行序列移动平均窗口（奇数）
  mergeGapPx: 12, // 两段空洞间隔 <= 此值则合并
  marginLo: 0.33, // 中缝搜索区间
  marginHi: 0.67,
})

// ---------------------------------------------------------------------------
// PNG 解码（最小子集：8-bit、非隔行、灰度/RGB/RGBA）
// ---------------------------------------------------------------------------

const PNG_SIG = 0x89504e47

/**
 * 解码 PNG 为灰度像素数组。
 * 只支持 8-bit 非隔行的 gray/RGB/RGBA —— 也就是 poppler 与 MiKTeX mgs 实际产出的形态。
 * 其它形态返回 `{ok:false, reason}` 而不是抛异常（本插件的降级约定）。
 * @param {Buffer} buffer - PNG 字节。
 * @returns {{ok: true, width: number, height: number, gray: Uint8Array} | {ok: false, reason: string}}
 */
export function decodePngGray(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.readUInt32BE(0) !== PNG_SIG) {
    return { ok: false, reason: 'NOT_PNG' }
  }
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      if (length < 13) return { ok: false, reason: 'BAD_IHDR' }
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + length
  }
  if (width <= 0 || height <= 0) return { ok: false, reason: 'NO_IHDR' }
  if (bitDepth !== 8) return { ok: false, reason: 'UNSUPPORTED_BIT_DEPTH_' + bitDepth }
  if (interlace !== 0) return { ok: false, reason: 'INTERLACED_UNSUPPORTED' }
  const channels = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 6 ? 4 : 0
  if (channels === 0) return { ok: false, reason: 'UNSUPPORTED_COLOR_TYPE_' + colorType }
  if (idat.length === 0) return { ok: false, reason: 'NO_IDAT' }

  let raw
  try {
    raw = zlib.inflateSync(Buffer.concat(idat))
  } catch (error) {
    return { ok: false, reason: 'INFLATE_FAILED: ' + String((error && error.message) || error) }
  }

  const stride = width * channels
  if (raw.length < height * (stride + 1)) return { ok: false, reason: 'TRUNCATED_IDAT' }
  const out = Buffer.alloc(height * stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const lineStart = y * stride
    const prevStart = lineStart - stride
    for (let x = 0; x < stride; x++) {
      const value = raw[pos + x]
      const a = x >= channels ? out[lineStart + x - channels] : 0
      const b = y > 0 ? out[prevStart + x] : 0
      const c = y > 0 && x >= channels ? out[prevStart + x - channels] : 0
      let result
      switch (filter) {
        case 0: result = value; break
        case 1: result = value + a; break
        case 2: result = value + b; break
        case 3: result = value + ((a + b) >> 1); break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          result = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)
          break
        }
        default: return { ok: false, reason: 'UNSUPPORTED_FILTER_' + filter }
      }
      out[lineStart + x] = result & 0xff
    }
    pos += stride
  }

  // 转灰度（与原版 cv2.COLOR_BGR2GRAY 同一组 ITU-R 601 权重）。
  const gray = new Uint8Array(width * height)
  if (channels === 1) {
    gray.set(out)
  } else {
    for (let i = 0, p = 0; i < gray.length; i++, p += channels) {
      const r = out[p]
      const g = out[p + 1]
      const b = out[p + 2]
      gray[i] = (r * 299 + g * 587 + b * 114 + 500) / 1000
    }
  }
  return { ok: true, width, height, gray }
}

/** 从文件名解析页码（`page_004.png` → 4），与 `page_index_from_name` 等价。 */
export function pageIndexFromName(name) {
  const m = /page[_-]?(\d+)/i.exec(String(name))
  return m ? Number.parseInt(m[1], 10) : null
}

// ---------------------------------------------------------------------------
// 阈值与投影
// ---------------------------------------------------------------------------

/**
 * Otsu 法求二值化阈值（原版 `cv2.threshold(..., THRESH_OTSU)` 的等价实现）。
 * @param {Uint8Array} gray - 灰度像素。
 * @returns {number} 0..255 的分界；样本退化时返回 -1。
 */
export function otsuThreshold(gray) {
  const hist = new Float64Array(256)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  if (total === 0) return -1
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = -1
  let bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > bestVar) {
      bestVar = between
      best = t
    }
  }
  return best
}

/**
 * 墨迹阈值：Otsu 分界 +15，夹在 [120,220]（原版 `ink_threshold_from_image`）。
 * 原版先做 `GaussianBlur(5,5)`；本实现省去模糊，因为对恒定的二值化分界影响可忽略，
 * 而模糊会引入额外的边界语义（这一点在 `test/voidetect.test.mjs` 里以不变量锁定）。
 * @param {Uint8Array} gray - 灰度像素。
 * @returns {number} 墨迹阈值。
 */
export function inkThreshold(gray) {
  const t = otsuThreshold(gray)
  if (t <= 0 || t >= 255) return 200
  return Math.min(220, Math.max(120, t + 15))
}

/**
 * 逐行墨迹占比 [0,1]（原版 `column_row_ink_ratio`）。
 * @param {Uint8Array} gray - 整图灰度。
 * @param {number} width - 整图宽。
 * @param {number} x0 - 子区域左边界（含）。
 * @param {number} x1 - 子区域右边界（不含）。
 * @param {number} y0 - 子区域上边界（含）。
 * @param {number} y1 - 子区域下边界（不含）。
 * @param {number} threshold - 墨迹阈值。
 * @returns {Float64Array} 每行占比。
 */
export function rowInkRatio(gray, width, x0, x1, y0, y1, threshold) {
  const rows = Math.max(0, y1 - y0)
  const cols = Math.max(1, x1 - x0)
  const out = new Float64Array(rows)
  for (let y = 0; y < rows; y++) {
    let ink = 0
    const base = (y0 + y) * width
    for (let x = x0; x < x1; x++) if (gray[base + x] < threshold) ink++
    out[y] = ink / cols
  }
  return out
}

/**
 * 一维移动平均（原版 `smooth_1d`，edge padding，窗口取奇数）。
 * @param {Float64Array|number[]} values - 序列。
 * @param {number} k - 窗口。
 * @returns {Float64Array} 平滑序列。
 */
export function smooth1d(values, k) {
  const window = Math.max(1, Math.trunc(k) | 1)
  if (window === 1) return Float64Array.from(values)
  const n = values.length
  const out = new Float64Array(n)
  const half = window >> 1
  for (let i = 0; i < n; i++) {
    let acc = 0
    for (let j = -half; j <= half; j++) {
      const idx = Math.min(n - 1, Math.max(0, i + j))
      acc += values[idx]
    }
    out[i] = acc / window
  }
  return out
}

/**
 * 找出空洞段（原版 `find_void_segments`）：连续无墨迹行成段 → 合并近邻 → 按阈值过滤。
 * @param {Float64Array} rowInk - 平滑后的行墨迹占比。
 * @param {number} colHeight - 栏高（像素）。
 * @param {object} params - `{voidRowThresh, minVoidRatio, minGapPx, mergeGapPx}`。
 * @returns {Array<{y0: number, y1: number, heightPx: number, ratioOfColumn: number}>}
 */
export function findVoidSegments(rowInk, colHeight, params) {
  const { voidRowThresh, minVoidRatio, minGapPx, mergeGapPx } = params
  const segments = []
  let i = 0
  const n = rowInk.length
  while (i < n) {
    if (!(rowInk[i] < voidRowThresh)) {
      i++
      continue
    }
    let j = i
    while (j < n && rowInk[j] < voidRowThresh) j++
    if (j - i >= minGapPx) segments.push([i, j])
    i = j
  }
  const merged = []
  for (const [y0, y1] of segments) {
    if (merged.length === 0) {
      merged.push([y0, y1])
      continue
    }
    const last = merged[merged.length - 1]
    if (y0 - last[1] <= mergeGapPx) last[1] = y1
    else merged.push([y0, y1])
  }
  const out = []
  for (const [y0, y1] of merged) {
    const heightPx = y1 - y0
    const ratio = heightPx / Math.max(1, colHeight)
    if (ratio >= minVoidRatio && heightPx >= minGapPx) {
      out.push({ y0, y1, heightPx, ratioOfColumn: Math.round(ratio * 1e4) / 1e4 })
    }
  }
  return out
}

/**
 * 中缝 x：在 [width*marginLo, width*marginHi) 内找平均亮度最高的竖带中心
 * （原版 `find_gutter_x`，窗口宽度 `width/200 | 1`）。
 * @param {Uint8Array} gray - 整图灰度。
 * @param {number} width - 图宽。
 * @param {number} height - 图高。
 * @param {number} marginLo - 搜索下界比例。
 * @param {number} marginHi - 搜索上界比例。
 * @returns {number} 中缝 x 像素。
 */
export function findGutterX(gray, width, height, marginLo = VOID_DEFAULTS.marginLo, marginHi = VOID_DEFAULTS.marginHi) {
  const x0 = Math.max(1, Math.trunc(width * marginLo))
  const x1 = Math.min(width - 2, Math.trunc(width * marginHi))
  let win = Math.max(3, (width / 200) | 1)
  if (win % 2 === 0) win++
  const half = win >> 1
  let bestX = (x0 + x1) >> 1
  let bestScore = -1
  for (let xc = x0; xc < x1; xc++) {
    const lo = Math.max(0, xc - half)
    const hi = Math.min(width, xc + half + 1)
    let acc = 0
    let count = 0
    for (let y = 0; y < height; y++) {
      const base = y * width
      for (let x = lo; x < hi; x++) {
        acc += gray[base + x]
        count++
      }
    }
    const score = count > 0 ? acc / count : 0
    if (score > bestScore) {
      bestScore = score
      bestX = xc
    }
  }
  return bestX
}

/**
 * 用纵向 Sobel 梯度的强响应行间距估计正文行高（原版 `analyze_page` 的 :194-203）。
 * @param {Uint8Array} gray - 整图灰度。
 * @param {number} width - 图宽。
 * @param {number} height - 图高。
 * @returns {number} 估计行高（像素），下限 18。
 */
export function estimateLineHeight(gray, width, height) {
  const rowAct = new Float64Array(height)
  for (let y = 1; y < height - 1; y++) {
    let acc = 0
    for (let x = 0; x < width; x++) {
      // 3x1 纵向 Sobel：[-1, 0, 1]^T 作用于 y-1 / y+1。
      acc += Math.abs(gray[(y + 1) * width + x] - gray[(y - 1) * width + x])
    }
    rowAct[y] = acc / width
  }
  const sorted = Float64Array.from(rowAct).sort()
  const p85 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.85))]
  const peaks = []
  for (let y = 0; y < height; y++) if (rowAct[y] > p85) peaks.push(y)
  if (peaks.length <= 10) return 18
  const diffs = []
  for (let i = 1; i < peaks.length; i++) {
    const d = peaks[i] - peaks[i - 1]
    if (d > 3) diffs.push(d)
  }
  if (diffs.length === 0) return 18
  diffs.sort((a, b) => a - b)
  const mid = diffs.length >> 1
  const median = diffs.length % 2 === 1 ? diffs[mid] : Math.round((diffs[mid - 1] + diffs[mid]) / 2)
  return Math.max(1, median)
}

/** 原版默认 line_h 下限 18，用于 min_gap_px。 */
const MIN_LINE_HEIGHT = 18

/**
 * 单页分析：产出 A5 候选（双栏）与页面级度量。
 *
 * 输出字段名与 `detect_column_void.py` 的 JSON 保持一致（snake_case），
 * 以便与 PaperFit 的诊断报告格式对齐。
 *
 * **layout 参数是必需的语义**：原版脚本假定输入是双栏页图，总是按中缝切成左右两栏。
 * 单栏文档没有中缝，硬切出来的「左/右栏」是没有意义的（实测单栏页会被切成
 * 30% 的假空洞）。因此 `layout: 'single'` 时**不做**空洞判定，只报页面级度量；
 * A5 在 taxonomy 里本就只对双栏成立。
 *
 * @param {Buffer} pngBuffer - 页图字节。
 * @param {{pageImage?: string, splitX?: number|null, layout?: 'single'|'double'}} [options] - 元数据与覆盖项。
 * @param {object} [params] - 算法参数（见 {@link VOID_DEFAULTS}）。
 * @returns {object} 每页报告；不可解码时返回 `{ok:false, reason}`。
 */
export function analyzePageImage(pngBuffer, options = {}, params = {}) {
  const p = { ...VOID_DEFAULTS, ...params }
  const decoded = decodePngGray(pngBuffer)
  if (!decoded.ok) return { ok: false, reason: decoded.reason }
  const { gray, width, height } = decoded

  const thr = inkThreshold(gray)
  const twoColumn = options.layout === 'double'

  // 页面级度量：与栏数无关，单栏/双栏都给。
  let inkPixels = 0
  let top = height
  let bottom = -1
  let left = width
  let right = -1
  for (let y = 0; y < height; y++) {
    const base = y * width
    for (let x = 0; x < width; x++) {
      if (gray[base + x] < thr) {
        inkPixels++
        if (y < top) top = y
        if (y > bottom) bottom = y
        if (x < left) left = x
        if (x > right) right = x
      }
    }
  }
  const lineHeightRaw = estimateLineHeight(gray, width, height)
  const lineHeight = Math.max(MIN_LINE_HEIGHT, lineHeightRaw)
  const pageMetrics = {
    width,
    height,
    ink_threshold: thr,
    ink_ratio: Math.round((inkPixels / Math.max(1, width * height)) * 1e4) / 1e4,
    estimated_line_height_px: lineHeight,
    content_box: bottom >= 0 ? { left, top, right, bottom } : null,
    // 正文结束后到页底的空带高度占比：A2（末页留白）的**可测**代理指标。
    trailing_blank_ratio: bottom >= 0 ? Math.round(((height - bottom) / height) * 1e4) / 1e4 : null,
  }

  if (!twoColumn) {
    return { ok: true, layout: 'single', page_image: options.pageImage ?? null, page_index: pageIndexFromName(options.pageImage ?? ''), ...pageMetrics, split_x: null, min_gap_px_used: null, columns: null, a5_candidates: [] }
  }

  const splitX = options.splitX === undefined || options.splitX === null
    ? findGutterX(gray, width, height, p.marginLo, p.marginHi)
    : Math.min(Math.max(Math.trunc(options.splitX), Math.trunc(width * 0.2)), Math.trunc(width * 0.8))
  const minGapPx = Math.max(12, Math.trunc(p.minVoidLines * lineHeight * 0.85))

  const columns = {}
  const candidates = []
  const spans = [['left', 0, splitX], ['right', splitX, width]]
  for (const [name, x0, x1] of spans) {
    const colHeight = height
    const raw = rowInkRatio(gray, width, x0, x1, 0, height, thr)
    const smoothed = smooth1d(raw, p.smoothRows)
    const voids = findVoidSegments(smoothed, colHeight, {
      voidRowThresh: p.voidRowThresh,
      minVoidRatio: p.minVoidRatio,
      minGapPx,
      mergeGapPx: p.mergeGapPx,
    })
    let maxRatio = 0
    for (const v of voids) maxRatio = Math.max(maxRatio, v.ratioOfColumn)
    let sum = 0
    for (const value of smoothed) sum += value
    columns[name] = {
      width_px: x1 - x0,
      height_px: colHeight,
      void_segments: voids.map((v) => ({ y0: v.y0, y1: v.y1, height_px: v.heightPx, ratio_of_column: v.ratioOfColumn })),
      max_void_ratio: Math.round(maxRatio * 1e4) / 1e4,
      mean_row_ink: Math.round((sum / Math.max(1, smoothed.length)) * 1e4) / 1e4,
    }
    for (const v of voids) {
      candidates.push({
        suggested_defect_id: 'A5',
        column: name,
        y0: v.y0,
        y1: v.y1,
        y0_frac: Math.round((v.y0 / colHeight) * 1e4) / 1e4,
        y1_frac: Math.round((v.y1 / colHeight) * 1e4) / 1e4,
        void_ratio_of_column: v.ratioOfColumn,
        confidence: v.ratioOfColumn >= 0.4 ? 'high' : 'medium',
      })
    }
  }

  return {
    ok: true,
    layout: 'double',
    page_image: options.pageImage ?? null,
    page_index: pageIndexFromName(options.pageImage ?? ''),
    ...pageMetrics,
    split_x: splitX,
    min_gap_px_used: minGapPx,
    columns,
    a5_candidates: candidates,
  }
}

/**
 * 批量分析一个页图目录。
 *
 * @param {string} pagesDir - 页图目录（绝对路径）。
 * @param {object} [options] - `{glob, splitX, params, limit}`。
 * @returns {{ok: boolean, reason?: string, page_count: number, pages: object[], a5_candidate_pages: number[]}}
 */
export function analyzePagesDirectory(pagesDir, options = {}) {
  let names
  try {
    names = fs.readdirSync(pagesDir)
  } catch (error) {
    return { ok: false, reason: 'PAGES_DIR_UNREADABLE: ' + String((error && error.message) || error), page_count: 0, pages: [], a5_candidate_pages: [] }
  }
  const pattern = options.glob ?? /\.(png|jpe?g)$/i
  const matcher = pattern instanceof RegExp ? pattern : new RegExp(String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'), 'i')
  let files = names.filter((n) => matcher.test(n)).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
  if (Number.isFinite(options.limit) && options.limit > 0) files = files.slice(0, options.limit)

  const pages = []
  const candidatePages = new Set()
  for (const name of files) {
    const abs = path.join(pagesDir, name)
    let buffer
    try {
      buffer = fs.readFileSync(abs)
    } catch (error) {
      pages.push({ ok: false, reason: 'READ_FAILED: ' + String((error && error.message) || error), page_image: name, a5_candidates: [] })
      continue
    }
    const result = analyzePageImage(buffer, { pageImage: name, splitX: options.splitX ?? null, layout: options.layout ?? 'double' }, options.params ?? {})
    pages.push(result)
    if (result.ok && result.a5_candidates.length > 0 && Number.isFinite(result.page_index)) {
      candidatePages.add(result.page_index)
    }
  }
  return {
    ok: true,
    page_count: pages.length,
    pages,
    a5_candidate_pages: [...candidatePages].sort((a, b) => a - b),
  }
}
