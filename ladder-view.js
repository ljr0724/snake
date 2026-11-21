import { fillTestRecords, requestJSON, scoreText } from './ladder-results.js';

const get = id => document.getElementById(id);

async function showLadder(rows) {
    try {
        const { entries } = await requestJSON('/api/ladder');
        rows.replaceChildren(...entries.map((entry, index) => {
            const row = document.createElement('tr');
            for (const value of [index + 1, entry.nickname, entry.model, scoreText(entry.score)]) {
                row.insertCell().textContent = value;
            }
            const link = document.createElement('a');
            link.href = '/ladder/entry?id=' + encodeURIComponent(entry.id);
            link.textContent = '查看详情 →';
            row.insertCell().append(link);
            return row;
        }));
        get('ladder-status').textContent = entries.length ? '' : '目前还没有成绩。跑完测评并确认上传，就会出现在这里。';
        get('ladder-status').hidden = entries.length > 0;
    } catch (error) {
        get('ladder-status').textContent = error.message;
    }
}

async function showEntry() {
    try {
        const id = new URLSearchParams(location.search).get('id') ?? '';
        const entry = await requestJSON('/api/ladder/entry?id=' + encodeURIComponent(id));
        const { openReplay } = await import('./replay.js');
        get('entry-title').textContent = entry.nickname + ' 的天梯记录';
        const date = new Date(entry.createdAt).toLocaleString('zh-CN');
        get('entry-status').textContent = entry.model + ' · 最高加权分 ' + scoreText(entry.score) + ' · ' + date;
        get('entry-code').textContent = entry.code;
        fillTestRecords(get('entry-records'), entry.suites, entry.bestSeed, entry.best,
            (played, seed) => openReplay(played, seed, entry.nickname));
        get('entry-content').hidden = false;
    } catch (error) {
        get('entry-status').textContent = error.message;
    }
}

const table = get('ladder-rows');
if (table) showLadder(table);
else showEntry();
