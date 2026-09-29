<div align="center">

<a href="https://github.com/raelsei"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/raelsei/raelsei/output/year-dark.svg">
  <img src="https://raw.githubusercontent.com/raelsei/raelsei/output/year-light.svg" width="440" alt="A spinning ASCII torus drawn from a year of GitHub contributions">
</picture></a>

</div>

# afterglow

Your last year of GitHub contributions, wrapped around a torus and spun in
ASCII the way [donut.c](https://www.a1k0n.net/2011/07/20/donut-math.html) spins
its donut. Beside it, `whoami`, your newest posts and your links, all printed as
one terminal session straight onto your profile page. It redraws itself every
day from a GitHub Action.

The torus above is live: it is [github.com/raelsei](https://github.com/raelsei)'s
year, redrawn every day.

## How a year becomes a donut

The contribution calendar is a grid, 53 weeks by 7 days, and a torus is a grid
with both pairs of edges glued together. Weeks go around the ring and weekdays
around the tube, so the year closes on itself: last week sits next to the one a
year ago.

Each day lifts the surface by the square root of its count and takes one of
GitHub's five contribution levels as its ink. Every frame is ray-marched and
shaded into donut.c's luminance ramp, `.,-~:;=!*#$@`, and a surface turned away
from the light prints nothing, as in the original.

There is no JavaScript anywhere. GitHub serves README images through a proxy,
and an SVG loaded as an image may not run scripts or fetch anything, so:

- 120 frames are drawn once and one CSS keyframe shows each in turn, eight a
  second. A frame lingers for two more slots at falling opacity, the way a
  phosphor screen fades, which also smooths the motion.
- Every file carries its own copy of [Google Sans Code](https://github.com/googlefonts/googlesans-code),
  cut down to the characters it draws.
- Each image ships a dark and a light file, and `<picture>` follows the
  viewer's GitHub theme. Under `prefers-reduced-motion` the torus holds the
  pose that shows the most of the year.

Text lines are separate images so that every post and link can be its own
link. Their ground is transparent, so GitHub's page is the screen.

## Use it

1. Put the markers where the session should go in your profile README
   (`<you>/<you>/README.md`):

   ```md
   <!-- afterglow:start -->
   <!-- afterglow:end -->
   ```

2. Add `.github/workflows/afterglow.yml`:

   ```yaml
   name: afterglow

   on:
     schedule:
       - cron: "17 3 * * *"
     workflow_dispatch:
     push:
       branches: [main]

   permissions:
     contents: write

   concurrency:
     group: afterglow
     cancel-in-progress: true

   jobs:
     draw:
       runs-on: ubuntu-latest
       timeout-minutes: 10
       steps:
         - uses: actions/checkout@v5

         - uses: raelsei/afterglow@v1
           with:
             prompt: you@home ~ %
             whoami: |
               Your Name
               what you do, where.

               one line you stand by.
             feed: https://your.site/rss.xml
             links: |
               web https://your.site
               mail mailto:you@your.site

         # Images first, so the README never points at files that are not there yet.
         - uses: peaceiris/actions-gh-pages@v4
           with:
             github_token: ${{ secrets.GITHUB_TOKEN }}
             publish_dir: ./afterglow
             publish_branch: output
             force_orphan: true
             commit_message: "afterglow: redraw"

         - name: Commit the README when the post list changed
           run: |
             git diff --quiet README.md && exit 0
             git config user.name "github-actions[bot]"
             git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
             git add README.md
             git commit -m "afterglow: refresh the post list"
             git push
   ```

3. Run it once from the Actions tab. After that it redraws daily, and a push
   made with the workflow's own token does not trigger it again.

The README only changes when your post list, links or `whoami` do. The torus
and the daily figures keep their file names and are simply replaced on the
`output` branch, so your history does not fill up with redraws.

## Inputs

| Input       | Default                    | What it does                                                                                 |
| ----------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| `user`      | repository owner           | Whose contribution calendar is drawn.                                                         |
| `token`     | `github.token`             | Reads the calendar over GraphQL.                                                              |
| `prompt`    | `<login> ~ %`              | Printed before every command.                                                                 |
| `whoami`    | GitHub name and bio        | Lines printed by `whoami`. The first is set large; blank lines are kept.                      |
| `feed`      | none                       | RSS or Atom feed. Without it there is no post list.                                           |
| `feed_note` | none                       | Lines printed as `#` comments above the post list.                                            |
| `posts`     | `5`                        | How many posts to list, 1 to 20.                                                              |
| `posts_url` | the feed's site            | Where the closing "all of them at" line points.                                               |
| `links`     | none                       | `label url` per line, printed by `cat links`. `whoami` links to the first.                    |
| `out`       | `afterglow`                | Where the SVGs are written.                                                                   |
| `readme`    | `README.md`                | Updated between the markers. Empty leaves it alone; the block is always in `<out>/README.block.md`. |
| `base_url`  | `raw.githubusercontent.com/<repo>/output` | Where the README loads the images from.                                        |

Every figure it prints comes from the calendar it just fetched: total
contributions, the busiest day, the busiest weekday and the current streak. A
streak shorter than two days is left out rather than printed as a zero, and a
quiet today does not end it yet.

## Run it locally

```sh
bun install
GITHUB_TOKEN=$(gh auth token) bun src/main.ts --user raelsei --feed https://koray.dev/rss.xml --out /tmp/afterglow
```

Every input is also a flag (`--feed-note`, `--posts-url`, …) or an
`INPUT_<NAME>` variable. `bun test` covers the feed parser, line wrapping, the
streak rules and the README markers; `bun run build` rebuilds `dist/index.mjs`,
which is what the action runs and is committed on purpose.

## Credits

The luminance ramp and the idea are Andy Sloane's
[donut.c](https://www.a1k0n.net/2011/07/20/donut-math.html). Google Sans Code is
© The Google Sans Code Project Authors, under the
[SIL Open Font License](fonts/OFL.txt). The Phosphor palette is
[koray.dev](https://koray.dev)'s.

## Licence

Code: [MIT](LICENSE). Fonts: [OFL 1.1](fonts/OFL.txt).
