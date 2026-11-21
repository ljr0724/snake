import { browserEvaluate } from './browser-evaluate.mjs';
import { apiOrigin } from './ladder-config.mjs';

let pending;

async function api(path, body) {
    if (path === '/api/ladder' && location.search) {
        const page = new URLSearchParams(location.search).get('page');
        if (page) path += '?page=' + encodeURIComponent(page);
    }
    const response = await fetch(new URL(path, apiOrigin), body === undefined ? undefined : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '共享天梯请求失败。');
    return data;
}

export async function requestOnline(path, body) {
    if (path === '/api/ladder/run') {
        pending = undefined;
        const { token, seeds } = await api('/api/ladder/challenge', {});
        const evaluation = await browserEvaluate({ label: 'ladder', code: body.code }, seeds);
        if (evaluation.error) throw Object.assign(new Error(evaluation.error), { details: evaluation.details });
        const best = evaluation.suites.reduce((top, suite) =>
            suite.weightedTotal !== null && (!top || suite.weightedTotal > top.weightedTotal) ? suite : top, null);
        const suites = evaluation.suites.map(suite => ({
            ...suite, cases: suite.cases.map(({ replay, ...game }) => game),
        }));
        if (best) pending = { ...body, token, suites, best };
        return { id: best ? token : null, suites, best, score: best?.weightedTotal ?? null, bestSeed: best?.seed };
    }
    if (path === '/api/ladder/upload') {
        if (!pending || pending.token !== body.id) throw new Error('请先完成本轮测评。');
        const reply = await api(path, pending);
        pending = undefined;
        return reply;
    }
    return api(path, body);
}
