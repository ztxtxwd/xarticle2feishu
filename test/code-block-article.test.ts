import { describe, expect, it } from 'vitest';
import { normalizeArticle } from '../src/mapping/normalizeArticle.js';
import { renderDocumentPlan } from '../src/mapping/renderDocumentPlan.js';
import { renderFeishuBlocks } from '../src/mapping/renderFeishuBlocks.js';
import type { FxArticle, FxEntityMapEntry } from '../src/types.js';

const article: FxArticle & { sourceTweetUrl: string; authorName: string; authorHandle: string } = {
  id: '2053827756463399072',
  title: 'Hermes 跑通了，然后呢？7 天把它变成工作台',
  created_at: '2026-05-12T00:00:00.000Z',
  modified_at: '2026-05-12T00:00:00.000Z',
  preview_text: 'test',
  sourceTweetUrl: 'https://x.com/ChrisWangwy/status/2053827756463399072',
  authorName: 'Chris Wang',
  authorHandle: 'ChrisWangwy',
  content: {
    blocks: [
      {
        key: 'code1',
        text: ' ',
        type: 'atomic',
        data: {},
        entityRanges: [{ key: 1, offset: 0, length: 1 }],
        inlineStyleRanges: [],
      },
    ],
    entityMap: [
      {
        key: '1',
        value: {
          type: 'MARKDOWN',
          mutability: 'Immutable',
          data: {
            markdown: '```\nhermes --version\nhermes status\nhermes sessions list\nhermes kanban boards list\n```',
          },
        },
      },
    ] as FxEntityMapEntry[],
  },
  media_entities: [],
};

describe('code block article mapping', () => {
  it('maps MARKDOWN fenced code to a Feishu code block', () => {
    const normalized = normalizeArticle(article);
    expect(normalized.blocks[0]).toMatchObject({
      type: 'code',
      language: 'PlainText',
    });
    expect(normalized.blocks[0].type).toBe('code');
    if (normalized.blocks[0].type === 'code') {
      expect(normalized.blocks[0].content).toContain('hermes --version');
    }


    const plan = renderDocumentPlan(normalized);
    expect(plan.operations.some((op) => op.type === 'appendCode')).toBe(true);

    const payload = renderFeishuBlocks(plan);
    expect(payload.descendants.some((block) => block.block_type === 14)).toBe(true);
    const codeBlock = payload.descendants.find((block) => block.block_type === 14);
    expect(codeBlock?.code?.elements[0]?.text_run.content).toContain('hermes --version');
  });
});
