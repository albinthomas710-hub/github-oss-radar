# GitHub OSS Radar

Find GitHub repos that match **your** interests. Skip the doomscroll.

One HTML file. No install, no server, no account required to try it. Your saves, follows, and token stay in your browser and are only sent to `api.github.com`.

**Live app:** https://albinthomas710-hub.github.io/github-oss-radar/app/

Or clone the repo and open `app/index.html`. On Windows, double-click `app/launch.bat`.

## What it does

| Tab | What you get |
|---|---|
| **Briefing** | One screen of what actually matters today |
| **Insider** | Recent stars from people you follow. A gem badge means two or more of them starred the same repo |
| **Releases** | New releases from repos you saved or follow |
| **Trending** | New and fast-rising repos, ranked by velocity, your taste, and interest match |
| **Following** | Search any GitHub user and watch what they ship |
| **Curated** | Interest lanes: AI agents, Claude and MCP, startup tools, dev tools, frontend |
| **Saved** | Your stash. Your own topics. Import the repos you already starred |

Interest lanes run several GitHub searches and score each repo against keywords you care about. Save what is gold. Hide what is noise. The taste model learns from both.

## Start in 30 seconds

1. Clone this repo.
2. Open `app/index.html` in Chrome, Edge, or Firefox.
3. Click **Sign in** and paste a GitHub token with no scopes. Public data only.

Create a token at [github.com/settings/tokens](https://github.com/settings/tokens?type=beta). It raises the API limit from 60 requests per hour to 5,000. The token never leaves your machine except when the app calls GitHub.

On Windows you can also double-click `app/launch.bat`.

Optional terminal sign-in, if you already use the GitHub CLI:

```powershell
cd app
python login.py
```

## Why this exists

Good repos show up on GitHub days before someone posts them on Instagram, X, or YouTube. This radar watches trending, the people you trust, and a few interest lanes, then puts the overlap on one screen.

## Optional daily markdown report

`fetch-trending.ps1` writes a dated markdown file next to itself. It uses `GITHUB_TOKEN` if set, or a local `.github-token` file (gitignored). No scopes needed.

```powershell
powershell -File .\fetch-trending.ps1
```

## Privacy

- Saves, follows, topics, and your token live in `localStorage` for this file.
- API calls go only to `api.github.com`.
- Export or import everything from **Settings**.
- Reset wipes local data. It does not touch your GitHub account.

## License

[MIT](LICENSE)
