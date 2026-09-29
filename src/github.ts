export type Level = 0 | 1 | 2 | 3 | 4;

export interface Day {
  date: string;
  count: number;
  level: Level;
}

export interface Profile {
  login: string;
  name: string | null;
  bio: string | null;
  total: number;
  /** Calendar columns, oldest first; seven slots each, Sunday first. The first
   *  and last weeks are partial, and their missing days are null. */
  weeks: (Day | null)[][];
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
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel weekday } }
      }
    }
  }
}`;

interface RawDay {
  date: string;
  contributionCount: number;
  contributionLevel: string;
  weekday: number;
}

export async function fetchProfile(login: string, token: string): Promise<Profile> {
  const endpoint = process.env.GITHUB_GRAPHQL_URL || "https://api.github.com/graphql";
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "afterglow",
    },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GitHub GraphQL answered ${res.status}: ${await res.text()}`);

  const body = (await res.json()) as {
    data?: { user: null | {
      login: string;
      name: string | null;
      bio: string | null;
      contributionsCollection: {
        contributionCalendar: { totalContributions: number; weeks: { contributionDays: RawDay[] }[] };
      };
    } };
    errors?: { message: string }[];
  };
  if (body.errors?.length) throw new Error(`GitHub GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);
  const user = body.data?.user;
  if (!user) throw new Error(`GitHub has no user called "${login}"`);

  const calendar = user.contributionsCollection.contributionCalendar;
  return {
    login: user.login,
    name: user.name || null,
    bio: user.bio || null,
    total: calendar.totalContributions,
    weeks: calendar.weeks.map((week) => {
      const slots: (Day | null)[] = [null, null, null, null, null, null, null];
      for (const day of week.contributionDays) {
        slots[day.weekday] = {
          date: day.date,
          count: day.contributionCount,
          level: LEVELS[day.contributionLevel] ?? 0,
        };
      }
      return slots;
    }),
  };
}
