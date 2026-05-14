import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchFxTwitterArticle = vi.fn();
const fetchBotInfo = vi.fn();
const uploadImageToDocument = vi.fn();
const uploadFileToDocument = vi.fn();
const connectFeishuMcp = vi.fn();
const createFeishuTools = vi.fn();
const normalizeArticle = vi.fn();
const renderDocumentPlan = vi.fn();
const renderFeishuBlocks = vi.fn();

vi.mock('../src/fetchFxTwitterArticle.js', () => ({ fetchFxTwitterArticle }));
vi.mock('../src/feishuBotHttp.js', () => ({
  fetchBotInfo,
  uploadImageToDocument,
  uploadFileToDocument,
}));
vi.mock('../src/mcp/connectFeishuMcp.js', () => ({ connectFeishuMcp }));
vi.mock('../src/mapping/normalizeArticle.js', () => ({ normalizeArticle }));
vi.mock('../src/mapping/renderDocumentPlan.js', () => ({ renderDocumentPlan }));
vi.mock('../src/mapping/renderFeishuBlocks.js', () => ({ renderFeishuBlocks }));
vi.mock('../src/mcp/feishuTools.js', () => ({
  FeishuTools: {
    create: createFeishuTools,
  },
}));

const { createFeishuDocFromXArticle } = await import('../src/runtime/createFeishuDocFromXArticle.js');

describe('createFeishuDocFromXArticle', () => {
  const transport = { close: vi.fn() };
  const feishuTools = {
    createDocument: vi.fn(),
    resolveDocumentFromUrl: vi.fn(),
    clearDocumentRootChildren: vi.fn(),
    createDescendantBlocks: vi.fn(),
    grantDocumentPermission: vi.fn(),
    replaceImage: vi.fn(),
    replaceFile: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();

    transport.close.mockResolvedValue(undefined);
    fetchFxTwitterArticle.mockResolvedValue({ id: 'tweet' });
    normalizeArticle.mockReturnValue({ title: 'Article title' });
    renderDocumentPlan.mockReturnValue({ title: 'Article title' });
    renderFeishuBlocks.mockReturnValue({ childrenId: [], descendants: [], nativeImages: [], nativeFiles: [] });
    connectFeishuMcp.mockResolvedValue({ client: {}, transport });
    createFeishuTools.mockResolvedValue(feishuTools);
    feishuTools.createDocument.mockResolvedValue({ documentId: 'new-doc', docUrl: 'https://li.feishu.cn/docx/new-doc' });
    feishuTools.resolveDocumentFromUrl.mockReturnValue({ documentId: 'existing-doc', docUrl: 'https://li.feishu.cn/docx/existing-doc' });
    feishuTools.createDescendantBlocks.mockResolvedValue([]);
    feishuTools.clearDocumentRootChildren.mockResolvedValue(undefined);
    feishuTools.grantDocumentPermission.mockResolvedValue(undefined);
    feishuTools.replaceImage.mockResolvedValue(undefined);
    feishuTools.replaceFile.mockResolvedValue(undefined);
    fetchBotInfo.mockResolvedValue({ openId: 'open-id' });
    uploadImageToDocument.mockResolvedValue({ fileToken: 'image-token' });
    uploadFileToDocument.mockResolvedValue({ fileToken: 'file-token' });
  });

  it('creates a new document when no existing document URL is provided', async () => {
    const result = await createFeishuDocFromXArticle({
      articleUrl: 'https://x.com/demo/status/1',
      feishuMcpServerUrl: 'https://mcp.example.com',
      botTenantAccessToken: 'tenant-token',
    });

    expect(feishuTools.createDocument).toHaveBeenCalledWith('Article title');
    expect(feishuTools.clearDocumentRootChildren).not.toHaveBeenCalled();
    expect(feishuTools.createDescendantBlocks).toHaveBeenCalledWith('new-doc', {
      childrenId: [],
      descendants: [],
      nativeImages: [],
      nativeFiles: [],
    });
    expect(result).toEqual({ docUrl: 'https://li.feishu.cn/docx/new-doc' });
  });

  it('reuses and clears an existing document before creating blocks', async () => {
    const result = await createFeishuDocFromXArticle({
      articleUrl: 'https://x.com/demo/status/1',
      feishuMcpServerUrl: 'https://mcp.example.com',
      botTenantAccessToken: 'tenant-token',
      existingDocumentUrl: 'https://li.feishu.cn/docx/existing-doc?from=share',
    });

    expect(feishuTools.resolveDocumentFromUrl).toHaveBeenCalledWith('https://li.feishu.cn/docx/existing-doc?from=share');
    expect(feishuTools.createDocument).not.toHaveBeenCalled();
    expect(feishuTools.clearDocumentRootChildren).toHaveBeenCalledWith('existing-doc');
    expect(feishuTools.createDescendantBlocks).toHaveBeenCalledWith('existing-doc', {
      childrenId: [],
      descendants: [],
      nativeImages: [],
      nativeFiles: [],
    });
    expect(result).toEqual({ docUrl: 'https://li.feishu.cn/docx/existing-doc' });
    expect(feishuTools.clearDocumentRootChildren.mock.invocationCallOrder[0]).toBeLessThan(
      feishuTools.createDescendantBlocks.mock.invocationCallOrder[0],
    );
  });
});

