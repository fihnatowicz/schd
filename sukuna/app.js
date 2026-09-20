(() => {
'use strict';
const DATA = JSON.parse(document.getElementById('schedule').textContent);

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const minToT = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const DAY_ACC = { 1: 'в понедельник', 2: 'во вторник', 3: 'в среду', 4: 'в четверг', 5: 'в пятницу', 6: 'в субботу' };
const plural = (n, one, few, many) => { const a = n % 100, b = n % 10; if (a > 10 && a < 20) return many; if (b > 1 && b < 5) return few; if (b === 1) return one; return many; };
const fmtDur = mins => { mins = Math.max(0, Math.ceil(mins)); const h = Math.floor(mins / 60), m = mins % 60; return h ? (m ? `${h} ч ${m} мин` : `${h} ч`) : `${m} мин`; };
const fmtDurShort = mins => { const h = Math.floor(mins / 60), m = mins % 60; return h ? (m ? `${h}ч ${m}м` : `${h}ч`) : `${m}м`; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmtDate = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
const fmtRange = (a, b) => a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${MONTHS[b.getMonth()]}` : `${fmtDate(a)} – ${fmtDate(b)}`;
const kindClass = c => c === 'ПР' ? 'k-pr' : c === 'ИНД' ? 'k-ind' : c === 'ГР' ? 'k-gr' : 'k-l';
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const headerH = () => $('#top').offsetHeight;

/* week Mon..Sat containing `now`; Sunday rolls to the coming week */
function weekDates(now, weekOffset) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((dow + 6) % 7) + (dow === 0 ? 7 : 0) + weekOffset * 7);
  const map = {};
  for (let i = 1; i <= 6; i++) { const x = new Date(mon); x.setDate(mon.getDate() + i - 1); map[i] = x; }
  return map;
}
const isSecondTuesday = d => d.getDay() === 2 && d.getDate() >= 8 && d.getDate() <= 14;
function nextSecondTuesday(from) {
  for (let k = 0; k < 24; k++) {
    const m = new Date(from.getFullYear(), from.getMonth() + k, 1);
    const second = new Date(m.getFullYear(), m.getMonth(), 1 + ((2 - m.getDay() + 7) % 7) + 7);
    if (second >= from) return second;
  }
  return null;
}

/* ---------- flatten: two weeks, only days that have lessons ---------- */
const WEEKS = [0, 1];
const DAYS = DATA.days.filter(d => d.lessons.length);
const ITEMS = [];
WEEKS.forEach(week => DAYS.forEach(day => day.lessons.forEach((lesson, idx) => {
  ITEMS.push({
    id: `l-${week}-${day.dow}-${idx}`, week, day, lesson, idx,
    s: toMin(lesson.start), e: toMin(lesson.end),
    slots: lesson.slots.map(([a, b]) => [toMin(a), toMin(b)]),
    subject: [...new Set(lesson.parts.map(p => p.subject))].join(' / '),
  });
})));

/* ---------- time state ---------- */
function compute(now) {
  const dates = WEEKS.map(w => weekDates(now, w));
  const todayDow = now.getDay();
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  let live = null, next = null;
  ITEMS.forEach(it => {
    it.date = dates[it.week][it.day.dow];
    it.enabled = it.lesson.cond === 'second-tuesday' ? isSecondTuesday(it.date) : true;
    let st = 'future';
    if (it.week === 0 && todayDow !== 0) {
      if (it.day.dow < todayDow) st = 'past';
      else if (it.day.dow === todayDow) { if (nowMin >= it.e) st = 'past'; else if (nowMin >= it.s) st = 'live'; }
    }
    if (!it.enabled && st === 'live') st = 'future';
    it.status = st; it.isNext = false; it.onBreak = false; it.resumeAt = null;
    it.progress = st === 'live' ? (nowMin - it.s) / (it.e - it.s) : 0;
    if (st === 'live' && !it.slots.some(([a, b]) => nowMin >= a && nowMin < b)) {
      it.onBreak = true;
      const nx = it.slots.find(([a]) => a > nowMin);
      it.resumeAt = nx ? nx[0] : null;
    }
    if (it.enabled) {
      if (st === 'live' && !live) live = it;
      if (st === 'future' && !next) next = it;
    }
  });
  if (next) next.isNext = true;
  return { now, dates, todayDow, nowMin, live, next, target: live || next };
}

/* ---------- render ---------- */
function cardEl(it) {
  const L = it.lesson;
  const subjects = [...new Set(L.parts.map(p => p.subject))];
  const kind = (L.parts.find(p => p.kind) || {}).kind;
  const multi = L.parts.length > 1;
  const parts = L.parts.map((p, i) => `
    <div class="part">
      ${multi ? `<span class="idx">${i + 1}</span>` : ''}
      <div class="info">
        ${subjects.length > 1 ? `<span class="psub">${esc(p.subject)}</span>` : ''}
        ${p.teacher ? `<span class="teacher">${esc(p.teacher)}${p.role ? ` <small>${esc(p.role)}</small>` : ''}</span>` : ''}
        ${p.room && p.room.place ? `<span class="place">${esc(p.room.place)}</span>` : ''}
      </div>
      ${p.room && p.room.room ? `<span class="room"><small>к.${p.room.building}</small><b>${esc(p.room.room)}</b></span>` : ''}
    </div>`).join('');
  const el = document.createElement('article');
  el.className = 'lesson';
  el.id = it.id;
  el.style.setProperty('--i', it.idx);
  el.innerHTML = `
    <i class="nt nt-t"></i><i class="nt nt-b"></i><span class="stk" hidden></span>
    <div class="tcol"><span class="ts">${L.start}</span><span class="te">${L.end}</span><span class="td">${fmtDurShort(it.e - it.s)}</span></div>
    <div class="body">
      <div class="head"><span class="badge" hidden></span>${kind ? `<span class="kind ${kindClass(kind.code)}" title="${esc(kind.label)}">${esc(kind.code)}</span>` : ''}</div>
      <h3 class="subject">${esc(subjects.join(' / '))}</h3>
      <div class="parts">${parts}</div>
      <div class="note" ${L.note ? '' : 'hidden'}>${esc(L.note || '')}</div>
      <div class="prog" hidden><i></i></div>
      <div class="status" hidden></div>
    </div>`;
  it.el = el;
  it.refs = { badge: $('.badge', el), stk: $('.stk', el), note: $('.note', el), prog: $('.prog', el), bar: $('.prog i', el), status: $('.status', el) };
  return el;
}

function render(st) {
  const frag = document.createDocumentFragment();
  WEEKS.forEach(week => {
    const dates = st.dates[week];
    if (week > 0) {
      const sep = document.createElement('div');
      sep.className = 'week-sep';
      sep.innerHTML = `<em class="jp">次</em><span>следующая неделя</span><i>${fmtRange(dates[DAYS[0].dow], dates[DAYS[DAYS.length - 1].dow])}</i>`;
      frag.appendChild(sep);
    }
    DAYS.forEach(day => {
      const date = dates[day.dow];
      const isToday = sameDay(date, st.now);
      const n = day.lessons.length;
      const sec = document.createElement('section');
      sec.className = 'day' + (isToday ? ' today' : '');
      sec.id = `day-${week}-${day.dow}`;
      sec.dataset.key = `${week}-${day.dow}`;
      sec.innerHTML = `<h2 class="day-head">
        <span class="dn">${day.name}</span><span class="dd">${fmtDate(date)}</span>
        ${isToday ? '<span class="chip today-chip">сегодня</span>' : ''}
        <span class="dc">${n} ${plural(n, 'занятие', 'занятия', 'занятий')}</span></h2>`;
      ITEMS.filter(it => it.week === week && it.day === day).forEach(it => sec.appendChild(cardEl(it)));
      frag.appendChild(sec);
    });
  });
  $('#list').replaceChildren(frag);

  $('#daynav').innerHTML = WEEKS.map(week => DAYS.map(d => {
    const dt = st.dates[week][d.dow];
    return `<button type="button" class="dchip${sameDay(dt, st.now) ? ' is-today' : ''}" data-key="${week}-${d.dow}"><span>${d.short}</span><b>${pad(dt.getDate())}</b></button>`;
  }).join('')).join('<span class="wk-sep"></span>');
  $$('.dchip').forEach(b => b.addEventListener('click', () => scrollToDay(b.dataset.key)));
}

function whenText(it, st) {
  if (sameDay(it.date, st.now)) return `начнётся в ${it.lesson.start} · через ${fmtDur(it.s - st.nowMin)}`;
  const tomorrow = new Date(st.now); tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(it.date, tomorrow)) return `завтра в ${it.lesson.start}`;
  return `${DAY_ACC[it.day.dow]}, ${fmtDate(it.date)} в ${it.lesson.start}`;
}

function patch(it, st) {
  const { el, refs } = it;
  el.classList.toggle('past', it.status === 'past');
  el.classList.toggle('live', it.status === 'live');
  el.classList.toggle('next', it.isNext);
  el.classList.toggle('cond', !it.enabled);
  el.classList.toggle('brk', it.status === 'live' && it.onBreak);

  let mark = '';
  if (it.status === 'live') {
    refs.badge.hidden = false; refs.badge.className = 'badge live' + (it.onBreak ? ' brk' : '');
    refs.badge.innerHTML = `<i class="dot"></i>${it.onBreak ? 'перерыв' : 'сейчас'}`;
    mark = it.onBreak ? '休' : '呪';
  } else if (it.isNext) {
    refs.badge.hidden = false; refs.badge.className = 'badge next'; refs.badge.textContent = 'далее';
    mark = '次';
  } else refs.badge.hidden = true;
  refs.stk.hidden = !mark;
  if (mark && refs.stk.textContent !== mark) refs.stk.textContent = mark;

  refs.prog.hidden = it.status !== 'live';
  if (it.status === 'live') refs.bar.style.width = (Math.min(1, it.progress) * 100).toFixed(2) + '%';

  let txt = '';
  if (it.status === 'live') {
    txt = it.onBreak && it.resumeAt != null
      ? `перерыв · продолжение в ${minToT(it.resumeAt)}`
      : `идёт · до ${it.lesson.end} · осталось ${fmtDur(it.e - st.nowMin)}`;
  } else if (it.isNext) txt = whenText(it, st);
  refs.status.hidden = !txt; refs.status.textContent = txt;

  if (it.lesson.cond === 'second-tuesday') {
    const nx = it.enabled ? null : nextSecondTuesday(it.date);
    refs.note.textContent = it.enabled
      ? 'проводится на этой неделе · 2-й вторник месяца'
      : `только во 2-й вторник месяца${nx ? ` · ближайший — ${fmtDate(nx)}` : ''}`;
  }
}

function renderFab(st) {
  const live = !!st.live;
  $('#fab').classList.toggle('alt', !live);
  $('#fab-txt').textContent = live ? 'Сейчас' : 'Далее';
}

function renderStatic() {
  const m = DATA.meta;
  document.title = `${m.title} · расписание`;
  $('#m-title').textContent = m.title;
  $('#m-sub').textContent = m.subtitle;
}

/* ---------- scrolling ---------- */
function scrollToItem(it) {
  if (!it || !it.el) return;
  if (it.idx === 0) return scrollToDay(`${it.week}-${it.day.dow}`);   /* first lesson: show the whole day from its header */
  const r = it.el.getBoundingClientRect();
  const hdr = headerH();
  const avail = innerHeight - hdr;
  const top = scrollY + r.top - hdr - Math.max(52, (avail - r.height) / 2);
  scrollTo({ top: Math.max(0, top), behavior: reduced ? 'auto' : 'smooth' });
}
function scrollToDay(key) {
  const sec = $(`#day-${key}`);
  if (!sec) return;
  const prev = sec.previousElementSibling;
  const anchor = prev && prev.classList.contains('week-sep') ? prev : sec;   /* keep the week divider visible */
  scrollTo({ top: Math.max(0, scrollY + anchor.getBoundingClientRect().top - headerH() - (anchor === sec ? -1 : 10)), behavior: reduced ? 'auto' : 'smooth' });
}
let spyRaf = 0, activeKey = null;
function spy() {
  spyRaf = 0;
  const hdr = headerH();
  const limit = hdr + Math.max(44, (innerHeight - hdr) * 0.25);
  let cur = null;
  $$('.day').forEach(sec => { if (sec.getBoundingClientRect().top <= limit) cur = sec; });
  const key = cur ? cur.dataset.key : ($('.day') || {}).dataset?.key;
  if (key === activeKey) return;
  activeKey = key;
  const nav = $('#daynav');
  $$('.dchip').forEach(b => {
    const on = b.dataset.key === key;
    b.classList.toggle('active', on);
    if (on) nav.scrollTo({ left: b.offsetLeft - (nav.clientWidth - b.offsetWidth) / 2, behavior: reduced ? 'auto' : 'smooth' });
  });
}
addEventListener('scroll', () => { if (!spyRaf) spyRaf = requestAnimationFrame(spy); }, { passive: true });

let io = null;
function watchTarget(it) {
  if (io) io.disconnect();
  const fab = $('#fab');
  if (!it) { fab.classList.remove('show'); return; }
  io = new IntersectionObserver(([en]) => fab.classList.toggle('show', !en.isIntersecting),
    { rootMargin: `-${headerH()}px 0px 0px 0px`, threshold: 0.15 });
  io.observe(it.el);
}

/* ---------- loop ---------- */
let state = null, renderedKey = null, targetId = null;
function tick() {
  const now = new Date();
  $('#ch').textContent = pad(now.getHours());
  $('#cm').textContent = pad(now.getMinutes());
  $('#cs').textContent = pad(now.getSeconds());
  const st = compute(now);
  const key = st.dates[0][1].toDateString() + '|' + now.toDateString();
  if (key !== renderedKey) { renderedKey = key; activeKey = null; render(st); }
  ITEMS.forEach(it => patch(it, st));
  renderFab(st);
  const tid = st.target ? st.target.id : null;
  if (tid !== targetId) { targetId = tid; watchTarget(st.target); }
  state = st;
  return st;
}

new ResizeObserver(() => document.documentElement.style.setProperty('--hdr-h', headerH() + 'px')).observe($('#top'));
$('#fab').addEventListener('click', () => scrollToItem(state && state.target));
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

renderStatic();
tick();
spy();
setInterval(tick, 1000);
setTimeout(() => scrollToItem(state && state.target), 320);
})();
