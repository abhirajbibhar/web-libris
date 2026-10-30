import { describe, expect, it } from 'vitest';
import {
  SUBTYPE,
  buildHighlights,
  decode,
  encode,
  isUserAnnotation,
  missingFrom,
  signature,
  textInRects,
  type AnnotationLike,
  type Rect,
  type TextRun,
  type TransferItem
} from './annotationSync';

const rect = (x: number, y: number, w: number, h = 10): Rect => ({ origin: { x, y }, size: { width: w, height: h } });
const run = (content: string, x: number, y: number, w: number): TextRun => ({ content, rect: rect(x, y, w), font: { size: 10 } });
const item = (a: Partial<AnnotationLike> & { id: string }): TransferItem => ({
  annotation: { type: SUBTYPE.HIGHLIGHT, pageIndex: 0, rect: rect(0, 0, 10), ...a }
});

describe('encode/decode', () => {
  it('round-trips dates and binary data through JSON', () => {
    const original = {
      id: 'a',
      created: new Date('2026-10-28T10:00:00.000Z'),
      nested: { when: new Date('2026-01-01T00:00:00.000Z') },
      bytes: new Uint8Array([0, 1, 254, 255]),
      buffer: new Uint8Array([9, 8, 7]).buffer
    };
    const wire = JSON.parse(JSON.stringify(encode(original))); // exactly what the server stores
    const back = decode<typeof original>(wire);
    expect(back.created).toBeInstanceOf(Date);
    expect(back.created.toISOString()).toBe('2026-10-28T10:00:00.000Z');
    expect(back.nested.when).toBeInstanceOf(Date);
    expect(Array.from(back.bytes)).toEqual([0, 1, 254, 255]);
    expect(Array.from(new Uint8Array(back.buffer))).toEqual([9, 8, 7]);
  });

  it('does not choke on large binary payloads', () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    const back = decode<{ b: Uint8Array }>(encode({ b: big }));
    expect(back.b.length).toBe(200_000);
    expect(back.b[199_999]).toBe(199_999 % 251);
  });
});

describe('signature', () => {
  it('ignores timestamps and ordering, but notices real edits', () => {
    const a = item({ id: '1', contents: 'x', created: new Date(1), modified: new Date(2) });
    const b = item({ id: '2', contents: 'y' });
    const same = signature([a, b]);
    expect(signature([b, { annotation: { ...a.annotation, modified: new Date(999) } }])).toBe(same);
    expect(signature([a, item({ id: '2', contents: 'changed' })])).not.toBe(same);
    expect(signature([a])).not.toBe(same);
  });
});

describe('merge + filtering', () => {
  it('keeps only remote annotations the local set lacks', () => {
    const merged = missingFrom([item({ id: 'a' }), item({ id: 'b' })], [item({ id: 'b' }), item({ id: 'c' })]);
    expect(merged.map(i => i.annotation.id)).toEqual(['c']);
  });
  it('treats links/widgets as part of the PDF, not the reader’s work', () => {
    expect(isUserAnnotation(item({ id: 'h', type: SUBTYPE.HIGHLIGHT }))).toBe(true);
    expect(isUserAnnotation(item({ id: 'l', type: 2 }))).toBe(false); // LINK
    expect(isUserAnnotation(item({ id: 'w', type: 20 }))).toBe(false); // WIDGET
  });
});

describe('textInRects', () => {
  // "The quick brown fox" laid out as separate words on one line.
  const words = [run('The', 0, 0, 30), run('quick', 40, 0, 50), run('brown', 100, 0, 50), run('fox', 160, 0, 30)];

  it('collects the words a highlight covers, in order, with spaces between', () => {
    expect(textInRects([rect(38, 0, 115)], words)).toBe('quick brown');
  });

  it('ignores runs on other lines', () => {
    const lines = [...words, run('below', 40, 40, 50)];
    expect(textInRects([rect(0, 0, 200)], lines)).toBe('The quick brown fox');
  });

  it('cuts a long run at the highlight edges and snaps to whole words', () => {
    // One 200pt-wide line run; highlight the middle part only.
    const line = [run('alpha beta gamma delta epsilon', 0, 0, 290)];
    const text = textInRects([rect(100, 0, 100)], line);
    expect(text).toContain('gamma');
    expect(text).not.toContain('alpha');
    expect(text).not.toContain('epsilon');
    expect(text.split(' ').every(w => ['beta', 'gamma', 'delta'].includes(w))).toBe(true);
  });

  it('joins multi-line highlights and repairs wrap hyphenation', () => {
    const runs = [run('an extraordi-', 0, 0, 130), run('nary result', 0, 12, 110)];
    expect(textInRects([rect(0, 0, 130), rect(0, 12, 110)], runs)).toBe('an extraordinary result');
  });

  it('keeps a real hyphen before a capital or digit', () => {
    const runs = [run('well-', 0, 0, 40), run('Known', 0, 12, 50)];
    expect(textInRects([rect(0, 0, 40), rect(0, 12, 50)], runs)).toBe('well- Known');
  });

  it('does not double-space when runs already carry spaces', () => {
    const runs = [run('Hello ', 0, 0, 36), run('world', 36, 0, 30)];
    expect(textInRects([rect(0, 0, 70)], runs)).toBe('Hello world');
  });

  it('returns empty when nothing is under the highlight', () => {
    expect(textInRects([rect(500, 500, 10)], words)).toBe('');
  });
});

describe('buildHighlights', () => {
  it('maps annotation kinds, pages and comments; skips unsupported kinds', () => {
    const items = [
      item({ id: 'h', type: SUBTYPE.HIGHLIGHT, pageIndex: 4, contents: ' remember this ', strokeColor: '#FFCD45', created: new Date('2026-10-28T00:00:00Z') }),
      item({ id: 'n', type: SUBTYPE.TEXT, pageIndex: 1, contents: 'sticky' }),
      item({ id: 's', type: SUBTYPE.STRIKEOUT, pageIndex: 0 }),
      item({ id: 'u', type: SUBTYPE.UNDERLINE, pageIndex: 2, color: '#00f' })
    ];
    const out = buildHighlights(items, a => `text of ${a.id}`);
    expect(out.map(o => o.id)).toEqual(['n', 'u', 'h']); // sorted by page; strikeout skipped
    expect(out.find(o => o.id === 'h')).toMatchObject({ kind: 'highlight', page: 5, text: 'text of h', comment: 'remember this', color: '#FFCD45', createdAt: '2026-10-28T00:00:00.000Z' });
    expect(out.find(o => o.id === 'n')).toMatchObject({ kind: 'note', page: 2, text: '', comment: 'sticky' });
    expect(out.find(o => o.id === 'u')).toMatchObject({ kind: 'underline', color: '#00f' });
  });
});
