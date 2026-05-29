import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchFxTwitterArticle = vi.fn();
const uploadImageToDocument = vi.fn();
const uploadFileToDocument = vi.fn();
const createDocxDocument = vi.fn();
const resolveDocxDocumentFromUrl = vi.fn();
const clearDocxRootChildren = vi.fn();
const createDocxDescendantBlocks = vi.fn();
const patchDocxBlock = vi.fn();
const transferDocumentOwner = vi.fn();
const normalizeArticle = vi.fn();
const renderDocumentPlan = vi.fn();
const renderFeishuBlocks = vi.fn();

vi.mock('../src/fetchFxTwitterArticle.js', () => ({ fetchFxTwitterArticle }));
vi.mock('../src/feishuBotHttp.js', () => ({
  uploadImageToDocument,
  uploadFileToDocument,
}));
vi.mock('../src/feishuDocsHttp.js', () => ({
  createDocxDocument,
  resolveDocxDocumentFromUrl,
  clearDocxRootChildren,
  createDocxDescendantBlocks,
  patchDocxBlock,
  transferDocumentOwner,
}));
vi.mock('../src/mapping/normalizeArticle.js', () => ({ normalizeArticle }));
vi.mock('../src/mapping/renderDocumentPlan.js', () => ({ renderDocumentPlan }));
vi.mock('../src/mapping/renderFeishuBlocks.js', () => ({ renderFeishuBlocks }));

const { createFeishuDocFromXArticle } = await import('../src/runtime/createFeishuDocFromXArticle.js');

describe('createFeishuDocFromXArticle', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    fetchFxTwitterArticle.mockResolvedValue({ id: 'tweet' });
    normalizeArticle.mockReturnValue({ title: 'Article title' });
    renderDocumentPlan.mockReturnValue({ title: 'Article title' });
    renderFeishuBlocks.mockReturnValue({ childrenId: [], descendants: [], nativeImages: [], nativeFiles: [] });
    createDocxDocument.mockResolvedValue({ documentId: 'new-doc', docUrl: 'https://li.feishu.cn/docx/new-doc' });
    resolveDocxDocumentFromUrl.mockReturnValue({ documentId: 'existing-doc', docUrl: 'https://li.feishu.cn/docx/existing-doc' });
    clearDocxRootChildren.mockResolvedValue(undefined);
    createDocxDescendantBlocks.mockResolvedValue([]);
    patchDocxBlock.mockResolvedValue(undefined);
    transferDocumentOwner.mockResolvedValue(undefined);
    uploadImageToDocument.mockResolvedValue({ fileToken: 'image-token' });
    uploadFileToDocument.mockResolvedValue({ fileToken: 'file-token' });
  });

  it('creates a new document and transfers ownership when no existing URL is provided', async () => {
    const result = await createFeishuDocFromXArticle({
      articleUrl: 'https://x.com/demo/status/1',
      botTenantAccessToken: 'tenant-token',
      ownerOpenId: 'ou_test',
    });

    expect(createDocxDocument).toHaveBeenCalledWith({
      title: 'Article title',
      botTenantAccessToken: 'tenant-token',
    });
    expect(clearDocxRootChildren).not.toHaveBeenCalled();
    expect(createDocxDescendantBlocks).toHaveBeenCalledWith({
      documentId: 'new-doc',
      blockId: 'new-doc',
      request: { childrenId: [], descendants: [], nativeImages: [], nativeFiles: [] },
      botTenantAccessToken: 'tenant-token',
    });
    expect(transferDocumentOwner).toHaveBeenCalledWith({
      documentId: 'new-doc',
      ownerOpenId: 'ou_test',
      botTenantAccessToken: 'tenant-token',
    });
    expect(result).toEqual({ docUrl: 'https://li.feishu.cn/docx/new-doc' });
  });

  it('reuses and clears an existing document, skipping ownership transfer', async () => {
    const result = await createFeishuDocFromXArticle({
      articleUrl: 'https://x.com/demo/status/1',
      botTenantAccessToken: 'tenant-token',
      ownerOpenId: 'ou_test',
      existingDocumentUrl: 'https://li.feishu.cn/docx/existing-doc?from=share',
    });

    expect(resolveDocxDocumentFromUrl).toHaveBeenCalledWith('https://li.feishu.cn/docx/existing-doc?from=share');
    expect(createDocxDocument).not.toHaveBeenCalled();
    expect(clearDocxRootChildren).toHaveBeenCalledWith({
      documentId: 'existing-doc',
      botTenantAccessToken: 'tenant-token',
    });
    expect(createDocxDescendantBlocks).toHaveBeenCalledWith({
      documentId: 'existing-doc',
      blockId: 'existing-doc',
      request: { childrenId: [], descendants: [], nativeImages: [], nativeFiles: [] },
      botTenantAccessToken: 'tenant-token',
    });
    expect(transferDocumentOwner).not.toHaveBeenCalled();
    expect(result).toEqual({ docUrl: 'https://li.feishu.cn/docx/existing-doc' });
    expect(clearDocxRootChildren.mock.invocationCallOrder[0]).toBeLessThan(
      createDocxDescendantBlocks.mock.invocationCallOrder[0],
    );
  });
});
