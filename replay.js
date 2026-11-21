import { replayFrame } from './replay-state.mjs';
export { replayFrame };

const width = 20;
const directions = { W: '上', A: '左', S: '下', D: '右' };
const reasons = { reverse: '反向移动', wall: '撞墙', obstacle: '撞障碍', body: '撞蛇身' };

const panel = document.getElementById('replay-panel');
const board = document.getElementById('board');
const slider = document.getElementById('replay-step');
const meta = document.getElementById('replay-meta');
const stateLabel = document.getElementById('replay-state');
const previous = document.getElementById('previous-step');
const next = document.getElementById('next-step');
const play = document.getElementById('play-replay');
let current;
let timer;

function stop() {
    clearInterval(timer);
    timer = undefined;
    play.textContent = '播放';
}

export function closeReplay() {
    stop();
    panel.hidden = true;
}

function render() {
    const { n, replay, error } = current;
    const step = Number(slider.value);
    const last = step === replay.moves.length;
    const { terrain, body, food, score } = replayFrame(replay, n, step);
    const ctx = board.getContext('2d');
    const px = board.width / width;
    function paint(index, color, inset = 1) {
        ctx.fillStyle = color;
        ctx.fillRect(index % width * px + inset, Math.floor(index / width) * px + inset,
            px - 2 * inset, px - 2 * inset);
    }
    ctx.fillStyle = '#dce3d4';
    ctx.fillRect(0, 0, board.width, board.height);
    terrain.forEach((cell, index) => paint(index, cell === '#' ? '#394352' : cell === 'O' ? '#697181' : '#f6f8ef'));
    body.forEach((index, i) => paint(index, i === 0 ? '#155f39' : '#73ab50', 2));
    if (food >= 0) paint(food, '#f1be42', 3);
    const attempted = last ? replay.attempted : null;
    if (attempted) {
        ctx.strokeStyle = '#b6372c';
        ctx.lineWidth = 3;
        ctx.strokeRect(attempted.col * px + 2, attempted.row * px + 2, px - 4, px - 4);
    }
    const action = attempted ? ' · 向' + directions[attempted.direction] + ' · ' + reasons[attempted.reason] :
        step ? ' · 本步向' + directions[replay.moves[step - 1][0]] : '';
    stateLabel.textContent = '第 ' + step + ' / ' + replay.moves.length + ' 步 · 得分 ' + score +
        action + (last && error ? ' · 输出校验异常' : '');
    slider.setAttribute('aria-valuetext', stateLabel.textContent);
    previous.disabled = step === 0;
    next.disabled = last;
    play.disabled = replay.moves.length === 0;
    if (last) stop();
}

export function openReplay(entry, seed, label) {
    stop();
    current = entry;
    slider.max = entry.replay.moves.length;
    slider.value = 0;
    meta.textContent = '方案 ' + label + ' · 种子 ' + seed + ' · N = ' + entry.n;
    panel.hidden = false;
    render();
    panel.scrollIntoView({ block: 'nearest' });
}

slider.addEventListener('input', () => { stop(); render(); });
previous.addEventListener('click', () => { stop(); slider.stepDown(); render(); });
next.addEventListener('click', () => { stop(); slider.stepUp(); render(); });
play.addEventListener('click', () => {
    if (timer) { stop(); return; }
    if (slider.value === slider.max) slider.value = 0;
    render();
    play.textContent = '暂停';
    timer = setInterval(() => { slider.stepUp(); render(); }, 140);
});
