import { fillTestRecords, requestJSON, scoreText } from './ladder-results.js';

const get = id => document.getElementById(id);
const dialog = get('identity-dialog');
const nickname = get('nickname');
const model = get('model');
const source = get('ladder-source');
const run = get('ladder-run');
const upload = get('ladder-upload');
const published = get('published-link');
const status = get('ladder-run-status');
const uploadStatus = get('upload-status');
const details = get('run-error');
const result = get('ladder-result');
let identity;
let draft;
let busy = false;

const sharedUpload = document.createElement('a');
sharedUpload.className = 'secondary-link';
sharedUpload.target = '_blank';
sharedUpload.rel = 'noopener noreferrer';
sharedUpload.textContent = '提交到共享榜单';
sharedUpload.hidden = true;
upload.after(sharedUpload);

function sharedIssue(data) {
    const best = data.suites.find(suite => suite.seed === data.bestSeed);
    if (!best || best.weightedTotal === null) return null;
    const ns = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
    const raw = ns.map(n => best.cases.find(game => game.n === n)?.score);
    if (!raw.every(Number.isSafeInteger)) return null;
    const metadata = encodeURIComponent(JSON.stringify({
        ...identity, seed: best.seed, raw,
    })).replace(/-/g, '%2D');
    const body = ['<!-- snake-oj-score-v1 ' + metadata + ' -->', '',
        '本机测评成绩（自报）', '', '种子：' + best.seed,
        '加权分：' + scoreText(data.score), '', '| N | 原始分 |', '| --- | --- |',
        ...ns.map((n, i) => '| ' + n + ' | ' + raw[i] + ' |')].join('\n');
    const issue = new URL('https://github.com/ljr0724/snake/issues/new');
    issue.search = new URLSearchParams({title: '[Snake OJ] 天梯成绩', body});
    return issue.href;
}


function updateControls() {
    run.disabled = busy || !identity || !source.value.trim();
    upload.disabled = busy;
    source.readOnly = busy;
}

get('anonymous').addEventListener('click', () => {
    const random = crypto.getRandomValues(new Uint32Array(10));
    nickname.value = '用户' + Array.from(random, number => Math.floor(number / 4294967296 * 10)).join('');
    nickname.setCustomValidity('');
    model.focus();
});

dialog.addEventListener('cancel', event => event.preventDefault());
for (const field of [nickname, model]) field.addEventListener('input', () => field.setCustomValidity(''));
get('identity-form').addEventListener('submit', event => {
    event.preventDefault();
    for (const field of [nickname, model]) {
        if (field.value.trim()) continue;
        field.setCustomValidity('请填写这一栏。');
        field.reportValidity();
        return;
    }
    identity = { nickname: nickname.value.trim(), model: model.value.trim() };
    get('identity-text').textContent = identity.nickname + ' · ' + identity.model;
    dialog.close();
    updateControls();
    source.focus();
});

source.addEventListener('input', () => {
    sharedUpload.hidden = true;
    if (draft) {
        draft = undefined;
        upload.hidden = true;
        uploadStatus.textContent = '代码已修改，请重新测评后上传。';
    }
    updateControls();
});

run.addEventListener('click', async () => {
    if (busy || !identity || !source.value.trim()) return;
    busy = true;
    draft = undefined;
    upload.hidden = true;
    published.hidden = true;
    sharedUpload.hidden = true;
    result.hidden = true;
    details.hidden = true;
    uploadStatus.textContent = '';
    status.textContent = '正在编译并运行 100 局，请保持此页打开…';
    updateControls();
    try {
        const data = await requestJSON('/api/ladder/run', { ...identity, code: source.value });
        draft = data.id;
        fillTestRecords(get('test-records'), data.suites, data.bestSeed);
        get('ladder-best').textContent = data.score === null ? '没有完整完成的测试组。' :
            '最高加权分 ' + scoreText(data.score) + ' · 种子 ' + data.bestSeed;
        const complete = data.suites.filter(suite => suite.weightedTotal !== null).length;
        status.textContent = '完成 ' + complete + '/10 个测试组。';
        result.hidden = false;
        upload.hidden = !draft;
        const share = draft ? sharedIssue(data) : null;
        if (share) {
            sharedUpload.href = share;
            sharedUpload.hidden = false;
        }
        if (draft) uploadStatus.textContent = '上传后，榜单详情中可以查看昵称、模型、源码和测试记录。';
    } catch (error) {
        status.textContent = error.message;
        details.textContent = error.details ?? '';
        details.hidden = !error.details;
    } finally {
        busy = false;
        updateControls();
    }
});

upload.addEventListener('click', async () => {
    if (busy || !draft) return;
    busy = true;
    updateControls();
    uploadStatus.textContent = '正在上传…';
    try {
        const { id } = await requestJSON('/api/ladder/upload', { id: draft });
        draft = undefined;
        upload.hidden = true;
        published.href = '/ladder/entry?id=' + encodeURIComponent(id);
        published.hidden = false;
        uploadStatus.textContent = '已上传到天梯榜。';
    } catch (error) {
        uploadStatus.textContent = error.message;
    } finally {
        busy = false;
        updateControls();
    }
});

dialog.showModal();
