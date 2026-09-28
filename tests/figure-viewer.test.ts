import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

// Vitest compiles JSX with the classic runtime, which reads a global React.
(globalThis as { React?: typeof React }).React = React;
const { FigureViewer } = await import('@/components/ui/figure-viewer');

describe('FigureViewer', () => {
  const html = renderToStaticMarkup(createElement(FigureViewer, { src: '/figures/bio-2009-doc3.png' }));

  it('shows the figure as a button that opens it in place, not a link to a new tab', () => {
    expect(html).toContain('<button');
    expect(html).toContain('aria-label="Open figure full size"');
    expect(html).not.toContain('target="_blank"');
  });

  it('holds the same image in a full-screen dialog with zoom and close controls', () => {
    expect(html).toContain('<dialog');
    expect(html.match(/src="\/figures\/bio-2009-doc3\.png"/g)).toHaveLength(2);
    for (const label of ['Zoom in', 'Zoom out', 'Fit to screen', 'Close']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  it('gives a whole-page image the full width', () => {
    const wide = renderToStaticMarkup(createElement(FigureViewer, { src: '/figures/x-p1.png', wide: true }));
    expect(wide).toMatch(/class="[^"]*w-full[^"]*"/);
  });
});
