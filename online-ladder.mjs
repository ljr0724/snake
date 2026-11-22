import { browserEvaluate } from './browser-evaluate.mjs';
import { apiOrigin } from './ladder-config.mjs';

let pending;
const ownerStorageName = id => 'snake-ladder-owner:' + id;

export function canDeleteEntry(id) {
    try {
        return Boolean(localStorage.getItem(ownerStorageName(id)));
    } catch {
        return false;
    }
}

export async function removeOwnEntry(id) {
    const name = ownerStorageName(id);
    const ownerKey = localStorage.getItem(name);
    if (!ownerKey) throw new Error('这条记录的删除凭证不在当前浏览器。');
    await api('/api/ladder/delete', { id, ownerKey });
    localStorage.removeItem(name);
}

export function addDeleteControl(cell, entry) {
    if (!canDeleteEntry(entry.id)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'seed-button';
    button.textContent = '删除我的记录';
    const feedback = document.createElement('span');
    feedback.setAttribute('role', 'status');
    button.addEventListener('click', async () => {
        if (!window.confirm('确定从天梯榜移除这条记录及其公开详情？')) return;
        button.disabled = true;
        feedback.textContent = '';
        try {
            await removeOwnEntry(entry.id);
            location.reload();
        } catch (error) {
            feedback.textContent = ' ' + error.message;
            button.disabled = false;
        }
    });
    cell.append(' ', button, feedback);
}

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
        const { id, token, seeds } = await api('/api/ladder/challenge', {});
        const evaluation = await browserEvaluate({ label: 'ladder', code: body.code }, seeds);
        if (evaluation.error) throw Object.assign(new Error(evaluation.error), { details: evaluation.details });
        const best = evaluation.suites.reduce((top, suite) =>
            suite.weightedTotal !== null && (!top || suite.weightedTotal > top.weightedTotal) ? suite : top, null);
        const suites = evaluation.suites.map(suite => ({
            ...suite, cases: suite.cases.map(({ replay, ...game }) => game),
        }));
        if (best) pending = { ...body, id, token, suites, best };
        return { id: best ? token : null, suites, best, score: best?.weightedTotal ?? null, bestSeed: best?.seed };
    }
    if (path === '/api/ladder/upload') {
        if (!pending || pending.token !== body.id) throw new Error('请先完成本轮测评。');
        const name = ownerStorageName(pending.id);
        let ownerKey;
        try {
            ownerKey = localStorage.getItem(name) ?? Array.from(crypto.getRandomValues(new Uint8Array(32)),
                value => value.toString(16).padStart(2, '0')).join('');
            localStorage.setItem(name, ownerKey);
        } catch {
            throw new Error('浏览器无法保存删除凭证。请允许此网站保存本地数据后重试。');
        }
        const reply = await api(path, { ...pending, ownerKey });
        pending = undefined;
        return reply;
    }
    return api(path, body);
}
