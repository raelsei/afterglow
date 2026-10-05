export interface Post {
  title: string;
  url: string;
  date: Date | null;
}

export interface Feed {
  /** Newest first. */
  posts: Post[];
  /** The site the feed belongs to, when the feed names one. */
  home: string | null;
}

/** Reads RSS 2.0 and Atom. Anything else fails loudly rather than rendering an empty list. */
export async function fetchFeed(url: string): Promise<Feed> {
  const res = await fetch(url, {
    headers: { "user-agent": "afterglow", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(30_000),
  }).catch((error: Error) => {
    throw new Error(`Feed ${url} did not answer: ${error.message}`);
  });
  if (!res.ok) throw new Error(`Feed ${url} answered ${res.status}`);
  const feed = parseFeed(await res.text(), url);
  if (feed.posts.length === 0) throw new Error(`Feed ${url} has no <item> or <entry> with a title and a link`);
  return feed;
}

export function parseFeed(xml: string, base: string): Feed {
  const isAtom = /<feed\b/.test(xml) && !/<rss\b/.test(xml);
  const blocks = [...xml.matchAll(isAtom ? /<entry\b[^>]*>([\s\S]*?)<\/entry>/g : /<item\b[^>]*>([\s\S]*?)<\/item>/g)].map(
    (m) => m[1]!,
  );

  const posts: Post[] = [];
  for (const block of blocks) {
    const title = isAtom ? atomTitle(block) : textOf(block, "title");
    const link = isAtom ? atomLink(block) : textOf(block, "link") || textOf(block, "guid");
    if (!title || !link) continue;
    const when =
      textOf(block, isAtom ? "published" : "pubDate") || textOf(block, "updated") || textOf(block, "dc:date");
    const date = when ? new Date(when) : null;
    posts.push({ title, url: new URL(link, base).href, date: date && !Number.isNaN(date.getTime()) ? date : null });
  }
  if (posts.every((post) => post.date)) posts.sort((a, b) => b.date!.getTime() - a.date!.getTime());

  const head = xml.replace(isAtom ? /<entry\b[\s\S]*<\/entry>/ : /<item\b[\s\S]*<\/item>/, "");
  const home = isAtom ? atomLink(head) : textOf(head, "link");
  return { posts, home: home ? new URL(home, base).href : null };
}

function rawOf(block: string, tag: string): { attrs: string; body: string } | null {
  const match = block.match(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`));
  if (!match) return null;
  const cdata = match[2]!.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return { attrs: match[1]!, body: cdata ? cdata[1]! : decode(match[2]!) };
}

/** RSS text elements are plain text, escaped once. */
function textOf(block: string, tag: string): string | null {
  const raw = rawOf(block, tag);
  return raw?.body.replace(/\s+/g, " ").trim() || null;
}

/** Atom titles say what they carry: text, escaped html, or inline xhtml. */
function atomTitle(block: string): string | null {
  const raw = rawOf(block, "title");
  if (!raw) return null;
  const type = raw.attrs.match(/\btype=["'](\w+)["']/)?.[1] ?? "text";
  const text = type === "text" ? raw.body : decode(raw.body.replace(/<[^>]+>/g, ""));
  return text.replace(/\s+/g, " ").trim() || null;
}

function atomLink(block: string): string | null {
  const links = [...block.matchAll(/<link\b([^>]*?)\/?>/g)].map((m) => m[1]!);
  const alternate = links.find((attrs) => !/\brel=/.test(attrs) || /\brel=["']alternate["']/.test(attrs));
  const href = alternate?.match(/\bhref=["']([^"']+)["']/)?.[1];
  return href ? decode(href) : null;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED[ref.toLowerCase()] ?? whole;
  });
}
