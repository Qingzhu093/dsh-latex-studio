/**
 * Upload gate for PDF parsing (`read_pdf`).
 *
 * `read_pdf` has two very different cost profiles:
 *  - `view: 'page'` renders one page locally and never uploads document bytes;
 *  - `view: 'content'` (structured / OCR parsing) may upload the document to the
 *    configured provider (INTERFACES.md §0: MinerU 结构化解析走 `official-v4`，会上传).
 *
 * This module is the single decision point for the second profile. It is pure
 * Node ESM and imports nothing from DSH.
 * @module dsh-latex-studio/core/pdfread
 */
import { normalizeConfig } from '../config.js'

/** Accepted `uploadScope` values (mirrors lib/config.js DEFAULTS). */
export const UPLOAD_SCOPES = Object.freeze(['external-only', 'always', 'never'])

/** `read_pdf` views. Only the local ones are safe without an upload decision. */
export const PDF_VIEWS = Object.freeze(['page', 'content', 'toc', 'table', 'image', 'all', 'artifacts'])

/** Views that render on the local machine and never upload document bytes. */
export const LOCAL_VIEWS = Object.freeze(['page'])

/** Fallback used when a config carries an unknown scope. */
export const DEFAULT_SCOPE = 'external-only'

/**
 * Read the effective upload scope out of a raw or already-normalized config.
 * @param {Record<string, unknown>|undefined} config - entry config.
 * @returns {'external-only'|'always'|'never'} scope.
 */
export function normalizeScope(config) {
  const scope = normalizeConfig(config).uploadScope
  return UPLOAD_SCOPES.includes(scope) ? scope : DEFAULT_SCOPE
}

/**
 * Whether a `read_pdf` view stays on the local machine.
 * @param {unknown} view - requested view.
 * @returns {boolean} true when the view is local-only.
 */
export function isLocalView(view) {
  return typeof view === 'string' && LOCAL_VIEWS.includes(view)
}

/**
 * Decide whether the requested `read_pdf` mode may run.
 *
 * Decision table:
 * - `view=page`                                    -> always allowed (local render);
 * - `uploadScope=never`                            -> denied;
 * - `uploadScope=always`                           -> allowed;
 * - `uploadScope=external-only` + non-user document -> allowed;
 * - `uploadScope=external-only` + user manuscript   -> denied unless `consent`.
 *
 * @param {Record<string, unknown>|undefined} config - entry config.
 * @param {object} [options] - decision inputs.
 * @param {string} [options.view='content'] - requested `read_pdf` view.
 * @param {boolean} [options.isUserWork=true] - whether the PDF is the user's own manuscript.
 * @param {boolean} [options.consent=false] - explicit per-call user consent to upload.
 * @param {string} [options.source] - free-form origin label used in the reason.
 * @returns {{allowed: boolean, reason: string, scope: string, view: string, uploads: boolean, advice?: string}}
 */
export function checkPdfRead(config, options = {}) {
  const scope = normalizeScope(config)
  const view = typeof options.view === 'string' && options.view.length > 0 ? options.view : 'content'
  const isUserWork = options.isUserWork !== false
  const consent = options.consent === true
  const label = typeof options.source === 'string' && options.source.length > 0 ? options.source : '当前 PDF'

  if (isLocalView(view)) {
    return {
      allowed: true,
      reason: 'view=page 为本地页渲染，不上传任何文档字节',
      scope,
      view,
      uploads: false,
    }
  }

  if (scope === 'never') {
    return {
      allowed: false,
      reason: 'uploadScope=never：本会话禁止任何 PDF 解析上传',
      scope,
      view,
      uploads: true,
      advice:
        '改用本地视觉通道（vto_inspect 的 pdftoppm 页图）读取版面；' +
        '确需结构化解析时，请用户显式把 uploadScope 改为 always 或 external-only 并给出同意。',
    }
  }

  if (scope === 'always') {
    return {
      allowed: true,
      reason: 'uploadScope=always：已授权对所有 PDF 使用解析模式',
      scope,
      view,
      uploads: true,
    }
  }

  // external-only
  if (!isUserWork || consent) {
    return {
      allowed: true,
      reason: consent
        ? 'uploadScope=external-only：用户已对本文件显式同意外发解析'
        : 'uploadScope=external-only：' + label + ' 判定为非用户手稿，可外发解析',
      scope,
      view,
      uploads: true,
    }
  }

  return {
    allowed: false,
    reason: 'uploadScope=external-only：' + label + ' 属于用户手稿，默认不外发解析',
    scope,
    view,
    uploads: true,
    advice:
      '默认不外发。若用户明确同意上传本文档，请以 consent=true 重试；' +
      '或仅使用本地页图通道（view=page / pdftoppm）。',
  }
}

/**
 * Render a short human-readable line for a gate decision.
 * @param {{allowed: boolean, reason: string, advice?: string}} gate - a checkPdfRead result.
 * @returns {string} one-line summary.
 */
export function describeGate(gate) {
  if (!gate || typeof gate !== 'object') return 'PDF 解析闸门：无决策'
  const head = (gate.allowed ? '允许' : '拒绝') + '：' + String(gate.reason ?? '')
  return gate.advice ? head + '（建议：' + gate.advice + '）' : head
}
