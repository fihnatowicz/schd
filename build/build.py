"""
Обновляет расписание сайта.

    python build/build.py                       # пересобрать index.html из schedule.json
    python build/build.py file.xlsx             # разобрать xlsx (лист "1  акт") -> schedule.json -> index.html
    python build/build.py file.xlsx "1  акт"    # явно указать файл и лист

Разметка живёт в index.html, стили в app.css, логика в app.js — их можно править
руками, пересборка для этого не нужна. Скрипт трогает только блок
<script id="schedule"> внутри index.html.

Соседние одинаковые 45-минутные слоты склеиваются в один блок (границы слотов
сохраняются — по ним страница определяет «перерыв» внутри блока).
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

DAYS = {
    'понедельник': ('Понедельник', 'Пн', 1),
    'вторник': ('Вторник', 'Вт', 2),
    'среда': ('Среда', 'Ср', 3),
    'четверг': ('Четверг', 'Чт', 4),
    'пятница': ('Пятница', 'Пт', 5),
    'суббота': ('Суббота', 'Сб', 6),
}
ROLE = {
    'п': 'проф.', 'д': 'доц.', 'д.': 'доц.',
    'с.пр': 'ст. преп.', 'с.пр.': 'ст. преп.', 'ст.п': 'ст. преп.',
    'пр': 'преп.', 'пр.': 'преп.',
}
KIND = {
    'пр': ('ПР', 'практическое занятие'),
    'инд': ('ИНД', 'индивидуальное занятие'),
    'гр': ('ГР', 'групповое занятие'),
    'л': ('Л', 'лекция'),
    'с': ('С', 'семинар'),
    'л пр': ('Л·ПР', 'лекция / практика'),
    'л/с': ('Л·С', 'лекция / семинар'),
}
SUBJECT_FIX = {'Бел.яз.': 'Белорусский язык'}

META = {
    'title': 'Ангелина',
    'subtitle': 'актёрское искусство · 1 курс',
}


def clean(s):
    if s is None:
        return ''
    s = str(s).replace('\xa0', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    return re.sub(r'[/\s]+$', '', s).strip()


def fix_teacher(t):
    t = clean(t)
    t = re.sub(r',$', '.', t)
    t = re.sub(r'\s*\.\s*', '.', t)
    t = re.sub(r'^(\S+)\.?\s*', r'\1 ', t)
    return t.strip()


def norm_room(s):
    s = clean(s)
    m = re.match(r'^к\.?\s*(\d)\s*,?\s*а\.?\s*(\d+)$', s, re.I)
    if m:
        return {'building': int(m.group(1)), 'room': m.group(2)}
    return {'place': s} if s else None


def norm_kind(k):
    k = clean(k).lower().rstrip('.')
    if not k:
        return None
    if k in KIND:
        code, label = KIND[k]
        return {'code': code, 'label': label}
    return {'code': k.upper(), 'label': k}


def norm_role(r):
    r = clean(r).lower()
    return ROLE.get(r) or ROLE.get(r.rstrip('.')) or (r or None)


def parse_time(t):
    m = re.match(r'(\d{2})\.(\d{2})\s*-\s*(\d{2})\.(\d{2})', clean(t))
    return f'{m.group(1)}:{m.group(2)}', f'{m.group(3)}:{m.group(4)}'


def split_parts(subject, kind, role, teacher, room):
    subject, kind, role, teacher, room = map(clean, (subject, kind, role, teacher, room))
    if '/' in teacher:                       # подгруппы: два преподавателя / две аудитории
        teachers = [fix_teacher(x) for x in teacher.split('/')]
        n = len(teachers)

        def spl(v):
            parts = [clean(x) for x in v.split('/')]
            return parts if len(parts) == n else [v] * n

        subjects, kinds, roles, rooms = spl(subject), spl(kind), spl(role), spl(room)
        return [dict(subject=SUBJECT_FIX.get(subjects[i], subjects[i]), kind=norm_kind(kinds[i]),
                     role=norm_role(roles[i]), teacher=teachers[i], room=norm_room(rooms[i]))
                for i in range(n)]
    return [dict(subject=SUBJECT_FIX.get(subject, subject), kind=norm_kind(kind),
                 role=norm_role(role), teacher=fix_teacher(teacher) or None, room=norm_room(room))]


def special(parts):
    """Особые записи: условные/периодические занятия."""
    s = parts[0]['subject']
    if s.startswith('Единый день информирования'):
        parts[0]['subject'] = 'Единый день информирования'
        return 'только во 2-й вторник месяца', 'second-tuesday'
    if s.startswith('Кураторский час'):
        parts[0]['subject'] = 'Кураторский / информационный час'
        return 'кураторский — 1 ч/мес, информационный — 3 ч/мес', None
    return None, None


def parse(xlsx, sheet):
    import openpyxl                      # нужен только для разбора xlsx
    ws = openpyxl.load_workbook(xlsx, data_only=True)[sheet]
    days, current = [], None
    for r in range(12, ws.max_row + 1):
        dname = clean(ws.cell(r, 1).value).lower()
        if dname in DAYS:
            full, short, dow = DAYS[dname]
            current = {'dow': dow, 'name': full, 'short': short, 'lessons': []}
            days.append(current)
        if current is None:
            continue
        t = ws.cell(r, 2).value
        if not t or not re.match(r'\d{2}\.\d{2}', clean(t)):
            if days and dname == '' and t is None and r > 84:
                break
            continue
        start, end = parse_time(t)
        if not clean(ws.cell(r, 3).value):
            continue
        parts = split_parts(*(ws.cell(r, c).value for c in range(3, 8)))
        note, cond = special(parts)
        key = json.dumps(parts, ensure_ascii=False, sort_keys=True)
        lessons = current['lessons']
        if lessons and lessons[-1]['_key'] == key:
            lessons[-1]['slots'].append([start, end])
            lessons[-1]['end'] = end
        else:
            lessons.append({'_key': key, 'start': start, 'end': end, 'slots': [[start, end]],
                            'parts': parts, 'note': note, 'cond': cond})
    for d in days:
        for lesson in d['lessons']:
            del lesson['_key']
    return {'meta': META, 'days': days}


DATA_FILE = os.path.join(ROOT, 'schedule.json')
PAGE = os.path.join(ROOT, 'index.html')
BLOCK = re.compile(r'(<script id="schedule" type="application/json">)(.*?)(</script>)', re.S)


def load_xlsx(xlsx, sheet):
    """xlsx -> dict, плюс сохраняет читаемый schedule.json для правок руками."""
    data = parse(xlsx, sheet)
    with open(DATA_FILE, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    return data


def inject(data):
    """Вшивает расписание в index.html, не трогая остальную разметку."""
    html = open(PAGE, encoding='utf-8').read()
    payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
    html, n = BLOCK.subn(lambda m: m.group(1) + payload + m.group(3), html, count=1)
    if not n:
        raise SystemExit('в index.html нет блока <script id="schedule" type="application/json">')
    with open(PAGE, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)


def main():
    args = sys.argv[1:]
    xlsx = args[0] if args else next(iter(sorted(glob.glob(os.path.join(ROOT, '*.xlsx')))), None)
    sheet = args[1] if len(args) > 1 else '1  акт'

    if xlsx:
        data = load_xlsx(xlsx, sheet)
        src = '%s [%s]' % (os.path.basename(xlsx), sheet)
    else:
        data = json.load(open(DATA_FILE, encoding='utf-8'))
        src = os.path.basename(DATA_FILE)

    inject(data)
    total = sum(len(d['lessons']) for d in data['days'])
    print('%s -> index.html: %d блоков в %d днях' % (src, total, len(data['days'])))


if __name__ == '__main__':
    main()
