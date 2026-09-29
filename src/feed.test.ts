import { expect, test } from "bun:test";
import { parseFeed } from "./feed";

test("RSS: CDATA and entities decode once, relative links resolve, newest first", () => {
  const feed = parseFeed(
    `<rss version="2.0"><channel><title>t</title><link>https://example.dev/</link>
      <atom:link href="https://example.dev/rss.xml" rel="self"/>
      <item><title>Older &amp; wiser</title><link>/posts/older/</link><pubDate>Mon, 02 Feb 2026 06:00:00 GMT</pubDate></item>
      <item><title><![CDATA[Why &lt;div&gt; can't]]></title><link>https://example.dev/posts/newer/</link><pubDate>Sat, 18 Jul 2026 06:00:00 GMT</pubDate></item>
      <item><title>Your LLM can&apos;t &lt;b&gt;count&lt;/b&gt;</title><link>/posts/middle/</link><pubDate>Fri, 01 May 2026 06:00:00 GMT</pubDate></item>
    </channel></rss>`,
    "https://example.dev/rss.xml",
  );
  expect(feed.home).toBe("https://example.dev/");
  expect(feed.posts.map((post) => [post.title, post.url])).toEqual([
    ["Why &lt;div&gt; can't", "https://example.dev/posts/newer/"],
    // Plain RSS text is escaped once: a literal tag in a title survives.
    ["Your LLM can't <b>count</b>", "https://example.dev/posts/middle/"],
    ["Older & wiser", "https://example.dev/posts/older/"],
  ]);
});

test("Atom: title type decides decoding, the alternate link wins over self", () => {
  const feed = parseFeed(
    `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
      <link rel="self" href="https://blog.example/atom.xml"/><link href="https://blog.example/"/>
      <entry><title type="html">Math.floor &lt;em&gt;is not&lt;/em&gt; a floor</title>
        <link rel="self" href="https://blog.example/api/1"/><link rel="alternate" href="https://blog.example/floor"/>
        <published>2026-02-26T06:00:00Z</published></entry>
      <entry><title>Keep &lt;div&gt; literal</title><link href="/div"/><updated>2026-03-01T00:00:00Z</updated></entry>
    </feed>`,
    "https://blog.example/atom.xml",
  );
  expect(feed.home).toBe("https://blog.example/");
  expect(feed.posts.map((post) => [post.title, post.url])).toEqual([
    ["Keep <div> literal", "https://blog.example/div"],
    ["Math.floor is not a floor", "https://blog.example/floor"],
  ]);
});

test("items without a title or a link are skipped, undated feeds keep their order", () => {
  const feed = parseFeed(
    `<rss><channel><item><title>no link</title></item><item><link>/a</link></item>
      <item><title>second</title><link>/b</link></item><item><title>third</title><link>/c</link></item></channel></rss>`,
    "https://x.dev/feed",
  );
  expect(feed.posts.map((post) => post.title)).toEqual(["second", "third"]);
  expect(feed.home).toBeNull();
});
