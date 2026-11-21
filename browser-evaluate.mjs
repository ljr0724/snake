const intervals = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];

function request(worker, data, timeout, timeoutMessage) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error(timeoutMessage));
        }, timeout);
        worker.onmessage = ({ data }) => {
            clearTimeout(timer);
            if (data.error) reject(Object.assign(new Error(data.error), { details: data.details }));
            else resolve(data.result);
        };
        worker.onerror = () => {
            clearTimeout(timer);
            reject(new Error('无法启动在线评测，请刷新页面后重试。'));
        };
        worker.postMessage(data);
    });
}

function newWorker() {
    return new Worker(new URL('./browser-judge.mjs', import.meta.url), { type: 'module' });
}

export async function browserEvaluate({ label, code }, seeds) {
    let worker;
    try {
        worker = newWorker();
        const module = await request(worker, { type: 'compile', source: code }, 120000, '在线编译超时。');
        worker.terminate();
        worker = newWorker();
        const suites = [];
        for (const seed of seeds) {
            const cases = [];
            for (const n of intervals) {
                try {
                    cases.push(await request(worker, { type: 'run', module, n, seed }, 30000, '单局超过 30 秒。'));
                } catch (error) {
                    worker.terminate();
                    worker = newWorker();
                    cases.push({ n, error: error.message });
                }
            }
            const complete = cases.every(result => result.status === 'collision');
            suites.push({
                seed, cases,
                rawTotal: complete ? cases.reduce((sum, result) => sum + result.score, 0) : null,
                weightedTotal: complete ? cases.reduce((sum, result) => sum + result.weightedScore, 0) : null,
            });
        }
        return { label, suites };
    } catch (error) {
        return { label, error: error.message, details: error.details };
    } finally {
        worker?.terminate();
    }
}
