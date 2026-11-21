from pathlib import Path
from shutil import copyfile
import json, os, re
from urllib.parse import urlsplit
out = Path(os.environ.get('SNAKE_PAGES_OUTPUT', '_site'))
out.mkdir()
api = os.environ.get('SNAKE_LADDER_API', '').strip().rstrip('/')
if api:
    parsed = urlsplit(api)
    assert parsed.scheme == 'https' and parsed.hostname and not (parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.password), 'SNAKE_LADDER_API must be an HTTPS origin'
routes = {'/':'./', '/rules':'./rules.html', '/evaluate':'./evaluate.html',
          '/ladder':'./ladder.html' if api else './shared-ladder.html', '/ladder/play':'./ladder-play.html',
          '/ladder/entry':'./ladder-entry.html', '/prompt.md':'./AI-PROMPT.txt',
          '/ai-kit.zip':'./snake-ai-kit.zip'}
download = '<a href="https://github.com/ljr0724/snake/archive/refs/heads/main.zip">下载完整项目</a>'
online = '在浏览器中编译和评测 C++17。首次评测需加载编译器，结果可提交共享天梯。'
note = '本机运行测评后，可导出 JSON，提交到共享天梯。' + download
pages = ['index.html','rules.html','evaluate.html','ladder-play.html','ladder-entry.html']
if api:
    pages.append('ladder.html')
for name in pages:
    page = Path(name).read_text(encoding='utf-8-sig')
    page = re.sub(r'(href|src)="(/[^"]*)"', lambda m: m[1] + '="' + routes.get(m[2],'.' + m[2]) + '"', page)
    if name == 'index.html':
        start = page.index('<section class="cover-links"')
        end = page.index('</section>', start)
        page = page[:end] + f'<a class="cover-card" href="{routes["/ladder"]}"><h2>共享天梯榜</h2><p>查看和提交测评成绩。</p></a>' + page[end:]
    elif name == 'evaluate.html':
        page = page.replace('./app.js', './app-online.js')
        page = re.sub(r'(<p id="status"[^>]*>).*?(</p>)', lambda m: m[1] + online + m[2], page)
    elif name == 'ladder-play.html' and not api:
        page = re.sub(r'(<p id="ladder-run-status"[^>]*>).*?(</p>)', lambda m: m[1] + note + m[2], page)
    elif name == 'ladder-entry.html' and not api:
        page = page.replace('正在读取提交记录…', '旧版天梯详情请在本机测评台查看。')
        page = page.replace('    <script type="module" src="./ladder-view.js"></script>', '')
    if api:
        page = page.replace('./ladder-play.js', './ladder-play-online.js').replace('./ladder-view.js', './ladder-view-online.js')
        if name == 'ladder.html':
            page = page.replace('按每次提交的最高加权分排名。', '按每次提交的最高加权分排名。成绩由参赛者的浏览器评测。')
            page = page.replace('</section>', '<nav id="ladder-pages" class="page-actions" aria-label="天梯分页" hidden></nav></section>')
            page = page.replace('</header>', '<a class="secondary-link" href="./shared-ladder.html">旧版榜单</a></header>')
    (out / name).write_text(page, encoding='utf-8')
app = Path('app.js').read_text(encoding='utf-8-sig')
start = app.index('async function submit(')
end = app.index('async function evaluate(', start)
app = "import { browserEvaluate as submit } from './browser-evaluate.mjs';\n" + app[:start] + app[end:]
(out / 'app-online.js').write_text(app, encoding='utf-8')
script = Path('ladder-play.js').read_text(encoding='utf-8-sig')
if api:
    transport = "import { requestOnline as requestJSON } from './online-ladder.mjs';\n"
    (out / 'ladder-config.mjs').write_text('export const apiOrigin = ' + json.dumps(api) + ';\n', encoding='utf-8')
    copyfile('online-ladder.mjs', out / 'online-ladder.mjs')
    script = script.replace('fillTestRecords, requestJSON, scoreText', 'fillTestRecords, scoreText')
    start = script.index("const sharedUpload = ")
    end = script.index('function updateControls()', start)
    script = script[:start] + script[end:]
    script = script.replace('    sharedUpload.hidden = true;\n', '')
    start = script.index('        const share = ')
    end = script.index('        if (draft) uploadStatus', start)
    script = script[:start] + script[end:]
    script = script.replace("'/ladder/entry?id='", "'./ladder-entry.html?id='")
    script = script.replace('上传后，榜单详情中可以查看昵称、模型、源码和测试记录。', '确认后将公开昵称、模型、源码、逐局成绩和最高分组的回放。')
    (out / 'ladder-play-online.js').write_text(transport + script, encoding='utf-8')
    view = Path('ladder-view.js').read_text(encoding='utf-8-sig')
    view = view.replace('fillTestRecords, requestJSON, scoreText', 'fillTestRecords, scoreText')
    view = view.replace("'/ladder/entry?id='", "'./ladder-entry.html?id='")
    view = view.replace("const { entries } = await requestJSON('/api/ladder');", """const { entries, hasNext } = await requestJSON('/api/ladder');
        const page = Number(new URLSearchParams(location.search).get('page') || 1);
        const pages = get('ladder-pages');
        for (const [available, target, label] of [[page > 1, page - 1, '上一页'], [hasNext, page + 1, '下一页']]) {
            if (!available) continue;
            const link = document.createElement('a');
            link.href = '?page=' + target;
            link.className = 'secondary-link';
            link.textContent = label;
            pages.append(link);
        }
        pages.hidden = !pages.childElementCount;""")
    view = view.replace('[index + 1,', '[(page - 1) * 50 + index + 1,')
    (out / 'ladder-view-online.js').write_text(transport + view, encoding='utf-8')
else:
    condition = 'busy || !identity || !source.value.trim()'
    script = script.replace('run.disabled = ' + condition + ';', 'run.disabled = true;')
    script = script.replace('if (' + condition + ') return;', 'if (run.disabled || ' + condition + ') return;')
    (out / 'ladder-play.js').write_text(script, encoding='utf-8')
for name in ('shared-ladder.html','ladder-results.js','replay.js','replay-state.mjs','style.css','snake-ai-kit.zip','browser-judge.mjs','browser-evaluate.mjs'):
    copyfile(name, out / name)
shared = (out / 'shared-ladder.html').read_text(encoding='utf-8-sig')
shared = shared.replace('本机测评', '测评').replace('提交本机成绩', '提交测评成绩')
(out / 'shared-ladder.html').write_text(shared, encoding='utf-8')
if not api:
    copyfile('shared-ladder.html', out / 'ladder.html')
copyfile('AI-PROMPT.md', out / 'AI-PROMPT.txt')
for page in out.glob('*.html'):
    for target in re.findall(r'(?:href|src)="[.]/([^"]+)"', page.read_text(encoding='utf-8-sig')):
        assert (out / target).is_file(), (page, target)
