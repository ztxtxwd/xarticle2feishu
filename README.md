# xarticle2feishu

把 `x.com` / `twitter.com` 的 **Article 帖子**转换为飞书文档。

> **v0.3.0 起不再依赖 Feishu MCP Server，全部改为通过 `tenant_access_token` 直连飞书开放平台 OpenAPI。** 入参 `feishuMcpServerUrl` 已移除，新增必填 `ownerOpenId`。

该库会：

1. 通过 `fxtwitter` 拉取 X 帖子的 article 数据。
2. 将 article 内容归一化为中间结构。
3. 映射为飞书文档块。
4. 通过飞书开放平台直接 HTTP 创建文档与正文块（不再写到指定文件夹，落在应用根目录）。
5. 通过飞书开放平台上传图片 / 视频文件，并替换占位块。
6. 把新建文档的所有者转移给指定用户 `openId`（仅新建路径；复用已有文档时跳过）。

这是一个 **程序化调用的 TypeScript 库**，同时仓库内也提供了一个可被外部触发的 GitHub Actions 工作流，用于把 X 文章自动转换成飞书文档。

## 功能特性

- 直接通过 `tenant_access_token` 调用飞书开放平台 OpenAPI，不再依赖 MCP server。
- 支持解析 `x.com` / `twitter.com` 状态页链接。
- 支持将 article 内容写入飞书文档。
- 支持把新建文档的所有者转移给指定用户 `openId`（机器人保留可管理权限）。
- 支持常见文本样式：
  - 段落
  - 一级 / 二级标题
  - 无序列表 / 有序列表
  - 引用
  - 分割线
  - 链接
  - 粗体 / 斜体
- 支持图片上传并替换为飞书原生图片块。
- 支持视频文件上传，并以飞书文件视图块方式插入。
- 支持将 fenced markdown code block 转成飞书代码块。
- 支持使用飞书 `app_id` / `app_secret` 换取 `tenant_access_token`。
- 支持通过 `repository_dispatch` 触发 GitHub Action 执行转换。
- 支持在 Action 结束后通过飞书 webhook 机器人发送成功 / 失败通知。
- 当正文为空或所有块都被过滤时，会自动写入文档标题，避免创建空文档。

## 工作原理

核心入口是 `createFeishuDocFromXArticle()`：

- `src/fetchFxTwitterArticle.ts`：从 `https://api.fxtwitter.com` 拉取 article 数据。
- `src/mapping/normalizeArticle.ts`：把原始 article 映射成稳定的中间结构。
- `src/mapping/renderDocumentPlan.ts`：生成文档操作计划。
- `src/mapping/renderFeishuBlocks.ts`：生成飞书 `descendant.create` 所需块结构，并产出媒体上传计划。
- `src/feishuDocsHttp.ts`：直连飞书 OpenAPI 的 docx / drive 接口（创建文档、列出/批删块、创建后代块、PATCH 块、转移所有者）。
- `src/runtime/createFeishuDocFromXArticle.ts`：调用上述 HTTP 接口创建文档、上传媒体、替换占位块、转移所有者。
- `src/cli/runRepositoryDispatchConversion.ts`：作为 GitHub Action 的运行包装入口，负责取 token、执行转换、写出 summary 并发送 webhook 通知。

## 安装

```bash
npm install xarticle2feishu
```

如果你是在仓库内开发：

```bash
npm install
npm run build
```

## 运行前准备

你需要准备 3 个输入：

### 1) X Article 链接

例如：

```text
https://x.com/ashpreetbedi/status/2053885390717890757
```

注意：该项目依赖 `fxtwitter` 返回 `tweet.article`。如果目标帖子不是 article，或上游未返回 article 数据，调用会失败。

### 2) 文档新所有者的 openID

转换结束后，库会把新建文档的所有者转给这个 `openId`（仅新建路径；传了 `existingDocumentUrl` 时跳过此步）。机器人在转移后默认保留 `full_access` 协作权限，仍可继续编辑。

### 3) 飞书机器人认证信息

你可以选择以下两种方式之一：

- 直接提供 `tenant_access_token`
- 提供 `app_id` + `app_secret`，由本库调用飞书接口换取 `tenant_access_token`

该 token / 凭证用于：

- 创建文档与正文块
- 上传图片 / 文件到飞书文档
- 转移文档所有者

## 快速开始

### 直接传 tenant access token

```ts
import { createFeishuDocFromXArticle } from 'xarticle2feishu';

const result = await createFeishuDocFromXArticle({
  articleUrl: 'https://x.com/ashpreetbedi/status/2053885390717890757',
  botTenantAccessToken: process.env.FEISHU_BOT_TENANT_ACCESS_TOKEN!,
  ownerOpenId: process.env.FEISHU_DOC_OWNER_OPEN_ID!,
});

console.log(result.docUrl);
```

### 先用 app_id / app_secret 获取 tenant access token

```ts
import { createFeishuDocFromXArticle, fetchTenantAccessToken } from 'xarticle2feishu';

const { tenantAccessToken } = await fetchTenantAccessToken(
  process.env.FEISHU_BOT_APP_ID!,
  process.env.FEISHU_BOT_APP_SECRET!,
);

const result = await createFeishuDocFromXArticle({
  articleUrl: 'https://x.com/ashpreetbedi/status/2053885390717890757',
  botTenantAccessToken: tenantAccessToken,
  ownerOpenId: process.env.FEISHU_DOC_OWNER_OPEN_ID!,
});

console.log(result.docUrl);
```

返回值：

```ts
{
  docUrl: string;
}
```

## GitHub Action：外部触发转换

仓库内提供了一个可外部触发的 workflow：

- 文件：`.github/workflows/convert-x-article.yml`
- 支持事件：`repository_dispatch`、`workflow_dispatch`
- 必填参数：`articleUrl`
- 可选参数：`existingDocumentUrl`，传入已有飞书文档链接后会复用该文档并覆盖内容

另有卡片视频上传 workflow：

- 文件：`.github/workflows/upload-x-card-video.yml`
- 事件类型：`upload_x_card_video`
- 下载 MP4（≤30MB）后调用飞书 `im/v1/files` 上传，再回调 `callbackUrl` 回写 `file_key`
- payload 字段：`videoUrl`、`durationMs`、`coverImageUrl`、`callbackUrl`、`callbackToken`、`cacheKey`

### 需要配置的 GitHub Secrets

- `FEISHU_DOC_OWNER_OPEN_ID` —— 新建文档转移给的用户 openID
- `FEISHU_BOT_APP_ID`
- `FEISHU_BOT_APP_SECRET`
- `FEISHU_WEBHOOK_URL`

### dispatch payload

```json
{
  "event_type": "convert_x_article",
  "client_payload": {
    "articleUrl": "https://x.com/ashpreetbedi/status/2053885390717890757",
    "existingDocumentUrl": "https://li.feishu.cn/docx/your-existing-document"
  }
}
```

### 用 GitHub API 触发

```bash
gh api repos/ztxtxwd/xarticle2feishu/dispatches \
  --method POST \
  -f event_type=convert_x_article \
  -F client_payload:='{"articleUrl":"https://x.com/ashpreetbedi/status/2053885390717890757","existingDocumentUrl":"https://li.feishu.cn/docx/your-existing-document"}'
```

### 在 GitHub Actions 页面手动触发

```bash
gh workflow run convert-x-article.yml \
  -f articleUrl='https://x.com/ashpreetbedi/status/2053885390717890757' \
  -f existingDocumentUrl='https://li.feishu.cn/docx/your-existing-document'
```

### Action 结束后的通知

无论成功还是失败，workflow 都会尝试通过飞书 webhook 机器人发送一条文本通知：

- 成功时：只发送飞书文档链接
- 失败时：发送中文失败说明

如果 webhook 通知失败，不会覆盖主转换任务的最终状态。

## API

### `createFeishuDocFromXArticle(input)`

将 X article 转成飞书文档并返回文档链接。

```ts
type CreateFeishuDocFromXArticleInput = {
  articleUrl: string;
  botTenantAccessToken: string;
  ownerOpenId: string;
  existingDocumentUrl?: string;
};

type CreateFeishuDocFromXArticleResult = {
  docUrl: string;
};
```

### `fetchTenantAccessToken(appId, appSecret)`

通过飞书自建应用的 `app_id` / `app_secret` 获取 `tenant_access_token`。

```ts
const { tenantAccessToken, expire } = await fetchTenantAccessToken(appId, appSecret);
```

### `parseXArticleUrl(articleUrl)`

解析 X / Twitter 状态页链接，返回作者和状态 ID。

```ts
import { parseXArticleUrl } from 'xarticle2feishu';

parseXArticleUrl('https://x.com/ashpreetbedi/status/2053885390717890757');
// => { author: 'ashpreetbedi', statusId: '2053885390717890757' }
```

### `fetchFxTwitterArticle(articleUrl)`

从 `fxtwitter` 获取 article 数据。

如果返回中没有 `tweet.article`，会抛错。

### `normalizeArticle(article)`

把原始 article 转成稳定中间结构，适合做二次处理或自定义渲染。

### `renderDocumentPlan(normalizedArticle)`

把归一化内容映射成与飞书文档无关的操作序列。

### `renderFeishuBlocks(plan)`

把文档操作序列映射为飞书块结构，并返回媒体上传计划。

### `fetchBotInfo(botTenantAccessToken)`

读取当前 bot 的 `openId`。

### `sendFeishuWebhookMessage(input)`

向飞书自定义机器人 webhook 发送文本通知消息。

### `uploadImageToDocument(input)`

把图片上传到飞书文档块。

## 公开导出

当前包导出如下内容：

```ts
export { createFeishuDocFromXArticle } from './runtime/createFeishuDocFromXArticle.js';
export type {
  CreateFeishuDocFromXArticleInput,
  CreateFeishuDocFromXArticleResult,
  FeishuWebhookMessageInput,
  FeishuTenantAccessTokenResult,
  RepositoryDispatchConversionSummary,
} from './types.js';
export { parseXArticleUrl, fetchFxTwitterArticle } from './fetchFxTwitterArticle.js';
export { normalizeArticle } from './mapping/normalizeArticle.js';
export { renderDocumentPlan } from './mapping/renderDocumentPlan.js';
export { renderFeishuBlocks } from './mapping/renderFeishuBlocks.js';
export { fetchBotInfo, fetchTenantAccessToken, uploadImageToDocument } from './feishuBotHttp.js';
export { sendFeishuWebhookMessage } from './feishuWebhook.js';
```

## 飞书自建应用所需权限

应用至少需要以下权限：

- 创建及编辑新版文档（`docx:document`）
- 转移云文档的所有权（`drive:drive` 的相关位）
- 上传 / 下载素材（媒体上传所用）
- `bot:read` 等用于 `fetchBotInfo` 的权限（仅当你单独调用该导出函数时需要）

## 内容映射规则

当前映射大致如下：

- `unstyled` → 段落
- `header-one` → 一级标题
- `header-two` → 二级标题
- `unordered-list-item` → 无序列表
- `ordered-list-item` → 有序列表
- `blockquote` → 引用
- `atomic + DIVIDER` → 分割线
- `atomic + MEDIA(image)` → 图片
- `atomic + MEDIA(video)` → 视频文件块
- `MARKDOWN` 且内容为 fenced code block → 飞书代码块
- 未识别但有文本的块 → 普通段落
- 空文本块 → 过滤，不写入飞书

文档头部还会额外生成：

- 标题
- 作者信息
- 原文链接
- 封面图（如果 article 提供）

## 限制与注意事项

- 只支持 `x.com` / `twitter.com` 状态页 URL。
- 依赖 `fxtwitter` 返回 `tweet.article`；普通推文不保证可用。
- 依赖飞书自建应用具备文档创建 / 编辑、转移所有者、媒体上传等权限。
- 图片 / 视频需要 bot token 具备对应文档与素材上传权限。
- GitHub Action 外部触发模式当前只支持 `repository_dispatch`。
- 运行时依赖原生 `fetch` / `FormData` / `Blob`，建议使用 **Node.js 18+**。
- 视频当前会以文件视图方式插入，而不是播放器嵌入。
- 链接会在写入飞书前做 URL 编码，以适配飞书文本元素格式。

## 开发

安装依赖：

```bash
npm install
```

类型检查：

```bash
npm run check
```

构建：

```bash
npm run build
```

运行测试：

```bash
npm run test
```

监听测试：

```bash
npm run test:watch
```

## 测试覆盖

当前仓库内包含的测试主要覆盖：

- `parseXArticleUrl()` 链接解析
- article fixture 到中间结构的归一化
- document plan 生成
- Feishu blocks 渲染
- markdown fenced code block 映射
- 原生图片占位块与上传计划
- 飞书媒体上传 HTTP 流程
- tenant access token 获取
- 飞书 webhook 文本消息发送

测试样例数据见：

- `test/article.fixture.json`

## 示例：在仓库内直接运行

如果你正在本仓库里调试，可以先构建，再直接用 Node 调用编译产物：

```bash
npm run build
node --input-type=module -e "import { createFeishuDocFromXArticle } from './dist/src/runtime/createFeishuDocFromXArticle.js'; const result = await createFeishuDocFromXArticle({ articleUrl: 'https://x.com/ashpreetbedi/status/2053885390717890757', botTenantAccessToken: process.env.FEISHU_BOT_TENANT_ACCESS_TOKEN, ownerOpenId: process.env.FEISHU_DOC_OWNER_OPEN_ID }); console.log(result.docUrl);"
```

## License

MIT
