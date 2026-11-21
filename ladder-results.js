const scoreText = number => number == null ? '未完成' : number.toFixed(4);
export { scoreText };

export function fillTestRecords(container, suites, bestSeed, replaySuite, showReplay) {
    const elements = suites.map(suite => {
        const details = document.createElement('details');
        details.className = 'test-record';
        const summary = document.createElement('summary');
        summary.textContent = '种子 ' + suite.seed + ' · ' + scoreText(suite.weightedTotal) +
            (suite.seed === bestSeed ? ' · 最高分组' : '');
        details.append(summary);
        const table = document.createElement('table');
        table.setAttribute('aria-label', '种子 ' + suite.seed + ' 的逐局结果');
        const header = table.createTHead().insertRow();
        const cases = new Map((replaySuite?.seed === suite.seed ? replaySuite.cases : []).map(game => [game.n, game]));
        const labels = ['N', '原始分', '加权分', '步数', '结果'];
        if (cases.size) labels.push('回放');
        for (const label of labels) {
            const cell = document.createElement('th');
            cell.scope = 'col';
            cell.textContent = label;
            header.append(cell);
        }
        const rows = table.createTBody();
        for (const game of suite.cases) {
            const row = rows.insertRow();
            const state = game.error || (game.status === 'collision' ? '完成' : '到达步数上限');
            for (const value of [game.n, game.score ?? '—', game.weightedScore?.toFixed(4) ?? '—', game.moved ?? '—', state]) {
                row.insertCell().textContent = value;
            }
            if (cases.size) {
                const cell = row.insertCell();
                const played = cases.get(game.n);
                if (played?.replay) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'seed-button';
                    button.textContent = '查看';
                    button.setAttribute('aria-label', '查看 N = ' + game.n + ' 的回放');
                    button.addEventListener('click', () => showReplay(played, suite.seed));
                    cell.append(button);
                }
            }
        }
        const scroll = document.createElement('div');
        scroll.className = 'table-scroll';
        scroll.append(table);
        details.append(scroll);
        return details;
    });
    container.replaceChildren(...elements);
}

export async function requestJSON(path, body) {
    const response = await fetch(path, body === undefined ? undefined : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) {
        const error = new Error(result.error || '请求失败。');
        error.details = result.details;
        throw error;
    }
    return result;
}
