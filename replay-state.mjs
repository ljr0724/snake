const width = 20;
const delta = { W: -width, A: -1, S: width, D: 1 };
export function replayFrame(replay, n, step) {
    const terrain = replay.initial.join('').split('');
    const head = terrain.indexOf('H');
    const body = [head];
    const remaining = new Set(terrain.map((cell, index) => cell === 'B' ? index : -1).filter(index => index >= 0));
    while (remaining.size) {
        const tail = body.at(-1);
        const next = Object.values(delta).map(change => tail + change).find(index => remaining.has(index));
        if (next === undefined) break;
        body.push(next);
        remaining.delete(next);
    }
    let food = terrain.indexOf('F');
    let score = 0;
    for (let index = 0; index < step; index++) {
        const [direction, nextFood] = replay.moves[index];
        const next = body[0] + delta[direction];
        const eats = next === food;
        if (!eats && (index + 1) % n !== 0) body.pop();
        body.unshift(next);
        if (eats) {
            food = nextFood;
            score += 10;
        }
    }
    return { terrain, body, food, score };
}

