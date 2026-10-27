import raw from "../CHANGELOG.md?raw";

export interface ReleaseSection {
  title: string;
  items: string[];
}

export interface Release {
  version: string;
  date: string;
  sections: ReleaseSection[];
}

function plainText(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = [];
  let current: Release | null = null;
  let section: ReleaseSection | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    const versionMatch = line.match(/^##\s+\[([^\]]+)\]\s*-\s*(.+)$/);
    if (versionMatch) {
      current = {
        version: plainText(versionMatch[1]),
        date: plainText(versionMatch[2]),
        sections: [],
      };
      releases.push(current);
      section = null;
      continue;
    }
    if (!current) continue;

    const sectionMatch = line.match(/^###\s+(.+)$/);
    if (sectionMatch) {
      section = { title: plainText(sectionMatch[1]), items: [] };
      current.sections.push(section);
      continue;
    }

    const itemMatch = line.match(/^-\s+(.+)$/);
    if (itemMatch && section) {
      section.items.push(plainText(itemMatch[1]));
    }
  }

  return releases;
}

export const RELEASES = parseChangelog(raw);
