import { closeReplay, openReplay } from './replay.js';

const get = id => document.getElementById(id);
const source = get('source');
const comparisonSource = get('source-b');
const lineNumbers = get('line-numbers');
const run = get('run');
const seedInput = get('seed');
const randomSeed = get('random-seed');
const presetBatch = get('preset-batch');
const status = get('status');
const diagnostics = get('diagnostics');
const caseTable = get('cases');
const resultSelect = get('result-select');
const presets = [...get('seed-presets').options].map(option => option.value);
const intervals = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
const format = n => n == null ? '—' : n.toFixed(4);
let busy = false;
let reportData;
let selectable = [];

function updateEditor() {
    lineNumbers.textContent = Array.from({ length: source.value.split('\n').length },
        (_, i) => String(i + 1)).join('\n');
    lineNumbers.scrollTop = source.scrollTop;
    run.disabled = busy || !source.value.trim();
}

function report(message, isError = false) {
    status.textContent = message;
    status.dataset.error = String(isError);
}

function makeRow(values, tag = 'td') {
    const row = document.createElement('tr');
    for (const value of values) {
        const cell = document.createElement(tag);
        cell.textContent = value;
        if (tag === 'th') cell.scope = 'col';
        row.append(cell);
    }
    return row;
}

function showResults(selected) {
    closeReplay();
    const results = selected?.suite;
    const byN = new Map((results?.cases ?? []).map(result => [result.n, result]));
    const rows = intervals.map(n => {
        const result = byN.get(n);
        const completed = result?.status === 'collision';
        const note = completed ? '完成' : result?.error ? '异常' : result ? '步数上限' : '—';
        const row = makeRow([n, result?.score ?? '—', format(result?.weightedScore), note]);
        if (result) row.className = completed ? 'complete' : 'failed';
        const action = document.createElement('td');
        action.textContent = '—';
        if (result?.replay) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'seed-button';
            button.textContent = '查看';
            button.setAttribute('aria-label', '查看 N = ' + n + ' 的回放');
            button.addEventListener('click', () => openReplay(result, results.seed, selected.label));
            action.replaceChildren(button);
        }
        row.append(action);
        return row;
    });
    caseTable.replaceChildren(...rows);
    get('weighted-total').textContent = format(results?.weightedTotal);
    get('raw-total').textContent = results?.rawTotal ?? '—';
}

function showBatch(data) {
    reportData = data;
    selectable = data?.submissions.flatMap(submission =>
        (submission.suites ?? []).map(suite => ({ label: submission.label, suite }))) ?? [];
    const options = selectable.map(({ label, suite }, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = label + ' · 种子 ' + suite.seed;
        return option;
    });
    resultSelect.replaceChildren(...options);
    resultSelect.value = '0';
    get('result-tools').hidden = !selectable.length;
    get('comparison').hidden = !data || (data.seeds.length === 1 && data.submissions.length === 1);
    showResults(selectable[0]);
    if (!data) return;

    const maps = data.submissions.map(entry => new Map((entry.suites ?? [])
        .map(suite => [suite.seed, suite.weightedTotal])));
    const compare = maps.length === 2;
    const header = ['种子', ...data.submissions.map(entry => '方案 ' + entry.label)];
    if (compare) header.push('B − A');
    get('batch-head').replaceChildren(makeRow(header, 'th'));
    get('batch-rows').replaceChildren(...data.seeds.map(seed => {
        const scores = maps.map(scored => scored.get(seed));
        const values = [seed, ...scores.map(format)];
        if (compare) values.push(scores.every(score => score != null) ? format(scores[1] - scores[0]) : '—');
        return makeRow(values);
    }));
    const comparable = data.seeds.filter(seed => maps.every(scored => scored.get(seed) != null));
    const summaries = maps.map((scored, index) => {
        const scores = comparable.map(seed => scored.get(seed));
        const label = data.submissions[index].label;
        return scores.length ? label + ' 平均 ' + format(scores.reduce((sum, s) => sum + s, 0) / scores.length) +
            '（' + format(Math.min(...scores)) + '～' + format(Math.max(...scores)) + '）' : label + ' 无可比较总分';
    });
    get('comparison-summary').textContent = '共同完成 ' + comparable.length + '/' + data.seeds.length + ' 组 · ' + summaries.join('；');
}

async function submit({ label, code }, seeds) {
    const query = new URLSearchParams();
    for (const seed of seeds) query.append('seed', seed);
    try {
        const response = await fetch('/batch?' + query, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: code,
        });
        if (response.status === 404) throw new Error('请关闭旧窗口并重新运行 start.bat，以启用批量评测。');
        const data = await response.json();
        if (!response.ok) return { label, error: data.error || '评测请求失败。', details: data.details };
        return { label, suites: data.suites };
    } catch (error) {
        return { label, error: error.message };
    }
}

async function evaluate() {
    if (busy || !source.value.trim()) return;
    const seedParts = seedInput.value.trim().split(/[\s,，]+/);
    if (seedParts.some(value => !/^\d{1,10}$/.test(value) || Number(value) > 0xffffffff)) {
        report('种子必须是 0 到 4294967295 之间的整数。', true);
        seedInput.focus();
        return;
    }
    const seeds = [...new Set(seedParts.map(Number))];
    if (seeds.length > 8) {
        report('一次最多评测 8 个种子。', true);
        return;
    }
    const entries = [{ label: 'A', code: source.value }];
    if (comparisonSource.value.trim()) entries.push({ label: 'B', code: comparisonSource.value });
    if (entries.some(entry => new TextEncoder().encode(entry.code).length > 256 * 1024)) {
        report('每份代码最多 256 KB。', true);
        return;
    }

    busy = true;
    for (const control of [seedInput, randomSeed, presetBatch]) control.disabled = true;
    get('run-text').textContent = '评测中…';
    diagnostics.hidden = true;
    diagnostics.textContent = '';
    updateEditor();
    const data = { format: 'snake-oj-result-v1', createdAt: new Date().toISOString(), seeds, submissions: [] };
    showBatch();
    try {
        for (const entry of entries) {
            report('方案 ' + entry.label + ' 正在编译并运行 ' + seeds.length * 10 + ' 局…');
            data.submissions.push(await submit(entry, seeds));
        }
        showBatch(data);
        const messages = [];
        for (const entry of data.submissions) {
            if (entry.error) {
                messages.push(['方案 ' + entry.label + ' ' + entry.error, entry.details].filter(Boolean).join('\n'));
            }
            for (const suite of entry.suites ?? []) {
                for (const result of suite.cases) {
                    if (result.status === 'collision') continue;
                    messages.push('方案 ' + entry.label + ' · 种子 ' + suite.seed + ' · N = ' + result.n +
                        ' · ' + (result.error || '到达步数上限'));
                }
            }
        }
        const complete = selectable.filter(entry => entry.suite.weightedTotal != null).length;
        report('完成 ' + complete + '/' + entries.length * seeds.length + ' 个十局测试组。', messages.length > 0);
        diagnostics.textContent = messages.join('\n\n');
        diagnostics.hidden = !messages.length;
    } catch (error) {
        report(error.message, true);
    } finally {
        busy = false;
        for (const control of [seedInput, randomSeed, presetBatch]) control.disabled = false;
        get('run-text').textContent = '开始评测';
        updateEditor();
    }
}

source.addEventListener('input', updateEditor);
source.addEventListener('scroll', () => { lineNumbers.scrollTop = source.scrollTop; });
document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        evaluate();
    }
});
randomSeed.addEventListener('click', () => {
    seedInput.value = String(crypto.getRandomValues(new Uint32Array(1))[0]);
});
presetBatch.addEventListener('click', () => { seedInput.value = presets.join(', '); });
resultSelect.addEventListener('change', () => showResults(selectable[Number(resultSelect.value)]));
get('export').addEventListener('click', () => {
    if (!reportData) return;
    const download = document.createElement('a');
    const url = URL.createObjectURL(new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' }));
    download.href = url;
    download.download = 'snake-oj-' + Date.now() + '.json';
    download.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
run.addEventListener('click', evaluate);
showBatch();
updateEditor();
