# 共享天梯部署

公开前端仍由 GitHub Pages 发布。Cloudflare Worker 存储和读取共享成绩，D1 保存昵称、模型、源码、十组分数和最高分组回放。

## Cloudflare

在仓库根目录使用 Wrangler 登录你自己的 Cloudflare 账号，然后运行下面的命令。将第一条命令输出的数据库 ID 填入 `wrangler.toml` 的 `database_id`。如果控制台要求设置 `workers.dev` 子域名，在账号中启用它。

```bash
npx wrangler d1 create snake-ladder
npx wrangler d1 execute snake-ladder --remote --file=snake-ladder-schema.sql
npx wrangler secret put CHALLENGE_KEY
npx wrangler deploy
```

`CHALLENGE_KEY` 输入随机生成的密钥，例如用 `node -p "require('node:crypto').randomBytes(32).toString('hex')"` 生成。密钥只保存在 Cloudflare Worker Secret。

## GitHub Pages

1. 在仓库的 Settings → Secrets and variables → Actions → Variables 中添加 `SNAKE_LADDER_API`。填写 Worker 的 HTTPS 地址，例如 `https://snake-ladder.example.workers.dev`，无需路径。
2. 在 Actions 中重新运行 **Publish Snake OJ and shared ladder**。部署后从首页点「天梯榜」，然后点「我要打天梯」。
3. 在浏览器中完成一次提交，打开榜单详情和回放。确认提交所用的浏览器能看到「删除我的记录」。

如果数据库建于删除功能上线前，在部署新版 Worker 前执行下列迁移。使用当前 schema 新建的数据库已包含这两列。

```sql
ALTER TABLE entries ADD COLUMN owner_digest TEXT;
ALTER TABLE entries ADD COLUMN deleted_at TEXT;
```

删除凭证保存在提交时所用的浏览器。数据库存储凭证的哈希，删除后的记录从公开列表和详情移除。旧成绩没有删除凭证，可由管理员在数据库中设置 `deleted_at`。

后端为每轮随机分配十个种子、重算加权分并校验提交格式。C++ 在参赛者的浏览器运行，因此榜单成绩源自浏览器上报。
