import { Client, SSEClientTransport, StreamableHTTPClientTransport, type Transport } from '@modelcontextprotocol/client';

export type FeishuMcpConnection = {
  client: Client;
  transport: Transport;
};

export async function connectFeishuMcp(serverUrl: string): Promise<FeishuMcpConnection> {
  const url = new URL(serverUrl);

  const streamableClient = new Client({ name: 'xarticle2feishu', version: '0.1.0' });
  const streamableTransport = new StreamableHTTPClientTransport(url);

  try {
    await streamableClient.connect(streamableTransport);
    return { client: streamableClient, transport: streamableTransport };
  } catch (streamableError) {
    await streamableTransport.close().catch(() => undefined);

    const sseClient = new Client({ name: 'xarticle2feishu', version: '0.1.0' });
    const sseTransport = new SSEClientTransport(url);

    try {
      await sseClient.connect(sseTransport);
      return { client: sseClient, transport: sseTransport };
    } catch (sseError) {
      await sseTransport.close().catch(() => undefined);
      const streamableMessage = streamableError instanceof Error ? streamableError.message : String(streamableError);
      const sseMessage = sseError instanceof Error ? sseError.message : String(sseError);
      throw new Error(`Failed to connect to Feishu MCP server. Streamable HTTP: ${streamableMessage}. SSE: ${sseMessage}`);
    }
  }
}
