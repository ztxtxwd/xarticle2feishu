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
const CREATE_DESCENDANT_BLOCKS_TOOL = 'docx_v1_documentBlockDescendant_create';
const PATCH_BLOCK_TOOL = 'docx_v1_documentBlock_patch';
const CREATE_PERMISSION_MEMBER_TOOL = 'drive_v1_permissionMember_create';

type ToolTextResult = {
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

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

    return { documentId, docUrl: `${DOC_URL_BASE}${documentId}` };
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

  private requireTool(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Missing required Feishu MCP tool: ${name}. Available tools: ${this.listToolNames().join(', ')}`);
    }

    return tool;
  }
}
