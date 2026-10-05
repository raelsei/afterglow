export type Level = 0 | 1 | 2 | 3 | 4;

export interface Day {
  date: string;
  count: number;
  level: Level;
}

export interface Repo {
  name: string;
  /** `owner/name`, to look the repository up again. */
  nameWithOwner: string;
  url: string;
  language: string | null;
  /** Commits in the calendar's window, by this user. */
  commits: number;
}

export interface Link {
  label: string;
  url: string;
}

export interface Pinned {
  name: string;
  url: string;
  description: string | null;
  language: string | null;
  stars: number;
}

export interface Pull {
  title: string;
  url: string;
  /** `name` in the user's own repositories, `owner/name` elsewhere. */
  repo: string;
  merged: Date;
}

export interface Release {
  /** The repository's name; releases come from the user's own repositories only. */
  repo: string;
  tag: string;
  name: string | null;
  url: string;
  published: Date;
}

export interface Commit {
  /** The first seven hex digits of the commit's id. */
  sha: string;
  /** The message's first line. */
  message: string;
  /** The repository's name. */
  repo: string;
  url: string;
  authored: Date;
}

export interface Profile {
  /** The user's GraphQL node id, which commit history filters by. */
  id: string;
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  /** Website first, then the social accounts set on the profile. */
  links: Link[];
  /** The calendar year drawn, or null for the twelve months up to today. */
  year: number | null;
  /** Whether the window runs up to today; false for a year gone by. */
  live: boolean;
  total: number;
  /** Contributions in the window by kind. `restricted` are the ones in private
   *  repositories, counted only when the user shows them, and of no stated kind. */
  kinds: { commits: number; pullRequests: number; reviews: number; issues: number; restricted: number };
  /** Calendar columns, oldest first; seven slots each, Sunday first. The first
   *  and last weeks are partial, and their missing days are null. */
  weeks: (Day | null)[][];
  /** Public repositories committed to in the calendar's window, most commits first.
   *  Private ones are dropped here, whatever the token can see. */
  repos: Repo[];
  /** Public repositories pinned on the profile, in their order. */
  pinned: Pinned[];
  /** Public pull requests opened in the window and merged, newest merge first. */
  pulls: Pull[];
  /** When the account was created. */
  since: Date;
  followers: number;
  following: number;
  /** Public repositories the user owns, forks left out. */
  repoCount: number;
  /** Stars on those repositories, summed over the 100 pushed to most recently. */
  stars: number;
  /** The latest release of each of those 100 repositories that has one, newest
   *  first. Not limited to the calendar's window: latest is latest. */
  releases: Release[];
}

const LEVELS: Record<string, Level> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const QUERY = `query ($login: String!, $from: DateTime, $to: DateTime) {
  user(login: $login) {
    id
    login
    name
    bio
    company
    websiteUrl
    createdAt
    followers { totalCount }
    following { totalCount }
    socialAccounts(first: 10) { nodes { provider displayName url } }
    repositories(first: 100, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false, orderBy: { field: PUSHED_AT, direction: DESC }) {
      totalCount
      nodes { name url stargazerCount latestRelease { tagName name url publishedAt } }
    }
    pinnedItems(first: 6, types: REPOSITORY) {
      nodes { ... on Repository { name url description stargazerCount isPrivate primaryLanguage { name } } }
    }
    contributionsCollection(from: $from, to: $to) {
      totalCommitContributions
      totalPullRequestContributions
      totalPullRequestReviewContributions
      totalIssueContributions
      restrictedContributionsCount
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel weekday } }
      }
      commitContributionsByRepository(maxRepositories: 50) {
        contributions { totalCount }
        repository { nameWithOwner name url isPrivate primaryLanguage { name } }
      }
      pullRequestContributions(first: 50, orderBy: { direction: DESC }) {
        nodes { pullRequest { title url mergedAt repository { name nameWithOwner isPrivate owner { login } } } }
      }
    }
  }
}`;

export interface RawUser {
  id: string;
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  websiteUrl: string | null;
  createdAt: string;
  followers: { totalCount: number };
  following: { totalCount: number };
  socialAccounts: { nodes: { provider: string; displayName: string; url: string }[] };
  repositories: {
    totalCount: number;
    nodes: { name: string; url: string; stargazerCount: number; latestRelease: { tagName: string; name: string | null; url: string; publishedAt: string } | null }[];
  };
  pinnedItems: {
    nodes: { name: string; url: string; description: string | null; stargazerCount: number; isPrivate: boolean; primaryLanguage: { name: string } | null }[];
  };
  contributionsCollection: {
    totalCommitContributions: number;
    totalPullRequestContributions: number;
    totalPullRequestReviewContributions: number;
    totalIssueContributions: number;
    restrictedContributionsCount: number;
    contributionCalendar: {
      totalContributions: number;
      weeks: { contributionDays: { date: string; contributionCount: number; contributionLevel: string; weekday: number }[] }[];
    };
    commitContributionsByRepository: {
      contributions: { totalCount: number };
      repository: { nameWithOwner: string; name: string; url: string; isPrivate: boolean; primaryLanguage: { name: string } | null };
    }[];
    pullRequestContributions: {
      nodes: {
        pullRequest: {
          title: string;
          url: string;
          mergedAt: string | null;
          repository: { name: string; nameWithOwner: string; isPrivate: boolean; owner: { login: string } };
        };
      }[];
    };
  };
}

/** One GraphQL request; its errors say what was being fetched. */
async function graphql<T>(what: string, query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  const endpoint = process.env.GITHUB_GRAPHQL_URL || "https://api.github.com/graphql";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "afterglow" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  }).catch((error: Error) => {
    throw new Error(`GitHub GraphQL did not answer for the ${what}: ${error.message}`);
  });
  if (!res.ok) throw new Error(`GitHub GraphQL answered ${res.status} for the ${what}: ${await res.text()}`);

  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length || !body.data) throw new Error(`GitHub GraphQL, ${what}: ${body.errors?.map((e) => e.message).join("; ") || "no data"}`);
  return body.data;
}

/** The profile over the twelve months up to today, or over calendar year `year`. */
export async function fetchProfile(login: string, token: string, year: number | null): Promise<Profile> {
  // A year still under way ends now; GitHub would draw its future days as empty.
  const range = year
    ? { from: `${year}-01-01T00:00:00Z`, to: new Date(Math.min(Date.UTC(year + 1, 0, 1) - 1000, Date.now())).toISOString() }
    : {};
  const { user } = await graphql<{ user: RawUser | null }>("profile", QUERY, { login, ...range }, token);
  if (!user) throw new Error(`GitHub has no user called "${login}"`);
  return toProfile(user, year);
}

/** A repository's default branch as the commits query answers it; null when the repository is empty. */
export interface RawHistory {
  name: string;
  defaultBranchRef: { target: { history?: { nodes: { abbreviatedOid: string; messageHeadline: string; authoredDate: string; url: string }[] } } } | null;
}

/**
 * The user's commits on the default branches of the 10 public repositories
 * they committed to most in the profile's window, newest first. A sample, not
 * the whole: at most 100 commits from each, and nothing from other branches or
 * repositories. A second request, made only when a pane asks for commits.
 */
export async function fetchCommits(profile: Profile, token: string): Promise<Commit[]> {
  const days = profile.weeks.flat().filter((day): day is Day => day !== null);
  const repos = profile.repos.slice(0, 10);
  if (days.length === 0 || repos.length === 0) return [];
  // One alias per repository; GitHub names are [\w.-], quoted all the same.
  const aliases = repos.map((repo, i) => {
    const [owner, name] = repo.nameWithOwner.split("/");
    return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ...log }`;
  });
  const query =
    `query ($id: ID!, $since: GitTimestamp, $until: GitTimestamp) { ${aliases.join(" ")} }\n` +
    "fragment log on Repository { name defaultBranchRef { target { ... on Commit { history(first: 100, author: { id: $id }, since: $since, until: $until) { nodes { abbreviatedOid messageHeadline authoredDate url } } } } } }";
  const variables = { id: profile.id, since: `${days[0]!.date}T00:00:00Z`, until: `${days.at(-1)!.date}T23:59:59Z` };
  return toCommits(await graphql<Record<string, RawHistory | null>>("commits", query, variables, token));
}

/** The commits answer as one list, newest first. A commit reached from two
 *  repositories (a fork and its upstream) counts once, in the busier one. */
export function toCommits(data: Record<string, RawHistory | null>): Commit[] {
  const commits = new Map<string, Commit>();
  for (const repo of Object.values(data)) {
    if (!repo) continue;
    for (const node of repo.defaultBranchRef?.target.history?.nodes ?? []) {
      const sha = node.abbreviatedOid.slice(0, 7);
      if (!commits.has(sha)) commits.set(sha, { sha, message: node.messageHeadline, repo: repo.name, url: node.url, authored: new Date(node.authoredDate) });
    }
  }
  return [...commits.values()].sort((a, b) => b.authored.getTime() - a.authored.getTime());
}

/** The GraphQL answer as the panes read it. Private repositories are dropped
 *  here, whatever the token could see. */
export function toProfile(user: RawUser, year: number | null): Profile {
  const links: Link[] = [];
  if (user.websiteUrl) {
    const url = /^https?:\/\//.test(user.websiteUrl) ? user.websiteUrl : `https://${user.websiteUrl}`;
    links.push({ label: "web", url });
  }
  for (const account of user.socialAccounts.nodes) {
    // GitHub's provider name, except Twitter's new one; a generic link is labelled by its host.
    const label =
      account.provider === "TWITTER"
        ? "x"
        : account.provider === "GENERIC"
          ? new URL(account.url).hostname.replace(/^www\./, "").split(".")[0]!
          : account.provider.toLowerCase();
    links.push({ label, url: account.url });
  }

  const collection = user.contributionsCollection;
  const calendar = collection.contributionCalendar;
  return {
    id: user.id,
    login: user.login,
    name: user.name || null,
    bio: user.bio || null,
    company: user.company || null,
    location: user.location || null,
    links,
    year,
    live: year === null || year >= new Date().getUTCFullYear(),
    total: calendar.totalContributions,
    kinds: {
      commits: collection.totalCommitContributions,
      pullRequests: collection.totalPullRequestContributions,
      reviews: collection.totalPullRequestReviewContributions,
      issues: collection.totalIssueContributions,
      restricted: collection.restrictedContributionsCount,
    },
    weeks: calendar.weeks.map((week) => {
      const slots: (Day | null)[] = [null, null, null, null, null, null, null];
      for (const day of week.contributionDays) {
        slots[day.weekday] = { date: day.date, count: day.contributionCount, level: LEVELS[day.contributionLevel] ?? 0 };
      }
      return slots;
    }),
    repos: collection.commitContributionsByRepository
      .filter((entry) => !entry.repository.isPrivate)
      .map((entry) => ({
        name: entry.repository.name,
        nameWithOwner: entry.repository.nameWithOwner,
        url: entry.repository.url,
        language: entry.repository.primaryLanguage?.name ?? null,
        commits: entry.contributions.totalCount,
      }))
      .sort((a, b) => b.commits - a.commits),
    pinned: user.pinnedItems.nodes
      .filter((repo) => !repo.isPrivate)
      .map((repo) => ({
        name: repo.name,
        url: repo.url,
        description: repo.description || null,
        language: repo.primaryLanguage?.name ?? null,
        stars: repo.stargazerCount,
      })),
    pulls: collection.pullRequestContributions.nodes
      .map((node) => node.pullRequest)
      .filter((pull) => pull.mergedAt && !pull.repository.isPrivate)
      .map((pull) => ({
        title: pull.title,
        url: pull.url,
        repo: pull.repository.owner.login === user.login ? pull.repository.name : pull.repository.nameWithOwner,
        merged: new Date(pull.mergedAt!),
      }))
      .sort((a, b) => b.merged.getTime() - a.merged.getTime()),
    since: new Date(user.createdAt),
    followers: user.followers.totalCount,
    following: user.following.totalCount,
    repoCount: user.repositories.totalCount,
    stars: user.repositories.nodes.reduce((n, repo) => n + repo.stargazerCount, 0),
    releases: user.repositories.nodes
      .flatMap(({ name, latestRelease: release }) =>
        release ? [{ repo: name, tag: release.tagName, name: release.name || null, url: release.url, published: new Date(release.publishedAt) }] : [],
      )
      .sort((a, b) => b.published.getTime() - a.published.getTime()),
  };
}
