import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizeArticle } from '../src/mapping/normalizeArticle.js';
import { renderDocumentPlan } from '../src/mapping/renderDocumentPlan.js';
import { renderFeishuBlocks } from '../src/mapping/renderFeishuBlocks.js';
import { parseXArticleUrl } from '../src/fetchFxTwitterArticle.js';
import type { FxTwitterApiResponse } from '../src/types.js';

const fixture = JSON.parse(
  readFileSync(new URL('./article.fixture.json', import.meta.url), 'utf8'),
) as FxTwitterApiResponse;

const tweet = fixture.tweet;
if (!tweet?.article) {
  throw new Error('Fixture is missing tweet.article');
}

const article = {
  ...tweet.article,
  sourceTweetUrl: tweet.url,
  authorName: tweet.author.name,
  authorHandle: tweet.author.screen_name,
};

describe('parseXArticleUrl', () => {
  it('parses x.com status URLs', () => {
    expect(parseXArticleUrl('https://x.com/ashpreetbedi/status/2053885390717890757')).toEqual({
      author: 'ashpreetbedi',
      statusId: '2053885390717890757',
    });
  });
});

describe('normalizeArticle', () => {
  it('normalizes the fixture into a stable IR', () => {
    const normalized = normalizeArticle(article);

    expect(normalized.title).toBe('Auto-Improving Software');
    expect(normalized.authorHandle).toBe('ashpreetbedi');
    expect(normalized.coverImage?.url).toContain('pbs.twimg.com/media/');
    expect(normalized.blocks.some((block) => block.type === 'heading1')).toBe(true);
    expect(normalized.blocks.some((block) => block.type === 'heading2')).toBe(true);
    expect(normalized.blocks.some((block) => block.type === 'bullet')).toBe(true);
    expect(normalized.blocks.some((block) => block.type === 'ordered')).toBe(true);
    expect(normalized.blocks.some((block) => block.type === 'quote')).toBe(true);
    expect(normalized.blocks.some((block) => block.type === 'divider')).toBe(true);
    expect(normalized.blocks.some((block) => block.type === 'video')).toBe(true);
  });

  it('keeps links and inline styles', () => {
    const normalized = normalizeArticle(article);
    const linkedParagraph = normalized.blocks.find(
      (block) => block.type === 'paragraph' && block.spans.some((span) => span.marks.some((mark) => mark.type === 'link')),
    );

    expect(linkedParagraph && 'spans' in linkedParagraph).toBeTruthy();
    if (linkedParagraph?.type === 'paragraph') {
      expect(linkedParagraph.spans.some((span) => span.marks.some((mark) => mark.type === 'link'))).toBe(true);
    }
  });
});

describe('renderDocumentPlan', () => {
  it('renders deterministic operations for the fixture', () => {
    const plan = renderDocumentPlan(normalizeArticle(article));

    expect(plan.operations[0]).toEqual({
      type: 'createDocument',
      title: 'Auto-Improving Software',
    });
    expect(plan.operations.some((op) => op.type === 'appendImage')).toBe(true);
    expect(plan.operations.some((op) => op.type === 'appendVideoFallback')).toBe(true);
    expect(plan.operations.some((op) => op.type === 'appendDivider')).toBe(true);
  });
});

describe('renderFeishuBlocks', () => {
  it('renders nested block payload for Feishu descendant.create', () => {
    const payload = renderFeishuBlocks(renderDocumentPlan(normalizeArticle(article)));

    expect(payload.childrenId.length).toBeGreaterThan(0);
    expect(payload.descendants.length).toBeGreaterThanOrEqual(payload.childrenId.length);
    expect(payload.descendants.some((block) => block.block_type === 3)).toBe(true);
    expect(payload.descendants.some((block) => block.block_type === 4)).toBe(true);
    expect(payload.descendants.some((block) => block.block_type === 12)).toBe(true);
    expect(payload.descendants.some((block) => block.block_type === 13)).toBe(true);
    expect(payload.descendants.some((block) => block.block_type === 15)).toBe(true);
    expect(payload.descendants.some((block) => block.block_type === 22)).toBe(true);
  });
});
