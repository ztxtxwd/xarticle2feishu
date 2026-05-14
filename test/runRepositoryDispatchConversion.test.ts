import { beforeEach, describe, expect, it, vi } from 'vitest';

const createFeishuDocFromXArticle = vi.fn();
const fetchTenantAccessToken = vi.fn();
const sendFeishuWebhookMessage = vi.fn();
const appendFileSync = vi.fn();
const consoleLog = vi.fn();
const consoleWarn = vi.fn();

vi.mock('node:fs', () => ({ appendFileSync }));
vi.mock('../src/index.js', () => ({
  createFeishuDocFromXArticle,
  fetchTenantAccessToken,
  sendFeishuWebhookMessage,
}));

function setBaseEnv(): void {
  process.env.ARTICLE_URL = 'https://x.com/demo/status/1';
  process.env.FEISHU_MCP_SERVER_URL = 'https://mcp.example.com';
  process.env.FEISHU_BOT_APP_ID = 'app-id';
  process.env.FEISHU_BOT_APP_SECRET = 'app-secret';
  process.env.FEISHU_WEBHOOK_URL = 'https://example.com/hook';
  process.env.GITHUB_OUTPUT = '/tmp/github-output';
  process.env.GITHUB_STEP_SUMMARY = '/tmp/github-summary';
  process.env.GITHUB_SERVER_URL = 'https://github.com';
  process.env.GITHUB_REPOSITORY = 'owner/repo';
  process.env.GITHUB_RUN_ID = '123';
}

describe('runRepositoryDispatchConversion', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal('console', {
      ...console,
      log: consoleLog,
      warn: consoleWarn,
    });

    delete process.env.ARTICLE_URL;
    delete process.env.FEISHU_MCP_SERVER_URL;
    delete process.env.FEISHU_BOT_APP_ID;
    delete process.env.FEISHU_BOT_APP_SECRET;
    delete process.env.FEISHU_WEBHOOK_URL;
    delete process.env.GITHUB_OUTPUT;
    delete process.env.GITHUB_STEP_SUMMARY;
    delete process.env.GITHUB_SERVER_URL;
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_RUN_ID;
    delete process.env.EXISTING_DOCUMENT_URL;

    setBaseEnv();
    fetchTenantAccessToken.mockResolvedValue({ tenantAccessToken: 'tenant-token' });
    createFeishuDocFromXArticle.mockResolvedValue({ docUrl: 'https://li.feishu.cn/docx/doc-123' });
    sendFeishuWebhookMessage.mockResolvedValue(undefined);
  });

  it('sends only the document link when conversion succeeds', async () => {
    await import('../src/cli/runRepositoryDispatchConversion.ts');

    expect(sendFeishuWebhookMessage).toHaveBeenCalledWith({
      webhookUrl: 'https://example.com/hook',
      title: '',
      lines: ['https://li.feishu.cn/docx/doc-123'],
    });
  });

  it('sends a Chinese failure message when conversion fails', async () => {
    createFeishuDocFromXArticle.mockRejectedValue(new Error('remote mcp timeout'));

    await expect(import('../src/cli/runRepositoryDispatchConversion.ts')).rejects.toThrow('remote mcp timeout');

    expect(sendFeishuWebhookMessage).toHaveBeenCalledWith({
      webhookUrl: 'https://example.com/hook',
      title: '文章转飞书文档失败',
      lines: ['失败详情：remote mcp timeout'],
    });
  });
});
