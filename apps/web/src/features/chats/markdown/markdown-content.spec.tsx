import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MarkdownContent } from './markdown-content';

function renderMarkdown(text: string) {
  return render(<MarkdownContent text={text} />);
}

describe('MarkdownContent', () => {
  it('renders emphasis, lists and GFM tables', () => {
    renderMarkdown('**fett**\n\n- eins\n- zwei\n\n| A | B |\n|---|---|\n| 1 | 2 |\n');

    expect(screen.getByText('fett').tagName).toBe('STRONG');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'A' })).toBeInTheDocument();
  });

  it('shows raw HTML as text and creates no element from it', () => {
    const { container } = renderMarkdown(
      '<img src=x onerror=alert(1)>\n\n<script>alert(2)</script>'
    );

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container).toHaveTextContent('<script>alert(2)</script>');
  });

  it('never loads an image: it shows a link with the alt text instead', () => {
    const { container } = renderMarkdown('![Logo](https://evil.test/p.png?d=secret)');

    expect(container.querySelector('img')).toBeNull();
    const link = screen.getByRole('link', { name: 'Logo' });
    expect(link).toHaveAttribute('href', 'https://evil.test/p.png?d=secret');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows the alt text of an image with an unsafe source as plain text', () => {
    const { container } = renderMarkdown('![nur Text](javascript:alert(1))');

    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('nur Text');
  });

  it('opens good links in a new tab without handing over the opener', () => {
    renderMarkdown('[Doku](https://example.test/doku) und [Mail](mailto:ben@example.test)');

    const doku = screen.getByRole('link', { name: 'Doku' });
    expect(doku).toHaveAttribute('href', 'https://example.test/doku');
    expect(doku).toHaveAttribute('target', '_blank');
    expect(doku).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Mail' })).toHaveAttribute(
      'href',
      'mailto:ben@example.test'
    );
  });

  it.each([
    ['[Klick](javascript:alert(1))', 'Klick'],
    ['[Daten](data:text/html;base64,PHNjcmlwdD4=)', 'Daten'],
    ['[Intern](/admin/users)', 'Intern'],
  ])('keeps the text of %s but makes no link of it', (markdown, text) => {
    const { container } = renderMarkdown(markdown);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(container).toHaveTextContent(text);
  });

  it('highlights a labelled code block', () => {
    const { container } = renderMarkdown('```js\nconst x = 1;\n```');

    expect(container.querySelector('.hljs-keyword')).toHaveTextContent('const');
  });

  it('copies the exact code of a block', async () => {
    const user = userEvent.setup();
    renderMarkdown('```js\nconst x = 1;\nconsole.log(x);\n```');

    await user.click(screen.getByRole('button', { name: 'Kopieren' }));

    expect(await navigator.clipboard.readText()).toBe('const x = 1;\nconsole.log(x);');
    expect(await screen.findByText('Kopiert.')).toBeInTheDocument();
  });

  it('says so when copying is not possible', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    renderMarkdown('```\nplain\n```');

    await user.click(screen.getByRole('button', { name: 'Kopieren' }));

    expect(await screen.findByText('Kopieren ist nicht möglich.')).toBeInTheDocument();
  });

  it('scrolls a long line inside the code block instead of the page', () => {
    const { container } = renderMarkdown('```\n' + 'x'.repeat(500) + '\n```');

    expect(container.querySelector('pre')).toHaveClass('overflow-x-auto');
  });
});
