import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const draftLifetime = 60 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function randomLadderSeeds() {
    const seeds = new Set();
    while (seeds.size < 10) seeds.add(randomBytes(4).readUInt32LE());
    return [...seeds];
}

export function createLadder(directory) {
    const drafts = new Map();
    const publishing = new Set();

    async function read(id) {
        if (!uuid.test(id)) return null;
        try {
            return JSON.parse(await readFile(join(directory, id + '.json'), 'utf8'));
        } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
        }
    }

    async function list() {
        let files;
        try {
            files = await readdir(directory);
        } catch (error) {
            if (error.code === 'ENOENT') return [];
            throw error;
        }
        const rows = [];
        for (const name of files) {
            if (!name.endsWith('.json') || !uuid.test(name.slice(0, -5))) continue;
            const entry = await read(name.slice(0, -5));
            if (!entry) continue;
            const { id, nickname, model, score, bestSeed, createdAt } = entry;
            rows.push({ id, nickname, model, score, bestSeed, createdAt });
        }
        return rows.sort((a, b) => b.score - a.score ||
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    }

    function addDraft(nickname, model, code, evaluation) {
        if (!evaluation.best) return null;
        const now = Date.now();
        for (const [id, draft] of drafts) {
            if (!publishing.has(id) && (now >= draft.expires || drafts.size >= 20)) drafts.delete(id);
        }
        const id = randomUUID();
        drafts.set(id, { expires: now + draftLifetime, entry: {
            id, nickname, model, code,
            score: evaluation.best.weightedTotal,
            bestSeed: evaluation.best.seed,
            suites: evaluation.suites,
            best: evaluation.best,
        } });
        return id;
    }

    async function publish(id) {
        if (publishing.has(id)) return { busy: true };
        publishing.add(id);
        try {
            const saved = await read(id);
            if (saved) return { id };
            const draft = drafts.get(id);
            if (!draft || Date.now() >= draft.expires) {
                drafts.delete(id);
                return null;
            }
            const entry = { ...draft.entry, createdAt: new Date().toISOString() };
            await mkdir(directory, { recursive: true });
            const pending = join(directory, id + '.tmp');
            try {
                await writeFile(pending, JSON.stringify(entry), { encoding: 'utf8', flag: 'wx' });
                await rename(pending, join(directory, id + '.json'));
            } catch (error) {
                if (error.code !== 'EEXIST') await rm(pending, { force: true });
                throw error;
            }
            drafts.delete(id);
            return { id };
        } finally {
            publishing.delete(id);
        }
    }

    return { read, list, addDraft, publish };
}
