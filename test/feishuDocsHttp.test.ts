import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  batchDeleteDocxBlockChildren,
  clearDocxRootChildren,
  createDocxDescendantBlocks,
  createDocxDocument,
  patchDocxBlock,
  resolveDocxDocumentFromUrl,
  transferDocumentOwner,
} from '../src/feishuDocsHttp.js';

const fetchMock = vi.fn();

function jsonResponse(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resolveDocxDocumentFromUrl', () => {
  it('parses and canonicalizes Feishu doc URLs', () => {
    expect(resolveDocxDocumentFromUrl('https://li.feishu.cn/docx/doxcn123/?from=share#abc')).toEqual({
      documentId: 'doxcn123',
      docUrl: 'https://li.feishu.cn/docx/doxcn123',
    });
  });

  it('throws on invalid Feishu doc URLs', () => {
    expect(() => resolveDocxDocumentFromUrl('https://li.feishu.cn/wiki/abc')).toThrow('Invalid Feishu document URL');
  });
});

describe('createDocxDocument', () => {
  it('posts only title (no folder_token) and returns canonical doc ref', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 0, data: { document: { document_id: 'doxcn123' } } }),
    );

    const result = await createDocxDocument({ title: 'Hello', botTenantAccessToken: 'tk' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://open.feishu.cn/open-apis/docx/v1/documents');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tk',
      'Content-Type': 'application/json; charset=utf-8',
    });
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Hello' });
    expect(result).toEqual({ documentId: 'doxcn123', docUrl: 'https://li.feishu.cn/docx/doxcn123' });
  });

  it('throws on non-zero code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 99991663, msg: 'no permission' }));
    await expect(createDocxDocument({ title: 'Hello', botTenantAccessToken: 'tk' })).rejects.toThrow(
      'Failed to create document',
    );
  });
});

describe('batchDeleteDocxBlockChildren', () => {
  it('sends DELETE with start_index and end_index', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 0 }));

    await batchDeleteDocxBlockChildren({
      documentId: 'doxcn123',
      blockId: 'doxcn123',
      startIndex: 0,
      endIndex: 2,
      botTenantAccessToken: 'tk',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://open.feishu.cn/open-apis/docx/v1/documents/doxcn123/blocks/doxcn123/children/batch_delete',
    );
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body as string)).toEqual({ start_index: 0, end_index: 2 });
  });
});

describe('clearDocxRootChildren', () => {
  it('returns immediately when root has no children', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 0, data: { items: [{ block_id: 'doxcn123', children: [] }] } }),
    );

    await clearDocxRootChildren({ documentId: 'doxcn123', botTenantAccessToken: 'tk' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].toString()).toContain('/blocks?page_size=500');
  });

  it('repeatedly deletes until root is empty', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, data: { items: [{ block_id: 'doxcn123', children: ['b1', 'b2'] }] } }),
      )
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { document_revision_id: 2 } }))
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, data: { items: [{ block_id: 'doxcn123', children: ['b3'] }] } }),
      )
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { document_revision_id: 3 } }))
      .mockResolvedValueOnce(
        jsonResponse({ code: 0, data: { items: [{ block_id: 'doxcn123', children: [] }] } }),
      );

    await clearDocxRootChildren({ documentId: 'doxcn123', botTenantAccessToken: 'tk' });

    const deleteCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(2);
    expect(JSON.parse(deleteCalls[0][1].body as string)).toEqual({ start_index: 0, end_index: 2 });
    expect(JSON.parse(deleteCalls[1][1].body as string)).toEqual({ start_index: 0, end_index: 1 });
  });

  it('throws when root block cannot be found', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: 0, data: { items: [{ block_id: 'other', children: [] }] } }),
    );

    await expect(
      clearDocxRootChildren({ documentId: 'doxcn123', botTenantAccessToken: 'tk' }),
    ).rejects.toThrow('Root block not found');
  });
});

describe('createDocxDescendantBlocks', () => {
  it('posts children_id + descendants and returns relations', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        code: 0,
        data: { block_id_relations: [{ temporary_block_id: 't1', block_id: 'b1' }] },
      }),
    );

    const result = await createDocxDescendantBlocks({
      documentId: 'doxcn123',
      blockId: 'doxcn123',
      request: { childrenId: ['t1'], descendants: [{ block_id: 't1', block_type: 2 }] as never },
      botTenantAccessToken: 'tk',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://open.feishu.cn/open-apis/docx/v1/documents/doxcn123/blocks/doxcn123/descendant',
    );
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      children_id: ['t1'],
      descendants: [{ block_id: 't1', block_type: 2 }],
    });
    expect(result).toEqual([{ temporaryBlockId: 't1', blockId: 'b1' }]);
  });
});

describe('patchDocxBlock', () => {
  it('PATCHes replace_image body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 0 }));

    await patchDocxBlock({
      documentId: 'doxcn123',
      blockId: 'b1',
      body: { replace_image: { token: 'img-tk' } },
      botTenantAccessToken: 'tk',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://open.feishu.cn/open-apis/docx/v1/documents/doxcn123/blocks/b1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ replace_image: { token: 'img-tk' } });
  });

  it('PATCHes replace_file body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 0 }));

    await patchDocxBlock({
      documentId: 'doxcn123',
      blockId: 'b1',
      body: { replace_file: { token: 'file-tk' } },
      botTenantAccessToken: 'tk',
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      replace_file: { token: 'file-tk' },
    });
  });
});

describe('transferDocumentOwner', () => {
  it('POSTs to drive permissions transfer_owner with type=docx and openid body', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 0 }));

    await transferDocumentOwner({
      documentId: 'doxcn123',
      ownerOpenId: 'ou_xxx',
      botTenantAccessToken: 'tk',
    });

    const [url, init] = fetchMock.mock.calls[0];
    const urlString = url.toString();
    expect(urlString).toContain(
      'https://open.feishu.cn/open-apis/drive/v1/permissions/doxcn123/members/transfer_owner',
    );
    expect(urlString).toContain('type=docx');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      member_type: 'openid',
      member_id: 'ou_xxx',
    });
  });

  it('throws on non-zero code', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 1254000, msg: 'no permission' }));

    await expect(
      transferDocumentOwner({
        documentId: 'doxcn123',
        ownerOpenId: 'ou_xxx',
        botTenantAccessToken: 'tk',
      }),
    ).rejects.toThrow('Failed to transfer document owner');
  });
});
