import { describe, expect, it } from 'vitest';
import { renderFeishuBlocks } from '../src/mapping/renderFeishuBlocks.js';
import type { DocumentPlan } from '../src/types.js';

describe('renderFeishuBlocks native image placeholders', () => {
  it('creates native image placeholders and upload plans', () => {
    const plan: DocumentPlan = {
      title: 'demo',
      operations: [
        { type: 'createDocument', title: 'demo' },
        { type: 'appendImage', url: 'https://example.com/demo.png', width: 640, height: 320 },
      ],
    };

    const rendered = renderFeishuBlocks(plan);
    expect(rendered.descendants[0]?.block_type).toBe(27);
    expect(rendered.nativeImages).toHaveLength(1);
    expect(rendered.nativeImages[0]?.imageUrl).toBe('https://example.com/demo.png');
    expect(rendered.nativeImages[0]?.temporaryBlockId).toBe(rendered.childrenId[0]);
  });

  it('skips empty text blocks that Feishu rejects', () => {
    const plan: DocumentPlan = {
      title: 'demo',
      operations: [
        { type: 'createDocument', title: 'demo' },
        { type: 'appendHeading', level: 2, spans: [] },
        { type: 'appendParagraph', spans: [] },
        { type: 'appendListItem', kind: 'bullet', spans: [] },
        { type: 'appendQuote', spans: [] },
      ],
    };

    const rendered = renderFeishuBlocks(plan);
    expect(rendered.descendants).toHaveLength(1);
    expect(rendered.childrenId).toHaveLength(1);
    expect(rendered.descendants[0]?.block_type).toBe(2);
    expect(rendered.descendants[0]?.text?.elements[0]?.text_run.content).toBe('demo');
  });
});
