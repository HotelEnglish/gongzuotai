/* ============================================================
   教学工作台 · 前端逻辑（原生 ES Module，零依赖）
   数据驱动：所有内容来自 data/ 目录下的 JSON 文件
   ============================================================ */

const $app = document.getElementById('app');
const DAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DAY_MS = 86400000;

const state = {
  index: null,        // data/index.json
  semesterId: null,
  sem: null,          // semester.json（校历）
  courses: null,      // courses.json
  plans: null,        // teachingPlans.json
  publications: null, // data/publications.json
  about: null,        // data/about.json
  trains: null,       // data/trainings.json
  view: 'dashboard',
  schedWeek: null,    // 课表当前选中周
  calYM: null,        // 日历当前年月 { y, m }
  calDetail: null,    // 日历选中日期 ISO
  pubTab: '全部',
  cache: new Map(),   // 学期数据缓存
};

/* ---------------- 日期与周次工具 ---------------- */

function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtISO(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function addDays(d, n) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
/** 返回 date 在学期中的教学周序号（1 起；学期外返回 0 或负数） */
function weekOfDate(sem, date) {
  const w1 = mondayOf(parseDate(sem.week1Start)).getTime();
  const cur = mondayOf(date).getTime();
  return Math.round((cur - w1) / (7 * DAY_MS)) + 1;
}
function weekInRange(sem, date) {
  const w = weekOfDate(sem, date);
  return w >= 1 && w <= sem.totalWeeks;
}
function currentWeek(sem) {
  const w = weekOfDate(sem, new Date());
  return Math.min(Math.max(w, 1), sem.totalWeeks);
}
/** 周次规则匹配：range 连续周 / parity 单双周 / list 指定周 */
function matchWeeks(w, weeks) {
  if (!weeks) return true;
  if (weeks.type === 'range') return w >= weeks.from && w <= weeks.to;
  if (weeks.type === 'parity') {
    if (w < weeks.from || w > weeks.to) return false;
    return weeks.parity === 'even' ? w % 2 === 0 : w % 2 === 1;
  }
  if (weeks.type === 'list') return (weeks.list || []).includes(w);
  return false;
}
function describeWeeks(weeks) {
  if (!weeks) return '全周';
  if (weeks.type === 'range') return `${weeks.from}-${weeks.to}周`;
  if (weeks.type === 'parity') return `${weeks.from}-${weeks.to}周${weeks.parity === 'even' ? '双' : '单'}周`;
  if (weeks.type === 'list') return `${(weeks.list || []).join(',')}周`;
  return '';
}
function holidayOf(sem, iso) {
  return (sem.holidays || []).find(h => h.date === iso) || null;
}
function eventsOn(sem, iso) {
  return (sem.events || []).filter(e => iso >= e.start && iso <= e.end);
}
function dayIndex(d) { return ((d.getDay() + 6) % 7) + 1; } // 1=周一 … 7=周日
function colorClass(key) { return `c-${key || 'indigo'}`; }
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- 数据加载 ---------------- */

async function fetchJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} 请求失败（${r.status}）`);
  return r.json();
}
async function loadIndex() {
  state.index = await fetchJSON('data/index.json');
}
async function loadSemester(id) {
  if (state.cache.has(id)) {
    const d = state.cache.get(id);
    state.sem = d.sem; state.courses = d.courses; state.plans = d.plans;
  } else {
    const base = `data/semesters/${id}/`;
    const [sem, courses, plans] = await Promise.all([
      fetchJSON(base + 'semester.json'),
      fetchJSON(base + 'courses.json'),
      fetchJSON(base + 'teachingPlans.json'),
    ]);
    state.sem = sem; state.courses = courses; state.plans = plans;
    state.cache.set(id, { sem, courses, plans });
  }
  state.semesterId = id;
}

/* ---------------- 课程与日期计算 ---------------- */

/** 某日期当天要上的课（已排除节假日、学期外、周次不匹配） */
function coursesOnDate(sem, courses, date) {
  const iso = fmtISO(date);
  if (holidayOf(sem, iso)) return [];
  const w = weekOfDate(sem, date);
  if (w < 1 || w > sem.totalWeeks) return [];
  const out = [];
  for (const c of courses.courses) {
    for (const s of c.sessions) {
      if (s.day === dayIndex(date) && matchWeeks(w, s.weeks)) {
        out.push({ course: c, session: s, startPeriod: Math.min(...s.periods) });
      }
    }
  }
  return out.sort((a, b) => a.startPeriod - b.startPeriod);
}

/** 构建某周的课表网格 grid[day][period]，含跨节 rowspan 信息 */
function buildWeekGrid(courses, week) {
  const grid = Array.from({ length: 8 }, () => Array.from({ length: 11 }, () => null));
  const covered = new Set();
  for (const c of courses.courses) {
    for (const s of c.sessions) {
      if (!matchWeeks(week, s.weeks)) continue;
      const start = Math.min(...s.periods);
      let row = start;
      while (covered.has(`${s.day}-${row}`) && row <= 10) row++; // 简单避让冲突
      grid[s.day][row] = { course: c, session: s, rowspan: s.periods.length };
      // 起始格(承载 chip)不放进 covered，只把 rowspan 的后续延续格标记，避免渲染时被跳过
      for (let p = row + 1; p < row + s.periods.length; p++) covered.add(`${s.day}-${p}`);
    }
  }
  return { grid, covered };
}

/* ---------------- 视图渲染 ---------------- */

function chipHTML(c, s, extra = '') {
  const times = s.periods.map(p => state.sem.periodTimes[String(p)] || '').filter(Boolean);
  return `
    <div class="chip ${colorClass(c.colorKey)}" title="${esc(c.name)} · ${esc(c.className)} · ${esc(s.room)} · ${esc(describeWeeks(s.weeks))}">
      <span class="chip-name">${esc(c.name)} ${esc(c.className)}</span>
      <span class="chip-meta">${esc(s.building || '')}${esc(s.room)}${extra ? ' · ' + esc(extra) : ''}</span>
      ${times.length ? `<span class="chip-meta">${esc(times[0].split('-')[0])}</span>` : ''}
    </div>`;
}

/* ---- 首页 Dashboard ---- */
function renderDashboard() {
  const sem = state.sem;
  const today = new Date();
  const iso = fmtISO(today);
  const w = weekOfDate(sem, today);
  const inSem = w >= 1 && w <= sem.totalWeeks;
  const holiday = holidayOf(sem, iso);
  const dow = DAY_NAMES[dayIndex(today) - 1];

  const endDays = Math.ceil((parseDate(sem.semesterEnd) - today) / DAY_MS);
  const startDays = Math.ceil((parseDate(sem.week1Start) - today) / DAY_MS);

  const statCourses = state.courses.courses.length;
  const weekPeriods = state.courses.courses.reduce((acc, c) => {
    for (const s of c.sessions) if (matchWeeks(inSem ? w : currentWeek(sem), s.weeks)) acc += s.periods.length;
    return acc;
  }, 0);
  let doneCh = 0, totalCh = 0;
  for (const p of state.plans.plans) for (const ch of p.chapters) { totalCh++; if (ch.status === 'done') doneCh++; }
  const planPct = totalCh ? Math.round((doneCh / totalCh) * 100) : 0;
  const pubCount = state.publications.items.length;

  const todayCourses = inSem && !holiday ? coursesOnDate(sem, state.courses, today) : [];

  const weekLine = inSem
    ? `第 ${w} 教学周 · 共 ${sem.totalWeeks} 周`
    : (w < 1 ? `开学前 · 距第 1 周还有 ${startDays} 天` : `学期已结束 · 寒假中`);

  $app.innerHTML = `
    <div class="card hero-week">
      <span class="hero-date">${today.getMonth() + 1} 月 ${today.getDate()} 日 ${dow}</span>
      <span class="hero-weeknum">${inSem ? `第 ${w} 周` : '假期'}</span>
      <span class="hero-sub">${esc(weekLine)}${holiday ? ` · 今天 ${esc(holiday.name)} 放假` : ''}</span>
    </div>

    ${holiday ? `<div class="notice" style="margin-top:16px">今日 ${esc(holiday.name)}，放假休息。</div>` : ''}

    <div class="grid grid-4" style="margin-top:16px">
      <div class="card stat-card"><div class="stat-label">本学期课程</div><div class="stat-value">${statCourses}<small>门</small></div></div>
      <div class="card stat-card"><div class="stat-label">本周课时</div><div class="stat-value">${weekPeriods}<small>节</small></div></div>
      <div class="card stat-card"><div class="stat-label">教学计划进度</div><div class="stat-value">${planPct}<small>%</small></div></div>
      <div class="card stat-card"><div class="stat-label">科研成果</div><div class="stat-value">${pubCount}<small>项</small></div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card card-pad">
        <div class="stat-label" style="margin-bottom:10px">今日课程（${inSem && !holiday ? `第 ${w} 周 ${dow}` : '假期无课'}）</div>
        ${inSem && !holiday
          ? (todayCourses.length
            ? `<ul class="today-list" style="display:grid;gap:8px">${todayCourses.map(({ course, session }) =>
                `<li>${chipHTML(course, session, `第 ${session.periods[0]}-${session.periods[session.periods.length - 1]} 节`)}</li>`).join('')}</ul>`
            : `<div class="empty">今天没有课</div>`)
          : `<div class="empty">${holiday ? '节假日休息' : '假期中，无课程安排'}</div>`}
      </div>
      <div class="card card-pad">
        <div class="stat-label" style="margin-bottom:10px">倒计时与快捷入口</div>
        <div style="font-size:26px;font-weight:650">
          ${inSem ? `距本学期结束 <span style="color:var(--accent)">${endDays}</span> 天` : (w < 1 ? `距开学 <span style="color:var(--accent)">${startDays}</span> 天` : '假期愉快')}
        </div>
        <div class="quick-links" style="margin-top:16px">
          <a href="#/schedule">查看课表</a>
          <a href="#/calendar">查看日历</a>
          <a href="#/plans">教学计划</a>
          <a href="#/publications">科研成果</a>
          <a href="#/trainings">培训学习</a>
        </div>
      </div>
    </div>`;
}

/* ---- 课表（周视图，按周次过滤，支持单双周/分段周） ---- */
function renderSchedule() {
  const sem = state.sem;
  const today = new Date();
  const week = state.schedWeek ?? currentWeek(sem);
  state.schedWeek = week;
  const weekStart = addDays(mondayOf(parseDate(sem.week1Start)), (week - 1) * 7);
  const todayMonday = mondayOf(today);
  const isThisWeek = weekStart.getTime() === todayMonday.getTime();

  const { grid, covered } = buildWeekGrid(state.courses, week);
  const breaks = sem.breaks || [];
  const brkAfter = new Map(breaks.map(b => [b.after, b.label]));

  let head = '<tr><th style="width:92px">节次</th>';
  for (let d = 1; d <= 7; d++) {
    const dayDate = addDays(weekStart, d - 1);
    const isToday = dayDate.getTime() - todayMonday.getTime() === (dayIndex(today) - 1) * DAY_MS && isThisWeek;
    head += `<th class="${d >= 6 ? 'weekend' : ''} ${isToday ? 'today-col' : ''}">${DAY_NAMES[d - 1]}<br><span style="font-weight:400;font-size:12px">${dayDate.getMonth() + 1}/${dayDate.getDate()}</span></th>`;
  }
  head += '</tr>';

  let body = '';
  for (let p = 1; p <= 10; p++) {
    if (brkAfter.has(p - 1)) {
      body += `<tr class="brk"><td colspan="8">— ${esc(brkAfter.get(p - 1))} —</td></tr>`;
    }
    const time = sem.periodTimes[String(p)] || '';
    body += `<tr><td class="period-cell"><b>第 ${p} 节</b>${esc(time)}</td>`;
    for (let d = 1; d <= 7; d++) {
      if (covered.has(`${d}-${p}`)) continue;
      const item = grid[d][p];
      if (item) {
        const { course, session } = item;
        body += `<td rowspan="${item.rowspan}" class="chip-in-table">${chipHTML(course, session, describeWeeks(session.weeks))}</td>`;
      } else {
        body += '<td></td>';
      }
    }
    body += '</tr>';
  }

  const legend = [...new Set(state.courses.courses.map(c => `${c.name} · ${c.className}`))]
    .map(x => `<span>${esc(x)}</span>`).join('');

  $app.innerHTML = `
    <div class="view-head">
      <div class="view-title">课表</div>
      <div class="view-desc">按教学周展示，自动处理单双周与分段周次（如 1-8 周、10-17 周、双周）</div>
    </div>
    <div class="sched-toolbar">
      <button class="week-nav-btn" id="wkPrev" ${week <= 1 ? 'disabled' : ''}>上一周</button>
      <span class="week-now">第 ${week} 周${isThisWeek ? '（本周）' : ''}</span>
      <button class="week-nav-btn" id="wkNext" ${week >= sem.totalWeeks ? 'disabled' : ''}>下一周</button>
      <select class="week-select" id="wkSelect">
        ${Array.from({ length: sem.totalWeeks }, (_, i) => i + 1).map(n =>
          `<option value="${n}" ${n === week ? 'selected' : ''}>第 ${n} 周</option>`).join('')}
      </select>
      ${isThisWeek ? '<span class="cal-week-badge">本周</span>' : '<button class="week-nav-btn" id="wkNow">回到本周</button>'}
      <span class="sched-hint">${fmtISO(weekStart)} ~ ${fmtISO(addDays(weekStart, 6))}</span>
    </div>
    <div class="card sched-table-wrap">
      <table class="sched-table"><thead>${head}</thead><tbody>${body}</tbody></table>
    </div>
    <div class="cal-legend">${legend}</div>`;

  document.getElementById('wkPrev').onclick = () => { state.schedWeek = week - 1; render(); };
  document.getElementById('wkNext').onclick = () => { state.schedWeek = week + 1; render(); };
  document.getElementById('wkSelect').onchange = e => { state.schedWeek = Number(e.target.value); render(); };
  const nowBtn = document.getElementById('wkNow');
  if (nowBtn) nowBtn.onclick = () => { state.schedWeek = currentWeek(sem); render(); };
}

/* ---- 日历（月视图 + 周数标注） ---- */
function renderCalendar() {
  const sem = state.sem;
  const today = new Date();
  if (!state.calYM) state.calYM = { y: today.getFullYear(), m: today.getMonth() };
  const { y, m } = state.calYM;

  const first = new Date(y, m, 1);
  const start = mondayOf(first);
  const todayISO = fmtISO(today);

  const calW = weekOfDate(sem, today);
  const calWValid = calW >= 1 && calW <= sem.totalWeeks;

  let cells = '';
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const iso = fmtISO(d);
    const otherMonth = d.getMonth() !== m;
    const isToday = iso === todayISO;
    const w = weekOfDate(sem, d);
    const inSem = w >= 1 && w <= sem.totalWeeks;
    const holiday = holidayOf(sem, iso);
    const evts = eventsOn(sem, iso);
    const dayCourses = coursesOnDate(sem, state.courses, d);
    const uniqueCourses = [...new Map(dayCourses.map(x => [x.course.id, x.course])).values()];
    const showWeekTag = (d.getDay() === 1 || isToday) && inSem; // 周一标注本周周数，今天也标

    cells += `
      <div class="cal-cell ${otherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}" data-date="${iso}">
        <div class="cal-date-row">
          <span class="cal-day-num">${d.getDate()}${d.getDate() === 1 && !otherMonth ? `<span style="font-size:11px;font-weight:400;color:var(--text-3)"> ${d.getMonth() + 1}月</span>` : ''}</span>
          ${showWeekTag ? `<span class="cal-week-tag mine">第${w}周</span>` : ''}
        </div>
        ${holiday ? `<div class="cal-holiday">${esc(holiday.name)}</div>` : ''}
        ${evts.map(e => `<div class="cal-event">${esc(e.name)}</div>`).join('')}
        ${uniqueCourses.length ? `<div class="cal-dots">${uniqueCourses.map(c => `<span class="cal-dot ${colorClass(c.colorKey)}" title="${esc(c.name)} ${esc(c.className)}"></span>`).join('')}</div>` : ''}
      </div>`;
  }

  const legend = [...new Set(state.courses.courses.map(c => c.colorKey))]
    .map(k => {
      const c = state.courses.courses.find(cc => cc.colorKey === k);
      return `<span><span class="cal-dot ${colorClass(k)}"></span>${esc(c.name)}</span>`;
    }).join('');

  $app.innerHTML = `
    <div class="view-head">
      <div class="view-title">日历</div>
      <div class="view-desc">月历带教学周数标注，由课表自动派生有课日，节假日自动排除</div>
    </div>
    <div class="cal-toolbar">
      <button class="week-nav-btn" id="calPrev">上月</button>
      <span class="cal-title">${y} 年 ${m + 1} 月</span>
      <button class="week-nav-btn" id="calNext">下月</button>
      <button class="week-nav-btn" id="calToday">今天</button>
      ${calWValid ? `<span class="cal-week-badge">本周：第 ${calW} 教学周</span>` : '<span class="cal-week-badge" style="color:var(--text-3);background:var(--surface-2)">假期中</span>'}
    </div>
    <div class="card">
      <div class="cal-grid">
        ${DAY_NAMES.map(n => `<div class="cal-dow">${n}</div>`).join('')}
        ${cells}
      </div>
    </div>
    <div class="cal-legend">${legend}<span style="color:var(--danger)">■ 节假日</span></div>
    <div class="card card-pad" style="color:var(--text-3);font-size:13.5px">点击日历中的任意日期，弹窗查看当天课程安排（含周次、节假日）。</div>`;

  document.getElementById('calPrev').onclick = () => {
    const nm = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 };
    state.calYM = nm; render();
  };
  document.getElementById('calNext').onclick = () => {
    const nm = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 };
    state.calYM = nm; render();
  };
  document.getElementById('calToday').onclick = () => {
    state.calYM = { y: today.getFullYear(), m: today.getMonth() };
    render();
  };
  $app.querySelectorAll('.cal-cell').forEach(el => {
    el.onclick = () => openDayModal(el.dataset.date);
  });
}

function renderDayDetail(iso) {
  const sem = state.sem;
  const d = parseDate(iso);
  const w = weekOfDate(sem, d);
  const inSem = w >= 1 && w <= sem.totalWeeks;
  const holiday = holidayOf(sem, iso);
  const evts = eventsOn(sem, iso);
  const list = coursesOnDate(sem, state.courses, d);
  const head = `${iso} ${DAY_NAMES[dayIndex(d) - 1]}${inSem ? ` · 第 ${w} 教学周` : ' · 学期外'}`;

  let body = '';
  if (holiday) body += `<div class="holiday-banner">${esc(holiday.name)} 放假，当天不排课。</div>`;
  if (evts.length) body += `<div class="cal-event" style="font-size:13px">${evts.map(e => esc(e.name)).join('、')}</div>`;
  if (!holiday && inSem) {
    body += list.length
      ? `<ul>${list.map(({ course, session }) => {
          const times = session.periods.map(p => sem.periodTimes[String(p)] || '').filter(Boolean);
          return `<li>${chipHTML(course, session, `第 ${session.periods[0]}-${session.periods[session.periods.length - 1]} 节 · ${times[0] || ''} ~ ${times[times.length - 1].split('-')[1] || ''}`)}</li>`;
        }).join('')}</ul>`
      : '<div class="empty">当天无课</div>';
  }

    return `<h3>${esc(head)}</h3>${body}`;
}

function openDayModal(iso) {
  document.getElementById('modalBody').innerHTML = renderDayDetail(iso);
  document.getElementById('modalOverlay').hidden = false;
}
function closeModal() {
  document.getElementById('modalOverlay').hidden = true;
}

/* ---- 教学计划 ---- */
function renderPlans() {
  const plans = state.plans.plans;
  if (!plans.length) { $app.innerHTML = '<div class="empty">本学期暂无教学计划数据</div>'; return; }
  const cards = plans.map(p => {
    const done = p.chapters.filter(c => c.status === 'done').length;
    const doing = p.chapters.filter(c => c.status === 'doing').length;
    const pct = p.chapters.length ? Math.round((done / p.chapters.length) * 100) : 0;
    const statusMap = { done: ['已完成', 'status-done'], doing: ['进行中', 'status-doing'], todo: ['未开始', 'status-todo'] };
    return `
      <div class="card card-pad plan-card">
        <div class="plan-head">
          <span class="plan-course">${esc(p.courseName)}</span>
          <span class="plan-class">${esc(p.className)} · ${p.hours} 学时</span>
        </div>
        <div style="color:var(--text-2);font-size:13px;margin-top:4px">${esc(p.goal || '')} · 考核：${esc(p.assessment || '')}</div>
        <div class="progress-row">
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
          <span class="progress-num">${done}/${p.chapters.length} 章 · ${pct}%${doing ? ` · ${doing} 章进行中` : ''}</span>
        </div>
        <ul class="chapter-list">
          ${p.chapters.map(ch => {
            const [label, cls] = statusMap[ch.status] || statusMap.todo;
            return `<li>
              <span class="chapter-title">${esc(ch.title)}</span>
              <span class="chapter-meta">${esc(ch.weeks)}周 · ${ch.hours}学时</span>
              <span class="status-chip ${cls}">${label}</span>
            </li>`;
          }).join('')}
        </ul>
      </div>`;
  }).join('');
  $app.innerHTML = `
    <div class="view-head">
      <div class="view-title">教学计划</div>
      <div class="view-desc">各课程大纲章节与教学进度（编辑 teachingPlans.json 更新）</div>
    </div>${cards}`;
}

/* ---- 科研成果 ---- */
function renderPublications() {
  const pubs = state.publications;
  const tabs = ['全部', ...pubs.types];
  const items = state.pubTab === '全部' ? pubs.items : pubs.items.filter(i => i.type === state.pubTab);

  const byYear = new Map();
  for (const it of items) {
    if (!byYear.has(it.year)) byYear.set(it.year, []);
    byYear.get(it.year).push(it);
  }
  const years = [...byYear.keys()].sort((a, b) => b - a);

  const yearHTML = years.map(y => `
    <div class="pub-year">${y} 年</div>
    ${byYear.get(y).map(it => `
      <div class="pub-item">
        <span class="pub-title">${esc(it.title)}</span>
        <span class="pub-meta">
          <span class="pub-tag">${esc(it.type)}</span>
          ${it.level ? `<span class="pub-tag">${esc(it.level)}</span>` : ''}
          ${it.role ? `<span class="pub-tag">${esc(it.role)}</span>` : ''}
          ${it.status ? `<span class="pub-tag ongoing">${esc(it.status)}</span>` : ''}
          ${it.publisher ? `<span class="pub-tag">${esc(it.publisher)}</span>` : ''}
        </span>
        ${it.note ? `<span class="pub-note">${esc(it.note)}</span>` : ''}
        ${it.url ? `<a class="pub-note" href="${esc(it.url)}" target="_blank" rel="noopener">查看链接</a>` : ''}
      </div>`).join('')}`).join('');

  $app.innerHTML = `
    <div class="view-head">
      <div class="view-title">科研成果</div>
      <div class="view-desc">论文 / 教材 / 课题 / 获奖（编辑 data/publications.json 即可新增更新）</div>
    </div>
    <div class="pub-tabs">
      ${tabs.map(t => `<button class="pub-tab ${t === state.pubTab ? 'active' : ''}" data-tab="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>
    <div class="card card-pad">${yearHTML || '<div class="empty">该分类暂无条目</div>'}</div>`;

  $app.querySelectorAll('.pub-tab').forEach(btn => {
    btn.onclick = () => { state.pubTab = btn.dataset.tab; render(); };
  });
}

/* ---- 培训学习 ---- */
function renderTrainings() {
  const list = state.trains.items || [];
  if (!list.length) {
    $app.innerHTML = '<div class="empty">暂无培训学习记录，请在 data/trainings.json 中添加。</div>';
    return;
  }
  const cols = [
    ['dateRange', '起止时间'], ['project', '项目名称'], ['type', '培训类型'], ['form', '培训形式'],
    ['organizer', '举办部门名称'], ['level', '培训级别'], ['duration', '培训时长'], ['location', '培训地点'],
  ];
  const head = `<tr>${cols.map(([, label]) => `<th>${esc(label)}</th>`).join('')}</tr>`;
  const body = list.map(it => `<tr>${cols.map(([key]) => {
    if (key === 'project') {
      return `<td><b>${esc(it.project || '')}</b>${it.note ? `<div class="pub-note">${esc(it.note)}</div>` : ''}</td>`;
    }
    return `<td>${esc(it[key] || '')}</td>`;
  }).join('')}</tr>`).join('');
  $app.innerHTML = `
    <div class="view-head">
      <div class="view-title">培训学习</div>
      <div class="view-desc">外出学习培训经历记录，共 ${list.length} 条（编辑 data/trainings.json 即可新增更新）</div>
    </div>
    <div class="card data-table-wrap">
      <table class="data-table"><thead>${head}</thead><tbody>${body}</tbody></table>
    </div>`;
}

/* ---- 关于 ---- */
function renderAbout() {
  const a = state.about;
  $app.innerHTML = `
    <div class="view-head">
      <div class="view-title">关于</div>
    </div>
    <div class="card card-pad">
      <div class="about-head">
        <span class="about-name">${esc(a.name)}<span style="font-size:14px;font-weight:400;color:var(--text-3);margin-left:8px">${esc(a.enName || '')}</span></span>
        <span class="about-title">${esc(a.title)} · ${esc(a.department)}</span>
      </div>
      <p class="about-bio">${esc(a.bio)}</p>
      <div class="tag-row">${(a.qualifications || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="tag-row">${(a.researchDirections || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
      <div class="tag-row">${(a.courses || []).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    </div>
    <div class="card card-pad">
      <div class="stat-label" style="margin-bottom:10px">外部链接</div>
      <ul class="link-list">
        ${(a.links || []).map(l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a></li>`).join('')}
      </ul>
    </div>`;
}

/* ---------------- 路由与初始化 ---------------- */

const VIEWS = {
  dashboard: { title: '首页', fn: renderDashboard },
  schedule: { title: '课表', fn: renderSchedule },
  calendar: { title: '日历', fn: renderCalendar },
  plans: { title: '教学计划', fn: renderPlans },
  publications: { title: '科研成果', fn: renderPublications },
  trainings: { title: '培训学习', fn: renderTrainings },
  about: { title: '关于', fn: renderAbout },
};

function render() {
  const v = VIEWS[state.view] || VIEWS.dashboard;
  document.querySelectorAll('[data-view]').forEach(a => {
    a.classList.toggle('active', a.dataset.view === state.view);
  });
  v.fn();
  document.getElementById('mobileNav').classList.remove('open');
  window.scrollTo(0, 0);
}

function bindHeader() {
  const sel = document.getElementById('semesterSelect');
  sel.innerHTML = state.index.semesters.map(s =>
    `<option value="${esc(s.id)}" ${s.id === state.semesterId ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  sel.onchange = async () => {
    await loadSemester(sel.value);
    state.schedWeek = null; state.calYM = null; state.calDetail = null;
    render();
  };

  document.getElementById('menuToggle').onclick = () => {
    document.getElementById('mobileNav').classList.toggle('open');
  };
  document.querySelectorAll('.mobile-nav a').forEach(a => {
    a.addEventListener('click', () => document.getElementById('mobileNav').classList.remove('open'));
  });

  const themeBtn = document.getElementById('themeToggle');
  const applyTheme = t => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('wb-theme', t);
    themeBtn.textContent = t === 'dark' ? '浅色' : '暗色';
  };
  applyTheme(localStorage.getItem('wb-theme') ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  themeBtn.onclick = () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  };

  document.getElementById('githubLink').href = state.index.site.github || '#';
  document.title = `${state.index.site.title} · ${state.index.site.owner}`;
}

function errorView(err) {
  $app.innerHTML = `
    <div class="notice">
      数据加载失败：${esc(err.message)}
    </div>
    <div class="card card-pad" style="color:var(--text-2);font-size:14px">
      <p style="margin-bottom:8px"><b>原因：</b>本站通过 fetch 读取 data/ 目录下的 JSON 文件，直接双击 HTML（file:// 协议）会被浏览器拦截。</p>
      <p style="margin-bottom:8px"><b>本地预览：</b>在本目录运行 <code>python -m http.server 8000</code>，然后访问 <code>http://localhost:8000</code>。</p>
      <p><b>线上部署：</b>Vercel / nginx 静态托管下无需任何配置即可正常访问。</p>
    </div>`;
}

async function init() {
  try {
    await loadIndex();
    const target = new URLSearchParams(location.hash.split('?')[1] || '');
    await loadSemester(state.index.currentSemester);
    const [pubs, about, trains] = await Promise.all([
      fetchJSON('data/publications.json'),
      fetchJSON('data/about.json'),
      fetchJSON('data/trainings.json'),
    ]);
    state.publications = pubs;
    state.about = about;
    state.trains = trains;

    const hash = location.hash.replace(/^#\//, '') || 'dashboard';
    state.view = VIEWS[hash] ? hash : 'dashboard';

    bindHeader();
    const modalOv = document.getElementById('modalOverlay');
    modalOv.addEventListener('click', e => { if (e.target === modalOv) closeModal(); });
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
    window.addEventListener('hashchange', () => {
      const h = location.hash.replace(/^#\//, '') || 'dashboard';
      if (VIEWS[h]) { state.view = h; render(); }
    });
    render();
  } catch (err) {
    errorView(err);
  }
}

init();
