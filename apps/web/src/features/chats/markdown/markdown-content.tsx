import Markdown, { type Components, type Options } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

import { CodeBlock } from './code-block';
import { nodeText } from './node-text';
import { safeUrlTransform } from './safe-href';

const LINK_CLASS = 'text-primary underline underline-offset-2';

/**
 * Model output is untrusted (invariant 7a): no raw HTML (react-markdown turns it into text), links only with the
 * schemes of `safeHref`, and no image is ever loaded: an image becomes a link with its alt text, so a prompt
 * injection cannot send data out through an image URL.
 */
const COMPONENTS: Components = {
  a: ({ href, children }) =>
    href === undefined || href === '' ? (
      <span>{children}</span>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
        {children}
      </a>
    ),
  img: ({ src, alt }) => {
    const href = typeof src === 'string' ? src : '';
    if (href === '') return <span>{alt}</span>;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
        {alt === undefined || alt === '' ? href : alt}
      </a>
    );
  },
  pre: ({ node, children }) => (
    <CodeBlock text={(node === undefined ? '' : nodeText(node)).replace(/\n$/, '')}>
      {children}
    </CodeBlock>
  ),
  code: ({ className, children }) => (
    <code className={cn('bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]', className)}>
      {children}
    </code>
  ),
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc pl-6">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal pl-6">{children}</ol>,
  li: ({ children }) => <li className="my-1">{children}</li>,
  h1: ({ children }) => <h3 className="mt-4 mb-2 text-xl font-semibold">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-4 mb-2 text-lg font-semibold">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-3 mb-1 text-base font-semibold">{children}</h5>,
  blockquote: ({ children }) => (
    <blockquote className="text-muted-foreground my-2 border-l-2 pl-3">{children}</blockquote>
  ),
  hr: () => <hr className="my-4" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border px-2 py-1 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border px-2 py-1">{children}</td>,
};

const REMARK_PLUGINS: Options['remarkPlugins'] = [remarkGfm];
const REHYPE_PLUGINS: Options['rehypePlugins'] = [[rehypeHighlight, { detect: false }]];

export function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="min-w-0 wrap-break-word">
      <Markdown
        components={COMPONENTS}
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        urlTransform={safeUrlTransform}
      >
        {text}
      </Markdown>
    </div>
  );
}
