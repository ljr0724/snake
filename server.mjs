import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SEED, runSuite } from './judge.mjs';
import { withCompiledSource } from './compiler.mjs';
import { createLadder, randomLadderSeeds } from './ladder.mjs';

const platformIsWindows = process.platform === 'win32';
const sourceLimit = 256 * 1024;
const port = Number(process.env.SNAKE_PORT ?? 8787);
const ladder = createLadder(process.env.SNAKE_DATA_DIR ?? fileURLToPath(new URL('./data/ladder/', import.meta.url)));
const html = 'text/html; charset=utf-8';
const js = 'text/javascript; charset=utf-8';
const plain = 'text/plain; charset=utf-8';
const assets = new Map([
    ['/', ['index.html', html]],
    ['/rules', ['rules.html', html]],
    ['/evaluate', ['evaluate.html', html]],
    ['/ladder', ['ladder.html', html]],
    ['/ladder/play', ['ladder-play.html', html]],
    ['/ladder/entry', ['ladder-entry.html', html]],
    ['/app.js', ['app.js', js]],
    ['/replay.js', ['replay.js', js]],
    ['/replay-state.mjs', ['replay-state.mjs', js]],
    ['/ai-kit.zip', ['snake-ai-kit.zip', 'application/zip']],
    ['/ladder-play.js', ['ladder-play.js', js]],
    ['/ladder-view.js', ['ladder-view.js', js]],
    ['/ladder-results.js', ['ladder-results.js', js]],
    ['/prompt.md', ['AI-PROMPT.md', plain]],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
    ['/example.cpp', ['example.cpp', plain]],
]);
let running = false;

function send(res, status, body, contentType) {
    res.writeHead(status, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    });
    res.end(body);
}

function json(res, status, body) {
    send(res, status, JSON.stringify(body), 'application/json; charset=utf-8');
}

async function receive(req, limit) {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    for await (const chunk of req) {
        if (tooLarge) continue;
        bytes += chunk.length;
        if (bytes > limit) tooLarge = true;
        else chunks.push(chunk);
    }
    return tooLarge ? null : Buffer.concat(chunks).toString('utf8');
}

function parseObject(body) {
    try {
        const data = JSON.parse(body);
        return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    } catch {
        return null;
    }
}

async function compileAndRun(source, seeds, mode) {
    return withCompiledSource(source, async executable => {
        if (mode === 'single') return await runSuite(executable, seeds[0]);
        const suites = [];
        let best = null;
        for (const seed of seeds) {
            const suite = await runSuite(executable, seed, true);
            if (mode === 'ladder') {
                if (suite.weightedTotal !== null && (!best || suite.weightedTotal > best.weightedTotal)) best = suite;
                suites.push({ ...suite, cases: suite.cases.map(({ replay, ...result }) => result) });
            } else {
                suites.push(suite);
            }
        }
        return mode === 'ladder' ? { suites, best } : { suites };
    });
}

async function handleLadderPost(req, res, publish) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
        return json(res, 415, { error: '天梯请求需要使用 JSON。' });
    }
    if (!publish && running) return json(res, 409, { error: '另一轮评测正在运行。' });
    const body = await receive(req, publish ? 1024 : sourceLimit * 6 + 4096);
    if (body === null) return json(res, 413, { error: '提交内容太大。' });
    const data = parseObject(body);
    if (!data) return json(res, 400, { error: '提交格式无效。' });
    if (publish) {
        if (typeof data.id !== 'string') return json(res, 400, { error: '缺少本轮评测编号。' });
        const saved = await ladder.publish(data.id);
        if (saved?.busy) return json(res, 409, { error: '正在上传这条记录。' });
        return saved ? json(res, 200, saved) : json(res, 404, { error: '待上传结果已失效，请重新评测。' });
    }
    const nickname = typeof data.nickname === 'string' ? data.nickname.trim() : '';
    const model = typeof data.model === 'string' ? data.model.trim() : '';
    if (!nickname || nickname.length > 40 || !model || model.length > 80) {
        return json(res, 400, { error: '请填写昵称（最多 40 字符）和 AI 模型（最多 80 字符）。' });
    }
    if (typeof data.code !== 'string' || !data.code.trim()) return json(res, 400, { error: '请先粘贴 C++ 代码。' });
    if (Buffer.byteLength(data.code, 'utf8') > sourceLimit) return json(res, 413, { error: '代码超过 256 KB。' });
    if (running) return json(res, 409, { error: '另一轮评测正在运行。' });
    running = true;
    try {
        const evaluation = await compileAndRun(data.code, randomLadderSeeds(), 'ladder');
        if (evaluation.error) return json(res, 422, evaluation);
        const id = ladder.addDraft(nickname, model, data.code, evaluation);
        return json(res, 200, { id, suites: evaluation.suites, bestSeed: evaluation.best?.seed ?? null,
            score: evaluation.best?.weightedTotal ?? null });
    } finally {
        running = false;
    }
}

const server = createServer(async (req, res) => {
    const allowedHosts = ['127.0.0.1:' + server.address().port, 'localhost:' + server.address().port];
    if (!allowedHosts.includes(req.headers.host)) return json(res, 403, { error: '访问来源无效。' });
    try {
        const url = new URL(req.url, 'http://127.0.0.1');
        const { pathname } = url;
        const asset = assets.get(pathname);
        if (req.method === 'GET' && asset) {
            const [filename, type] = asset;
            const body = await readFile(fileURLToPath(new URL(filename, import.meta.url)));
            return send(res, 200, body, type);
        }
        if (req.method === 'GET' && pathname === '/api/ladder') {
            return json(res, 200, { entries: await ladder.list() });
        }
        if (req.method === 'GET' && pathname === '/api/ladder/entry') {
            const entry = await ladder.read(url.searchParams.get('id') ?? '');
            return entry ? json(res, 200, entry) : json(res, 404, { error: '找不到这条天梯记录。' });
        }
        const batch = pathname === '/batch';
        const ranked = pathname === '/api/ladder/run';
        const publish = pathname === '/api/ladder/upload';
        if (req.method !== 'POST' || (!batch && !ranked && !publish && pathname !== '/run')) {
            return json(res, 404, { error: '找不到该页面。' });
        }
        if (req.headers.origin !== 'http://' + req.headers.host) {
            return json(res, 403, { error: '请在本地评测页面操作。' });
        }
        if (ranked || publish) return await handleLadderPost(req, res, publish);
        if (req.headers['content-type']?.split(';')[0] !== 'text/plain') {
            return json(res, 415, { error: '代码需要以纯文本提交。' });
        }
        const inputs = url.searchParams.getAll('seed');
        if (inputs.some(value => !/^\d{1,10}$/.test(value) || Number(value) > 0xffffffff)) {
            return json(res, 400, { error: '种子必须是 0 到 4294967295 之间的整数。' });
        }
        const seeds = [...new Set(inputs.map(Number))];
        if (!seeds.length) seeds.push(DEFAULT_SEED);
        if (seeds.length > (batch ? 8 : 1)) return json(res, 400, { error: batch ? '一次最多评测 8 个种子。' : '单组评测只接受一个种子。' });
        if (running) return json(res, 409, { error: '另一轮评测正在运行。' });

        running = true;
        try {
            const source = await receive(req, sourceLimit);
            if (source === null) return json(res, 413, { error: '代码超过 256 KB。' });
            if (!source.trim()) return json(res, 400, { error: '请先粘贴 C++ 代码。' });
            const result = await compileAndRun(source, seeds, batch ? 'batch' : 'single');
            return json(res, result.error ? 422 : 200, result);
        } finally {
            running = false;
        }
    } catch (error) {
        console.error(error);
        if (!res.headersSent) json(res, 500, { error: '评测服务遇到错误。请查看终端。' });
    }
});

server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? '端口已占用。请关闭已有的评测窗口后重试。' : error.message);
    process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + server.address().port;
    console.log('Snake OJ · ' + url);
    if (platformIsWindows && process.argv.includes('--open')) {
        const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
            stdio: 'ignore', windowsHide: true,
        });
        browser.on('error', () => console.log('请手动在浏览器打开 ' + url));
        browser.unref();
    }
});
