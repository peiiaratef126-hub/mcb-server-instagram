import { FullDashboardData } from "./data-provider.js";

const DAYS_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function renderDashboardHtml(data: FullDashboardData): string {
  const { account, quotas, queue, best_time, audit_logs, last_updated } = data;

  // Heatmap rendering
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const heatmapRows = best_time.heatmap
    .map((row, dayIdx) => {
      const cells = row
        .map((score, hr) => {
          const intensity = Math.min(Math.max(score / 100, 0), 1);
          // Interpolate color from dark navy (#1e293b) to vibrant emerald (#10b981)
          const r = Math.round(30 + intensity * (16 - 30));
          const g = Math.round(41 + intensity * (185 - 41));
          const b = Math.round(59 + intensity * (129 - 59));
          const bg = `rgb(${r}, ${g}, ${b})`;
          return `<div class="heat-cell" style="background: ${bg};" title="${DAYS_NAMES[dayIdx]} ${hr}:00 UTC - Score: ${score}"></div>`;
        })
        .join("");
      return `
        <div class="heat-row">
          <span class="day-label">${DAYS_NAMES[dayIdx]}</span>
          <div class="cells-row">${cells}</div>
        </div>
      `;
    })
    .join("");

  const queueItems = queue
    .map((job) => {
      const statusClass = `status-${job.status.toLowerCase()}`;
      return `
        <tr class="queue-row">
          <td><span class="badge ${statusClass}">${job.status}</span></td>
          <td><span class="badge badge-media">${job.media_type}</span></td>
          <td class="caption-cell" title="${escapeHtml(job.caption)}">${escapeHtml(job.caption)}</td>
          <td class="mono">${job.scheduled_at ? formatTime(job.scheduled_at) : "Immediate"}</td>
          <td>${job.attempts} / ${job.max_attempts}</td>
        </tr>
      `;
    })
    .join("");

  const quotaCards = quotas.quotas
    .map((q) => {
      const pct = Math.min(q.percentage_used, 100);
      const barColor = pct > 85 ? "#ef4444" : pct > 60 ? "#f59e0b" : "#10b981";
      return `
        <div class="card quota-card">
          <div class="quota-header">
            <span class="quota-title">${escapeHtml(q.label)}</span>
            <span class="quota-val">${q.used} / ${q.limit}</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${pct}%; background: ${barColor};"></div>
          </div>
          <div class="quota-sub">${pct}% used &bull; ${q.limit - q.used} remaining</div>
        </div>
      `;
    })
    .join("");

  const auditRows = audit_logs
    .map((log) => {
      const badgeClass = log.status === "success" ? "badge-success" : log.status === "escalated" ? "badge-danger" : "badge-warning";
      return `
        <tr>
          <td><span class="badge ${badgeClass}">${log.status}</span></td>
          <td><code>${escapeHtml(log.action_type)}</code></td>
          <td>${escapeHtml(log.summary)}</td>
          <td class="mono text-muted">${formatTime(log.created_at)}</td>
        </tr>
      `;
    })
    .join("");

  const topRecs = best_time.ranked_slots
    .slice(0, 3)
    .map(
      (slot, i) => `
        <div class="rec-slot">
          <span class="rec-rank">#${i + 1}</span>
          <span class="rec-time">${slot.day_name} at ${slot.hour.toString().padStart(2, "0")}:00 UTC</span>
          <span class="rec-score">Score ${slot.score}</span>
        </div>
      `
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MCB Server Instagram &bull; Analytics & Queue Dashboard</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: rgba(22, 30, 49, 0.85);
      --card-border: rgba(255, 255, 255, 0.08);
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #3b82f6;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font-family);
      min-height: 100vh;
      padding: 24px;
      line-height: 1.5;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    /* Header */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--card-border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand h1 {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .header-badges {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    /* Badges */
    .badge {
      display: inline-block;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 600;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .badge-live { background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); }
    .badge-mode { background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); }
    .badge-media { background: rgba(168, 85, 247, 0.2); color: #c084fc; }
    .status-published, .badge-success { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .status-scheduled { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .status-pending, .status-processing, .badge-warning { background: rgba(245, 158, 11, 0.2); color: #fbbf24; }
    .status-failed, .badge-danger { background: rgba(239, 68, 68, 0.2); color: #f87171; }

    /* Cards & Grid */
    .grid {
      display: grid;
      gap: 20px;
    }
    .grid-4 { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .grid-2 { grid-template-columns: 1fr 1fr; }
    @media (max-width: 860px) {
      .grid-2 { grid-template-columns: 1fr; }
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
      backdrop-filter: blur(8px);
    }
    .card-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Account Overview */
    .profile-card {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .avatar {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      object-fit: cover;
      border: 2px solid var(--primary);
      background: #1f2937;
    }
    .profile-info h2 { font-size: 18px; margin-bottom: 4px; }
    .profile-meta { display: flex; gap: 16px; margin-top: 8px; font-size: 13px; color: var(--text-muted); }
    .profile-meta strong { color: var(--text); }

    /* Quotas */
    .quota-header { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; font-weight: 600; }
    .progress-bar { width: 100%; height: 6px; background: rgba(255, 255, 255, 0.1); border-radius: 3px; overflow: hidden; margin-bottom: 6px; }
    .progress-fill { height: 100%; border-radius: 3px; transition: width 0.3s ease; }
    .quota-sub { font-size: 11px; color: var(--text-muted); }

    /* Heatmap */
    .heat-container { margin-top: 12px; }
    .heat-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
    .day-label { width: 36px; font-size: 11px; font-weight: 600; color: var(--text-muted); }
    .cells-row { display: flex; gap: 3px; flex: 1; }
    .heat-cell { flex: 1; height: 18px; border-radius: 2px; cursor: pointer; transition: transform 0.1s; }
    .heat-cell:hover { transform: scale(1.15); z-index: 10; box-shadow: 0 0 8px rgba(0,0,0,0.5); }
    .heat-hours { display: flex; gap: 3px; margin-left: 44px; margin-top: 6px; font-size: 9px; color: var(--text-muted); }
    .heat-hours span { flex: 1; text-align: center; }

    /* Top Recommendations */
    .recs-container { display: flex; gap: 12px; margin-top: 16px; flex-wrap: wrap; }
    .rec-slot { background: rgba(255, 255, 255, 0.04); border: 1px solid var(--card-border); padding: 8px 12px; border-radius: 8px; display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .rec-rank { font-weight: 700; color: var(--primary); }
    .rec-time { font-weight: 600; }
    .rec-score { color: var(--success); font-size: 11px; }

    /* Tables */
    table { width: 100%; border-collapse: collapse; font-size: 13px; text-align: left; }
    th { color: var(--text-muted); font-size: 11px; text-transform: uppercase; padding: 10px 12px; border-bottom: 1px solid var(--card-border); }
    td { padding: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
    .caption-cell { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
    .text-muted { color: var(--text-muted); }

    footer { margin-top: 32px; text-align: center; font-size: 12px; color: var(--text-muted); border-top: 1px solid var(--card-border); padding-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header>
      <div class="brand">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
        </svg>
        <h1>MCB Server Instagram</h1>
      </div>
      <div class="header-badges">
        <span class="badge badge-live">&bull; Connected (${account.api_version})</span>
        <span class="badge badge-mode">${account.mode} mode</span>
      </div>
    </header>

    <!-- Main Grid -->
    <div class="grid" style="gap: 24px;">
      <!-- Account Card -->
      <div class="card profile-card">
        <img class="avatar" src="${escapeHtml(account.profile_picture_url || 'https://via.placeholder.com/72?text=IG')}" alt="Avatar">
        <div class="profile-info">
          <h2>@${escapeHtml(account.username)}</h2>
          <p style="font-size: 13px; color: var(--text-muted);">${escapeHtml(account.biography || account.name || 'Official Instagram Business Account')}</p>
          <div class="profile-meta">
            <span><strong>${account.followers_count.toLocaleString()}</strong> Followers</span>
            <span><strong>${account.follows_count.toLocaleString()}</strong> Following</span>
            <span><strong>${account.media_count.toLocaleString()}</strong> Posts</span>
          </div>
        </div>
      </div>

      <!-- Quotas Row -->
      <div>
        <h3 class="card-title">Daily Meta Quotas &amp; Limits</h3>
        <div class="grid grid-4">
          ${quotaCards}
        </div>
      </div>

      <!-- Two column: Best Time Heatmap & Queue -->
      <div class="grid grid-2">
        <!-- Heatmap -->
        <div class="card">
          <h3 class="card-title">Best Time to Post &bull; 7x24 UTC Heatmap</h3>
          <p style="font-size: 12px; color: var(--text-muted); margin-bottom: 12px;">${escapeHtml(best_time.recommendations_summary)}</p>
          <div class="heat-container">
            ${heatmapRows}
            <div class="heat-hours">
              <span>0h</span><span>4h</span><span>8h</span><span>12h</span><span>16h</span><span>20h</span><span>23h</span>
            </div>
          </div>
          <div class="recs-container">
            ${topRecs}
          </div>
        </div>

        <!-- Publish Queue -->
        <div class="card">
          <h3 class="card-title">Publish Queue Status</h3>
          <div style="overflow-x: auto;">
            <table>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Media</th>
                  <th>Caption</th>
                  <th>Schedule (UTC)</th>
                  <th>Retries</th>
                </tr>
              </thead>
              <tbody>
                ${queueItems}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Audit Logs Row -->
      <div class="card">
        <h3 class="card-title">Recent Automated Actions &amp; Moderation Logs</h3>
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Action</th>
                <th>Summary</th>
                <th>Time (UTC)</th>
              </tr>
            </thead>
            <tbody>
              ${auditRows}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <footer>
      MCB Server Instagram &bull; Zero-Token Client &bull; Last updated at <span class="mono">${formatTime(last_updated)}</span>
    </footer>
  </div>

  <script>
    // Live auto-refresh every 15 seconds
    setInterval(async () => {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          console.log('[Dashboard] Status poll complete');
        }
      } catch (err) {
        console.warn('[Dashboard] Background status poll failed', err);
      }
    }, 15000);
  </script>
</body>
</html>
`;
}

function escapeHtml(str?: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return isoStr;
  }
}
