#!/usr/bin/env node
/**
 * tools/verify-pdf-read.mjs — P0 探针：逐个后端试渲染 PDF 第 1 页，报告哪个后端可用。
 *
 * 用法：
 *   node tools/verify-pdf-read.mjs                      # 自动搜索默认 PDF（见下）
 *   node tools/verify-pdf-read.mjs --pdf latex-demo/.latex-studio/build/main.pdf
 *   node tools/verify-pdf-read.mjs --pdf ../latex-demo/.latex-studio/build/main.pdf
 *   node tools/verify-pdf-read.mjs --workdir <会话工作区> --pdf <相对路径>
 *   node tools/verify-pdf-read.mjs --json               # 机器可读结果
 *
 * 路径解析口径（与 daily/vto 工具的「工作区相对路径」一致）：
 *   1) 绝对路径：直接使用。
 *   2) 相对路径：依次尝试 [--workdir] → $DSH_WORKSPACE / $DSH_SESSION_CWD / $DSH_CWD →
 *      process.cwd() → 工作区根（插件根的上一级）→ 插件根；**取第一个真实存在的**。
 *      因此 cwd=插件根时，--pdf latex-demo/x.pdf 与 --pdf ../latex-demo/x.pdf 都能命中。
 *   3) 未传 --pdf 时，按同一批基准目录搜索：
 *      <base>/latex-demo/.latex-studio/build/main.pdf → <base>/latex-demo/main.pdf → <base>/.latex-studio/build/main.pdf
 *   4) PDF 找不到时**不探测任何后端**，返回 reason:'PDF_NOT_FOUND' + 候选路径 + advice，
 *      结论行是 `NO SAMPLE PDF`（不会误报成 NO-LOCAL-BACKEND）。
 *   三态结论：OK（有可用后端） / NO-LOCAL-BACKEND（样本在但后端全坏） / NO SAMPLE PDF（样本缺失，未探测）。
 *
 * 供 latex_doctor --verify-pdf-read 调用：也可作为模块导入
 *   import { verifyPdfRead } from './verify-pdf-read.mjs'
 *   const r = await verifyPdfRead({ pdfPath, workDir, callReadPdf })   // callReadPdf 由 tools 层注入
 *
 * 设计约束：
 * - 纯 Node ESM，不 import @deepseek-ai/*；callReadPdf 由调用方注入。
 * - 外部件缺失一律 status:'skipped' + reason/advice，绝不抛异常。
 * - 路径可能含空格与中文：一律 spawn(cmd, argsArray, {shell:false})，不拼 shell 字符串。
 * - 后端顺序与 docs/INTERFACES.md §8 / lib/config.js 的 rendererOrder 一致：
 *   poppler → miktex-ghostscript → mineru-page
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const WORKSPACE_ROOT = path.resolve(PLUGIN_ROOT, '..');

export const DEFAULT_RENDERER_ORDER = ['poppler', 'miktex-ghostscript', 'mineru-page'];

/** 已知的本地可执行文件落点（P0 已确认：DSH 进程 PATH 不含 MiKTeX bin）。 */
export function knownBinDirs() {
  const env = process.env;
  const dirs = [
    // 可选：仓库内自带的 poppler（tools/poppler/<release>/Library/bin）
    path.join(PLUGIN_ROOT, 'tools', 'poppler'),
    // MiKTeX 自带 poppler（pdftoppm/pdfinfo 24.04.0）与 Ghostscript（mgs.exe 9.25）
    'D:\\MiKTeX\\miktex\\bin\\x64',
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64') : '',
    env.ProgramFiles ? path.join(env.ProgramFiles, 'MiKTeX', 'miktex', 'bin', 'x64') : '',
    // scoop / 其它
    env.USERPROFILE ? path.join(env.USERPROFILE, 'scoop', 'shims') : '',
    'D:\\scoop_all\\scoop\\shims',
  ];
  return dirs.filter(Boolean);
}

export function pathDirs() {
  return String(process.env.PATH || '')
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 相对路径的候选基准目录（去重、保序）。
 * @param {string} [workDir] 显式基准（--workdir 或 opts.workDir），优先级最高
 * @returns {string[]}
 */
export function candidateBaseDirs(workDir) {
  const env = process.env;
  const list = [];
  const push = (p) => {
    if (!p) return;
    const abs = path.resolve(p);
    if (!list.includes(abs)) list.push(abs);
  };
  push(workDir);
  push(env.DSH_WORKSPACE);
  push(env.DSH_SESSION_CWD);
  push(env.DSH_CWD);
  push(process.cwd());
  push(WORKSPACE_ROOT);
  push(PLUGIN_ROOT);
  return list;
}

/** 未传 --pdf 时的默认搜索路径（按候选基准目录展开）。 */
export function defaultPdfCandidates(bases = candidateBaseDirs()) {
  const out = [];
  for (const b of bases) {
    out.push(path.join(b, 'latex-demo', '.latex-studio', 'build', 'main.pdf'));
    out.push(path.join(b, 'latex-demo', 'main.pdf'));
    out.push(path.join(b, '.latex-studio', 'build', 'main.pdf'));
  }
  return out;
}

/** 在 dir 内递归找名为 names 之一的可执行文件（限深，避免扫全盘）。 */
async function findInDir(dir, names, depth = 4) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    if (e.isFile() && names.includes(e.name.toLowerCase())) return path.join(dir, e.name);
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const lower = e.name.toLowerCase();
    if (lower === 'node_modules' || lower === '.git') continue;
    const hit = await findInDir(path.join(dir, e.name), names, depth - 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * 解析外部可执行文件：PATH → 已知落点。
 * @returns {Promise<string|null>}
 */
export async function resolveExecutable(...names) {
  const wanted = names.map((n) => n.toLowerCase());
  for (const d of pathDirs()) {
    const hit = await findInDir(d, wanted, 0);
    if (hit) return hit;
  }
  for (const d of knownBinDirs()) {
    const hit = await findInDir(d, wanted, 4);
    if (hit) return hit;
  }
  return null;
}

async function statOf(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

/** 找到一个真实存在的普通文件（返回第一个命中的路径，否则 null）。 */
async function pickExisting(candidates) {
  for (const p of candidates) {
    const st = await statOf(p);
    if (st && st.isFile()) return p;
  }
  return null;
}

/**
 * 解析目标 PDF。
 * @returns {Promise<{pdfPath:string|null, baseDir:string, attempted:string[], viaDefault:boolean}>}
 */
export async function resolvePdfPath(pdfPath, workDir) {
  const bases = candidateBaseDirs(workDir);
  const baseDir = bases[0];

  if (pdfPath) {
    if (path.isAbsolute(pdfPath)) {
      const abs = path.resolve(pdfPath);
      return { pdfPath: abs, baseDir, matchedBase: null, attempted: [abs], viaDefault: false };
    }
    const attempted = bases.map((b) => path.resolve(b, pdfPath));
    const hit = await pickExisting(attempted);
    const idx = hit ? attempted.indexOf(hit) : -1;
    return { pdfPath: hit || attempted[0], baseDir, matchedBase: idx >= 0 ? bases[idx] : null, attempted, viaDefault: false };
  }

  const attempted = defaultPdfCandidates(bases);
  const hit = await pickExisting(attempted);
  const matchedBase = hit ? (bases.find((b) => hit.startsWith(b + path.sep)) || null) : null;
  return { pdfPath: hit || attempted[0], baseDir, matchedBase, attempted, viaDefault: true };
}

/** 运行子进程，永不抛异常；全部走参数数组。 */
function run(cmd, args, { timeoutMs = 120000, cwd } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { shell: false, windowsHide: true, cwd });
    } catch (err) {
      resolve({ code: -1, stdout: '', stderr: '', error: String(err && err.message ? err.message : err) });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* ignore */ }
      resolve({ code: -1, stdout, stderr, error: 'timeout after ' + timeoutMs + 'ms' });
    }, timeoutMs);
    child.stdout?.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr?.on('data', (b) => { stderr += b.toString('utf8'); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr, error: String(err && err.message ? err.message : err) });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code === null ? -1 : code, stdout, stderr, error: null });
    });
  });
}

/** 从 PNG 头部读宽高（IHDR）。 */
async function pngSize(file) {
  try {
    const fh = await fs.open(file, 'r');
    try {
      const buf = Buffer.alloc(33);
      await fh.read(buf, 0, 33, 0);
      if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
      }
    } finally {
      await fh.close();
    }
  } catch { /* ignore */ }
  return {};
}

async function fileInfo(file) {
  try {
    const st = await fs.stat(file);
    if (!st.isFile() || st.size === 0) return null;
    return { path: file, bytes: st.size, ...(await pngSize(file)) };
  } catch {
    return null;
  }
}

function tail(s, n = 400) {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(-n) : t;
}

/**
 * 逐个后端试渲染第 1 页。
 * @param {object} opts
 * @param {string} [opts.pdfPath]  PDF 路径（绝对，或相对候选基准目录）
 * @param {string} [opts.workDir]  相对路径的解析基准（会话工作区）
 * @param {string} [opts.outDir]   输出目录（默认系统临时目录）
 * @param {number} [opts.dpi]      默认 120
 * @param {number} [opts.timeoutMs]
 * @param {(arg: object) => Promise<any>} [opts.callReadPdf] 由 tools 层注入的 read_pdf 调用
 * @param {string[]} [opts.rendererOrder]
 * @returns {Promise<object>} VerifyPdfReadReport
 */
export async function verifyPdfRead(opts = {}) {
  const dpi = Number(opts.dpi) || 120;
  const timeoutMs = Number(opts.timeoutMs) || 120000;
  const rendererOrder = Array.isArray(opts.rendererOrder) && opts.rendererOrder.length
    ? opts.rendererOrder
    : DEFAULT_RENDERER_ORDER;
  const outDir = path.resolve(opts.outDir || path.join(os.tmpdir(), 'dsh-latex-verify-pdf-read'));

  const resolvedPdf = await resolvePdfPath(opts.pdfPath, opts.workDir);
  const report = {
    ok: false,
    reason: null,
    pdfPath: resolvedPdf.pdfPath,
    baseDir: resolvedPdf.baseDir,
    resolvedBase: resolvedPdf.matchedBase,
    viaDefault: resolvedPdf.viaDefault,
    probed: false,
    dpi,
    outDir,
    backendOrder: [...rendererOrder],
    backends: [],
    recommended: null,
    advice: [],
  };

  const st = resolvedPdf.pdfPath ? await statOf(resolvedPdf.pdfPath) : null;
  if (!st || !st.isFile()) {
    // PDF 本身不存在：不探测任何后端，也不得报成 NO-LOCAL-BACKEND。
    report.reason = 'PDF_NOT_FOUND';
    report.attempted = resolvedPdf.attempted;
    report.advice.push({
      level: 'error',
      code: 'PDF_NOT_FOUND',
      message: '找不到 PDF，未探测任何后端：' + resolvedPdf.pdfPath,
      command: '先用 latex_build 生成 PDF，或传 --pdf <路径>（相对路径基准目录：' + resolvedPdf.baseDir + '）',
    });
    return report;
  }
  if (st.size === 0) {
    report.reason = 'PDF_EMPTY';
    report.advice.push({
      level: 'error',
      code: 'PDF_EMPTY',
      message: 'PDF 是空文件，未探测任何后端：' + resolvedPdf.pdfPath,
      command: '重新 latex_build',
    });
    return report;
  }

  const pdfPath = resolvedPdf.pdfPath;
  await fs.mkdir(outDir, { recursive: true });
  report.probed = true;

  for (const backend of rendererOrder) {
    const entry = { backend, status: 'skipped', reason: null, advice: null };

    if (backend === 'poppler') {
      const bin = (await resolveExecutable('pdftoppm.exe', 'pdftoppm')) || null;
      if (!bin) {
        entry.reason = '未找到 pdftoppm（PATH / MiKTeX bin / tools/poppler 均无）';
        entry.advice = '安装 MiKTeX（自带 poppler）或把 poppler 解压到 dsh-latex-studio/tools/poppler/';
      } else {
        const prefix = path.join(outDir, 'poppler-p1');
        const out = prefix + '.png';
        await fs.rm(out, { force: true }).catch(() => {});
        const r = await run(bin, ['-f', '1', '-l', '1', '-r', String(dpi), '-png', '-singlefile', '--', pdfPath, prefix], { timeoutMs });
        const info = await fileInfo(out);
        if (r.code === 0 && info) {
          entry.status = 'ok';
          entry.bin = bin;
          entry.pages = [{ index: 1, ...info }];
          entry.raw = { code: r.code, stderr: tail(r.stderr) };
        } else {
          entry.status = 'failed';
          entry.bin = bin;
          entry.reason = r.error || ('pdftoppm exit=' + r.code + ' ' + tail(r.stderr));
          entry.raw = { code: r.code, stdout: tail(r.stdout), stderr: tail(r.stderr) };
        }
      }
    } else if (backend === 'miktex-ghostscript') {
      const bin = (await resolveExecutable('mgs.exe', 'gswin64c.exe', 'gswin64c', 'gs')) || null;
      if (!bin) {
        entry.reason = '未找到 Ghostscript（mgs.exe / gswin64c）';
        entry.advice = '安装 MiKTeX（自带 mgs.exe）或 Ghostscript';
      } else {
        const out = path.join(outDir, 'miktex-ghostscript-p1.png');
        await fs.rm(out, { force: true }).catch(() => {});
        const r = await run(bin, ['-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=png16m', '-r' + dpi, '-dFirstPage=1', '-dLastPage=1', '-sOutputFile=' + out, pdfPath], { timeoutMs });
        const info = await fileInfo(out);
        if (r.code === 0 && info) {
          entry.status = 'ok';
          entry.bin = bin;
          entry.pages = [{ index: 1, ...info }];
          entry.raw = { code: r.code, stderr: tail(r.stderr) };
        } else {
          entry.status = 'failed';
          entry.bin = bin;
          entry.reason = r.error || ('mgs exit=' + r.code + ' ' + tail(r.stderr));
          entry.raw = { code: r.code, stdout: tail(r.stdout), stderr: tail(r.stderr) };
        }
      }
    } else if (backend === 'mineru-page') {
      if (typeof opts.callReadPdf !== 'function') {
        entry.reason = '需要 DSH 工具层注入 callReadPdf（read_pdf view:\'page\'），CLI 独立运行时不可用';
      } else {
        try {
          const res = await opts.callReadPdf({ file_path: pdfPath, view: 'page', pages: 1 });
          const images = Array.isArray(res && res.inlined_images) ? res.inlined_images.length : 0;
          if (res && res.state === 'completed' && images > 0) {
            entry.status = 'ok';
            entry.pages = [{ index: 1, images }];
          } else {
            entry.status = 'failed';
            entry.reason = 'read_pdf 未返回页图（state=' + (res && res.state) + ', images=' + images + '）';
          }
        } catch (err) {
          entry.status = 'failed';
          entry.reason = 'read_pdf 抛错：' + String(err && err.message ? err.message : err);
        }
      }
    } else {
      entry.reason = '未知后端：' + backend;
    }

    report.backends.push(entry);
    if (entry.status === 'ok' && !report.recommended) report.recommended = backend;
  }

  report.ok = report.recommended !== null;
  if (!report.ok) {
    report.reason = 'NO_LOCAL_BACKEND';
    report.advice.push({
      level: 'warn',
      message: '所有本地页图后端均不可用：降级为「只给 checklist」，不做视觉核验。',
    });
  } else {
    report.reason = null;
    report.advice.push({ level: 'info', message: '推荐页图后端：' + report.recommended });
  }
  return report;
}

export function formatReport(report) {
  const lines = [];
  lines.push('PDF: ' + report.pdfPath);
  lines.push('基准目录: ' + report.baseDir + (report.viaDefault ? '（未传 --pdf，按默认候选搜索）' : ''));
  if (report.resolvedBase) lines.push('命中基准: ' + report.resolvedBase);
  lines.push('后端顺序: ' + (report.backendOrder || []).join(' -> '));

  if (!report.probed) {
    lines.push('尝试过的路径:');
    for (const p of report.attempted || []) lines.push('  - ' + p);
    for (const a of report.advice || []) {
      if (a.command) lines.push('建议命令: ' + a.command);
    }
    lines.push('CONCLUSION: NO SAMPLE PDF（reason=' + (report.reason || 'NOT_PROBED') + '）— 未做任何后端探测；请先生成 PDF 或修正 --pdf/--workdir');
    return lines.join('\n');
  }

  for (const b of report.backends || []) {
    const tag = { ok: 'OK', failed: 'FAIL', skipped: 'SKIP' }[b.status] || b.status;
    let detail = '';
    if (b.status === 'ok') {
      const p = (b.pages && b.pages[0]) || {};
      detail = (b.bin ? b.bin + ' ' : '') + '(' + p.width + 'x' + p.height + ', ' + p.bytes + ' bytes)';
    } else {
      detail = b.reason || '';
    }
    lines.push('  [' + tag + '] ' + b.backend + ' :: ' + detail);
  }
  lines.push(report.ok ? 'CONCLUSION: OK — 推荐后端 = ' + report.recommended : 'CONCLUSION: NO-LOCAL-BACKEND — 视觉通道不可用');
  return lines.join('\n');
}

function parseArgs(argv) {
  const out = { json: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pdf' || a === '-p') out.pdf = argv[++i];
    else if (a === '--workdir' || a === '-w') out.workDir = argv[++i];
    else if (a === '--out' || a === '-o') out.outDir = argv[++i];
    else if (a === '--dpi') out.dpi = Number(argv[++i]);
    else if (a === '--json') out.json = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('--')) out.pdf = a;
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('node tools/verify-pdf-read.mjs [--pdf <path>] [--workdir <base>] [--out <dir>] [--dpi N] [--json] [--strict]');
    console.log('相对 --pdf 的基准目录顺序: --workdir -> $DSH_WORKSPACE/$DSH_SESSION_CWD/$DSH_CWD -> cwd -> 工作区根 -> 插件根（取第一个存在的）');
    process.exit(0);
  }
  const report = await verifyPdfRead({ pdfPath: args.pdf, workDir: args.workDir, outDir: args.outDir, dpi: args.dpi });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(formatReport(report));
  process.exit(args.strict && !report.ok ? 1 : 0);
}

export default verifyPdfRead;
