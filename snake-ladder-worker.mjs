const ns = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
const encoder = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const directions = /^[WASD]$/;
const submissionLimit = 1800000;
const challengeLifetime = 2 * 60 * 60 * 1000;
const ownerKeyPattern = /^[a-f0-9]{64}$/;

function validOwnerKey(value) {
    return typeof value === 'string' && ownerKeyPattern.test(value);
}
async function ownerDigest(value) {
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(value));
    return base64(new Uint8Array(hash));
}

function base64(bytes) {
    return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function unbase64(value) {
    return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
}
function key(env) {
    return crypto.subtle.importKey('raw', encoder.encode(env.CHALLENGE_KEY),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function challenge(env) {
    const seeds = new Set();
    while (seeds.size < 10) seeds.add(crypto.getRandomValues(new Uint32Array(1))[0]);
    const data = { id: crypto.randomUUID(), seeds: [...seeds], expires: Date.now() + challengeLifetime };
    const payload = base64(encoder.encode(JSON.stringify(data)));
    const signature = await crypto.subtle.sign('HMAC', await key(env), encoder.encode(payload));
    return { id: data.id, seeds: data.seeds, token: payload + '.' + base64(new Uint8Array(signature)) };
}
async function readChallenge(token, env) {
    if (typeof token !== 'string' || token.length > 600 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
    const [payload, signature] = token.split('.');
    try {
        const valid = await crypto.subtle.verify('HMAC', await key(env), unbase64(signature), encoder.encode(payload));
        return valid ? JSON.parse(new TextDecoder().decode(unbase64(payload))) : null;
    } catch {
        return null;
    }
}

function textField(value, max) {
    if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
        throw new Error('昵称或 AI 模型无效。');
    }
    return value.trim();
}
function integer(value, min, max) {
    return Number.isInteger(value) && value >= min && value <= max;
}
function checkCase(game, n) {
    if (!game || game.n !== n || (game.moved !== undefined && !integer(game.moved, 0, 15000))) {
        throw new Error('逐局评测记录无效。');
    }
    if (typeof game.error === 'string' && game.error.length) {
        return { n, moved: game.moved, error: game.error.slice(0, 200) };
    }
    if (!['collision', 'step limit'].includes(game.status) || !integer(game.score, 0, 150000) ||
        game.score % 10 || !integer(game.moved, 0, 15000) || game.score / 10 > game.moved) {
        throw new Error('逐局分数无效。');
    }
    return { n, moved: game.moved, score: game.score, status: game.status, weightedScore: game.score / (Math.log2(n) + 1) };
}
function checkReplay(replay, game) {
    if (!replay || !Array.isArray(replay.initial) || replay.initial.length !== 20 ||
        !replay.initial.every(line => typeof line === 'string' && /^[#.OBHF]{20}$/.test(line)) ||
        !Array.isArray(replay.moves) || replay.moves.length !== game.moved ||
        !replay.moves.every(move => Array.isArray(move) && move.length === 2 && directions.test(move[0]) &&
            (move[1] === null || integer(move[1], -1, 399))) ||
        replay.moves.filter(move => move[1] !== null).length * 10 !== game.score) {
        throw new Error('最高分组的对局回放无效。');
    }
    const { attempted } = replay;
    if (!attempted || !directions.test(attempted.direction) || !integer(attempted.row, 0, 19) ||
        !integer(attempted.col, 0, 19) || !['reverse', 'wall', 'obstacle', 'body'].includes(attempted.reason)) {
        throw new Error('最高分组的碰撞记录无效。');
    }
    const { direction, row, col, reason } = attempted;
    return { initial: replay.initial, moves: replay.moves, attempted: { direction, row, col, reason } };
}
function buildEntry(body, trial) {
    const nickname = textField(body.nickname, 40);
    const model = textField(body.model, 80);
    const code = body.code;
    if (typeof code !== 'string' || !code.trim() || encoder.encode(code).length > 256 * 1024) {
        throw new Error('C++ 源码为空或超过 256 KB。');
    }
    if (!Array.isArray(body.suites) || body.suites.length !== trial.seeds.length) throw new Error('缺少十组评测记录。');
    const suites = trial.seeds.map((seed, index) => {
        const raw = body.suites[index];
        if (raw?.seed !== seed || !Array.isArray(raw.cases) || raw.cases.length !== ns.length) {
            throw new Error('评测记录与分配的种子不符。');
        }
        const cases = ns.map((n, i) => checkCase(raw.cases[i], n));
        const complete = cases.every(game => game.status === 'collision');
        return {
            seed, cases,
            rawTotal: complete ? cases.reduce((sum, game) => sum + game.score, 0) : null,
            weightedTotal: complete ? cases.reduce((sum, game) => sum + game.weightedScore, 0) : null,
        };
    });
    const best = suites.reduce((top, suite) =>
        suite.weightedTotal !== null && (!top || suite.weightedTotal > top.weightedTotal) ? suite : top, null);
    if (!best || body.best?.seed !== best.seed || !Array.isArray(body.best.cases) || body.best.cases.length !== ns.length) {
        throw new Error('没有完整完成的最高分组。');
    }
    const publishedBest = { ...best, cases: best.cases.map((game, i) => ({
        ...game, replay: checkReplay(body.best.cases[i]?.replay, game),
    })) };
    return { id: trial.id, nickname, model, code, score: best.weightedTotal, bestSeed: best.seed,
        suites, best: publishedBest, createdAt: new Date().toISOString() };
}

async function readBody(request) {
    if (!request.body || !request.headers.get('content-type')?.startsWith('application/json') ||
        Number(request.headers.get('content-length') || 0) > submissionLimit) throw new Error('提交文件格式无效或过大。');
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let size = 0, text = '';
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > submissionLimit) throw new Error('提交记录过大。');
            text += decoder.decode(value, { stream: true });
        }
        return JSON.parse(text + decoder.decode());
    } finally {
        await reader.cancel();
    }
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin');
        const headers = { 'Cache-Control': 'no-store', Vary: 'Origin' };
        if (origin === env.SITE_ORIGIN) headers['Access-Control-Allow-Origin'] = origin;
        const json = (value, status = 200) => Response.json(value, { status, headers });
        const url = new URL(request.url);
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: origin === env.SITE_ORIGIN ? 204 : 403, headers: {
                ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type',
            } });
        }
        try {
            if (request.method === 'GET' && url.pathname === '/api/ladder') {
                const page = Number(url.searchParams.get('page') ?? 1);
                if (!integer(page, 1, 10000)) return json({ error: '无效的页码。' }, 400);
                const { results } = await env.LADDER_DB.prepare(
                    'SELECT id, nickname, model, score, created_at AS createdAt FROM entries WHERE deleted_at IS NULL ORDER BY score DESC, created_at, id LIMIT 51 OFFSET ?'
                ).bind((page - 1) * 50).all();
                return json({ entries: results.slice(0, 50), hasNext: results.length > 50 });
            }
            if (request.method === 'GET' && url.pathname === '/api/ladder/entry') {
                const id = url.searchParams.get('id') ?? '';
                const entry = uuid.test(id) ? await env.LADDER_DB.prepare(
                    'SELECT payload FROM entries WHERE id = ? AND deleted_at IS NULL'
                ).bind(id).first() : null;
                return entry ? json(JSON.parse(entry.payload)) : json({ error: '这条天梯记录不存在。' }, 404);
            }
            if (request.method === 'POST' && ['/api/ladder/challenge', '/api/ladder/upload', '/api/ladder/delete'].includes(url.pathname)) {
                if (origin !== env.SITE_ORIGIN) return json({ error: '请从贪吃蛇网站提交。' }, 403);
                const visitor = request.headers.get('CF-Connecting-IP') ?? 'local';
                const rate = await env.LADDER_LIMIT.limit({ key: visitor + ':' + url.pathname });
                if (!rate.success) return json({ error: '提交太频繁，请稍后再试。' }, 429);
                if (url.pathname.endsWith('/challenge')) return json(await challenge(env));
                let body;
                try { body = await readBody(request); }
                catch { return json({ error: '提交记录格式无效或过大。' }, 400); }
                if (url.pathname.endsWith('/delete')) {
                    if (typeof body?.id !== 'string' || !uuid.test(body.id) || !validOwnerKey(body.ownerKey)) {
                        return json({ error: '记录或删除凭证无效。' }, 400);
                    }
                    const digest = await ownerDigest(body.ownerKey);
                    const removed = await env.LADDER_DB.prepare(
                        'UPDATE entries SET deleted_at = COALESCE(deleted_at, ?) WHERE id = ? AND owner_digest = ? RETURNING id'
                    ).bind(new Date().toISOString(), body.id, digest).first();
                    return removed ? json({ id: removed.id }) : json({ error: '没有这条记录的删除权限。' }, 403);
                }
                if (!validOwnerKey(body?.ownerKey)) return json({ error: '请刷新网页后重新测评并提交。' }, 400);
                const trial = await readChallenge(body?.token, env);
                if (!trial || trial.expires < Date.now()) return json({ error: '本轮评测已过期，请重新运行。' }, 400);
                let entry;
                try { entry = buildEntry(body, trial); }
                catch (error) { return json({ error: error.message }, 400); }
                await env.LADDER_DB.prepare(
                    'INSERT INTO entries (id, nickname, model, score, created_at, payload, owner_digest) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING'
                ).bind(entry.id, entry.nickname, entry.model, entry.score, entry.createdAt, JSON.stringify(entry), await ownerDigest(body.ownerKey)).run();
                return json({ id: entry.id }, 201);
            }
            return json({ error: '接口不存在。' }, 404);
        } catch (error) {
            console.error(error);
            return json({ error: '共享天梯暂时不可用，请稍后重试。' }, 503);
        }
    },
};
