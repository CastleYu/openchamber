import { describe, expect, test } from 'bun:test';
import { CSSVariableGenerator } from './cssGenerator';
import { getDefaultTheme, themes } from './themes';

describe('conversation theme colors', () => {
  test('preserves the original light and dark inline-code colors', () => {
    const generator = new CSSVariableGenerator();
    expect(generator.generate(getDefaultTheme(false))).toContain('--markdown-inline-code: #006A2C;');
    expect(generator.generate(getDefaultTheme(true))).toContain('--markdown-inline-code: #76ad4f;');
  });

  test('every built-in theme supplies its own inline-code pair', () => {
    const generator = new CSSVariableGenerator();
    for (const theme of themes) {
      const colors = theme.colors.markdown;
      expect(colors?.inlineCode).toBeTruthy();
      expect(colors?.inlineCodeBackground).toBeTruthy();
      const css = generator.generate(theme);
      expect(css).toContain(`--markdown-inline-code: ${colors?.inlineCode};`);
      expect(css).toContain(`--markdown-inline-code-bg: ${colors?.inlineCodeBackground};`);
    }
  });

  test('custom themes without Markdown overrides fall back to syntax and chat colors', () => {
    const theme = structuredClone(getDefaultTheme(true));
    delete theme.colors.markdown;
    const generator = new CSSVariableGenerator();
    const css = generator.generate(theme);
    expect(css).toContain(`--markdown-inline-code: ${theme.colors.syntax.base.string};`);
    expect(css).toContain(`--markdown-inline-code-bg: ${theme.colors.chat?.background || theme.colors.surface.background};`);
    theme.colors.markdown = {};
    expect(generator.generate(theme)).toBe(css);
  });
});
