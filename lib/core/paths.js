/**
 * 统一路径守卫（唯一实现）
 *
 * 本模块是工作区相对路径校验的**唯一实现**。`lib/tools/daily.js` 与
 * `lib/tools/vto.js` 必须从这里导入，不得各自维护一份。
 *
 * 背景：重构前存在两份实现
 * （`daily.workspaceRelativePath()` 与 `vto.safeRel()`），
 * 二者在「是否做容器性比较」「是否用 `path.resolve` 归一化分隔符」「是否拒绝 UNC」
 * 上并不一致；E4（含正斜杠 root 的误判）只修了其中一份。
 * 一个安全边界由两份代码决定，就必然漂移。
 *
 * 纯 Node ESM，零 DSH 依赖。
 * @module dsh-latex-studio/core/paths
 */

import { isAbsolute, relative, resolve, sep } from 'node:path'

/** 路径校验失败。调用方据此返回 INVALID_PATH，而不是抛到工具边界之外。 */
export class PathError extends Error {
  /**
   * @param {string} message - 面向模型的中文说明。
   * @param {string} code - 稳定错误码。
   */
  constructor(message, code = 'INVALID_PATH') {
    super(message)
    this.name = 'PathError'
    this.code = code
  }
}

/**
 * 判断一个用户输入是否是「绝对路径 / 盘符 / UNC」形式（一律拒绝）。
 * 覆盖：`C:\x`、`C:/x`、`C:x`（驱动器相对）、`\\server\share`、`//server/share`、`/x`、`\x`。
 * @param {string} raw - 原始输入。
 * @returns {boolean} true 表示必须拒绝。
 */
export function isAbsoluteLike(raw) {
  const value = String(raw)
  if (value.startsWith('\\\\') || value.startsWith('//')) return true
  if (/^[A-Za-z]:/.test(value)) return true // 含 `C:foo` 这种驱动器相对写法
  return isAbsolute(value)
}

/**
 * 把工作区相对路径解析成绝对路径，并证明它没有逃出工作区。
 *
 * @param {unknown} input - 模型给出的路径参数。
 * @param {string} [root] - 工作区根（默认 process.cwd()）。
 * @param {string} [label] - 参数名，用于错误信息。
 * @returns {{ok: true, abs: string, rel: string} | {ok: false, code: string, message: string}}
 *   永不抛异常——调用方按 `ok` 分支处理，避免路径错误变成工具崩溃。
 */
export function resolveWorkspacePath(input, root = process.cwd(), label = 'path') {
  if (typeof input !== 'string' || input.trim() === '') {
    return { ok: false, code: 'INVALID_PATH', message: label + ' 必须是非空字符串。' }
  }
  const raw = input.trim()
  if (isAbsoluteLike(raw)) {
    return { ok: false, code: 'INVALID_PATH', message: label + ' 只接受工作区相对路径，拒绝绝对路径/盘符/UNC：' + raw }
  }
  const segments = raw.split(/[\\/]+/).filter((part) => part !== '' && part !== '.')
  if (segments.some((part) => part === '..')) {
    return { ok: false, code: 'INVALID_PATH', message: label + ' 不得包含 ..：' + raw }
  }
  // path.resolve 会归一化分隔符，因此含正斜杠的 root（宿主传 cwd 时的常见形态）
  // 必须同样归一化后再做容器性比较（E4 回归点）。
  const abs = resolve(String(root), ...segments)
  const rootAbs = resolve(String(root))
  const containment = relative(rootAbs, abs)
  if (containment !== '' && (containment.startsWith('..') || isAbsolute(containment))) {
    return { ok: false, code: 'INVALID_PATH', message: label + ' 越出工作区：' + raw }
  }
  return { ok: true, abs, rel: segments.join('/') }
}

/**
 * 证明 `candidate`（绝对或相对）落在 `root` 之内。
 *
 * 与 `resolveWorkspacePath` 的分工：后者校验**模型输入**，本函数校验**已经解析出的
 * 绝对路径**（例如 `path.resolve(root, rel)` 之后）。二者都做大小写无关比较，
 * 因为 Windows 路径不区分大小写。
 *
 * @param {string} root - 工作区/工程根。
 * @param {string} candidate - 待判定路径。
 * @returns {{root: string, abs: string, inside: boolean, rel: string}} 归一化结果。
 */
export function resolveInside(root, candidate) {
  const rootAbs = resolve(String(root))
  const abs = resolve(rootAbs, String(candidate))
  const withSep = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep
  const inside = abs === rootAbs || abs.toLowerCase().startsWith(withSep.toLowerCase())
  return { root: rootAbs, abs, inside, rel: relative(rootAbs, abs) }
}

/**
 * 同 {@link resolveWorkspacePath}，但失败时抛 {@link PathError}。
 * 供「已经确认要抛异常由工具边界兜住」的调用点使用。
 * @param {unknown} input - 路径参数。
 * @param {string} [label] - 参数名。
 * @returns {string} 归一化后的相对路径（用调用方平台分隔符）。
 * @throws {PathError} 校验失败。
 */
export function requireWorkspacePath(input, label = 'path') {
  const result = resolveWorkspacePath(input, process.cwd(), label)
  if (!result.ok) throw new PathError(result.message, result.code)
  return result.rel.split('/').join(sep)
}
