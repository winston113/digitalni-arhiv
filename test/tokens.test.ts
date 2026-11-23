import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('barve aplikacije so enake design sistemu', () => {
  const tokens = JSON.parse(readFileSync('design/project/tokens.json', 'utf8'));
  const css = readFileSync('src/web/styles/tokens.css', 'utf8');
  const [light, dark] = css.split('[data-theme="dark"]') as [string, string];
  for (const t of tokens.color.tokens) {
    const value = typeof t.value === 'string' ? { light: t.value, dark: t.value } : t.value;
    expect(light).toContain(`--${t.name}: ${value.light};`);
    expect(dark).toContain(`--${t.name}: ${value.dark};`);
  }
});
