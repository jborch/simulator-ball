import { expect, test } from 'vitest';
import { esc } from './hud';

test('text from the server is escaped before it goes into the HUD as HTML', () => {
  expect(esc('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  expect(esc("Tom & Jerry's line")).toBe('Tom &amp; Jerry&#39;s line');
  expect(esc('(01)05712345000014(17)291114')).toBe('(01)05712345000014(17)291114');
});
