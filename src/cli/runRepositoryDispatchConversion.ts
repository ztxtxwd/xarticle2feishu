import { appendFileSync } from 'node:fs';
import { createFeishuDocFromXArticle, fetchTenantAccessToken, sendFeishuWebhookMessage } from '../index.js';
import type { RepositoryDispatchConversionSummary } from '../types.js';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalRunUrl(): string | undefined {
  const serverUrl = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!serverUrl || !repository || !runId) {
    return undefined;
  }
  return `${serverUrl}/${repository}/actions/runs/${runId}`;
}

function writeGithubOutput(summary: RepositoryDispatchConversionSummary): void {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    return;
  }

  const lines = [
    `status=${summary.status}`,
    `article_url=${summary.articleUrl}`,
    `doc_url=${summary.docUrl ?? ''}`,
    `error_message=${(summary.errorMessage ?? '').replace(/\n/g, ' ')}`,
    `run_url=${summary.runUrl ?? ''}`,
  ];
  appendFileSync(outputFile, `${lines.join('\n')}\n`);
}

function writeGithubSummary(summary: RepositoryDispatchConversionSummary): void {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) {
    return;
  }

  const lines = [
    '# X article conversion result',
    '',
    `- status: ${summary.status}`,
    `- articleUrl: ${summary.articleUrl}`,
  ];

  if (summary.docUrl) {
    lines.push(`- docUrl: ${summary.docUrl}`);
  }
  if (summary.runUrl) {
    lines.push(`- runUrl: ${summary.runUrl}`);
  }
  if (summary.errorMessage) {
    lines.push(`- error: ${summary.errorMessage}`);
  }

  appendFileSync(summaryFile, `${lines.join('\n')}\n`);
}

async function notify(summary: RepositoryDispatchConversionSummary): Promise<void> {
  const webhookUrl = requiredEnv('FEISHU_WEBHOOK_URL');
  const repository = process.env.GITHUB_REPOSITORY ?? 'unknown';
  const eventName = process.env.GITHUB_EVENT_NAME ?? 'repository_dispatch';
  const timestamp = new Date().toISOString();

  const lines = [
    `repository: ${repository}`,
    `event: ${eventName}`,
    `articleUrl: ${summary.articleUrl}`,
    `timestamp: ${timestamp}`,
  ];

  if (summary.docUrl) {
    lines.push(`docUrl: ${summary.docUrl}`);
  }
  if (summary.runUrl) {
    lines.push(`runUrl: ${summary.runUrl}`);
  }
  if (summary.errorMessage) {
    lines.push(`error: ${summary.errorMessage}`);
  }

  await sendFeishuWebhookMessage({
    webhookUrl,
    title: summary.status === 'success' ? 'X article conversion succeeded' : 'X article conversion failed',
    lines,
  });
}

async function main(): Promise<void> {
  const articleUrl = requiredEnv('ARTICLE_URL');
  const feishuMcpServerUrl = requiredEnv('FEISHU_MCP_SERVER_URL');
  const appId = requiredEnv('FEISHU_BOT_APP_ID');
  const appSecret = requiredEnv('FEISHU_BOT_APP_SECRET');
  const runUrl = optionalRunUrl();

  let summary: RepositoryDispatchConversionSummary;

  try {
    const { tenantAccessToken } = await fetchTenantAccessToken(appId, appSecret);
    const { docUrl } = await createFeishuDocFromXArticle({
      articleUrl,
      feishuMcpServerUrl,
      botTenantAccessToken: tenantAccessToken,
    });

    summary = {
      status: 'success',
      articleUrl,
      docUrl,
      runUrl,
    };
  } catch (error) {
    summary = {
      status: 'failure',
      articleUrl,
      errorMessage: error instanceof Error ? error.message : String(error),
      runUrl,
    };
  }

  writeGithubOutput(summary);
  writeGithubSummary(summary);

  try {
    await notify(summary);
  } catch (notifyError) {
    console.warn(notifyError instanceof Error ? notifyError.message : String(notifyError));
  }

  console.log(JSON.stringify(summary));

  if (summary.status === 'failure') {
    throw new Error(summary.errorMessage ?? 'X article conversion failed');
  }
}

await main();
