import type { Client, Tool } from '@modelcontextprotocol/client';
import type {
  FeishuBlockIdRelation,
  FeishuDescendantRequest,
  FeishuDocumentPermissionInput,
  FeishuReplaceFileInput,
  FeishuReplaceImageInput,
} from '../types.js';

const DOC_URL_BASE = 'https://li.feishu.cn/docx/';
const CREATE_DOCUMENT_TOOL = 'docx_v1_document_create';
const LIST_DOCUMENT_BLOCKS_TOOL = 'docx_v1_documentBlock_list';
const CREATE_DESCENDANT_BLOCKS_TOOL = 'docx_v1_documentBlockDescendant_create';
const DELETE_BLOCK_CHILDREN_TOOL = 'docx_v1_documentBlockChildren_batchDelete';
const PATCH_BLOCK_TOOL = 'docx_v1_documentBlock_patch';
const CREATE_PERMISSION_MEMBER_TOOL = 'drive_v1_permissionMember_create';

type ToolTextResult = {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type FeishuBlockSummary = {
  blockId: string;
  parentId?: string;
  children: string[];
};

function normalizeDocUrl(documentId: string): string {
  return `${DOC_URL_BASE}${documentId}`;
}

function parseDocumentId(docUrl: string): string {
  let url: URL;
  try {
    url = new URL(docUrl);
  } catch {
    throw new Error(`Invalid Feishu document URL: ${docUrl}`);
  }

  const match = url.pathname.match(/^\/docx\/([^/]+)\/?$/);
  const documentId = match?.[1];
  if (!documentId) {
    throw new Error(`Invalid Feishu document URL: ${docUrl}`);
  }

  return documentId;
}

function parseBlockSummaries(data: Record<string, unknown>): { items: FeishuBlockSummary[]; pageToken?: string } {
  const items = Array.isArray(data.items) ? data.items : [];
  const pageToken = typeof data.page_token === 'string' && data.page_token ? data.page_token : undefined;

  return {
    items: items.map((item) => {
      const block = item as Record<string, unknown>;
      const children = Array.isArray(block.children) ? block.children.filter((child): child is string => typeof child === 'string') : [];
      const parentId = typeof block.parent_id === 'string' && block.parent_id ? block.parent_id : undefined;
      return {
        blockId: String(block.block_id),
        parentId,
        children,
      };
    }),
    pageToken,
  };
}

function textContent(result: ToolTextResult): string {
  const text = result.content
    .filter((item): item is { type: 'text'; text: string } => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n');

  if (text) {
    return text;
  }

  return result.structuredContent ? JSON.stringify(result.structuredContent) : '';
}

function parseJsonResult(result: ToolTextResult): Record<string, unknown> {
  const text = textContent(result).trim();
  if (!text) {
    throw new Error('MCP tool returned an empty result');
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`MCP tool returned non-JSON content: ${text}`);
  }
}

function getToolResultData(result: Record<string, unknown>): Record<string, unknown> {
  const code = result.code;
  if (code !== 0) {
    throw new Error(`MCP tool failed: ${JSON.stringify(result)}`);
  }

  const data = result.data;
  if (!data || typeof data !== 'object') {
    throw new Error(`MCP tool result is missing data: ${JSON.stringify(result)}`);
  }

  return data as Record<string, unknown>;
}

export class FeishuTools {
  private constructor(private readonly client: Client, private readonly tools: Map<string, Tool>) {}

  static async create(client: Client): Promise<FeishuTools> {
    const allTools: Tool[] = [];
    let cursor: string | undefined;

    do {
      const response = await client.listTools(cursor ? { cursor } : undefined);
      allTools.push(...response.tools);
      cursor = response.nextCursor;
    } while (cursor);

    return new FeishuTools(client, new Map(allTools.map((tool) => [tool.name, tool])));
  }

  listToolNames(): string[] {
    return [...this.tools.keys()];
  }

  async createDocument(title: string): Promise<{ documentId: string; docUrl: string }> {
    this.requireTool(CREATE_DOCUMENT_TOOL);
    const result = await this.client.callTool({
      name: CREATE_DOCUMENT_TOOL,
      arguments: {
        body: {
          title,
        },
      },
    });

    const payload = getToolResultData(parseJsonResult(result));
    const document = payload.document;
    if (!document || typeof document !== 'object') {
      throw new Error(`Create document result missing document payload: ${JSON.stringify(payload)}`);
    }

    const documentId = (document as Record<string, unknown>).document_id;
    if (typeof documentId !== 'string' || !documentId) {
      throw new Error(`Create document result missing document_id: ${JSON.stringify(payload)}`);
    }

    return { documentId, docUrl: normalizeDocUrl(documentId) };
  }

  resolveDocumentFromUrl(docUrl: string): { documentId: string; docUrl: string } {
    const documentId = parseDocumentId(docUrl);
    return { documentId, docUrl: normalizeDocUrl(documentId) };
  }

  async listDocumentBlocks(documentId: string, pageToken?: string): Promise<{ items: FeishuBlockSummary[]; pageToken?: string }> {
    this.requireTool(LIST_DOCUMENT_BLOCKS_TOOL);
    const result = await this.client.callTool({
      name: LIST_DOCUMENT_BLOCKS_TOOL,
      arguments: {
        path: {
          document_id: documentId,
        },
        query: {
          page_size: 500,
          ...(pageToken ? { page_token: pageToken } : {}),
        },
      },
    });

    return parseBlockSummaries(getToolResultData(parseJsonResult(result)));
  }

  async deleteBlockChildren(documentId: string, blockId: string, startIndex: number, endIndex: number): Promise<void> {
    this.requireTool(DELETE_BLOCK_CHILDREN_TOOL);
    const result = await this.client.callTool({
      name: DELETE_BLOCK_CHILDREN_TOOL,
      arguments: {
        path: {
          document_id: documentId,
          block_id: blockId,
        },
        body: {
          start_index: startIndex,
          end_index: endIndex,
        },
      },
    });

    getToolResultData(parseJsonResult(result));
  }

  async clearDocumentRootChildren(documentId: string): Promise<void> {
    for (;;) {
      const rootBlock = await this.findRootBlock(documentId);
      const childCount = rootBlock.children.length;
      if (childCount === 0) {
        return;
      }

      await this.deleteBlockChildren(documentId, documentId, 0, Math.min(childCount, 500));
    }
  }

  async createDescendantBlocks(documentId: string, request: FeishuDescendantRequest): Promise<FeishuBlockIdRelation[]> {
    this.requireTool(CREATE_DESCENDANT_BLOCKS_TOOL);
    const result = await this.client.callTool({
      name: CREATE_DESCENDANT_BLOCKS_TOOL,
      arguments: {
        path: {
          document_id: documentId,
          block_id: documentId,
        },
        body: {
          children_id: request.childrenId,
          descendants: request.descendants,
        },
      },
    });

    const data = getToolResultData(parseJsonResult(result));
    const relations = Array.isArray(data.block_id_relations) ? data.block_id_relations : [];
    return relations.map((relation) => ({
      temporaryBlockId: String((relation as Record<string, unknown>).temporary_block_id),
      blockId: String((relation as Record<string, unknown>).block_id),
    }));
  }

  async grantDocumentPermission(input: FeishuDocumentPermissionInput): Promise<void> {
    this.requireTool(CREATE_PERMISSION_MEMBER_TOOL);
    const result = await this.client.callTool({
      name: CREATE_PERMISSION_MEMBER_TOOL,
      arguments: {
        path: {
          token: input.documentId,
        },
        query: {
          type: input.documentType,
        },
        body: {
          member_id: input.openId,
          member_type: 'openid',
          perm: 'edit',
        },
      },
    });

    getToolResultData(parseJsonResult(result));
  }

  async replaceImage(input: FeishuReplaceImageInput): Promise<void> {
    this.requireTool(PATCH_BLOCK_TOOL);
    const result = await this.client.callTool({
      name: PATCH_BLOCK_TOOL,
      arguments: {
        path: {
          document_id: input.documentId,
          block_id: input.blockId,
        },
        body: {
          replace_image: {
            token: input.fileToken,
          },
        },
      },
    });

    getToolResultData(parseJsonResult(result));
  }

  async replaceFile(input: FeishuReplaceFileInput): Promise<void> {
    this.requireTool(PATCH_BLOCK_TOOL);
    const result = await this.client.callTool({
      name: PATCH_BLOCK_TOOL,
      arguments: {
        path: {
          document_id: input.documentId,
          block_id: input.blockId,
        },
        body: {
          replace_file: {
            token: input.fileToken,
          },
        },
      },
    });

    getToolResultData(parseJsonResult(result));
  }

  private async findRootBlock(documentId: string): Promise<FeishuBlockSummary> {
    let pageToken: string | undefined;

    do {
      const page = await this.listDocumentBlocks(documentId, pageToken);
      const rootBlock = page.items.find((block) => block.blockId === documentId);
      if (rootBlock) {
        return rootBlock;
      }
      pageToken = page.pageToken;
    } while (pageToken);

    throw new Error(`Root block not found for document ${documentId}`);
  }

  private requireTool(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Missing required Feishu MCP tool: ${name}. Available tools: ${this.listToolNames().join(', ')}`);
    }

    return tool;
  }
}
