import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

const side = 20;
const steps = { W: [-1, 0], A: [0, -1], S: [1, 0], D: [0, 1] };
const reverse = { W: 'S', A: 'D', S: 'W', D: 'A' };
const intervals = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
const stepLimit = 15000;
export const DEFAULT_SEED = 20261121;

function randomFrom(seed) {
    return limit => {
        seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
        return Math.floor(seed / 4294967296 * limit);
    };
}

function pickEmpty(board, body, random) {
    const occupied = new Set(body);
    const empty = [];
    for (let p = 0; p < board.length; p++) {
        if (board[p] === '.' && !occupied.has(p)) empty.push(p);
    }
    return empty.length ? empty[random(empty.length)] : -1;
}

function formatBoard(terrain, body, food) {
    const board = [...terrain];
    if (food >= 0) board[food] = 'F';
    for (const p of body) board[p] = 'B';
    board[body[0]] = 'H';
    return Array.from({ length: side }, (_, r) =>
        board.slice(r * side, (r + 1) * side).join(''));
}

async function runCase(executable, n, seed, record) {
    const random = randomFrom(seed);
    const terrain = Array.from({ length: side * side }, (_, p) => {
        const row = Math.floor(p / side), col = p % side;
        return row === 0 || col === 0 || row === side - 1 || col === side - 1
            ? '#' : '.';
    });
    const head = (2 + random(13)) * side + 2 + random(16);
    const body = [head, head + side, head + 2 * side];
    for (let i = 0; i < 10; i++) terrain[pickEmpty(terrain, body, random)] = 'O';
    let food = pickEmpty(terrain, body, random);
    const initial = formatBoard(terrain, body, food);
    const replay = record ? { initial, moves: [], attempted: null } : undefined;
    let facing = 'W', score = 0, moved = 0;

    const child = spawn(executable, [], {
        cwd: dirname(executable), stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
    });
    child.stdin.on('error', () => {});
    const exit = new Promise(resolveExit => {
        child.once('error', error => resolveExit(error));
        child.once('close', code => resolveExit(code));
    });
    const reader = createInterface({ input: child.stdout });
    const lines = reader[Symbol.asyncIterator]();
    let outputBytes = 0;
    let interrupted;
    function interrupt(message) {
        interrupted = message;
        child.kill();
        reader.close();
    }
    child.stdout.on('data', chunk => {
        outputBytes += chunk.length;
        if (outputBytes > 1024 * 1024 && !interrupted) interrupt('Output limit exceeded');
    });
    const timeout = setTimeout(() => interrupt('Time limit exceeded (30 seconds)'), 30000);
    async function readLine() {
        const { value, done } = await lines.next();
        if (interrupted) throw new Error(interrupted);
        if (done) {
            const result = await exit;
            throw new Error(result instanceof Error ? result.message :
                'Program ended before it produced the required output');
        }
        return value;
    }

    try {
        child.stdin.write(initial.join('\n') + '\n' + n + '\n');
        for (;;) {
            const direction = await readLine();
            if (!(direction in steps) || direction.length !== 1)
                throw new Error('Invalid direction: ' + direction);
            const claimed = await readLine();
            if (claimed !== String(score))
                throw new Error('Expected score ' + score + ', got ' + claimed);

            const [dr, dc] = steps[direction];
            const row = Math.floor(body[0] / side) + dr, col = body[0] % side + dc;
            const next = row * side + col;
            const eats = next === food;
            const grows = eats || (moved + 1) % n === 0;
            const collision = direction === reverse[facing] ? 'reverse' :
                terrain[next] === '#' ? 'wall' : terrain[next] === 'O' ? 'obstacle' :
                body.includes(next) ? 'body' : null;
            if (collision) {
                if (replay) replay.attempted = { direction, row, col, reason: collision };
                child.stdin.end('100 100\n');
                const expected = [...formatBoard(terrain, body, food), String(score)];
                for (const line of expected) {
                    const actual = await readLine();
                    if (actual !== line)
                        throw new Error('Wrong final board or score: expected ' +
                                        line + ', got ' + actual);
                }
                if (!(await lines.next()).done) throw new Error('Extra output after game over');
                if (interrupted) throw new Error(interrupted);
                if (await exit !== 0) throw new Error('Program failed to exit cleanly');
                return { score, moved, status: 'collision', replay };
            }
            if (moved === stepLimit) {
                child.stdin.end();
                if (!(await lines.next()).done) throw new Error('Extra output after EOF');
                if (interrupted) throw new Error(interrupted);
                if (await exit !== 0) throw new Error('Program failed to exit at EOF');
                return { score, moved, status: 'step limit', replay };
            }

            if (!grows) body.pop();
            body.unshift(next);
            facing = direction;
            moved++;
            if (eats) {
                score += 10;
                food = pickEmpty(terrain, body, random);
            }
            if (replay) replay.moves.push([direction, eats ? food : null]);
            const reply = eats && food >= 0
                ? Math.floor(food / side) + ' ' + food % side : '20 20';
            child.stdin.write(reply + '\n');
        }
    } catch (error) {
        return { error: error.message, moved, replay };
    } finally {
        clearTimeout(timeout);
        reader.close();
        if (child.exitCode === null && child.signalCode === null) child.kill();
        await exit;
    }
}

export async function runSuite(executable, seed = DEFAULT_SEED, record = false) {
    const cases = [];
    for (const n of intervals) {
        try {
            const result = await runCase(executable, n, (seed + n) >>> 0, record);
            cases.push({ n, ...result, ...(result.error ? {} : { weightedScore: result.score / (Math.log2(n) + 1) }) });
        } catch (error) {
            cases.push({ n, error: error.message });
        }
    }
    const complete = cases.every(result => !result.error && result.status === 'collision');
    return {
        seed,
        cases,
        rawTotal: complete ? cases.reduce((sum, result) => sum + result.score, 0) : null,
        weightedTotal: complete ? cases.reduce((sum, result) => sum + result.weightedScore, 0) : null,
    };
}
