import { WASI } from './vendor/wasi/main.js';

const root = new URL('./vendor/', import.meta.url);
const sides = 20;
const steps = { W: [-1, 0], A: [0, -1], S: [1, 0], D: [0, 1] };
const reverse = { W: 'S', A: 'D', S: 'W', D: 'A' };
const intervals = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
const limit = 1024 * 1024;

async function fetchAsset(name) {
    const response = await fetch(new URL(name, root));
    if (!response.ok) throw new Error('无法加载在线编译器资源：' + name);
    return response;
}

function file(path, content, mode = 'binary') {
    const now = new Date(0);
    return { path, content, mode, timestamps: { access: now, modification: now, change: now } };
}

function run(module, options) {
    const wasi = new WASI(options);
    const instance = new WebAssembly.Instance(module, wasi.getImportObject());
    return wasi.start({ module, instance });
}

let compiler;
async function loadCompiler() {
    const [clang, linker, archive] = await Promise.all([
        fetchAsset('clang.wasm').then(async response => WebAssembly.compile(await response.arrayBuffer())),
        fetchAsset('wasm-ld.wasm').then(async response => WebAssembly.compile(await response.arrayBuffer())),
        fetchAsset('clang-files.json.gz'),
    ]);
    const stream = archive.body.pipeThrough(new DecompressionStream('gzip'));
    const files = await new Response(stream).json();
    const fs = Object.fromEntries(Object.entries(files).map(([path, base64]) =>
        [path, file(path, Uint8Array.from(atob(base64), char => char.charCodeAt(0)))]));
    return { clang, linker, fs };
}

export async function compile(source) {
    if (new TextEncoder().encode(source).length > 256 * 1024) throw new Error('源码不能超过 256 KB。');
    compiler ??= loadCompiler();
    const { clang, linker, fs } = await compiler;
    let diagnostics = '';
    const stderr = chunk => { diagnostics = (diagnostics + chunk).slice(0, 16384); };
    const sourcePath = '/submission.cpp';
    const objectPath = '/program.o';
    const executablePath = '/program.wasm';
    const compiled = run(clang, {
        args: ['clang', '-cc1', '-emit-obj', '-disable-free', '-isysroot', '/sys',
            '-internal-isystem', '/sys/include/c++/v1', '-internal-isystem', '/sys/include',
            '-internal-isystem', '/sys/lib/clang/8.0.1/include', '-ferror-limit', '4',
            '-O2', '-std=c++17', '-o', objectPath, '-x', 'c++', sourcePath],
        fs: { ...fs, [sourcePath]: file(sourcePath, source, 'string') }, stderr,
    });
    if (compiled.exitCode !== 0 || !compiled.fs[objectPath]) {
        throw Object.assign(new Error('C++ 编译失败。'), { details: diagnostics });
    }
    const linked = run(linker, {
        args: ['wasm-ld', '--no-threads', '--export-dynamic', '-z', 'stack-size=1048576',
            '--max-memory=134217728', '-L/sys/lib/wasm32-wasi', '/sys/lib/wasm32-wasi/crt1.o',
            objectPath, '-lc', '-lc++', '-lc++abi', '-o', executablePath],
        fs: compiled.fs, stderr,
    });
    if (linked.exitCode !== 0 || !linked.fs[executablePath]) {
        throw Object.assign(new Error('C++ 链接失败。'), { details: diagnostics });
    }
    return WebAssembly.compile(linked.fs[executablePath].content);
}

function setupGame(n, seed) {
    const random = bound => {
        seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
        return Math.floor(seed / 4294967296 * bound);
    };
    const terrain = Array.from({ length: sides * sides }, (_, p) => {
        const row = Math.floor(p / sides), col = p % sides;
        return row === 0 || col === 0 || row === sides - 1 || col === sides - 1 ? '#' : '.';
    });
    const head = (2 + random(13)) * sides + 2 + random(16);
    const body = [head, head + sides, head + 2 * sides];
    function pickEmpty() {
        const occupied = new Set(body);
        const empty = [];
        for (let p = 0; p < terrain.length; p++) {
            if (terrain[p] === '.' && !occupied.has(p)) empty.push(p);
        }
        return empty.length ? empty[random(empty.length)] : -1;
    }
    for (let i = 0; i < 10; i++) terrain[pickEmpty()] = 'O';
    let food = pickEmpty();
    function board() {
        const cells = [...terrain];
        if (food >= 0) cells[food] = 'F';
        for (const p of body) cells[p] = 'B';
        cells[body[0]] = 'H';
        return Array.from({ length: sides }, (_, r) =>
            cells.slice(r * sides, (r + 1) * sides).join(''));
    }
    const initial = board();
    const replay = { initial, moves: [], attempted: null };
    let input = initial.join('\n') + '\n' + n + '\n';
    let score = 0, moved = 0, facing = 'W', direction, expected, status;
    let buffered = '', outputSize = 0;
    function accept(line) {
        if (status === 'collision' && expected.length) {
            const next = expected.shift();
            if (line !== next) throw new Error('Wrong final board or score: expected ' + next + ', got ' + line);
            return;
        }
        if (status) throw new Error(status === 'collision' ? 'Extra output after game over' : 'Extra output after EOF');
        if (!direction) {
            if (line.length !== 1 || !Object.hasOwn(steps, line)) throw new Error('Invalid direction: ' + line);
            direction = line;
            return;
        }
        if (line !== String(score)) throw new Error('Expected score ' + score + ', got ' + line);
        const [dr, dc] = steps[direction];
        const row = Math.floor(body[0] / sides) + dr, col = body[0] % sides + dc;
        const next = row * sides + col;
        const collision = direction === reverse[facing] ? 'reverse' :
            terrain[next] === '#' ? 'wall' : terrain[next] === 'O' ? 'obstacle' :
            body.includes(next) ? 'body' : null;
        if (collision) {
            replay.attempted = { direction, row, col, reason: collision };
            input += '100 100\n';
            expected = [...board(), String(score)];
            status = 'collision';
            return;
        }
        if (moved === 15000) {
            status = 'step limit';
            return;
        }
        const eats = next === food;
        if (!eats && (moved + 1) % n !== 0) body.pop();
        body.unshift(next);
        facing = direction;
        moved++;
        if (eats) {
            score += 10;
            food = pickEmpty();
        }
        replay.moves.push([direction, eats ? food : null]);
        input += (eats && food >= 0 ? Math.floor(food / sides) + ' ' + food % sides : '20 20') + '\n';
        direction = undefined;
    }
    return {
        stdin(size) {
            if (!input && !status) throw new Error('程序在读取评测器回复前，必须输出方向和当前分数并刷新 stdout。');
            const chunk = input.slice(0, size);
            input = input.slice(chunk.length);
            return chunk;
        },
        stdout(chunk) {
            outputSize += chunk.length;
            if (outputSize > limit) throw new Error('Output limit exceeded');
            const lines = (buffered + chunk).split('\n');
            buffered = lines.pop();
            for (const line of lines) accept(line.endsWith('\r') ? line.slice(0, -1) : line);
        },
        finish(exitCode) {
            if (buffered) accept(buffered);
            if (!status || expected?.length) throw new Error('Program ended before it produced the required output');
            if (exitCode !== 0) throw new Error('Program failed to exit cleanly');
            return { n, score, moved, status, replay, weightedScore: score / (Math.log2(n) + 1) };
        },
        failed(error) { return { n, error: error.message, moved, replay }; },
    };
}

export function judgeCase(module, n, seed) {
    const game = setupGame(n, (seed + n) >>> 0);
    try {
        const result = run(module, { args: ['submission'], stdin: game.stdin, stdout: game.stdout });
        return game.finish(result.exitCode);
    } catch (error) {
        return game.failed(error);
    }
}

export function suiteResult(seed, cases) {
    const complete = cases.every(result => !result.error && result.status === 'collision');
    return {
        seed, cases,
        rawTotal: complete ? cases.reduce((sum, result) => sum + result.score, 0) : null,
        weightedTotal: complete ? cases.reduce((sum, result) => sum + result.weightedScore, 0) : null,
    };
}

export { intervals };

if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.onmessage = async ({ data }) => {
        try {
            if (data.type === 'compile') {
                self.postMessage({ result: await compile(data.source) });
            } else {
                self.postMessage({ result: judgeCase(data.module, data.n, data.seed) });
            }
        } catch (error) {
            self.postMessage({ error: error.message, details: error.details });
        }
    };
}
