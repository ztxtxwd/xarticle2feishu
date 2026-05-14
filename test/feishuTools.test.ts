import { describe, expect, it, vi } from 'vitest';
import { FeishuTools } from '../src/mcp/feishuTools.js';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
};

function toolResult(data: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ code: 0, data }) }],
  };
}

function createClient() {
  return {
    listTools: vi.fn().mockResolvedValue({
      tools: [
        { name: 'docx_v1_document_create' },
        { name: 'docx_v1_documentBlock_list' },
        { name: 'docx_v1_documentBlockDescendant_create' },
        { name: 'docx_v1_documentBlockChildren_batchDelete' },
        { name: 'docx_v1_documentBlock_patch' },
        { name: 'drive_v1_permissionMember_create' },
      ],
      nextCursor: undefined,
    }),
    callTool: vi.fn(),
  };
}

describe('FeishuTools.resolveDocumentFromUrl', () => {
  it('parses and canonicalizes Feishu doc URLs', async () => {
    const client = createClient();
    const tools = await FeishuTools.create(client as never);

    expect(tools.resolveDocumentFromUrl('https://li.feishu.cn/docx/doxcn123/?from=share#abc')).toEqual({
      documentId: 'doxcn123',
      docUrl: 'https://li.feishu.cn/docx/doxcn123',
    });
  });

  it('throws on invalid Feishu doc URLs', async () => {
    const client = createClient();
    const tools = await FeishuTools.create(client as never);

    expect(() => tools.resolveDocumentFromUrl('https://li.feishu.cn/wiki/abc')).toThrow('Invalid Feishu document URL');
  });
});

describe('FeishuTools.clearDocumentRootChildren', () => {
  it('returns immediately when the root block has no children', async () => {
    const client = createClient();
    client.callTool.mockResolvedValueOnce(toolResult({
      items: [{ block_id: 'doxcn123', children: [] }],
    }));
    const tools = await FeishuTools.create(client as never);

    await tools.clearDocumentRootChildren('doxcn123');

    expect(client.callTool).toHaveBeenCalledTimes(1);
    expect(client.callTool).toHaveBeenCalledWith({
      name: 'docx_v1_documentBlock_list',
      arguments: {
        path: { document_id: 'doxcn123' },
        query: { page_size: 500 },
      },
    });
  });

  it('repeatedly deletes root children until the root is empty', async () => {
    const client = createClient();
    client.callTool
      .mockResolvedValueOnce(toolResult({
        items: [{ block_id: 'doxcn123', children: ['b1', 'b2'] }],
      }))
      .mockResolvedValueOnce(toolResult({ document_revision_id: 2 }))
      .mockResolvedValueOnce(toolResult({
        items: [{ block_id: 'doxcn123', children: ['b3'] }],
      }))
      .mockResolvedValueOnce(toolResult({ document_revision_id: 3 }))
      .mockResolvedValueOnce(toolResult({
        items: [{ block_id: 'doxcn123', children: [] }],
      }));
    const tools = await FeishuTools.create(client as never);

    await tools.clearDocumentRootChildren('doxcn123');

    expect(client.callTool).toHaveBeenNthCalledWith(2, {
      name: 'docx_v1_documentBlockChildren_batchDelete',
      arguments: {
        path: { document_id: 'doxcn123', block_id: 'doxcn123' },
        body: { start_index: 0, end_index: 2 },
      },
    });
    expect(client.callTool).toHaveBeenNthCalledWith(4, {
      name: 'docx_v1_documentBlockChildren_batchDelete',
      arguments: {
        path: { document_id: 'doxcn123', block_id: 'doxcn123' },
        body: { start_index: 0, end_index: 1 },
      },
    });
  });

  it('throws when the root block cannot be found', async () => {
    const client = createClient();
    client.callTool.mockResolvedValueOnce(toolResult({
      items: [{ block_id: 'other', children: [] }],
    }));
    const tools = await FeishuTools.create(client as never);

    await expect(tools.clearDocumentRootChildren('doxcn123')).rejects.toThrow('Root block not found');
  });
});
