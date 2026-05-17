// ── State ──────────────────────────────────────────────────────────────────
let appData = null;

async function loadData(runId = null) {
  const url = runId ? `/api/data?run_id=${runId}` : '/api/data';
  const res = await fetch(url);
  appData = await res.json();
  render();
}

function render() {
  if (!appData) return;
  renderSummaryBar();
  renderGrid();
  renderChart();
}

// Bootstrap
loadData();

// ── Summary bar ────────────────────────────────────────────────────────────
function renderSummaryBar() {
  const { summary, runs, current_run_id } = appData;

  document.getElementById('found-count').textContent = summary.found;

  const newlyEl = document.getElementById('newly-added');
  newlyEl.textContent = summary.newly_added?.length
    ? `+${summary.newly_added.join(', ')} since last run`
    : '';

  const selector = document.getElementById('run-selector');
  if (selector.children.length === 0) {
    runs.forEach(run => {
      const opt = document.createElement('option');
      opt.value = run.id;
      opt.textContent = new Date(run.ran_at).toLocaleString();
      selector.appendChild(opt);
    });
    selector.addEventListener('change', () => {
      loadData(Number(selector.value) || null);
    });
  }
  selector.value = current_run_id;
}

// ── Crawl button ───────────────────────────────────────────────────────────
document.getElementById('crawl-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Crawling…';
  await fetch('/api/crawl', { method: 'POST' });
  let attempts = 0;
  const poll = setInterval(async () => {
    attempts++;
    const res = await fetch('/api/data');
    const data = await res.json();
    if (data.runs.length > appData.runs.length || attempts > 20) {
      clearInterval(poll);
      appData = data;
      btn.disabled = false;
      btn.textContent = 'Run crawl';
      // Rebuild run selector with new runs included
      const selector = document.getElementById('run-selector');
      selector.innerHTML = '';
      data.runs.forEach(run => {
        const opt = document.createElement('option');
        opt.value = run.id;
        opt.textContent = new Date(run.ran_at).toLocaleString();
        selector.appendChild(opt);
      });
      render();
    }
  }, 3000);
});

// ── State grid ─────────────────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('state-grid');
  grid.innerHTML = '';

  for (const entity of appData.entities) {
    const card = document.createElement('div');
    const typeLabel = entity.type === 'dc' ? 'District' : entity.type;
    card.className = `state-card ${entity.current.found ? 'found' : 'not-found'}${entity.current.changed ? ' changed' : ''}`;
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const since = entity.current.first_seen_at
      ? `<div class="card-since">Since ${new Date(entity.current.first_seen_at).toLocaleDateString()}</div>`
      : '';

    card.innerHTML = `
      <div class="card-name">${entity.name}</div>
      <div class="card-type">${typeLabel}</div>
      ${since}
    `;

    card.addEventListener('click', () => openDetail(entity));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') openDetail(entity); });
    grid.appendChild(card);
  }
}

// ── Timeline chart (SVG) ───────────────────────────────────────────────────
function renderChart() {
  const container = document.getElementById('chart-container');
  const { runs, entities } = appData;

  if (runs.length < 2) {
    container.innerHTML = '<p style="color:var(--gray-400);font-size:.875rem;padding:.5rem 0">Run the crawler a second time to see the adoption trend.</p>';
    return;
  }

  const points = runs.slice().reverse().map(run => {
    const count = entities.reduce((n, e) => {
      const h = e.history.find(h => h.run_id === run.id);
      return n + (h?.found ? 1 : 0);
    }, 0);
    return { date: new Date(run.ran_at), count, runId: run.id };
  });

  const W = 800, H = 140;
  const PAD = { top: 10, right: 20, bottom: 30, left: 30 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const maxCount = Math.max(...points.map(p => p.count), 10);

  const xScale = i => PAD.left + (i / Math.max(points.length - 1, 1)) * innerW;
  const yScale = v => PAD.top + innerH - (v / maxCount) * innerH;

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.count)}`).join(' ');

  const labelStep = Math.max(1, Math.floor(points.length / 6));
  const xLabels = points.map((p, i) => {
    if (i % labelStep !== 0 && i !== points.length - 1) return '';
    const label = p.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `<text x="${xScale(i)}" y="${H - 4}" text-anchor="middle" fill="var(--gray-400)" font-size="10">${label}</text>`;
  }).join('');

  const yTicks = [0, Math.round(maxCount / 2), maxCount].map(v =>
    `<text x="${PAD.left - 6}" y="${yScale(v) + 4}" text-anchor="end" fill="var(--gray-400)" font-size="10">${v}</text>
     <line x1="${PAD.left}" y1="${yScale(v)}" x2="${W - PAD.right}" y2="${yScale(v)}" stroke="var(--gray-100)" stroke-width="1"/>`
  ).join('');

  const dots = points.map((p, i) =>
    `<circle cx="${xScale(i)}" cy="${yScale(p.count)}" r="4" fill="var(--blue)" stroke="white" stroke-width="2">
      <title>${p.date.toLocaleDateString()}: ${p.count} found</title>
    </circle>`
  ).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="overflow:visible">
      ${yTicks}
      <path d="${pathD}" fill="none" stroke="var(--blue)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      ${xLabels}
    </svg>
  `;
}

// ── Detail panel ───────────────────────────────────────────────────────────
function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function diffLines(prev, curr) {
  const prevLines = prev.split('\n');
  const currLines = curr.split('\n');
  const prevSet = new Set(prevLines);
  const currSet = new Set(currLines);
  const result = [];
  for (const line of prevLines) {
    result.push({ type: currSet.has(line) ? 'same' : 'remove', line });
  }
  for (const line of currLines) {
    if (!prevSet.has(line)) result.push({ type: 'add', line });
  }
  return result;
}

function renderDiff(prev, curr) {
  const lines = diffLines(prev, curr);
  const hasChanges = lines.some(l => l.type !== 'same');
  if (!hasChanges) return '<p style="font-size:.8125rem;color:var(--gray-400)">Content unchanged</p>';
  return `<div class="diff-view">${lines.map(l =>
    `<div class="diff-line ${l.type}">${l.type === 'add' ? '+ ' : l.type === 'remove' ? '− ' : '  '}${escHtml(l.line)}</div>`
  ).join('')}</div>`;
}

function renderLlmsContent(content) {
  const lines = content.split('\n');
  let html = '';
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('# ')) {
      html += `<p style="font-weight:650;font-size:.9375rem;margin-bottom:.25rem">${escHtml(t.slice(2))}</p>`;
    } else if (t.startsWith('> ')) {
      html += `<p style="color:var(--gray-400);font-size:.8125rem;margin-bottom:.75rem">${escHtml(t.slice(2))}</p>`;
    } else if (t.startsWith('## ')) {
      html += `<div class="llms-section-name">${escHtml(t.slice(3))}</div>`;
    } else if (t.startsWith('- [')) {
      const m = t.match(/^- \[([^\]]+)\]\(([^)]+)\)(?::\s*(.+))?$/);
      if (m) {
        html += `<div class="llms-link">
          <a href="${escHtml(m[2])}" target="_blank" rel="noopener">${escHtml(m[1])}</a>
          ${m[3] ? `<span class="link-desc">${escHtml(m[3])}</span>` : ''}
        </div>`;
      }
    }
  }
  return html || `<pre style="font-size:.75rem;white-space:pre-wrap">${escHtml(content)}</pre>`;
}

function openDetail(entity) {
  const dialog = document.getElementById('detail-dialog');
  const { current } = entity;

  document.getElementById('dialog-title').textContent = entity.name;
  const urlEl = document.getElementById('dialog-url');
  urlEl.href = entity.url;
  urlEl.textContent = entity.url.replace('https://', '');

  const badge = document.getElementById('dialog-badge');
  badge.textContent = current.found ? 'Has llms.txt' : 'Not found';
  badge.className = `status-badge ${current.found ? 'found' : 'not-found'}`;

  const body = document.getElementById('dialog-body');
  body.innerHTML = '';

  if (current.found && current.content) {
    const contentSection = document.createElement('div');
    contentSection.className = 'llms-content';
    contentSection.innerHTML = `<h3>llms.txt content</h3>${renderLlmsContent(current.content)}`;
    body.appendChild(contentSection);

    if (current.changed && current.prev_content) {
      const diffSection = document.createElement('div');
      diffSection.innerHTML = `<h3 style="font-size:.75rem;font-weight:650;text-transform:uppercase;letter-spacing:.05em;color:var(--amber);margin-bottom:.5rem">Changes since last run</h3>${renderDiff(current.prev_content, current.content)}`;
      body.appendChild(diffSection);
    }
  } else {
    body.innerHTML = `<p style="color:var(--gray-400);font-size:.875rem">No llms.txt found at <code>${escHtml(entity.url)}/llms.txt</code></p>`;
  }

  if (entity.history.length > 1) {
    const histSection = document.createElement('div');
    const dots = entity.history.map(h =>
      `<span title="${h.ran_at}" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${h.found ? 'var(--blue)' : 'var(--gray-200)'};margin-right:3px"></span>`
    ).join('');
    histSection.innerHTML = `<div><p style="font-size:.75rem;font-weight:650;text-transform:uppercase;letter-spacing:.05em;color:var(--gray-400);margin-bottom:.5rem">Run history</p><div>${dots}</div></div>`;
    body.appendChild(histSection);
  }

  dialog.showModal();
}

document.getElementById('dialog-close').addEventListener('click', () => {
  document.getElementById('detail-dialog').close();
});
document.getElementById('detail-dialog').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});
