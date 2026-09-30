export type Level = 0 | 1 | 2 | 3 | 4;

export interface Day {
  date: string;
  count: number;
  level: Level;
}

export interface Repo {
  name: string;
  url: string;
  language: string | null;
  /** Commits in the calendar's window, by this user. */
  commits: number;
}

export interface Link {
  label: string;
  url: string;
}

export interface Profile {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  /** Website first, then the social accounts set on the profile. */
  links: Link[];
  total: number;
  /** Calendar columns, oldest first; seven slots each, Sunday first. The first
   *  and last weeks are partial, and their missing days are null. */
  weeks: (Day | null)[][];
  /** Public repositories committed to in the calendar's window, most commits first.
   *  Private ones are dropped here, whatever the token can see. */
  repos: Repo[];
}

const LEVELS: Record<string, Level> = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
};

const QUERY = `query ($login: String!) {
  user(login: $login) {
    login
    name
    bio
    company
    location
    websiteUrl
    socialAccounts(first: 10) { nodes { provider displayName url } }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel weekday } }
      }
      commitContributionsByRepository(maxRepositories: 50) {
        contributions { totalCount }
        repository { nameWithOwner name url isPrivate primaryLanguage { name } }
      }
    }
  }
}`;

interface RawUser {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  websiteUrl: string | null;
  socialAccounts: { nodes: { provider: string; displayName: string; url: string }[] };
  contributionsCollection: {
    contributionCalendar: {
      totalContributions: number;
      weeks: { contributionDays: { date: string; contributionCount: number; contributionLevel: string; weekday: number }[] }[];
    };
    commitContributionsByRepository: {
      contributions: { totalCount: number };
      repository: { nameWithOwner: string; name: string; url: string; isPrivate: boolean; primaryLanguage: { name: string } | null };
    }[];
  };
}

/** Labels for the providers GitHub names; anything else is labelled by its host. */
const PROVIDERS: Record<string, string> = {
  TWITTER: "x",
  LINKEDIN: "linkedin",
  MASTODON: "mastodon",
  BLUESKY: "bluesky",
  INSTAGRAM: "instagram",
  YOUTUBE: "youtube",
  FACEBOOK: "facebook",
  REDDIT: "reddit",
  TWITCH: "twitch",
  NPM: "npm",
  HOMETOWN: "hometown",
};

export async function fetchProfile(login: string, token: string): Promise<Profile> {
  const endpoint = process.env.GITHUB_GRAPHQL_URL || "https://api.github.com/graphql";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "afterglow" },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL answered ${res.status}: ${await res.text()}`);

  const body = (await res.json()) as { data?: { user: RawUser | null }; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`GitHub GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
  const user = body.data?.user;
  if (!user) throw new Error(`GitHub has no user called "${login}"`);

  const links: Link[] = [];
  if (user.websiteUrl) {
    const url = /^https?:\/\//.test(user.websiteUrl) ? user.websiteUrl : `https://${user.websiteUrl}`;
    links.push({ label: "web", url });
  }
  for (const account of user.socialAccounts.nodes) {
    const label = PROVIDERS[account.provider] ?? new URL(account.url).hostname.replace(/^www\./, "").split(".")[0]!;
    links.push({ label, url: account.url });
  }

  const collection = user.contributionsCollection;
  const calendar = collection.contributionCalendar;
  return {
    login: user.login,
    name: user.name || null,
    bio: user.bio || null,
    company: user.company || null,
    location: user.location || null,
    links,
    total: calendar.totalContributions,
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
        url: entry.repository.url,
        language: entry.repository.primaryLanguage?.name ?? null,
        commits: entry.contributions.totalCount,
      }))
      .sort((a, b) => b.commits - a.commits),
  };
}
