import type { EpubReaderSettings, EpubTheme } from './settings';

export interface EpubThemeColors {
  bg: string;
  fg: string;
  link: string;
}

/** Theme palette, mirroring the original reader's four themes. */
export const EPUB_THEMES: Record<EpubTheme, EpubThemeColors> = {
  light: { bg: '#ffffff', fg: '#1a1a1a', link: '#0b57d0' },
  sepia: { bg: '#f4ecd8', fg: '#5b4636', link: '#8b4513' },
  dark: { bg: '#121212', fg: '#e0e0e0', link: '#8ab4f8' },
  night: { bg: '#000000', fg: '#b2b2b2', link: '#8ab4f8' }
};

/**
 * User stylesheet injected into every EPUB content document through
 * foliate's renderer.setStyles. Ported from the original ReaderStyleService,
 * trimmed to the settings this reader exposes (theme, size, justify).
 */
export function generateEpubCss(settings: EpubReaderSettings): string {
  const theme = EPUB_THEMES[settings.theme] ?? EPUB_THEMES.light;
  const fontSize = Math.min(32, Math.max(10, Math.round(settings.fontSize)));

  return `
    @media print {
      html { column-width: auto !important; height: auto !important; width: auto !important; }
    }
    @media screen {
      html {
        color: ${theme.fg};
        font-size: ${fontSize}px;
        line-height: 1.55;
      }
      a:any-link { color: ${theme.link}; text-underline-offset: .1em; }
      a:any-link:hover { text-decoration-color: unset; }
    }
    html, body {
      color: ${theme.fg} !important;
      background: ${theme.bg} !important;
    }
    body * {
      color: ${theme.fg} !important;
      background-color: ${theme.bg} !important;
      border-color: currentColor !important;
    }
    a:any-link { color: ${theme.link} !important; }
    svg, img { background-color: transparent !important; }
    p, li, blockquote, dd {
      text-align: ${settings.justify ? 'justify' : 'start'} !important;
      hyphens: none;
    }
    ::selection { background-color: rgba(128, 128, 128, 0.35); }
  `;
}
