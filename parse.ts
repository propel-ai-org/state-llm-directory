export interface LlmsLink {
  text: string;
  url: string;
  description?: string;
}

export interface LlmsSection {
  name: string;
  links: LlmsLink[];
}

export interface ParsedLlms {
  title: string;
  description?: string;
  sections: LlmsSection[];
}

export function parseLlms(content: string): ParsedLlms {
  const lines = content.split('\n');
  let title = '';
  let description: string | undefined;
  const sections: LlmsSection[] = [];
  let currentSection: LlmsSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ') && !title) {
      title = trimmed.slice(2).trim();
    } else if (trimmed.startsWith('> ') && !description) {
      description = trimmed.slice(2).trim();
    } else if (trimmed.startsWith('## ')) {
      currentSection = { name: trimmed.slice(3).trim(), links: [] };
      sections.push(currentSection);
    } else if (trimmed.startsWith('- [') && currentSection) {
      const match = trimmed.match(/^- \[([^\]]+)\]\(([^)]+)\)(?::\s*(.+))?$/);
      if (match) {
        currentSection.links.push({
          text: match[1],
          url: match[2],
          description: match[3]?.trim(),
        });
      }
    }
  }

  return { title: title || 'Untitled', description, sections };
}
