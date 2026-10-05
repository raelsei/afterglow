import { expect, test } from "bun:test";
import { toCommits, toProfile, type RawHistory, type RawUser } from "./github";

const repo = (name: string, commits: number, isPrivate = false, language: string | null = null) => ({
  contributions: { totalCount: commits },
  repository: { nameWithOwner: `me/${name}`, name, url: `https://github.com/me/${name}`, isPrivate, primaryLanguage: language ? { name: language } : null },
});

const pinned = (name: string, isPrivate = false) => ({
  name,
  url: `https://github.com/me/${name}`,
  description: "",
  stargazerCount: 3,
  isPrivate,
  primaryLanguage: null,
});

const pull = (title: string, mergedAt: string | null, owner = "me", isPrivate = false) => ({
  pullRequest: { title, url: `https://github.com/${owner}/x/pull/1`, mergedAt, repository: { name: "x", nameWithOwner: `${owner}/x`, isPrivate, owner: { login: owner } } },
});

const owned = (name: string, stars: number, release: [string, string | null, string] | null = null) => ({
  name,
  url: `https://github.com/me/${name}`,
  stargazerCount: stars,
  latestRelease: release && { tagName: release[0], name: release[1], url: `https://github.com/me/${name}/releases/tag/${release[0]}`, publishedAt: release[2] },
});

const user: RawUser = {
  id: "U_me",
  login: "me",
  name: "",
  bio: "Writes things.",
  company: null,
  location: null,
  websiteUrl: "me.dev",
  createdAt: "2020-05-17T08:00:00Z",
  followers: { totalCount: 8 },
  following: { totalCount: 3 },
  repositories: {
    totalCount: 4,
    nodes: [
      owned("old", 1, ["v1.0.0", "", "2025-01-10T00:00:00Z"]),
      owned("none", 2),
      owned("new", 4, ["v0.2.0", "Second", "2026-07-02T00:00:00Z"]),
    ],
  },
  socialAccounts: {
    nodes: [
      { provider: "TWITTER", displayName: "@me", url: "https://twitter.com/me" },
      { provider: "MASTODON", displayName: "@me", url: "https://hachyderm.io/@me" },
      { provider: "GENERIC", displayName: "me", url: "https://www.codeberg.org/me" },
    ],
  },
  pinnedItems: { nodes: [pinned("shown"), pinned("hidden", true)] },
  contributionsCollection: {
    totalCommitContributions: 7,
    totalPullRequestContributions: 4,
    totalPullRequestReviewContributions: 0,
    totalIssueContributions: 1,
    restrictedContributionsCount: 0,
    contributionCalendar: {
      totalContributions: 6,
      weeks: [
        {
          contributionDays: [
            { date: "2026-09-30", contributionCount: 4, contributionLevel: "THIRD_QUARTILE", weekday: 3 },
            { date: "2026-10-01", contributionCount: 2, contributionLevel: "FIRST_QUARTILE", weekday: 4 },
          ],
        },
      ],
    },
    commitContributionsByRepository: [repo("small", 2), repo("secret", 9, true), repo("big", 5, false, "TypeScript")],
    pullRequestContributions: {
      nodes: [
        pull("open", null),
        pull("older", "2026-03-01T10:00:00Z", "someone"),
        pull("closed in secret", "2026-09-01T10:00:00Z", "me", true),
        pull("newer", "2026-08-01T10:00:00Z"),
      ],
    },
  },
};

test("links: the website gains a scheme, accounts are labelled by provider, a generic one by its host", () => {
  expect(toProfile(user, null).links).toEqual([
    { label: "web", url: "https://me.dev" },
    { label: "x", url: "https://twitter.com/me" },
    { label: "mastodon", url: "https://hachyderm.io/@me" },
    { label: "codeberg", url: "https://www.codeberg.org/me" },
  ]);
});

test("a partial week keeps its days in their weekday slots, the rest empty", () => {
  expect(toProfile(user, null).weeks).toEqual([
    [null, null, null, { date: "2026-09-30", count: 4, level: 3 }, { date: "2026-10-01", count: 2, level: 1 }, null, null],
  ]);
});

test("private repositories drop out, whatever the token saw; the rest go most commits first", () => {
  const profile = toProfile(user, null);
  expect(profile.repos.map((r) => [r.name, r.commits, r.language])).toEqual([
    ["big", 5, "TypeScript"],
    ["small", 2, null],
  ]);
  expect(profile.name).toBeNull();
});

test("pinned keeps the public repositories; pulls keep the merged public ones, newest merge first, named by owner elsewhere", () => {
  const profile = toProfile(user, null);
  expect(profile.pinned.map((repo) => [repo.name, repo.description])).toEqual([["shown", null]]);
  expect(profile.pulls.map((p) => [p.title, p.repo])).toEqual([
    ["newer", "x"],
    ["older", "someone/x"],
  ]);
});

test("a year gone by is not live; the last twelve months and this year are", () => {
  const thisYear = new Date().getUTCFullYear();
  expect([toProfile(user, null).live, toProfile(user, thisYear).live, toProfile(user, thisYear - 1).live]).toEqual([true, true, false]);
});

test("releases keep the repositories that have one, newest first, an empty name as none", () => {
  const profile = toProfile(user, null);
  expect(profile.releases.map((r) => [r.repo, r.tag, r.name])).toEqual([
    ["new", "v0.2.0", "Second"],
    ["old", "v1.0.0", null],
  ]);
});

const history = (name: string, commits: [string, string][]): RawHistory => ({
  name,
  defaultBranchRef: {
    target: { history: { nodes: commits.map(([oid, at]) => ({ abbreviatedOid: oid, messageHeadline: `${name} ${oid}`, authoredDate: at, url: `https://github.com/me/${name}/commit/${oid}` })) } },
  },
});

test("commits from every repository merge newest first; one reached twice keeps the busier repository; empty ones add nothing", () => {
  const commits = toCommits({
    r0: history("big", [["aaaaaaa1", "2026-09-02T10:00:00Z"], ["bbbbbbb", "2026-08-01T10:00:00Z"]]),
    r1: { name: "empty", defaultBranchRef: null },
    r2: history("fork", [["ccccccc", "2026-09-10T23:30:00Z"], ["bbbbbbb", "2026-08-01T10:00:00Z"]]),
    r3: null,
  });
  expect(commits.map((c) => [c.sha, c.repo])).toEqual([
    ["ccccccc", "fork"],
    ["aaaaaaa", "big"],
    ["bbbbbbb", "big"],
  ]);
  expect(commits[0]!.authored.toISOString()).toBe("2026-09-10T23:30:00.000Z");
});
