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
  renderMasthead();
  renderGrid();
  renderChart();
}

function formatRelative(iso) {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day} day${day === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Bootstrap
loadData();

// ── Masthead ───────────────────────────────────────────────────────────────
function renderMasthead() {
  const { summary, runs, current_run_id } = appData;
  const currentRun = runs.find(r => r.id === current_run_id);

  document.getElementById('found-count').textContent = summary.found;
  document.getElementById('total-count').textContent = summary.total;

  const subline = document.getElementById('subline');
  const parts = [];
  if (currentRun) parts.push(`Crawled ${formatRelative(currentRun.ran_at)}`);

  const delta = summary.found - (summary.prev_found ?? summary.found);
  if (summary.newly_added?.length) {
    parts.push(`<span class="delta delta-up">+${summary.newly_added.length} new</span>`);
  } else if (delta === 0 && summary.prev_found !== undefined && runs.length > 1) {
    parts.push(`no change since last run`);
  } else if (delta < 0) {
    parts.push(`<span class="delta">${delta} since last run</span>`);
  }
  subline.innerHTML = parts.join(' · ');

  const selector = document.getElementById('run-selector');
  if (selector.children.length === 0) {
    runs.forEach((run, i) => {
      const opt = document.createElement('option');
      opt.value = run.id;
      const label = i === 0 ? 'Latest run' : new Date(run.ran_at).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
      });
      opt.textContent = label;
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

// ── Grid ───────────────────────────────────────────────────────────────────
function renderGrid() {
  const foundGrid = document.getElementById('found-grid');
  const missingGrid = document.getElementById('missing-grid');
  const foundSection = document.getElementById('found-section');
  foundGrid.innerHTML = '';
  missingGrid.innerHTML = '';

  const found = appData.entities.filter(e => e.current.found);
  const missing = appData.entities.filter(e => !e.current.found);

  document.getElementById('found-section-count').textContent = found.length;
  document.getElementById('missing-section-count').textContent = missing.length;
  foundSection.style.display = found.length ? '' : 'none';

  for (const entity of found) foundGrid.appendChild(buildFoundCard(entity));
  for (const entity of missing) missingGrid.appendChild(buildMissingChip(entity));
}

function buildFoundCard(entity) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `found-card${entity.current.changed ? ' changed' : ''}`;

  const since = entity.current.first_seen_at
    ? new Date(entity.current.first_seen_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : '';

  const linkCount = entity.current.content
    ? (entity.current.content.match(/^- \[/gm) ?? []).length
    : 0;

  const typeLabel = entity.type === 'state' ? '' : (entity.type === 'dc' ? 'District' : 'Territory');
  const metaParts = [typeLabel, since && `tracking since ${since}`].filter(Boolean);

  card.innerHTML = `
    <div class="found-card-head">
      <div class="found-card-name">${entity.name}</div>
      ${metaParts.length ? `<div class="found-card-meta">${metaParts.join(' · ')}</div>` : ''}
    </div>
    <div class="found-card-stats">
      ${linkCount > 0 ? `<span class="stat"><span class="stat-num">${linkCount}</span> link${linkCount === 1 ? '' : 's'}</span>` : ''}
      <span class="found-card-url">${entity.url.replace(/^https?:\/\//, '')}</span>
    </div>
  `;

  card.addEventListener('click', () => openDetail(entity));
  return card;
}

function buildMissingChip(entity) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'missing-chip';
  if (entity.type !== 'state') chip.classList.add(`type-${entity.type}`);
  chip.title = `${entity.name}: ${entity.url.replace(/^https?:\/\//, '')}/llms.txt`;
  chip.textContent = entity.name;
  chip.addEventListener('click', () => openDetail(entity));
  return chip;
}

// ── Timeline chart (SVG) ───────────────────────────────────────────────────
function renderChart() {
  const container = document.getElementById('chart-container');
  const { runs, entities, summary } = appData;

  // One point per day: keep the most recent run for each calendar day
  const runsByDay = new Map();
  for (const run of runs.slice().reverse()) {
    const key = new Date(run.ran_at).toDateString();
    runsByDay.set(key, run);
  }
  const dailyRuns = [...runsByDay.values()];

  if (dailyRuns.length < 2) {
    container.innerHTML = '<p class="chart-empty">One day of data so far. Check back tomorrow to see the trend.</p>';
    return;
  }

  const points = dailyRuns.map(run => {
    const count = entities.reduce((n, e) => {
      const h = e.history.find(h => h.run_id === run.id);
      return n + (h?.found ? 1 : 0);
    }, 0);
    return { date: new Date(run.ran_at), count, runId: run.id };
  });

  const W = 800, H = 130;
  const PAD = { top: 18, right: 24, bottom: 26, left: 32 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const dataMax = Math.max(...points.map(p => p.count), 1);
  const yMax = Math.max(Math.ceil(dataMax * 1.4 / 5) * 5, 5);

  const xScale = i => PAD.left + (i / Math.max(points.length - 1, 1)) * innerW;
  const yScale = v => PAD.top + innerH - (v / yMax) * innerH;

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(p.count)}`).join(' ');
  const areaD = `${pathD} L ${xScale(points.length - 1)} ${yScale(0)} L ${xScale(0)} ${yScale(0)} Z`;

  const fmtDate = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  const xLabels = points.map((p, i) => {
    const isEdge = i === 0 || i === points.length - 1;
    if (!isEdge && points.length > 6 && i % Math.ceil(points.length / 5) !== 0) return '';
    const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
    return `<text x="${xScale(i)}" y="${H - 6}" text-anchor="${anchor}" fill="var(--ink-3)" font-size="10" font-family="var(--font)">${fmtDate(p.date)}</text>`;
  }).join('');

  const yTicks = [0, yMax].map(v =>
    `<text x="${PAD.left - 8}" y="${yScale(v) + 3}" text-anchor="end" fill="var(--ink-3)" font-size="10" font-family="var(--font)">${v}</text>
     <line x1="${PAD.left}" y1="${yScale(v)}" x2="${W - PAD.right}" y2="${yScale(v)}" stroke="var(--line-soft)" stroke-width="1"/>`
  ).join('');

  const dots = points.map((p, i) => {
    const isLast = i === points.length - 1;
    const r = isLast ? 5 : 3.5;
    return `<g>
      ${isLast ? `<circle cx="${xScale(i)}" cy="${yScale(p.count)}" r="10" fill="var(--accent)" opacity="0.12"/>` : ''}
      <circle cx="${xScale(i)}" cy="${yScale(p.count)}" r="${r}" fill="var(--accent)" stroke="var(--surface)" stroke-width="${isLast ? 2.5 : 2}">
        <title>${p.date.toLocaleDateString()}: ${p.count} found</title>
      </circle>
    </g>`;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${yTicks}
      <path d="${areaD}" fill="url(#area-fill)"/>
      <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
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
  if (!hasChanges) return '<p style="font-size:.8125rem;color:var(--ink-3)">Content unchanged</p>';
  return `<div class="diff-view">${lines.map(l =>
    `<div class="diff-line ${l.type}">${l.type === 'add' ? '+ ' : l.type === 'remove' ? '− ' : '  '}${escHtml(l.line)}</div>`
  ).join('')}</div>`;
}

function inlineFormat(text) {
  let s = escHtml(text);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g,
    (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s;
}

function renderLlmsContent(content) {
  const lines = content.split('\n');
  const out = [];
  let listBuf = null;
  let paraBuf = null;

  const flushPara = () => {
    if (paraBuf) { out.push(`<p class="lc-p">${inlineFormat(paraBuf.join(' '))}</p>`); paraBuf = null; }
  };
  const flushList = () => {
    if (listBuf) {
      out.push(`<ul class="lc-list">${listBuf.map(item => {
        const linkMatch = item.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)(?:\s*[:—-]\s*(.+))?$/);
        if (linkMatch) {
          const [, label, url, desc] = linkMatch;
          return `<li class="lc-li lc-li-link"><a href="${escHtml(url)}" target="_blank" rel="noopener">${escHtml(label)}</a>${desc ? `<span class="lc-li-desc">${escHtml(desc)}</span>` : ''}</li>`;
        }
        return `<li class="lc-li">${inlineFormat(item)}</li>`;
      }).join('')}</ul>`);
      listBuf = null;
    }
  };
  const flushAll = () => { flushPara(); flushList(); };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();

    if (!trimmed) { flushAll(); continue; }

    const h = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      flushAll();
      const level = h[1].length;
      out.push(`<h${level === 1 ? 1 : level === 2 ? 2 : 3} class="lc-h lc-h${level}">${inlineFormat(h[2])}</h${level === 1 ? 1 : level === 2 ? 2 : 3}>`);
      continue;
    }

    if (trimmed.startsWith('> ')) {
      flushAll();
      out.push(`<blockquote class="lc-quote">${inlineFormat(trimmed.slice(2))}</blockquote>`);
      continue;
    }

    const li = line.match(/^\s*[-*]\s+(.+)$/);
    if (li) {
      flushPara();
      listBuf = listBuf ?? [];
      listBuf.push(li[1]);
      continue;
    }

    flushList();
    paraBuf = paraBuf ?? [];
    paraBuf.push(trimmed);
  }
  flushAll();

  return out.join('') || `<pre class="lc-raw">${escHtml(content)}</pre>`;
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
    body.innerHTML = `<p style="color:var(--ink-3);font-size:.875rem">No llms.txt found at <code>${escHtml(entity.url)}/llms.txt</code></p>`;
  }

  if (entity.history.length > 1) {
    const histSection = document.createElement('div');
    const dots = entity.history.map(h =>
      `<span title="${h.ran_at}" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${h.found ? 'var(--accent)' : 'var(--line)'};margin-right:3px"></span>`
    ).join('');
    histSection.innerHTML = `<div><p style="font-size:.75rem;font-weight:650;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-3);margin-bottom:.5rem">Run history</p><div>${dots}</div></div>`;
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
