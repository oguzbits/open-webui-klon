interface TextNode {
  type: string;
  value?: string;
  children?: TextNode[];
}

/** The plain text of a syntax-tree node (what the user sees in a code block, without the highlighting spans). */
export function nodeText(node: TextNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(nodeText).join('');
}
