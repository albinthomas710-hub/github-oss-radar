<#
    fetch-trending.ps1
    Daily GitHub Trending report generator.
    No external dependencies beyond PowerShell.
#>

$ErrorActionPreference = 'Stop'

$OutDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$LogPath = Join-Path $OutDir 'fetch-trending.log'

function Write-Log {
    param([string]$Level, [string]$Message)
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    "$ts [$Level] $Message" | Add-Content -Path $LogPath -Encoding UTF8
}

# AI/DEV keyword list
$Keywords = @(
    'ai','llm','gpt','claude','agent','machine-learning','deep-learning',
    'generative','copilot','assistant','automation','dev-tool','developer-tool',
    'cli','mcp'
)

function Test-AiDev {
    param($repo)
    $parts = @()
    if ($repo.description) { $parts += $repo.description }
    if ($repo.full_name)   { $parts += $repo.full_name }
    if ($repo.topics)      { $parts += ($repo.topics -join ' ') }
    $blob = ($parts -join ' ').ToLower()
    # Tokenize on non-alphanumerics (keep hyphens so 'machine-learning' survives)
    $tokens = [regex]::Split($blob, '[^a-z0-9\-]+') | Where-Object { $_ }
    foreach ($k in $Keywords) {
        if ($tokens -contains $k) { return $true }
    }
    return $false
}

function Invoke-GithubSearch {
    param([string]$Query, [int]$PerPage)
    $url = "https://api.github.com/search/repositories?q=$([uri]::EscapeDataString($Query))&sort=stars&order=desc&per_page=$PerPage"
    $headers = @{
        'User-Agent' = 'github-trending-daily'
        'Accept'     = 'application/vnd.github+json'
    }
    # Try env var, then a local token file
    $token = $env:GITHUB_TOKEN
    if (-not $token) {
        $tokenFile = Join-Path $OutDir '.github-token'
        if (Test-Path $tokenFile) { $token = (Get-Content $tokenFile -Raw).Trim() }
    }
    if ($token) {
        $headers['Authorization'] = "Bearer $token"
    }
    return Invoke-RestMethod -Uri $url -Headers $headers -Method Get
}

function Format-RepoEntry {
    param($repo, [int]$Rank, [bool]$IsAiDev)
    $stars    = '{0:N0}' -f [int]$repo.stargazers_count
    $lang     = if ($repo.language) { $repo.language } else { 'n/a' }
    $created  = ([datetime]$repo.created_at).ToString('yyyy-MM-dd')
    $tag      = if ($IsAiDev) { ' **[AI/DEV]**' } else { '' }
    $topicStr = ''
    if ($repo.topics -and $repo.topics.Count -gt 0) {
        $top5 = $repo.topics | Select-Object -First 5
        $topicStr = "   Topics: " + ($top5 -join ', ') + "`n"
    }
    $desc = if ($repo.description) { $repo.description.Trim() } else { '_No description_' }
    return "$Rank. [$($repo.full_name)]($($repo.html_url))$tag - star $stars - $lang - created $created`n$topicStr   $desc`n"
}

try {
    if (-not (Test-Path $OutDir)) {
        New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
    }

    Write-Log 'INFO' 'Run started.'

    $nowUtc  = (Get-Date).ToUniversalTime()
    $since7  = $nowUtc.AddDays(-7).ToString('yyyy-MM-dd')
    $since30 = $nowUtc.AddDays(-30).ToString('yyyy-MM-dd')

    Write-Log 'INFO' "Fetching weekly (created:>=$since7)"
    $week = Invoke-GithubSearch -Query "created:>=$since7" -PerPage 10

    Start-Sleep -Seconds 2

    Write-Log 'INFO' "Fetching monthly (created:>=$since30)"
    $month = Invoke-GithubSearch -Query "created:>=$since30" -PerPage 5

    $today    = Get-Date
    $dateStr  = $today.ToString('yyyy-MM-dd')
    $dayName  = $today.DayOfWeek.ToString()
    $outFile  = Join-Path $OutDir "$dateStr-trending.md"

    # Pre-compute AI/DEV flags for weekly list (used in Content Radar)
    $weekFlags = @()
    foreach ($r in $week.items) {
        $weekFlags += [pscustomobject]@{ Repo = $r; IsAiDev = (Test-AiDev $r) }
    }
    $aiCount = ($weekFlags | Where-Object { $_.IsAiDev }).Count
    $topAi   = $weekFlags | Where-Object { $_.IsAiDev } | Select-Object -First 1

    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("# GitHub Trending - $dateStr ($dayName)")
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('## Top 10 Trending This Week')
    [void]$sb.AppendLine('')
    $i = 1
    foreach ($wf in $weekFlags) {
        [void]$sb.AppendLine((Format-RepoEntry -repo $wf.Repo -Rank $i -IsAiDev $wf.IsAiDev))
        $i++
    }

    [void]$sb.AppendLine('## Top 5 Trending This Month')
    [void]$sb.AppendLine('')
    $i = 1
    foreach ($r in $month.items) {
        $flag = Test-AiDev $r
        [void]$sb.AppendLine((Format-RepoEntry -repo $r -Rank $i -IsAiDev $flag))
        $i++
    }

    [void]$sb.AppendLine('## Content Radar')
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine("AI/DEV-relevant repos this week: **$aiCount / $($weekFlags.Count)**")
    [void]$sb.AppendLine('')
    if ($topAi) {
        $tStars = '{0:N0}' -f [int]$topAi.Repo.stargazers_count
        $tDesc  = if ($topAi.Repo.description) { $topAi.Repo.description.Trim() } else { '_No description_' }
        [void]$sb.AppendLine("**Top AI pick:** [$($topAi.Repo.full_name)]($($topAi.Repo.html_url)) - star $tStars")
        [void]$sb.AppendLine('')
        [void]$sb.AppendLine($tDesc)
    } else {
        [void]$sb.AppendLine('_No AI/DEV-tagged repos in this week''s top 10._')
    }

    # Interest Lane Highlights
    $lanes = @(
        @{ Name = '🤖 AI Agents & LLMs';        Keywords = @('agent','agents','llm','gpt','claude','anthropic','openai','langchain','autogpt','crewai','autonomous','reasoning','rag','retrieval','embedding') },
        @{ Name = '⚡ Claude & MCP & Cursor';    Keywords = @('claude','claude-code','cursor','mcp','anthropic','model-context-protocol','sonnet','opus','haiku','windsurf','cline') },
        @{ Name = '🚀 Startup & SaaS Tools';     Keywords = @('saas','startup','boilerplate','starter','mvp','landing-page','stripe','payment','auth','waitlist','indie-hacker','launch','pricing') },
        @{ Name = '🛠 Developer Tools & CLI';     Keywords = @('cli','terminal','devtools','developer-tool','productivity','automation','workflow','build-tool','linter','formatter','debugger') },
        @{ Name = '🎨 Frontend & UI';            Keywords = @('react','nextjs','tailwind','ui','component','design-system','css','animation','shadcn','radix','svelte','vue','astro') }
    )

    $allTrending = @($week.items) + @($month.items) | Sort-Object full_name -Unique
    $laneHits = @()
    foreach ($lane in $lanes) {
        $matched = @()
        foreach ($repo in $allTrending) {
            $parts = @()
            if ($repo.description) { $parts += $repo.description }
            if ($repo.full_name)   { $parts += $repo.full_name }
            if ($repo.topics)      { $parts += ($repo.topics -join ' ') }
            $blob = ($parts -join ' ').ToLower()
            $tokens = [regex]::Split($blob, '[^a-z0-9\-]+') | Where-Object { $_ }
            $hits = 0
            foreach ($kw in $lane.Keywords) {
                if ($tokens -contains $kw -or $blob.Contains($kw)) { $hits++ }
            }
            if ($hits -ge 2) {
                $matched += [pscustomobject]@{ Repo = $repo; Hits = $hits }
            }
        }
        if ($matched.Count -gt 0) {
            $top3 = $matched | Sort-Object Hits -Descending | Select-Object -First 3
            $laneHits += [pscustomobject]@{ Lane = $lane; Repos = $top3 }
        }
    }

    if ($laneHits.Count -gt 0) {
        [void]$sb.AppendLine('')
        [void]$sb.AppendLine('## Interest Lane Highlights')
        [void]$sb.AppendLine('')
        foreach ($lh in $laneHits) {
            [void]$sb.AppendLine("### $($lh.Lane.Name)")
            [void]$sb.AppendLine('')
            $i = 1
            foreach ($m in $lh.Repos) {
                $r = $m.Repo
                $stars = '{0:N0}' -f [int]$r.stargazers_count
                $desc  = if ($r.description) { $r.description.Trim() } else { '_No description_' }
                [void]$sb.AppendLine("$i. [$($r.full_name)]($($r.html_url)) - star $stars · keyword hits $($m.Hits)")
                [void]$sb.AppendLine("   $desc")
                [void]$sb.AppendLine('')
                $i++
            }
        }
    }

    Set-Content -Path $outFile -Value $sb.ToString() -Encoding UTF8
    Write-Log 'INFO' "Wrote $outFile"
    Write-Output $outFile
}
catch {
    Write-Log 'ERROR' ($_ | Out-String)
    exit 1
}
