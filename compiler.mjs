import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function withCompiledSource(source, evaluate) {
    const directory = await mkdtemp(join(tmpdir(), 'snake-oj-'));
    try {
        const executable = join(directory, process.platform === 'win32' ? 'submission.exe' : 'submission');
        await writeFile(join(directory, 'submission.cpp'), source, 'utf8');
        try {
            await execute(process.env.CXX || 'g++', ['-std=c++17', '-O2', 'submission.cpp', '-o', executable], {
                cwd: directory, timeout: 30000, maxBuffer: 256 * 1024, windowsHide: true,
            });
        } catch (error) {
            if (error.code === 'ENOENT') return { error: '找不到 C++ 编译器，请检查 g++ 或环境变量 CXX。' };
            if (error.killed) return { error: '编译超过 30 秒。' };
            return { error: '编译失败', details: (error.stderr || error.message).slice(0, 16000) };
        }
        return await evaluate(executable);
    } finally {
        await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
}
