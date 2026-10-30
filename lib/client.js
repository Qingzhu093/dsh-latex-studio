/**
 * dsh-latex-studio browser half: the configuration page for this bundle.
 *
 * WHY THIS FILE IS HAND-WRITTEN PLAIN JAVASCRIPT
 * The web client serves a plugin's `exports["./client"]` bundle as ONE script in
 * the client module system's lazy-CJS factory format ("客户端模块"): it registers
 * the package id and a `factory(require)` whose `require` can only resolve the
 * modules the module graph already serves. There is no bundler, no JSX runtime
 * and no import of this package's other files — so the page is authored here as
 * a single self-contained factory body that requires nothing but React.
 *
 * WHY configForms AND NOT A SAVE BUTTON
 * Plugin config fields are declared `.volatile()` (lib/index.js). The settings
 * service exposes volatile fields as one form per profile entry id, and the
 * Plugins page passes the same controller to any plugin page. Writing through
 * `form.set`/`form.unset` therefore goes through the product's own path:
 * the Host validates the FULL config, writes the profile patch, and swaps the
 * live values in place — no restart, no reload, no custom RPC, no new runtime
 * dependency. `unset` restores the schema default, which is what every "重置"
 * control in this page uses.
 *
 * The page is registered twice, on purpose:
 *   * `plugins.bundle.config` keyed by the package name — the bundle's own page,
 *     which is what a user sees after clicking the plugin card;
 *   * `plugins.row.config` keyed by "<package>#<row id>" — the component page, so
 *     clicking the `latex-studio` row shows the same form instead of a dead end.
 * @module dsh-latex-studio/client
 */
window.__ModuleLoader__.load({
	id: "dsh-latex-studio",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		/** Dictionary namespace owned by this plugin. */
		const NS = "latex-studio";
		/** The package name: half of the row-config key and the bundle-config key. */
		const PACKAGE_NAME = "dsh-latex-studio";
		/** The loader row id declared by cordis.patch.yml — the settings namespace. */
		const ROW_ID = "latex-studio";

		// #region preview-dict
		const ZH = {
			"meta.title": "LaTeX Studio",
			"meta.description": "MiKTeX 原生编译、参考文献审计与 VTO 版面闭环",
			"page.title": "LaTeX Studio 配置",
			"page.intro": "所有字段即时生效并写入当前 profile。恢复默认会移除本页写入的覆盖值，回到插件声明的默认值。",
			"action.expandAll": "展开全部",
			"action.collapseAll": "收起全部",
			"action.resetAll": "恢复全部默认",
			"action.resetCard": "本组恢复默认",
			"action.resetField": "恢复该字段默认值",
			"state.synced": "已同步",
			"state.saving": "保存中",
			"state.loading": "读取中",
			"state.readonly": "只读",
			"state.unavailable": "配置表单不可用",
			"state.unavailable.hint": "当前部署没有提供可编辑的配置表单。以下显示的是插件默认值；要在 GUI 中编辑，请确认 profile 已启用设置与配置编辑器，然后重启 DeepSeek Harness。",
			"state.modified": "已修改",
			"badge.restart": "重载后生效",
			"badge.on": "已启用",
			"badge.off": "已关闭",
			"section.compile": "编译链",
			"section.compile.desc": "用哪个引擎编译、允许 MiKTeX 自动补包、以及单次编译的超时",
			"section.render": "页图渲染",
			"section.render.desc": "VTO 视觉检查把 PDF 转成页图的后端顺序，以及二进制路径",
			"section.read": "PDF 读取与隐私",
			"section.read.desc": "read_pdf 结构化解析的调用名与上传边界（决定了哪些 PDF 会被上传）",
			"section.vto": "VTO 版面循环",
			"section.vto.desc": "工作目录、页数门禁与每轮内联的页图数量",
			"section.systems": "命令系统",
			"section.systems.desc": "日常编译线（4 个工具）与 VTO 线（6 个工具）的总开关",
			"section.checks": "可选检查",
			"section.checks.desc": "额外的静态检查；默认关闭，未安装时不报错",
			"field.latexCommand": "编译驱动",
			"field.latexCommand.hint": "留空=自动：检测到 Perl 就用 latexmk 驱动，否则用内置多趟驱动。显式选择会绕过自动判定。",
			"field.engineArgs": "额外引擎参数",
			"field.engineArgs.hint": "追加到引擎命令行的原样参数，例如 -shell-escape。",
			"field.engineArgs.placeholder": "留空表示不加参数",
			"field.enableInstaller": "允许 MiKTeX 自动安装缺失宏包",
			"field.enableInstaller.hint": "关闭后缺失宏包会直接编译失败，适合需要完全离线/可复现的构建。",
			"field.compileTimeoutMs": "单次编译超时",
			"field.compileTimeoutMs.hint": "毫秒。首次编译需要装包时请留足余量。",
			"field.rendererOrder": "页图渲染后端",
			"field.rendererOrder.hint": "按列表顺序尝试，第一个成功的后端生效。取消勾选可跳过某个后端。",
			"field.popplerPath": "Poppler 路径",
			"field.popplerPath.hint": "留空=用内置/自动探测的 pdftoppm。",
			"field.popplerPath.placeholder": "留空表示自动探测",
			"field.ghostscriptPath": "Ghostscript 路径",
			"field.ghostscriptPath.hint": "留空=用内置/自动探测的 gswin64c。",
			"field.ghostscriptPath.placeholder": "留空表示自动探测",
			"field.renderTimeoutMs": "单页渲染超时",
			"field.renderTimeoutMs.hint": "毫秒。",
			"field.uploadScope": "PDF 上传范围",
			"field.uploadScope.hint": "external-only 只上传工作区之外的文档；never 从不上传；always 总是尝试上传。",
			"field.readPdfToolName": "PDF 读取工具名",
			"field.readPdfToolName.hint": "宿主注册的结构化解析工具名，默认 read_pdf。",
			"field.workDir": "工作目录名",
			"field.workDir.hint": "相对项目根目录的工作目录，存放页图、报告与台账。",
			"field.pageBudget": "目标页数",
			"field.pageBudget.hint": "留空表示不设页数门禁；设置后 VTO 复核会按该预算判定。",
			"field.pageBudget.placeholder": "留空表示不限",
			"field.attachImagesPerRound": "每轮内联页图数",
			"field.attachImagesPerRound.hint": "0 表示不在回复内联页图，只用文字缺陷清单。",
			"field.enableDaily": "启用日常编译线",
			"field.enableDaily.hint": "latex_doctor / latex_build / latex_lint / bib_tool。",
			"field.enableVto": "启用 VTO 版面线",
			"field.enableVto.hint": "vto_start / vto_inspect / vto_fix / vto_verify / vto_report / vto_rollback。",
			"field.enableChktex": "启用 chktex",
			"field.enableChktex.hint": "在 latex_lint 中附加外部静态检查提示。",
			"field.chktexPath": "chktex 路径",
			"field.chktexPath.hint": "留空=按 PATH 查找。",
			"field.chktexPath.placeholder": "留空表示按 PATH 查找",
			"opt.auto": "自动（有 Perl 优先 latexmk）",
			"opt.latexmk": "latexmk（需要 Perl）",
			"opt.pdflatex": "pdflatex（内置多趟驱动）",
			"opt.xelatex": "xelatex（内置多趟驱动）",
			"opt.lualatex": "lualatex（内置多趟驱动）",
			"opt.poppler": "Poppler（pdftoppm）",
			"opt.miktex-ghostscript": "MiKTeX Ghostscript",
			"opt.mineru-page": "MinerU 页渲染",
			"opt.uploadScope.external-only": "仅外部文档",
			"opt.uploadScope.always": "总是上传",
			"opt.uploadScope.never": "从不上传",
			"value.default": "默认",
			"value.unset": "未设置",
			"summary.compile.auto": "自动驱动（有 Perl 用 latexmk）",
			"summary.render": "渲染顺序：",
			"summary.vto": "工作目录 {workDir}",
			"summary.systems": "日常 {daily} · VTO {vto}",
			"summary.checks.off": "全部关闭",
			"summary.read": "上传范围：",
			"unit.ms": "ms",
			"unit.images": "张/轮"
		};
		const EN = {
			"meta.title": "LaTeX Studio",
			"meta.description": "MiKTeX-native compilation, bibliography audit and the VTO typesetting loop",
			"page.title": "LaTeX Studio configuration",
			"page.intro": "Every field applies immediately and is written to the current profile. Restoring a default removes the override this page wrote.",
			"action.expandAll": "Expand all",
			"action.collapseAll": "Collapse all",
			"action.resetAll": "Restore all defaults",
			"action.resetCard": "Restore this group",
			"action.resetField": "Restore this field",
			"state.synced": "Saved",
			"state.saving": "Saving",
			"state.loading": "Loading",
			"state.readonly": "Read-only",
			"state.unavailable": "Configuration form unavailable",
			"state.unavailable.hint": "This deployment does not expose an editable configuration form. The values below are the plugin defaults; restart DeepSeek Harness once settings and the config editor are enabled to edit them here.",
			"state.modified": "Modified",
			"badge.restart": "Applies after reload",
			"badge.on": "On",
			"badge.off": "Off",
			"section.compile": "Compilation chain",
			"section.compile.desc": "Which driver compiles, whether MiKTeX may install missing packages, and the per-build timeout",
			"section.render": "Page rendering",
			"section.render.desc": "Backend order used to turn the PDF into page images, plus binary paths",
			"section.read": "PDF reading and privacy",
			"section.read.desc": "Tool name for structured parsing and the upload boundary that decides which PDFs leave the machine",
			"section.vto": "VTO typesetting loop",
			"section.vto.desc": "Work directory, page budget and how many page images are inlined per round",
			"section.systems": "Command systems",
			"section.systems.desc": "Master switches for the daily line (4 tools) and the VTO line (6 tools)",
			"section.checks": "Optional checks",
			"section.checks.desc": "Extra static checks; off by default, absent tools are not an error",
			"field.latexCommand": "Compile driver",
			"field.latexCommand.hint": "Empty = auto: use latexmk when Perl is available, otherwise the built-in multi-pass driver. An explicit choice bypasses detection.",
			"field.engineArgs": "Extra engine arguments",
			"field.engineArgs.hint": "Verbatim arguments appended to the engine command line, e.g. -shell-escape.",
			"field.engineArgs.placeholder": "Empty means no extra arguments",
			"field.enableInstaller": "Let MiKTeX install missing packages",
			"field.enableInstaller.hint": "When off, a missing package fails the build instead of being installed.",
			"field.compileTimeoutMs": "Per-build timeout",
			"field.compileTimeoutMs.hint": "Milliseconds. Leave room for the first build, which installs packages.",
			"field.rendererOrder": "Page render backends",
			"field.rendererOrder.hint": "Tried in order; the first backend that succeeds wins. Uncheck to skip one.",
			"field.popplerPath": "Poppler path",
			"field.popplerPath.hint": "Empty = the bundled or auto-detected pdftoppm.",
			"field.popplerPath.placeholder": "Empty means auto-detect",
			"field.ghostscriptPath": "Ghostscript path",
			"field.ghostscriptPath.hint": "Empty = the bundled or auto-detected gswin64c.",
			"field.ghostscriptPath.placeholder": "Empty means auto-detect",
			"field.renderTimeoutMs": "Per-page render timeout",
			"field.renderTimeoutMs.hint": "Milliseconds.",
			"field.uploadScope": "PDF upload scope",
			"field.uploadScope.hint": "external-only uploads only documents outside the workspace; never never uploads; always always tries.",
			"field.readPdfToolName": "PDF reading tool name",
			"field.readPdfToolName.hint": "Name of the host tool used for structured parsing, read_pdf by default.",
			"field.workDir": "Work directory",
			"field.workDir.hint": "Project-relative directory holding page images, reports and the defect ledger.",
			"field.pageBudget": "Page budget",
			"field.pageBudget.hint": "Empty disables the page-count gate; when set, the VTO verification judges against it.",
			"field.pageBudget.placeholder": "Empty means unlimited",
			"field.attachImagesPerRound": "Page images per round",
			"field.attachImagesPerRound.hint": "0 keeps page images out of the reply and leaves the textual defect list only.",
			"field.enableDaily": "Enable the daily line",
			"field.enableDaily.hint": "latex_doctor / latex_build / latex_lint / bib_tool.",
			"field.enableVto": "Enable the VTO line",
			"field.enableVto.hint": "vto_start / vto_inspect / vto_fix / vto_verify / vto_report / vto_rollback.",
			"field.enableChktex": "Enable chktex",
			"field.enableChktex.hint": "Adds external static-check hints to latex_lint.",
			"field.chktexPath": "chktex path",
			"field.chktexPath.hint": "Empty = look up PATH.",
			"field.chktexPath.placeholder": "Empty means look up PATH",
			"opt.auto": "Auto (latexmk when Perl is present)",
			"opt.latexmk": "latexmk (requires Perl)",
			"opt.pdflatex": "pdflatex (built-in driver)",
			"opt.xelatex": "xelatex (built-in driver)",
			"opt.lualatex": "lualatex (built-in driver)",
			"opt.poppler": "Poppler (pdftoppm)",
			"opt.miktex-ghostscript": "MiKTeX Ghostscript",
			"opt.mineru-page": "MinerU page render",
			"opt.uploadScope.external-only": "External documents only",
			"opt.uploadScope.always": "Always upload",
			"opt.uploadScope.never": "Never upload",
			"value.default": "Default",
			"value.unset": "Not set",
			"summary.compile.auto": "Automatic driver (latexmk when Perl is present)",
			"summary.render": "Render order: ",
			"summary.vto": "Work dir {workDir}",
			"summary.systems": "Daily {daily} · VTO {vto}",
			"summary.checks.off": "All off",
			"summary.read": "Upload scope: ",
			"unit.ms": "ms",
			"unit.images": " per round"
		};
		// #endregion preview-dict

		// #region preview-model
		const MODEL = [
			{
				id: "compile",
				titleKey: "section.compile",
				descKey: "section.compile.desc",
				fields: [
					{ key: "latexCommand", kind: "select", labelKey: "field.latexCommand", hintKey: "field.latexCommand.hint",
						options: [
							{ value: "", labelKey: "opt.auto" },
							{ value: "latexmk", labelKey: "opt.latexmk" },
							{ value: "pdflatex", labelKey: "opt.pdflatex" },
							{ value: "xelatex", labelKey: "opt.xelatex" },
							{ value: "lualatex", labelKey: "opt.lualatex" }
						] },
					{ key: "engineArgs", kind: "text", labelKey: "field.engineArgs", hintKey: "field.engineArgs.hint", placeholderKey: "field.engineArgs.placeholder", wide: true },
					{ key: "enableInstaller", kind: "switch", labelKey: "field.enableInstaller", hintKey: "field.enableInstaller.hint" },
					{ key: "compileTimeoutMs", kind: "number", labelKey: "field.compileTimeoutMs", hintKey: "field.compileTimeoutMs.hint", min: 1000, step: 1000, unitKey: "unit.ms" }
				]
			},
			{
				id: "render",
				titleKey: "section.render",
				descKey: "section.render.desc",
				fields: [
					{ key: "rendererOrder", kind: "checks", labelKey: "field.rendererOrder", hintKey: "field.rendererOrder.hint",
						options: [
							{ value: "poppler", labelKey: "opt.poppler" },
							{ value: "miktex-ghostscript", labelKey: "opt.miktex-ghostscript" },
							{ value: "mineru-page", labelKey: "opt.mineru-page" }
						] },
					{ key: "popplerPath", kind: "text", labelKey: "field.popplerPath", hintKey: "field.popplerPath.hint", placeholderKey: "field.popplerPath.placeholder", wide: true },
					{ key: "ghostscriptPath", kind: "text", labelKey: "field.ghostscriptPath", hintKey: "field.ghostscriptPath.hint", placeholderKey: "field.ghostscriptPath.placeholder", wide: true },
					{ key: "renderTimeoutMs", kind: "number", labelKey: "field.renderTimeoutMs", hintKey: "field.renderTimeoutMs.hint", min: 1000, step: 1000, unitKey: "unit.ms" }
				]
			},
			{
				id: "read",
				titleKey: "section.read",
				descKey: "section.read.desc",
				fields: [
					{ key: "uploadScope", kind: "segmented", labelKey: "field.uploadScope", hintKey: "field.uploadScope.hint",
						options: [
							{ value: "external-only", labelKey: "opt.uploadScope.external-only" },
							{ value: "always", labelKey: "opt.uploadScope.always" },
							{ value: "never", labelKey: "opt.uploadScope.never" }
						] },
					{ key: "readPdfToolName", kind: "text", labelKey: "field.readPdfToolName", hintKey: "field.readPdfToolName.hint" }
				]
			},
			{
				id: "vto",
				titleKey: "section.vto",
				descKey: "section.vto.desc",
				fields: [
					{ key: "workDir", kind: "text", labelKey: "field.workDir", hintKey: "field.workDir.hint" },
					{ key: "pageBudget", kind: "number", labelKey: "field.pageBudget", hintKey: "field.pageBudget.hint", placeholderKey: "field.pageBudget.placeholder", min: 1, step: 1, nullable: true },
					{ key: "attachImagesPerRound", kind: "number", labelKey: "field.attachImagesPerRound", hintKey: "field.attachImagesPerRound.hint", min: 0, max: 6, step: 1, unitKey: "unit.images" }
				]
			},
			{
				id: "systems",
				titleKey: "section.systems",
				descKey: "section.systems.desc",
				fields: [
					{ key: "enableDaily", kind: "switch", labelKey: "field.enableDaily", hintKey: "field.enableDaily.hint", restart: true },
					{ key: "enableVto", kind: "switch", labelKey: "field.enableVto", hintKey: "field.enableVto.hint", restart: true }
				]
			},
			{
				id: "checks",
				titleKey: "section.checks",
				descKey: "section.checks.desc",
				fields: [
					{ key: "enableChktex", kind: "switch", labelKey: "field.enableChktex", hintKey: "field.enableChktex.hint" },
					{ key: "chktexPath", kind: "text", labelKey: "field.chktexPath", hintKey: "field.chktexPath.hint", placeholderKey: "field.chktexPath.placeholder", wide: true }
				]
			}
		];
		// #endregion preview-model

		// #region preview-css
		const CSS = [
			".dshl-root{box-sizing:border-box;display:flex;flex-direction:column;gap:16px;width:100%;min-width:0;max-width:840px;padding-bottom:32px;color:var(--dsw-alias-label-primary,inherit)}",
			".dshl-head{display:flex;flex-direction:column;gap:4px}",
			".dshl-title{font-size:18px;font-weight:600;line-height:26px;letter-spacing:-.01em;margin:0}",
			".dshl-intro{font-size:13px;line-height:18px;color:var(--dsw-alias-label-tertiary,#7b818b);margin:0}",
			".dshl-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding-top:2px}",
			".dshl-spacer{flex:1 1 auto}",
			".dshl-status{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary,#374151);border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:999px;padding:4px 10px;background:var(--dsw-alias-bg-layer-3,#fff)}",
			".dshl-dot{width:6px;height:6px;border-radius:999px;background:var(--dsw-alias-state-success-primary,#16a34a)}",
			".dshl-status[data-state='saving'] .dshl-dot{background:var(--dsw-alias-state-warn-primary,#d97706)}",
			".dshl-status[data-state='loading'] .dshl-dot{background:var(--dsw-alias-label-dimmed,#9ca3af)}",
			".dshl-status[data-state='readonly'] .dshl-dot,.dshl-status[data-state='unavailable'] .dshl-dot{background:var(--dsw-alias-state-error-primary,#dc2626)}",
			".dshl-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-secondary,#374151);font:inherit;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap}",
			".dshl-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#edf0f3)}",
			".dshl-btn:disabled{opacity:.45;cursor:default}",
			".dshl-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:2px}",
			".dshl-note{font-size:12px;line-height:17px;color:var(--dsw-alias-state-warn-primary,#b45309);background:var(--dsw-alias-state-warn-tertiary,#fef3c7);border-radius:8px;padding:8px 10px;margin:0}",
			".dshl-card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff);overflow:hidden}",
			".dshl-cardHead{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;cursor:pointer;background:none;border:0;width:100%;text-align:left;font:inherit;color:inherit}",
			".dshl-cardHead:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:-2px}",
			".dshl-cardBody{display:flex;flex-direction:column;gap:14px;padding:0 16px 16px}",
			".dshl-cardTitles{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto}",
			".dshl-cardTitle{font-size:14px;font-weight:600;line-height:20px}",
			".dshl-cardDesc{font-size:12px;line-height:17px;color:var(--dsw-alias-label-tertiary,#7b818b)}",
			".dshl-badges{display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end}",
			".dshl-badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:15px;border-radius:6px;padding:2px 7px;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);color:var(--dsw-alias-label-secondary,#374151);background:var(--dsw-alias-bg-layer-2,#f4f6f8);white-space:nowrap}",
			".dshl-badgeOn{color:var(--dsw-alias-state-success-primary,#15803d);border-color:var(--dsw-alias-state-success-tertiary,#bbf7d0);background:var(--dsw-alias-state-success-tertiary,#f0fdf4)}",
			".dshl-badgeWarn{color:var(--dsw-alias-state-warn-primary,#b45309);border-color:var(--dsw-alias-state-warn-tertiary,#fde68a);background:var(--dsw-alias-state-warn-tertiary,#fffbeb)}",
			".dshl-chev{flex-shrink:0;color:var(--dsw-alias-label-dimmed,#9ca3af);transition:transform .15s;font-size:12px;line-height:1;padding-top:3px}",
			".dshl-chev[data-open='true']{transform:rotate(90deg)}",
			".dshl-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px 20px}",
			".dshl-field{display:flex;flex-direction:column;gap:6px;min-width:0}",
			".dshl-fieldWide{grid-column:1/-1}",
			".dshl-labelRow{display:flex;align-items:center;gap:6px;min-width:0}",
			".dshl-label{font-size:12px;font-weight:500;line-height:16px;color:var(--dsw-alias-label-secondary,#374151)}",
			".dshl-flag{font-size:10px;line-height:14px;border-radius:5px;padding:1px 5px;color:var(--dsw-alias-label-dimmed,#6b7280);background:var(--dsw-alias-bg-layer-2,#eef1f4)}",
			".dshl-reset{margin-left:auto;border:0;background:none;padding:0 2px;font:inherit;font-size:11px;color:var(--dsw-alias-brand-primary,#4c78ff);cursor:pointer;white-space:nowrap}",
			".dshl-reset:hover{text-decoration:underline}",
			".dshl-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8b9099)}",
			".dshl-control{display:flex;align-items:center;gap:8px;min-width:0}",
			".dshl-input,.dshl-select{box-sizing:border-box;height:32px;width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;padding:0 10px}",
			".dshl-input:focus-visible,.dshl-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:1px;border-color:transparent}",
			".dshl-input:disabled,.dshl-select:disabled{opacity:.55;cursor:not-allowed}",
			".dshl-input[data-modified='true']{border-color:var(--dsw-alias-brand-primary,#4c78ff)}",
			".dshl-unit{font-size:11px;color:var(--dsw-alias-label-dimmed,#9ca3af);flex-shrink:0}",
			".dshl-switchRow{display:flex;align-items:center;gap:10px;min-height:32px}",
			".dshl-switch{position:relative;flex-shrink:0;width:38px;height:22px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);background:var(--dsw-alias-bg-layer-2,#e6eaee);cursor:pointer;padding:0;transition:background-color .15s,border-color .15s}",
			".dshl-switch[data-on='true']{background:var(--dsw-alias-button-primary-fill,#111827);border-color:transparent}",
			".dshl-switch:disabled{opacity:.5;cursor:not-allowed}",
			".dshl-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:2px}",
			".dshl-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:999px;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.25);transition:transform .15s}",
			".dshl-switch[data-on='true'] .dshl-knob{transform:translateX(16px)}",
			".dshl-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2,#d7dbe0);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#f1f3f6);flex-wrap:wrap}",
			".dshl-segBtn{border:0;background:none;font:inherit;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5563);padding:5px 12px;border-radius:8px;cursor:pointer;white-space:nowrap}",
			".dshl-segBtn[data-active='true']{background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,#111827);box-shadow:0 1px 2px rgba(16,24,40,.12);font-weight:500}",
			".dshl-segBtn:disabled{opacity:.5;cursor:not-allowed}",
			".dshl-segBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c78ff);outline-offset:1px}",
			".dshl-checks{display:flex;flex-direction:column;gap:6px}",
			".dshl-check{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#374151);cursor:pointer}",
			".dshl-check input{width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary,#4c78ff);margin:0;cursor:pointer}",
			".dshl-check input:disabled{cursor:not-allowed}",
			".dshl-order{font-size:10px;color:var(--dsw-alias-label-dimmed,#9ca3af)}",
			".dshl-summaryLine{font-size:12px;color:var(--dsw-alias-label-tertiary,#7b818b)}"
		].join("");
		// #endregion preview-css

		/** The dict every page render uses; the locale service publishes them under NS. */
		const DICTIONARIES = { zh: ZH, en: EN };
		/** Snapshot shape returned when no config form service exists. */
		const UNAVAILABLE = Object.freeze({ status: "unavailable", value: undefined, user: undefined, revision: undefined, writable: false, mode: "unavailable" });

		/** Required services: slot registration plus the dictionary namespace. */
		const inject = ["slots", "locale"];

		/** Render an interpolation-free dictionary lookup. */
		function translate(dict, t, key) {
			if (typeof t === "function") return t(key);
			return typeof dict[key] === "string" ? dict[key] : key;
		}

		/** Replace {name} placeholders in a summary template. */
		function fill(template, values) {
			return String(template).replace(/\{(\w+)\}/g, (match, name) => (values[name] === undefined ? match : String(values[name])));
		}

		/** Install this page's stylesheet once per document. */
		function installStyles() {
			if (typeof document === "undefined") return;
			const tagId = PACKAGE_NAME + "/ConfigPage.css";
			let tag = document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]");
			if (tag === null) {
				tag = document.createElement("style");
				tag.dataset.plugin = PACKAGE_NAME;
				tag.dataset.pluginCss = tagId;
				document.head.appendChild(tag);
			}
			tag.textContent = CSS;
		}

		/** Every field in the page, in navigation order. */
		function allFields() {
			const fields = [];
			for (const section of MODEL) for (const field of section.fields) fields.push(field);
			return fields;
		}

		/**
		 * Resolve the settings namespace this page edits.
		 *
		 * The product documents one form per profile entry id. The row id this
		 * bundle inserts is "latex-studio"; a deployment that re-ids the row is
		 * still handled by falling back to the served-namespace directory.
		 */
		function resolveNamespace(ctx, configForms) {
			const candidates = [];
			const entryId = ctx?.fiber?.entry?.options?.id;
			if (typeof entryId === "string" && entryId !== "") candidates.push(entryId);
			candidates.push(ROW_ID, PACKAGE_NAME);
			try {
				const view = configForms?.describe?.()?.getSnapshot?.()?.view;
				for (const namespace of view?.namespaces ?? []) {
					if (/latex/i.test(namespace.ns) && candidates.indexOf(namespace.ns) === -1) candidates.push(namespace.ns);
				}
			} catch (error) {
				/* a missing describe face only removes the fallback, never the page */
			}
			if (configForms && typeof configForms.get === "function") {
				for (const cand of candidates) {
					try {
						const form = configForms.get(cand);
						if (form && typeof form.getSnapshot === "function") {
							const snap = form.getSnapshot();
							if (snap && snap.status !== "unavailable") return cand;
						}
					} catch (e) {}
				}
				for (const cand of candidates) {
					try {
						const form = configForms.get(cand);
						if (form && typeof form.getSnapshot === "function") return cand;
					} catch (e) {}
				}
			}
			return candidates[0];
		}

		/** Bind one config form and re-render on every snapshot change. */
		function useForm(ctx) {
			const [handle] = React.useState(() => {
				const configForms = typeof ctx.get === "function" ? ctx.get("configForms") : undefined;
				if (!configForms || typeof configForms.get !== "function") return null;
				const namespace = resolveNamespace(ctx, configForms);
				const form = configForms.get(namespace);
				return typeof form?.getSnapshot === "function" ? form : null;
			});
			const subscribe = React.useCallback((listener) => (handle === null ? () => {} : handle.subscribe(listener)), [handle]);
			const getSnapshot = React.useCallback(() => (handle === null ? UNAVAILABLE : handle.getSnapshot()), [handle]);
			const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
			return { form: handle, snapshot };
		}

		/** A labeled field wrapper with the per-field "modified" reset. */
		function FieldShell(props) {
			const t = props.t;
			return React.createElement("div", { className: props.wide ? "dshl-field dshl-fieldWide" : "dshl-field" },
				React.createElement("div", { className: "dshl-labelRow" },
					React.createElement("span", { className: "dshl-label" }, t(props.field.labelKey)),
					props.field.restart ? React.createElement("span", { className: "dshl-flag" }, t("badge.restart")) : null,
					props.showFlag ? React.createElement("span", { className: "dshl-flag" }, t("state.modified")) : null,
					props.modified ? React.createElement("button", { type: "button", className: "dshl-reset", title: t("action.resetField"), onClick: props.onReset, disabled: props.disabled }, t("action.resetField")) : null),
				props.children,
				props.field.hintKey ? React.createElement("span", { className: "dshl-hint" }, t(props.field.hintKey)) : null);
		}

		/** A boolean field. */
		function SwitchField(props) {
			const t = props.t;
			const on = props.value === true;
			return React.createElement(FieldShell, { field: props.field, t, wide: true, modified: props.modified, disabled: props.disabled, onReset: props.onReset },
				React.createElement("div", { className: "dshl-switchRow" },
					React.createElement("button", {
						type: "button",
						role: "switch",
						"aria-checked": on,
						"aria-label": t(props.field.labelKey),
						className: "dshl-switch",
						"data-on": on,
						disabled: props.disabled,
						onClick: () => props.onCommit(!on)
					}, React.createElement("span", { className: "dshl-knob" })),
					React.createElement("span", { className: "dshl-hint" }, on ? t("badge.on") : t("badge.off"))));
		}

		/** A segmented (radio) field. */
		function SegmentedField(props) {
			const t = props.t;
			return React.createElement(FieldShell, { field: props.field, t, wide: true, modified: props.modified, disabled: props.disabled, onReset: props.onReset },
				React.createElement("div", { className: "dshl-seg", role: "radiogroup", "aria-label": t(props.field.labelKey) },
					props.field.options.map((option) => React.createElement("button", {
						key: option.value,
						type: "button",
						role: "radio",
						"aria-checked": props.value === option.value,
						className: "dshl-segBtn",
						"data-active": props.value === option.value,
						disabled: props.disabled,
						onClick: () => props.onCommit(option.value)
					}, t(option.labelKey)))));
		}

		/** A checkbox group whose value is the ordered subset of selected options. */
		function ChecksField(props) {
			const t = props.t;
			const selected = Array.isArray(props.value) ? props.value : [];
			const toggle = (option, checked) => {
				const next = checked ? selected.concat([option]) : selected.filter((item) => item !== option);
				props.onCommit(next);
			};
			return React.createElement(FieldShell, { field: props.field, t, wide: true, modified: props.modified, disabled: props.disabled, onReset: props.onReset },
				React.createElement("div", { className: "dshl-checks" },
					props.field.options.map((option, index) => React.createElement("label", { key: option.value, className: "dshl-check" },
						React.createElement("input", {
							type: "checkbox",
							checked: selected.indexOf(option.value) !== -1,
							disabled: props.disabled,
							onChange: (event) => toggle(option.value, event.target.checked)
						}),
						React.createElement("span", null, t(option.labelKey)),
						selected.indexOf(option.value) !== -1 ? React.createElement("span", { className: "dshl-order" }, "#" + String(index + 1)) : null))));
		}

		/** A select field. */
		function SelectField(props) {
			const t = props.t;
			return React.createElement(FieldShell, { field: props.field, t, wide: true, modified: props.modified, disabled: props.disabled, onReset: props.onReset },
				React.createElement("select", {
					className: "dshl-select",
					"aria-label": t(props.field.labelKey),
					value: typeof props.value === "string" ? props.value : "",
					disabled: props.disabled,
					onChange: (event) => props.onCommit(event.target.value)
				}, props.field.options.map((option) => React.createElement("option", { key: option.value, value: option.value }, t(option.labelKey)))));
		}

		/**
		 * A text or number field.
		 *
		 * Writes are committed on blur or Enter, never per keystroke: every write is
		 * one validated Host mutation that rewrites the profile patch.
		 */
		function DraftField(props) {
			const t = props.t;
			const field = props.field;
			const asDraft = (value) => (value === undefined || value === null ? "" : String(value));
			const [draft, setDraft] = React.useState(() => asDraft(props.value));
			const [editing, setEditing] = React.useState(false);
			React.useEffect(() => {
				if (!editing) setDraft(asDraft(props.value));
			}, [props.value, editing]);
			const commit = () => {
				setEditing(false);
				const text = draft.trim();
				if (text === "") {
					if (field.nullable) props.onCommit(null);
					else if (field.kind === "number") props.onCommit(props.value);
					else props.onCommit("");
					return;
				}
				if (field.kind === "number") {
					const numeric = Number(text);
					if (!Number.isFinite(numeric)) {
						setDraft(asDraft(props.value));
						return;
					}
					props.onCommit(numeric);
					return;
				}
				props.onCommit(text);
			};
			return React.createElement(FieldShell, { field, t, wide: field.wide === true || field.kind === "number", modified: props.modified, disabled: props.disabled, onReset: props.onReset },
				React.createElement("div", { className: "dshl-control" },
					React.createElement("input", {
						className: "dshl-input",
						type: field.kind === "number" ? "number" : "text",
						inputMode: field.kind === "number" ? "numeric" : undefined,
						min: field.min,
						max: field.max,
						step: field.step,
						disabled: props.disabled,
						"aria-label": t(field.labelKey),
						"data-modified": props.modified === true,
						placeholder: field.placeholderKey ? t(field.placeholderKey) : "",
						value: draft,
						onFocus: () => setEditing(true),
						onChange: (event) => setDraft(event.target.value),
						onBlur: commit,
						onKeyDown: (event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								commit();
							} else if (event.key === "Escape") {
								setEditing(false);
								setDraft(asDraft(props.value));
								event.currentTarget.blur();
							}
						}
					}),
					field.unitKey ? React.createElement("span", { className: "dshl-unit" }, unitLabel(field, props.value, t)) : null));
		}

		/** A duration a human can read at a glance (the config stores milliseconds). */
		function humanMs(value) {
			const ms = Number(value);
			if (!Number.isFinite(ms) || ms <= 0) return String(value);
			if (ms < 1000) return ms + " ms";
			const seconds = ms / 1000;
			if (seconds < 90) return seconds + " s";
			return Math.round(seconds / 60) + " min";
		}

		/** Short backend names, so the render badge stays one line. */
		const SHORT_BACKENDS = { poppler: "poppler", "miktex-ghostscript": "Ghostscript", "mineru-page": "mineru" };

		/** The unit shown next to a number field, including a readable form for ms. */
		function unitLabel(field, value, t) {
			if (!field.unitKey) return "";
			if (field.unitKey !== "unit.ms") return t(field.unitKey);
			const ms = Number(value);
			if (!Number.isFinite(ms) || ms < 1000) return t(field.unitKey);
			return t(field.unitKey) + " (≈ " + humanMs(ms) + ")";
		}

		/** Which values a card summarises when collapsed. */
		function cardSummary(section, values, t) {
			const pick = (key) => values[key];
			if (section.id === "compile") {
				const driver = pick("latexCommand");
				const label = driver === "" || driver === undefined ? t("summary.compile.auto") : String(driver);
				return label + " · " + humanMs(pick("compileTimeoutMs"));
			}
			if (section.id === "render") {
				const order = Array.isArray(pick("rendererOrder")) ? pick("rendererOrder") : [];
				return t("summary.render") + order.map((id) => SHORT_BACKENDS[id] ?? id).join(" → ");
			}
			if (section.id === "read") {
				const scope = pick("uploadScope");
				return t("summary.read") + (scope ? t("opt.uploadScope." + scope) : t("value.unset"));
			}
			if (section.id === "vto") {
				const images = Number(pick("attachImagesPerRound"));
				const budget = pick("pageBudget");
				return fill(t("summary.vto"), { workDir: String(pick("workDir")) })
					+ " · " + (budget === null || budget === undefined ? t("value.unset") : String(budget) + " 页")
					+ " · " + (Number.isFinite(images) ? images : 0) + t("unit.images");
			}
			if (section.id === "systems") {
				return fill(t("summary.systems"), { daily: pick("enableDaily") ? t("badge.on") : t("badge.off"), vto: pick("enableVto") ? t("badge.on") : t("badge.off") });
			}
			if (section.id === "checks") return pick("enableChktex") ? "chktex " + t("badge.on") : t("summary.checks.off");
			return "";
		}

		/** One collapsible configuration card. */
		function Card(props) {
			const t = props.t;
			const open = props.open;
			return React.createElement("section", { className: "dshl-card" },
				React.createElement("button", {
					type: "button",
					className: "dshl-cardHead",
					"aria-expanded": open,
					onClick: props.onToggle
				},
				React.createElement("span", { className: "dshl-chev", "data-open": open, "aria-hidden": "true" }, "▶"),
				React.createElement("span", { className: "dshl-cardTitles" },
					React.createElement("span", { className: "dshl-cardTitle" }, t(props.section.titleKey)),
					React.createElement("span", { className: "dshl-cardDesc" }, t(props.section.descKey))),
				React.createElement("span", { className: "dshl-badges" },
					props.badges.map((badge, index) => React.createElement("span", { key: index, className: "dshl-badge " + (badge.tone === "on" ? "dshl-badgeOn" : badge.tone === "warn" ? "dshl-badgeWarn" : "") }, badge.text)))),
				open ? React.createElement("div", { className: "dshl-cardBody" },
					React.createElement("div", { className: "dshl-grid" },
						props.section.fields.map((field) => React.createElement(FieldControl, {
							key: field.key,
							field,
							t,
							value: props.values[field.key],
							modified: props.modified[field.key] === true,
							disabled: props.disabled,
							onCommit: (next) => props.onWrite(field, next),
							onReset: () => props.onUnset(field)
						}))),
					React.createElement("div", { className: "dshl-bar" },
						React.createElement("button", {
							type: "button",
							className: "dshl-btn",
							disabled: props.disabled,
							onClick: () => props.section.fields.forEach((field) => props.onUnset(field))
						}, t("action.resetCard")))) : null);
		}

		/** Dispatch one field to its control. */
		function FieldControl(props) {
			if (props.field.kind === "switch") return React.createElement(SwitchField, props);
			if (props.field.kind === "segmented") return React.createElement(SegmentedField, props);
			if (props.field.kind === "checks") return React.createElement(ChecksField, props);
			if (props.field.kind === "select") return React.createElement(SelectField, props);
			return React.createElement(DraftField, props);
		}

		/** The configuration page, rendered into both config slots. */
		function ConfigPage(props) {
			const t = React.useCallback((key) => translate(props.dict, props.t, key), [props.dict, props.t]);
			const { form, snapshot } = useForm(props.ctx);
			const [openCards, setOpenCards] = React.useState(() => ({ compile: true, systems: false }));
			const [pending, setPending] = React.useState(0);

			React.useEffect(() => {
				installStyles();
			}, []);

			const ready = snapshot.status === "ready";
			const writable = ready && snapshot.writable === true && form !== null;
			const values = ready && snapshot.value && typeof snapshot.value === "object" ? snapshot.value : {};
			const user = snapshot.user && typeof snapshot.user === "object" ? snapshot.user : {};
			const modified = {};
			for (const key of Object.keys(user)) modified[key] = true;

			const run = (operation) => {
				setPending((count) => count + 1);
				return Promise.resolve(operation())
					.catch(() => undefined)
					.finally(() => setPending((count) => Math.max(0, count - 1)));
			};
			const write = (field, next) => {
				if (form === null) return;
				run(() => form.set(field.key, next));
			};
			const unset = (field) => {
				if (form === null) return;
				run(() => form.unset(field.key));
			};
			const state = snapshot.status === "loading" ? "loading"
				: !ready ? "unavailable"
					: !snapshot.writable ? "readonly"
						: pending > 0 ? "saving" : "synced";
			const stateKey = "state." + state;

			if (props.view === "summary") {
				return React.createElement("span", { className: "dshl-summaryLine" }, t("meta.description"));
			}

			const anyOpen = MODEL.some((section) => openCards[section.id] === true);
			return React.createElement("div", { className: "dshl-root" },
				React.createElement("div", { className: "dshl-head" },
					React.createElement("h3", { className: "dshl-title" }, t("page.title")),
					React.createElement("p", { className: "dshl-intro" }, t("page.intro"))),
				React.createElement("div", { className: "dshl-bar" },
					React.createElement("span", { className: "dshl-status", "data-state": state, role: "status" },
						React.createElement("span", { className: "dshl-dot", "aria-hidden": "true" }),
						t(stateKey)),
					React.createElement("span", { className: "dshl-spacer" }),
					React.createElement("button", {
						type: "button",
						className: "dshl-btn",
						onClick: () => {
							const next = {};
							for (const section of MODEL) next[section.id] = !anyOpen;
							setOpenCards(next);
						}
					}, t(anyOpen ? "action.collapseAll" : "action.expandAll")),
					React.createElement("button", {
						type: "button",
						className: "dshl-btn",
						disabled: !writable || pending > 0,
						onClick: () => run(() => form.mutate(allFields().map((field) => ({ op: "unset", path: [field.key] }))))
					}, t("action.resetAll"))),
				ready ? null : React.createElement("p", { className: "dshl-note", role: "status" }, t("state.unavailable.hint")),
				MODEL.map((section) => {
					const badges = [];
					const sectionValues = {};
					for (const field of section.fields) sectionValues[field.key] = values[field.key];
					// The description explains what the card is for and never changes; the
					// badge is the value summary, so a collapsed card still answers
					// "what is it set to?" without being expanded.
					if (section.id === "systems") badges.push({ text: t("badge.restart"), tone: "warn" });
					badges.push({ text: cardSummary(section, sectionValues, t), tone: "" });
					return React.createElement(Card, {
						key: section.id,
						section,
						t,
						values,
						modified,
						disabled: !writable,
						open: openCards[section.id] === true,
						summary: cardSummary(section, sectionValues, t),
						badges,
						onToggle: () => setOpenCards((current) => ({ ...current, [section.id]: current[section.id] !== true })),
						onWrite: write,
						onUnset: unset
					});
				}));
		}

		/**
		 * Register the page on both configuration surfaces.
		 * @param ctx - client cordis context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), PACKAGE_NAME + ": dictionaries");
			const ctx_ = ctx;
			ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
				name: "plugins.bundle.config",
				key: PACKAGE_NAME,
				locale: NS,
				inject: () => ({ ctx: ctx_, dict: ZH })
			}, ConfigPage));
			ctx.slots.inject("plugins.row.config", () => ctx.slots.register({
				name: "plugins.row.config",
				key: PACKAGE_NAME + "#" + ROW_ID,
				locale: NS,
				inject: () => ({ ctx: ctx_, dict: ZH })
			}, ConfigPage));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.NS = NS;
		exports.DICTIONARIES = DICTIONARIES;
		exports.ROW_ID = ROW_ID;
		exports.MODEL = MODEL;
		return module.exports;
	}
});
