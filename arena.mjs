import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { withCompiledSource } from './compiler.mjs';
import { DEFAULT_SEED, runSuite } from './judge.mjs';
import { replayFrame } from './replay-state.mjs';

const fixedSeeds = [DEFAULT_SEED, 104729, 271828, 314159, 8675309];
const usage = [
    'node arena.mjs check snake.cpp',
    'node arena.mjs run snake.cpp [--seeds 20261121,104729] [--out results.json]',
    'node arena.mjs show results.json <seed> <N> [step]',
].join('\n');

function readUnsigned(text) {
    if (!/^\d{1,10}$/.test(text ?? '') || Number(text) > 0xffffffff) {
        throw new Error('Expected an integer from 0 to 4294967295: ' + (text ?? ''));
    }
    return Number(text);
}

async function judge(command, sourcePath, args) {
    if (!sourcePath?.toLowerCase().endsWith('.cpp')) throw new Error('Give a C++ source file ending in .cpp.');
    let seeds = command === 'check' ? [DEFAULT_SEED] : fixedSeeds;
    let output;
    for (let i = 0; i < args.length; i += 2) {
        const [flag, value] = args.slice(i, i + 2);
        if (!value || value.startsWith('--')) throw new Error('Missing value for ' + flag);
        if (flag === '--seeds') seeds = [...new Set(value.split(',').map(x => readUnsigned(x.trim())))];
        else if (flag === '--out') output = value;
        else throw new Error('Unknown option: ' + flag);
    }
    if (output && !output.toLowerCase().endsWith('.json')) throw new Error('--out must end in .json.');
    const source = await readFile(sourcePath, 'utf8');
    if (!source.trim() || Buffer.byteLength(source) > 256 * 1024) {
        throw new Error('Source must contain code and fit within 256 KB.');
    }
    const report = await withCompiledSource(source, async executable => {
        const suites = [];
        for (const seed of seeds) suites.push(await runSuite(executable, seed, Boolean(output)));
        const complete = suites.filter(suite => suite.weightedTotal !== null);
        const totals = complete.map(suite => suite.weightedTotal);
        return {
            format: 'snake-oj-cli-v1', source: basename(sourcePath), seeds,
            complete: complete.length, requested: seeds.length,
            average: totals.length ? totals.reduce((sum, score) => sum + score, 0) / totals.length : null,
            best: totals.length ? Math.max(...totals) : null,
            suites,
        };
    });
    if (output) await writeFile(resolve(output), JSON.stringify(report, null, 2) + '\n', 'utf8');
    const summary = report.suites ? {
        ...report,
        suites: report.suites.map(suite => ({ ...suite, cases: suite.cases.map(({ replay, ...rest }) => rest) })),
    } : report;
    console.log(JSON.stringify(summary, null, 2));
    if (report.error || report.complete !== report.requested) process.exitCode = 1;
}

async function show(path, seed, n, step) {
    const report = JSON.parse(await readFile(path, 'utf8'));
    const group = report.suites?.find(suite => suite.seed === readUnsigned(seed));
    const game = group?.cases.find(entry => entry.n === readUnsigned(n));
    if (!game?.replay) throw new Error('Replay not found. Run arena.mjs run with --out first.');
    const latest = game.replay.moves.length;
    const turn = step === undefined ? latest : readUnsigned(step);
    if (turn > latest) throw new Error('Step is outside the replay. Last step: ' + latest);
    const { terrain, body, food, score } = replayFrame(game.replay, game.n, turn);
    const board = terrain.map(cell => cell === '#' || cell === 'O' ? cell : '.');
    if (food >= 0) board[food] = 'F';
    for (const segment of body) board[segment] = 'B';
    board[body[0]] = 'H';
    for (let row = 0; row < 20; row++) console.log(board.slice(row * 20, (row + 1) * 20).join(''));
    const attempted = turn === latest ? game.replay.attempted : null;
    console.log(JSON.stringify({ seed: group.seed, n: game.n, step: turn, lastStep: latest,
        score, attempted, error: turn === latest ? game.error : undefined }));
}

try {
    const [command, path, ...args] = process.argv.slice(2);
    if (!command || command === '--help' || command === '-h') console.log(usage);
    else if (command === 'check' || command === 'run') await judge(command, path, args);
    else if (command === 'show' && path && args.length >= 2 && args.length <= 3) await show(path, ...args);
    else throw new Error('Unknown command or incorrect arguments.');
} catch (error) {
    console.error(error.message + '\n' + usage);
    process.exitCode = 2;
}
