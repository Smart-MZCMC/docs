#!/usr/bin/env node
/**
 * Build the VitePress docs and publish them into the Go backend's static dir.
 *
 *   node scripts/build.mjs                  # install + build + deploy
 *   node scripts/build.mjs --no-install     # skip `pnpm install`
 *   node scripts/build.mjs --skip-build     # deploy the existing build only
 *   node scripts/build.mjs --backend ../backend/public/docs
 *
 * VitePress writes to `.vitepress/dist`; the deployed copy lives at
 * `backend/public/docs` and is mounted at /docs by backend/routes/web.go.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, cpSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(scriptDir, '..');
const buildDir = join(docsDir, '.vitepress', 'dist');
const defaultBackend = resolve(docsDir, '..', 'backend', 'public', 'docs');

// --- args -----------------------------------------------------------------
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag) => {
	const i = argv.indexOf(flag);
	return i >= 0 ? argv[i + 1] : undefined;
};

const backendDir = resolve(docsDir, valueOf('--backend') ?? defaultBackend);
const skipInstall = has('--no-install');
const skipBuild = has('--skip-build');

// --- logging --------------------------------------------------------------
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const step = (msg) => console.log(paint('36;1', `\n==> ${msg}`));
const ok = (msg) => console.log(paint('32', `    ok  ${msg}`));
const warn = (msg) => console.log(paint('33', `    warn  ${msg}`));
const fail = (msg) => console.error(paint('31;1', `    fail  ${msg}`));

// A failed awaited child rejects at top level; report it without a raw stack.
process.on('unhandledRejection', (reason) => {
	fail(reason instanceof Error ? reason.message : String(reason));
	process.exit(1);
});

const run = (command, args, extraEnv) =>
	new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(
			// On Windows pnpm is a .cmd shim, so it needs the shell; passing the whole
			// command as one string avoids Node's shell+args deprecation warning.
			process.platform === 'win32' ? [command, ...args].join(' ') : command,
			process.platform === 'win32' ? [] : args,
			{ cwd: docsDir, stdio: 'inherit', shell: true, env: { ...process.env, ...extraEnv } }
		);
		child.on('error', (err) => rejectPromise(new Error(`无法执行 ${command}: ${err.message}`)));
		child.on('close', (code) => {
			const label = `${command} ${args.join(' ')}`;
			if (code !== 0) rejectPromise(new Error(`${label} 退出码 ${code}`));
			else resolvePromise();
		});
	});

// --- sanity ---------------------------------------------------------------
if (!existsSync(join(docsDir, 'package.json'))) {
	fail(`找不到 docs/package.json（docsDir=${docsDir}）`);
	process.exit(1);
}
if (!existsSync(join(docsDir, '.vitepress', 'config.mts'))) {
	fail(`找不到 .vitepress/config.mts，无法确认这是 VitePress 站点`);
	process.exit(1);
}

// Refuse to write into anything that is not clearly the backend static target.
const backendParent = dirname(backendDir); // .../public
const backendPublic = dirname(backendParent); // .../backend
if (!/^public$/i.test(backendParent.split(/[\\/]/).pop() ?? '')) {
	fail(`目标目录的父级必须叫 public，实际是 "${backendParent}"。用 --backend 指定正确路径。`);
	process.exit(1);
}
if (!existsSync(backendPublic)) {
	fail(`后端目录不存在: ${backendPublic}`);
	process.exit(1);
}
if (backendDir === docsDir || docsDir.startsWith(backendDir + '\\') || docsDir.startsWith(backendDir + '/')) {
	fail(`拒绝操作：目标目录 ${backendDir} 会覆盖 docs 自身。`);
	process.exit(1);
}

console.log(paint('1', '校园直播导播协调系统 · 文档站构建发布'));
console.log(`    docs   : ${docsDir}`);
console.log(`    backend: ${backendDir}`);

// --- 1. install -----------------------------------------------------------
if (skipInstall) {
	step('跳过依赖安装 (--no-install)');
} else {
	step('安装依赖 (pnpm install)');
	// CI=true would force a frozen lockfile and defeat the point of this script.
	await run('pnpm', ['install'], { CI: '' });
	ok('依赖已就绪');
}

// --- 2. build -------------------------------------------------------------
if (skipBuild) {
	step('跳过构建 (--skip-build)');
	if (!existsSync(join(buildDir, 'index.html'))) {
		fail(`没有可用的构建产物: ${join(buildDir, 'index.html')} 不存在`);
		process.exit(1);
	}
	ok('复用已有构建产物');
} else {
	step('构建文档站 (pnpm docs:build)');
	await run('pnpm', ['run', 'docs:build']);
	ok('构建完成');
}

const builtIndex = join(buildDir, 'index.html');
if (!existsSync(builtIndex)) {
	fail(`构建产物缺少 index.html: ${builtIndex}`);
	process.exit(1);
}

// VitePress resolves every asset against `base`, so a wrong base produces a
// site that 404s in production even though the build succeeds. Fail loudly.
const builtHtml = readFileSync(builtIndex, 'utf8');
const baseMatch = builtHtml.match(/["'](\/[^"']*\/)assets\//);
const detectedBase = baseMatch ? baseMatch[1] : '/';
if (detectedBase !== '/docs/') {
	warn(`构建产物里检测到的 base 是 "${detectedBase}"，期望 "/docs/"`);
	warn('请在 docs/.vitepress/config.mts 里设置 base: \'/docs/\'');
} else {
	ok('base 路径为 /docs/');
}

// --- 3. deploy ------------------------------------------------------------
step('部署到后端静态目录');
mkdirSync(backendDir, { recursive: true });

let removed = 0;
for (const entry of readdirSync(backendDir)) {
	rmSync(join(backendDir, entry), { recursive: true, force: true });
	removed += 1;
}
ok(`已清空旧文件 (${removed} 项)`);

cpSync(buildDir, backendDir, { recursive: true });
const deployed = [];
(function walk(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full);
		else deployed.push(relative(backendDir, full));
	}
})(backendDir);
ok(`已复制 ${deployed.length} 个文件`);

// --- 4. verify ------------------------------------------------------------
step('校验部署结果');

if (!existsSync(join(backendDir, 'index.html'))) {
	fail('部署后缺少 index.html');
	process.exit(1);
}

const html = readFileSync(join(backendDir, 'index.html'), 'utf8');
const refs = [...new Set([...html.matchAll(/["'](\/docs\/[^"'#?]+)["']/g)].map((m) => m[1]))];

// VitePress emits both real files (`/docs/assets/x.css`) and clean URLs
// (`/docs/operation-manual`). The Go handler resolves the latter by appending
// `.html`, so the check mirrors that instead of demanding a literal file.
const isAsset = (url) => url.startsWith('/docs/assets/') || /\.[a-z0-9]+$/i.test(url);
const missing = [];
for (const url of refs) {
	const rel = url.replace(/^\/docs\//, '');
	if (!rel) continue;
	const target = join(backendDir, decodeURIComponent(rel));
	const found =
		existsSync(target) && !statSync(target).isDirectory()
			? true
			: existsSync(target + '.html') || existsSync(join(target, 'index.html'));
	if (!found) missing.push({ url, kind: isAsset(url) ? 'asset' : 'page' });
}

if (missing.length > 0) {
	fail(`${missing.length}/${refs.length} 个引用缺失:`);
	for (const { url, kind } of missing.slice(0, 10)) console.log(`          [${kind}] ${url}`);
	fail('index.html 里存在无法解析的地址，站点会出现 404 或加载失败');
	process.exit(1);
}
ok(`index.html 引用的 ${refs.length} 个地址全部可解析`);

// cleanUrls: true means pages are requested without the .html extension, which
// the Go handler resolves by appending .html. Make sure the sources are there.
const pages = deployed.filter((rel) => rel.endsWith('.html') && rel !== '404.html');
if (pages.length === 0) {
	warn('没有生成任何 .html 页面，构建结果可能不完整');
} else {
	ok(`${pages.length} 个 HTML 页面（cleanUrls 由后端补 .html 解析）`);
}

const totalBytes = deployed.reduce((sum, rel) => sum + statSync(join(backendDir, rel)).size, 0);
const mb = (totalBytes / 1024 / 1024).toFixed(2);

console.log(paint('32;1', `\n完成：${deployed.length} 个文件，${mb} MB -> ${backendDir}`));
console.log('访问 http://127.0.0.1:3000/docs（静态文件实时读取，无需重启后端）');
