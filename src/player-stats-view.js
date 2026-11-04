import data from 'virtual:player-stats';
import { METRICS, emptyTotals, addTotals, metricValue, formatMetric, periodPlayers, filterPlayers, rankPlayers, median, winInterval, dailyTotals, leaderboardCsv } from './player-stats.js';
import './player-stats.css';

const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const count = value => value.toLocaleString('en-US');
const dateLabel = day => new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortName = name => name.length > 23 ? name.slice(0, 21) + '…' : name;
const options = selected => Object.entries(METRICS).map(([key, m]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${m.label}</option>`).join('');
const svg = (content, label, height = 320) => `<svg viewBox="0 0 620 ${height}" aria-label="${esc(label)}" role="group">${content}</svg>`;
const text = (x, y, value, extra = '') => `<text x="${x}" y="${y}" ${extra}>${esc(value)}</text>`;
const empty = message => `<div class="ps-empty">${esc(message)}</div>`;

export function setupPlayerStats(root) {
  const meta = data.meta;
  root.innerHTML = `
    <div class="ps-heading"><div><p class="eyebrow">COMMANDER BATTLE / THE PLAYER REPORT</p><h1>Every round tells a story.</h1><p class="subtitle">Explore the leaderboard. Understand the performance behind the rank.</p></div><div class="ps-edition"><span class="ps-dot"></span> RECORDED DATA<strong>${meta.snapshotDay ? esc(dateLabel(meta.snapshotDay) + ' ' + meta.snapshotDay.slice(0, 4)) : 'Journal export'}</strong><small>Static export · updated with each build</small></div></div>
    <div id="ps-notices"></div>
    <section class="ps-controls" aria-label="Player statistics filters">
      <label class="ps-search">Find a player<input id="ps-search" type="search" placeholder="Search names & past aliases…" autocomplete="off"></label>
      <label>Period<select id="ps-period"><option value="all">All recorded history</option><option value="7">Last 7 days of data</option><option value="30">Last 30 days of data</option><option value="custom">Custom dates (UTC)</option></select></label>
      <label>Minimum completed rounds<select id="ps-min"><option value="0">0 · include everyone</option><option value="5">5+ rounds</option><option value="20" selected>20+ rounds</option><option value="50">50+ rounds</option><option value="100">100+ rounds</option></select></label>
      <button id="ps-reset" class="ps-button" type="button">Reset filters ↺</button>
      <div id="ps-dates" class="ps-dates" hidden><label>From<input id="ps-from" type="date"></label><label>Through<input id="ps-through" type="date"></label></div>
      <p id="ps-filter-note" class="ps-note" role="status"></p>
    </section>
    <div id="ps-summary" class="ps-summary"></div>
    <p id="ps-insight" class="ps-insight"></p>
    <div class="ps-chart-grid">
      <section class="ps-card"><div class="ps-card-heading"><div><p class="eyebrow">01 / PERFORMANCE LANDSCAPE</p><h2>Volume meets efficiency.</h2></div><span class="ps-tag">EXPLORE</span></div>
        <div class="ps-chart-controls"><label>Horizontal axis<select id="ps-x">${options('rounds')}</select></label><label>Vertical axis<select id="ps-y">${options('personal_kd')}</select></label></div>
        <div id="ps-scatter" class="ps-chart"></div><p id="ps-scatter-readout" class="ps-readout" aria-live="polite">Hover or focus a point to inspect. Select it to open a player.</p>
        <div class="ps-legend"><span><i class="ps-swatch ps-low"></i>Lower win rate</span><span><i class="ps-swatch ps-high"></i>Higher win rate</span><span>Size = completed rounds</span></div><p id="ps-scatter-note" class="ps-note"></p>
      </section>
      <section class="ps-card"><div class="ps-card-heading"><div><p class="eyebrow">02 / THE FRONT RUNNERS</p><h2>Leading the field.</h2></div><span class="ps-tag">TOP 8</span></div>
        <label class="ps-metric-control">Rank by<select id="ps-metric">${options('squad_kills')}</select></label>
        <div id="ps-leaders" class="ps-leaders"></div><p class="ps-note">Highest values in the filtered cohort. Select a bar to inspect that player. Ties use numeric account order.</p>
      </section>
    </div>
    <div class="ps-detail-grid">
      <section class="ps-card ps-board"><div class="ps-card-heading"><div><p class="eyebrow">03 / LEADERBOARD</p><h2>The full picture.</h2></div><button id="ps-export" class="ps-button">Export CSV ↓</button></div>
        <p class="ps-note">Click a column to sort; select a name for their profile. Undefined ratios appear last.</p>
        <div id="ps-table" class="ps-table-wrap" tabindex="0" role="region" aria-label="Player leaderboard"></div>
        <div class="ps-pagination"><button id="ps-prev" class="ps-button" aria-label="Previous leaderboard page">← Previous</button><span id="ps-page" role="status"></span><button id="ps-next" class="ps-button" aria-label="Next leaderboard page">Next →</button></div>
      </section>
      <section class="ps-card ps-profile" aria-labelledby="ps-profile-title"><p class="eyebrow">04 / PLAYER DOSSIER</p>
        <label>Look up any player<select id="ps-player" aria-label="Look up any player"></select></label>
        <div id="ps-profile"></div>
        <label class="ps-compare-label">Compare with<select id="ps-compare"><option value="">Choose another player…</option></select></label><div id="ps-comparison"></div>
      </section>
    </div>
    <section class="ps-card ps-history"><div class="ps-card-heading"><div><p class="eyebrow">05 / ACTIVITY OVER TIME</p><h2>Where the action happened.</h2></div><label>Chart focus<select id="ps-history-focus"><option value="cohort">Filtered cohort</option><option value="player">Selected player</option></select></label></div>
      <div id="ps-history" class="ps-chart"></div><p id="ps-history-readout" class="ps-readout" aria-live="polite">Hover or focus a bar for that UTC day's breakdown.</p>
      <div class="ps-legend"><span><i class="ps-swatch ps-personal"></i>Personal enemy kills</span><span><i class="ps-swatch ps-squad"></i>Squad enemy kills</span></div><p class="ps-note">Actual UTC dates, including gaps. Only dates present in the indexed journals are shown; missing dates are not zero activity. The latest date may be incomplete. On smaller screens, scroll horizontally to explore earlier dates.</p>
    </section>
    <details class="ps-methods"><summary>Read the data notes & methodology <span>Definitions, coverage, and limitations ↗</span></summary><div class="ps-method-grid">
      <div><h3>What counts</h3><p>Personal kills include human and bot enemies, including combat after taking over a bot. Squad kills are credited to owned bots. Friendly kills are separate. Deaths and casualties include friendly fire and environmental causes; horses are excluded.</p><p>A completed round requires an eligible player to spawn and stay connected on the same playing team. Aborted rounds have no result. Player-rounds count participations, not unique server rounds.</p></div>
      <div><h3>How to read the ratios</h3><p>Personal K/D = personal kills ÷ deaths. Squad K/C = squad kills ÷ squad casualties. Win rate = wins ÷ completed rounds, including draws. Zero denominators are undefined (—), never infinity.</p><p>Per-round figures divide all recorded combat by completed rounds. Combat from rounds where a player did not earn a result can still count, so these are aggregate ratios, not averages of eligible-round combat.</p></div>
      <div><h3>Sample size & uncertainty</h3><p>The default cohort requires 20 completed rounds within the selected period. Medians give each player equal weight. Dashed lines mark cohort medians on the plot. Win-rate intervals use a 95% Wilson interval; team outcomes are correlated, so these intervals are descriptive, not proof of individual skill.</p><p>No playtime is collected: no hourly rates or time-based skill scores are inferred. Opponent strength, team balance, map, and squad size are not adjusted for.</p></div>
      <div><h3>Source & coverage</h3><p id="ps-source-note"></p><p>Date presets end at the last recorded event, not today. UTC boundaries include both selected dates. Profile lookup ignores search and minimum-round filters, but follows the period. Names can change; accounts stay distinct. The exported leaderboard contains the entire filtered cohort in the current sort order.</p></div>
    </div></details>`;
  const $ = id => root.querySelector('#ps-' + id);
  let sort = 'squad_kills', direction = 'desc', page = 0, selected = '', compare = '';
  let start = '', end = '', players = [], cohort = [], ranked = [];
  const perPage = 15;
  const names = [...data.players].sort((a, b) => a.name.localeCompare(b.name) || a.order - b.order);
  const nameCounts = new Map(); names.forEach(p => nameCounts.set(p.name, (nameCounts.get(p.name) || 0) + 1));
  const playerOptions = names.map(p => `<option value="${p.id}">${esc(p.name)}${nameCounts.get(p.name) > 1 ? ' · ' + p.id.slice(0, 5) : ''}</option>`).join('');
  $('player').innerHTML = playerOptions; $('compare').insertAdjacentHTML('beforeend', playerOptions);
  selected = rankPlayers(periodPlayers(data), 'squad_kills')[0]?.id || '';
  $('notices').innerHTML = meta.notes.map(note => `<p class="ps-notice">${esc(note)}</p>`).join('');
  if (!data.players.length) $('notices').insertAdjacentHTML('beforeend', empty('No player statistics are available in this build.'));
  $('period').disabled = !meta.historyValid;
  $('history-focus').disabled = !meta.historyValid;
  if (meta.days.length) for (const id of ['from', 'through']) { $(id).min = meta.days[0]; $(id).max = meta.days.at(-1); }
  $('source-note').textContent = meta.historyValid ? `${count(data.players.length)} accounts · ${count(meta.seq)} indexed events · ${count(meta.roundResults)} recorded server round results. Journal coverage: ${dateLabel(meta.days[0])}–${dateLabel(meta.days.at(-1))} ${meta.days.at(-1).slice(0, 4)}. The full journal is reconciled against the snapshot, then any later events are applied. ${meta.ignoredFiles} unindexed journal files excluded. No raw event logs or account IDs are sent to the browser.` : 'Validated cumulative snapshot only. Journal history is unavailable in this build.';

  function updatePeriod() {
    const period = $('period').value;
    $('dates').hidden = period !== 'custom';
    start = ''; end = '';
    if (period === 'custom') {
      start = $('from').value; end = $('through').value;
      if (start && end && start > end) { end = start; $('through').value = end; }
    } else if (period !== 'all' && meta.lastAt) {
      end = new Date(meta.lastAt * 1000).toISOString().slice(0, 10);
      const from = new Date(end + 'T00:00:00Z'); from.setUTCDate(from.getUTCDate() - Number(period) + 1); start = from.toISOString().slice(0, 10);
    }
  }
  function choose(id) { selected = id; render(); }
  function bindPlayers(container) {
    container.querySelectorAll('[data-player]').forEach(node => {
      node.addEventListener('click', () => choose(node.dataset.player));
      if (node.tagName.toLowerCase() !== 'button') node.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(node.dataset.player); }
      });
    });
  }
  function render() {
    updatePeriod();
    players = periodPlayers(data, start, end);
    cohort = filterPlayers(players, { search: $('search').value, minRounds: Number($('min').value) });
    ranked = rankPlayers(cohort, sort, direction);
    page = Math.max(0, Math.min(page, Math.ceil(ranked.length / perPage) - 1));
    const totals = cohort.reduce((sum, p) => addTotals(sum, p.totals), emptyTotals());
    const rate = median(cohort.map(p => metricValue(p, 'win_rate')));
    $('filter-note').textContent = `${count(cohort.length)} of ${count(players.length)} players · ${start || end ? `${start || 'Start of history'} → ${end || 'Latest event'} (UTC)` : 'All recorded history'} · Filters apply to cohort cards, plots, and leaderboard.`;
    $('summary').innerHTML = [
      ['Players in view', count(cohort.length), `${count(players.length)} recorded accounts`, '01'],
      ['Enemy kills', count(totals.personal_kills + totals.squad_kills), `${count(totals.personal_kills)} personal · ${count(totals.squad_kills)} squad`, '02'],
      ['Completed player-rounds', count(totals.rounds), 'Participations, not unique server rounds', '03'],
      ['Median player win rate', formatMetric(rate, 'win_rate'), `${count(cohort.filter(p => p.totals.rounds > 0).length)} players with completed rounds`, '04'],
    ].map(([label, value, note, n]) => `<div class="ps-stat"><span class="ps-stat-number">${n}</span><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');
    const squadShare = totals.personal_kills + totals.squad_kills ? totals.squad_kills / (totals.personal_kills + totals.squad_kills) * 100 : null;
    $('insight').innerHTML = cohort.length ? `<span class="ps-insight-label">IN THIS COHORT</span> Squads account for <strong>${formatMetric(squadShare, 'win_rate')}</strong> of enemy kills. The median personal K/D is <strong>${formatMetric(median(cohort.map(p => metricValue(p, 'personal_kd'))), 'personal_kd')}</strong>. <span>Totals reflect activity; ratios add context.</span>` : '<strong>No players match these filters.</strong> Try fewer minimum rounds, a broader period, or another name.';
    renderScatter(); renderLeaders(); renderTable(); renderProfile(); renderHistory();
  }
  function renderScatter() {
    const xKey = $('x').value, yKey = $('y').value;
    const points = cohort.map(p => ({ p, x: metricValue(p, xKey), y: metricValue(p, yKey) })).filter(p => p.x !== null && p.y !== null);
    $('scatter-readout').textContent = 'Hover or focus a point to inspect. Select it to open a player.';
    $('scatter-note').textContent = `${points.length} players plotted · ${cohort.length - points.length} omitted for undefined ratios. Dashed lines = cohort medians. Axes start at zero.`;
    if (!points.length) { $('scatter').innerHTML = empty('No players have defined values for both axes.'); return; }
    const niceMax = value => { if (!value) return 1; const p = 10 ** Math.floor(Math.log10(value)); return Math.ceil(value / p * 2) / 2 * p; };
    const xMax = niceMax(Math.max(...points.map(p => p.x))), yMax = niceMax(Math.max(...points.map(p => p.y)));
    const x = v => 65 + v / xMax * 530, y = v => 262 - v / yMax * 226;
    let content = '';
    for (let i = 0; i <= 4; i++) {
      const xx = x(xMax * i / 4), yy = y(yMax * i / 4);
      content += `<path class="ps-gridline" d="M65 ${yy}H595"/>` + text(55, yy + 4, formatMetric(yMax * i / 4, yKey), 'text-anchor="end"') + text(xx, 282, formatMetric(xMax * i / 4, xKey), 'text-anchor="middle"');
    }
    const mx = x(median(points.map(p => p.x))), my = y(median(points.map(p => p.y)));
    content += `<path class="ps-median" d="M${mx} 36V262M65 ${my}H595"/>` + text(65, 16, METRICS[yKey].short, 'class="ps-axis-title"') + text(595, 310, METRICS[xKey].short, 'text-anchor="end" class="ps-axis-title"');
    const maxRounds = Math.max(1, ...points.map(({ p }) => p.totals.rounds));
    points.sort((a, b) => b.p.totals.rounds - a.p.totals.rounds || a.p.order - b.p.order);
    for (const { p, x: xv, y: yv } of points) {
      const rate = metricValue(p, 'win_rate');
      const color = rate === null ? '#a4aca9' : `hsl(${32 + rate * 1.25} 37% ${58 - rate * .22}%)`;
      const description = `${p.name}: ${METRICS[xKey].short} ${formatMetric(xv, xKey)}; ${METRICS[yKey].short} ${formatMetric(yv, yKey)}; ${p.totals.rounds} rounds; win rate ${formatMetric(rate, 'win_rate')}`;
      content += `<circle class="ps-point ${p.id === selected ? 'is-selected' : ''}" cx="${x(xv)}" cy="${y(yv)}" r="${4 + Math.sqrt(p.totals.rounds / maxRounds) * 8}" fill="${color}" tabindex="0" role="button" data-player="${p.id}" aria-label="${esc(description)}"><title>${esc(description)}</title></circle>`;
    }
    $('scatter').innerHTML = svg(content, `${METRICS[xKey].label} versus ${METRICS[yKey].label}`);
    bindPlayers($('scatter'));
    $('scatter').querySelectorAll('.ps-point').forEach(point => {
      for (const type of ['pointerenter', 'focus']) point.addEventListener(type, () => { $('scatter-readout').textContent = point.getAttribute('aria-label'); });
    });
  }
  function renderLeaders() {
    const metric = $('metric').value;
    const leaders = rankPlayers(cohort, metric).filter(p => (metricValue(p, metric) ?? 0) > 0).slice(0, 8);
    const max = leaders.length ? metricValue(leaders[0], metric) : 1;
    $('leaders').innerHTML = leaders.length ? leaders.map((p, i) => `<button class="ps-leader ${p.id === selected ? 'is-selected' : ''}" data-player="${p.id}" title="${esc(p.name)}"><span class="ps-place">${String(i + 1).padStart(2, '0')}</span><span class="ps-leader-main"><span>${esc(p.name)}</span><span class="ps-bar-track"><span style="width:${metricValue(p, metric) / max * 100}%"></span></span></span><strong>${formatMetric(metricValue(p, metric), metric)}</strong></button>`).join('') : empty('No positive values for this metric in the current cohort.');
    bindPlayers($('leaders'));
  }
  function renderTable() {
    const keys = [...new Set(['squad_kills', 'personal_kills', 'personal_kd', 'win_rate', 'rounds', sort])];
    const rows = ranked.slice(page * perPage, (page + 1) * perPage);
    $('table').innerHTML = rows.length ? `<table><thead><tr><th scope="col">#</th><th scope="col">Player</th>${keys.map(k => `<th scope="col" aria-sort="${k === sort ? direction === 'desc' ? 'descending' : 'ascending' : 'none'}"><button data-sort="${k}">${METRICS[k].short} ${k === sort ? direction === 'desc' ? '↓' : '↑' : '↕'}</button></th>`).join('')}</tr></thead><tbody>${rows.map((p, i) => `<tr ${p.id === selected ? 'class="is-selected"' : ''}><td class="ps-row-number">${page * perPage + i + 1}</td><th scope="row"><button class="ps-player-link" data-player="${p.id}" aria-pressed="${p.id === selected}">${esc(p.name)}</button>${p.totals.rounds < 20 ? '<small class="ps-small-sample">Small sample</small>' : ''}</th>${keys.map(k => `<td class="${k === sort ? 'ps-sorted-value' : ''}">${formatMetric(metricValue(p, k), k)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : empty('No matching players. Adjust the filters above.');
    $('page').textContent = ranked.length ? `${page * perPage + 1}–${Math.min((page + 1) * perPage, ranked.length)} of ${ranked.length}` : '0 players';
    $('prev').disabled = page === 0; $('next').disabled = (page + 1) * perPage >= ranked.length; $('export').disabled = !ranked.length;
    bindPlayers($('table'));
    $('table').querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
      direction = sort === button.dataset.sort && direction === 'desc' ? 'asc' : 'desc'; sort = button.dataset.sort; page = 0; render();
    }));
  }
  function renderProfile() {
    const p = players.find(p => p.id === selected);
    $('player').value = selected;
    if (!p) { $('profile').innerHTML = empty('No player selected.'); $('comparison').replaceChildren(); return; }
    const t = p.totals, interval = winInterval(t.wins, t.rounds);
    const isInCohort = cohort.some(row => row.id === selected);
    const split = (human, bot, label) => {
      const total = human + bot;
      return `<div class="ps-combat-row"><span>${label}</span><strong>${count(total)}</strong><div class="ps-combat-track"><i style="width:${total ? human / total * 100 : 0}%"></i></div><small>${count(human)} human · ${count(bot)} bot</small></div>`;
    };
    $('profile').innerHTML = `<div class="ps-profile-heading"><span class="ps-avatar" aria-hidden="true">${esc(p.name.slice(0, 2).toUpperCase())}</span><div><h2 id="ps-profile-title">${esc(p.name)}</h2><p>${t.rounds < 20 ? 'Small sample · fewer than 20 rounds' : `${count(t.rounds)} completed rounds`} ${isInCohort ? '' : '· Outside filtered cohort'}</p></div></div>
      ${p.aliases.length ? `<details class="ps-aliases"><summary>${p.aliases.length} recorded name${p.aliases.length === 1 ? '' : 's'}</summary><p>${p.aliases.map(esc).join(', ')}</p></details>` : ''}
      <div class="ps-profile-metrics">${['personal_kd', 'squad_kd', 'win_rate', 'wins'].map(k => `<div><span>${METRICS[k].short}</span><strong>${formatMetric(metricValue(p, k), k)}</strong></div>`).join('')}</div>
      <div class="ps-outcomes" aria-label="Round outcomes">${[['wins', 'win'], ['losses', 'loss'], ['draws', 'draw']].map(([key, color]) => `<span class="ps-outcome-${color}" style="flex:${t[key]}" title="${t[key]} ${key}"></span>`).join('')}</div><p class="ps-note">${count(t.wins)} wins · ${count(t.losses)} losses · ${count(t.draws)} draws</p>
      <div class="ps-interval"><span>Win rate · 95% interval</span><strong>${interval ? `${interval[0].toFixed(1)}–${interval[1].toFixed(1)}%` : '—'}</strong><div class="ps-interval-track">${interval ? `<i style="left:${interval[0]}%;width:${interval[1] - interval[0]}%"></i><b style="left:${metricValue(p, 'win_rate')}%"></b>` : ''}</div><small>Wider intervals mean more uncertainty.</small></div>
      <h3 class="ps-subheading">Enemy kills <span>Human / bot breakdown</span></h3>${split(t.personal_human_kills, t.personal_bot_kills, 'Personal')}${split(t.squad_human_kills, t.squad_bot_kills, 'Squad')}
      <div class="ps-secondary-metrics"><span>Deaths <strong>${count(t.deaths)}</strong></span><span>Squad casualties <strong>${count(t.squad_casualties)}</strong></span><span>Personal teamkills <strong>${count(t.personal_teamkills)}</strong></span><span>Squad teamkills <strong>${count(t.squad_teamkills)}</strong></span></div>`;
    const other = players.find(p => p.id === compare);
    $('compare').value = compare;
    for (const option of $('compare').options) option.disabled = option.value === selected;
    if (other && other.id !== selected) {
      $('comparison').innerHTML = `<div class="ps-table-wrap"><table class="ps-compare-table"><thead><tr><th>Metric</th><th>${esc(shortName(p.name))}</th><th>${esc(shortName(other.name))}</th></tr></thead><tbody>${['rounds', 'personal_kills', 'squad_kills', 'personal_kd', 'squad_kd', 'win_rate'].map(k => `<tr><th scope="row">${METRICS[k].short}</th><td>${formatMetric(metricValue(p, k), k)}</td><td>${formatMetric(metricValue(other, k), k)}</td></tr>`).join('')}</tbody></table></div><p class="ps-note">Same selected period. These are descriptive comparisons, without adjustment for teams or opponents.</p>`;
    } else $('comparison').replaceChildren();
  }
  function renderHistory() {
    $('history-readout').textContent = 'Hover or focus a bar for that UTC day’s breakdown.';
    if (!meta.historyValid) { $('history').innerHTML = empty('Daily trends require a complete, validated event history. Snapshot totals remain available above.'); return; }
    const group = $('history-focus').value === 'player' ? players.filter(p => p.id === selected) : cohort;
    const rows = dailyTotals(group, meta.days, start, end);
    if (!group.length || !rows.length) { $('history').innerHTML = empty('No recorded dates or players in this selection.'); return; }
    const max = Math.max(1, ...rows.map(r => r.totals.personal_kills + r.totals.squad_kills));
    const first = Date.parse((start || rows[0].day) + 'T00:00:00Z'), last = Date.parse((end || rows.at(-1).day) + 'T00:00:00Z');
    const span = Math.max(1, (last - first) / 86400000 + 1), width = Math.min(28, 1080 / span * .7);
    const x = day => 65 + ((Date.parse(day + 'T00:00:00Z') - first) / 86400000 + .5) / span * 1080;
    let content = '';
    for (let i = 0; i <= 4; i++) { const y = 190 - i * 40; content += `<path class="ps-gridline" d="M65 ${y}H1155"/>` + text(54, y + 4, Math.round(max * i / 4).toLocaleString('en-US'), 'text-anchor="end"'); }
    const interval = Math.max(1, Math.ceil(span / 9));
    for (let i = 0; i < span; i += interval) {
      const day = new Date(first + i * 86400000).toISOString().slice(0, 10);
      content += text(x(day), 216, dateLabel(day), 'text-anchor="middle"');
    }
    for (const row of rows) {
      const personal = row.totals.personal_kills / max * 160, squad = row.totals.squad_kills / max * 160;
      const xx = x(row.day) - width / 2;
      const description = `${row.day} UTC: ${count(row.totals.personal_kills)} personal kills; ${count(row.totals.squad_kills)} squad kills; ${count(row.totals.rounds)} completed player-rounds`;
      content += `<g class="ps-day" tabindex="0" role="img" aria-label="${esc(description)}"><title>${esc(description)}</title><rect x="${xx}" y="25" width="${width}" height="166" fill="transparent"/><rect x="${xx}" y="${190 - personal}" width="${width}" height="${personal}" fill="#245e52"/><rect x="${xx}" y="${190 - personal - squad}" width="${width}" height="${squad}" fill="#a3b99a"/>${personal + squad === 0 ? `<circle cx="${x(row.day)}" cy="190" r="2" fill="#8c9990"/>` : ''}</g>`;
    }
    $('history').innerHTML = `<svg viewBox="0 0 1180 235" role="group" aria-label="Daily personal and squad kills for ${esc($('history-focus').value === 'player' ? group[0].name : 'the filtered cohort')}">${content}</svg>`;
    $('history').scrollLeft = $('history').scrollWidth;
    $('history').querySelectorAll('.ps-day').forEach(node => { for (const event of ['pointerenter', 'focus']) node.addEventListener(event, () => { $('history-readout').textContent = node.getAttribute('aria-label'); }); });
  }
  for (const id of ['period', 'min', 'from', 'through']) $(id).addEventListener('change', () => { page = 0; render(); });
  $('search').addEventListener('input', () => { page = 0; render(); });
  for (const id of ['x', 'y']) $(id).addEventListener('change', renderScatter);
  $('metric').addEventListener('change', () => { sort = $('metric').value; direction = 'desc'; page = 0; render(); });
  $('player').addEventListener('change', () => choose($('player').value));
  $('compare').addEventListener('change', () => { compare = $('compare').value; renderProfile(); });
  $('history-focus').addEventListener('change', renderHistory);
  window.addEventListener('resize', () => { $('history').scrollLeft = $('history').scrollWidth; });
  $('prev').addEventListener('click', () => { page--; renderTable(); });
  $('next').addEventListener('click', () => { page++; renderTable(); });
  $('reset').addEventListener('click', () => {
    $('search').value = ''; $('period').value = 'all'; $('min').value = '20'; $('from').value = ''; $('through').value = ''; page = 0; render();
  });
  $('export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob(['\uFEFF' + leaderboardCsv(ranked)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `player-stats-${start || 'all'}-${end || meta.snapshotDay || 'history'}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  render();
}
