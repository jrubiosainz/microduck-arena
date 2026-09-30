import { marked } from "marked";
import { dress, guideHref, menuHref, raceHref } from "./router.js";
import { chequer, footer, signage } from "./signage.js";

// Authored repository content only. No API response or visitor input is parsed as HTML.
const sources = import.meta.glob("../../docs/guides/**/*.md", {
  query: "?raw", import: "default", eager: true,
});
const content = new Map(Object.entries(sources)
  .filter(([path]) => !path.endsWith("/README.md"))
  .map(([path, markdown]) => [path.replace("../../docs/guides/", "").replace(/\.md$/, ""), markdown]));

function link(text, href) {
  const node = document.createElement("a");
  node.textContent = text;
  node.href = href;
  return node;
}

export function renderGuides(root, { guideId = "index", eventId, event, section = null } = {}) {
  dress("guides");
  const main = document.createElement("main");
  main.className = "hall guide-page";
  // Only a challenge's guide carries a way back: it returns to that challenge,
  // which the strip's mark cannot. General help has the mark for the front and
  // nothing else — a "get started" beside it pointed at basics no one needs
  // before opening a challenge.
  if (eventId) {
    const breadcrumbs = document.createElement("nav");
    breadcrumbs.className = "guide-breadcrumbs";
    breadcrumbs.setAttribute("aria-label", "Breadcrumb");
    breadcrumbs.append(event
      ? link("← Back to challenge", raceHref(eventId))
      : link("← Back to challenges", menuHref));
    main.append(breadcrumbs);
  }

  const article = document.createElement("article");
  article.className = "guide-article";
  article.innerHTML = marked.parse(content.get(eventId ? `challenges/${eventId}` : guideId) ??
    "# Guide not found\n\nOpen a challenge for its training instructions, or [get started](index.md) with the basics.");

  const headings = [...article.querySelectorAll("h1, h2, h3")];
  for (const heading of headings) {
    heading.id = heading.textContent.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s/g, "-");
    heading.tabIndex = -1;
  }
  for (const anchor of article.querySelectorAll("a")) {
    const local = anchor.getAttribute("href").match(/^(?:\.\.\/)?([\w-]+)\.md(?:#(.+))?$/);
    if (local) anchor.href = guideHref(local[1], local[2]);
  }
  for (const pre of article.querySelectorAll("pre")) {
    pre.tabIndex = 0;
    pre.setAttribute("aria-label", "Command example");
  }
  for (const table of article.querySelectorAll("table")) {
    const scroll = document.createElement("div");
    scroll.className = "guide-table";
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "Scrollable reference table");
    table.replaceWith(scroll);
    scroll.append(table);
  }

  main.append(article);
  root.replaceChildren(signage(null), chequer("page-checker"), main, footer());
  document.title = `${headings[0].textContent} · Microduck Arena`;
  const target = headings.find(heading => heading.id === section) ?? headings[0];
  target.focus({ preventScroll: true });
  (section ? target : root).scrollIntoView?.({ block: "start" });
}
