export function icon(name: string, cls = ""): string {
  const classes = [cls, name === "brand" ? "brand-glyph" : ""].filter(Boolean).join(" ");
  const klass = classes ? ` class="${classes}"` : "";
  return `<svg${klass} aria-hidden="true"><use href="#i-${name}" /></svg>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
