"""从 CSV 更新 wc2026-results.json"""
import csv, json, re
from datetime import datetime, timezone
from collections import Counter

CSV_TEXT = """date,home_team,away_team,home_score,away_score,tournament,city,country,neutral
2026-06-11,Mexico,South Africa,2,0,FIFA World Cup,Mexico City,Mexico,FALSE
2026-06-11,South Korea,Czech Republic,2,1,FIFA World Cup,Zapopan,Mexico,TRUE
2026-06-12,Canada,Bosnia and Herzegovina,1,1,FIFA World Cup,Toronto,Canada,FALSE
2026-06-12,United States,Paraguay,4,1,FIFA World Cup,Inglewood,United States,FALSE
2026-06-13,Qatar,Switzerland,1,1,FIFA World Cup,Santa Clara,United States,TRUE
2026-06-13,Brazil,Morocco,1,1,FIFA World Cup,East Rutherford,United States,TRUE
2026-06-13,Haiti,Scotland,0,1,FIFA World Cup,Foxborough,United States,TRUE
2026-06-13,Australia,Turkey,NA,NA,FIFA World Cup,Vancouver,Canada,TRUE
2026-06-14,Germany,Curaçao,7,1,FIFA World Cup,Houston,United States,TRUE
2026-06-14,Ivory Coast,Ecuador,1,0,FIFA World Cup,Philadelphia,United States,TRUE
2026-06-14,Netherlands,Japan,2,2,FIFA World Cup,Arlington,United States,TRUE
2026-06-14,Sweden,Tunisia,5,1,FIFA World Cup,Guadalupe,Mexico,TRUE
2026-06-15,Belgium,Egypt,1,1,FIFA World Cup,Seattle,United States,TRUE
2026-06-15,Iran,New Zealand,2,2,FIFA World Cup,Inglewood,United States,TRUE
2026-06-15,Spain,Cape Verde,0,0,FIFA World Cup,Atlanta,United States,TRUE
2026-06-15,Saudi Arabia,Uruguay,1,1,FIFA World Cup,Miami Gardens,United States,TRUE
2026-06-16,France,Senegal,3,1,FIFA World Cup,East Rutherford,United States,TRUE
2026-06-16,Iraq,Norway,1,4,FIFA World Cup,Foxborough,United States,TRUE
2026-06-16,Argentina,Algeria,3,0,FIFA World Cup,Kansas City,United States,TRUE
2026-06-16,Austria,Jordan,3,1,FIFA World Cup,Santa Clara,United States,TRUE
2026-06-17,Portugal,DR Congo,1,1,FIFA World Cup,Houston,United States,TRUE
2026-06-17,Uzbekistan,Colombia,1,3,FIFA World Cup,Mexico City,Mexico,TRUE
2026-06-17,England,Croatia,4,2,FIFA World Cup,Arlington,United States,TRUE
2026-06-17,Ghana,Panama,1,0,FIFA World Cup,Toronto,Canada,TRUE
2026-06-18,Czech Republic,South Africa,1,1,FIFA World Cup,Atlanta,United States,TRUE
2026-06-18,Mexico,South Korea,1,0,FIFA World Cup,Zapopan,Mexico,FALSE
2026-06-18,Switzerland,Bosnia and Herzegovina,4,1,FIFA World Cup,Inglewood,United States,TRUE
2026-06-18,Canada,Qatar,6,0,FIFA World Cup,Vancouver,Canada,FALSE
2026-06-19,Scotland,Morocco,0,1,FIFA World Cup,Foxborough,United States,TRUE
2026-06-19,Brazil,Haiti,3,0,FIFA World Cup,Philadelphia,United States,TRUE
2026-06-19,United States,Australia,2,0,FIFA World Cup,Seattle,United States,FALSE
2026-06-19,Turkey,Paraguay,0,1,FIFA World Cup,Santa Clara,United States,TRUE
2026-06-20,Germany,Ivory Coast,2,1,FIFA World Cup,Toronto,Canada,TRUE
2026-06-20,Ecuador,Curaçao,0,0,FIFA World Cup,Kansas City,United States,TRUE
2026-06-20,Netherlands,Sweden,5,1,FIFA World Cup,Houston,United States,TRUE
2026-06-20,Tunisia,Japan,0,4,FIFA World Cup,Guadalupe,Mexico,TRUE
2026-06-21,Belgium,Iran,0,0,FIFA World Cup,Inglewood,United States,TRUE
2026-06-21,New Zealand,Egypt,1,3,FIFA World Cup,Vancouver,Canada,TRUE
2026-06-21,Spain,Saudi Arabia,4,0,FIFA World Cup,Atlanta,United States,TRUE
2026-06-21,Uruguay,Cape Verde,2,2,FIFA World Cup,Miami Gardens,United States,TRUE
2026-06-22,France,Iraq,3,0,FIFA World Cup,Philadelphia,United States,TRUE
2026-06-22,Norway,Senegal,3,2,FIFA World Cup,East Rutherford,United States,TRUE
2026-06-22,Argentina,Austria,2,0,FIFA World Cup,Arlington,United States,TRUE
2026-06-22,Jordan,Algeria,1,2,FIFA World Cup,Santa Clara,United States,TRUE
2026-06-23,Portugal,Uzbekistan,5,0,FIFA World Cup,Houston,United States,TRUE
2026-06-23,Colombia,DR Congo,1,0,FIFA World Cup,Zapopan,Mexico,TRUE
2026-06-23,England,Ghana,0,0,FIFA World Cup,Foxborough,United States,TRUE
2026-06-23,Panama,Croatia,0,1,FIFA World Cup,Toronto,Canada,TRUE
2026-06-24,Mexico,Czech Republic,3,0,FIFA World Cup,Mexico City,Mexico,FALSE
2026-06-24,South Africa,South Korea,1,0,FIFA World Cup,Guadalupe,Mexico,TRUE
2026-06-24,Canada,Switzerland,1,2,FIFA World Cup,Vancouver,Canada,FALSE
2026-06-24,Bosnia and Herzegovina,Qatar,3,1,FIFA World Cup,Seattle,United States,TRUE
2026-06-24,Scotland,Brazil,0,3,FIFA World Cup,Miami Gardens,United States,TRUE
2026-06-24,Morocco,Haiti,4,2,FIFA World Cup,Atlanta,United States,TRUE
2026-06-25,United States,Turkey,2,3,FIFA World Cup,Inglewood,United States,FALSE
2026-06-25,Paraguay,Australia,0,0,FIFA World Cup,Santa Clara,United States,TRUE
2026-06-25,Curaçao,Ivory Coast,0,2,FIFA World Cup,Philadelphia,United States,TRUE
2026-06-25,Ecuador,Germany,2,1,FIFA World Cup,East Rutherford,United States,TRUE
2026-06-25,Japan,Sweden,1,1,FIFA World Cup,Arlington,United States,TRUE
2026-06-25,Tunisia,Netherlands,1,3,FIFA World Cup,Kansas City,United States,TRUE
2026-06-26,Egypt,Iran,1,1,FIFA World Cup,Seattle,United States,TRUE
2026-06-26,New Zealand,Belgium,1,5,FIFA World Cup,Vancouver,Canada,TRUE
2026-06-26,Cape Verde,Saudi Arabia,0,0,FIFA World Cup,Houston,United States,TRUE
2026-06-26,Uruguay,Spain,0,1,FIFA World Cup,Zapopan,Mexico,TRUE
2026-06-26,Norway,France,1,4,FIFA World Cup,Foxborough,United States,TRUE
2026-06-26,Senegal,Iraq,5,0,FIFA World Cup,Toronto,Canada,TRUE
2026-06-27,Algeria,Austria,3,3,FIFA World Cup,Kansas City,United States,TRUE
2026-06-27,Jordan,Argentina,1,3,FIFA World Cup,Arlington,United States,TRUE
2026-06-27,Colombia,Portugal,0,0,FIFA World Cup,Miami Gardens,United States,TRUE
2026-06-27,DR Congo,Uzbekistan,3,1,FIFA World Cup,Atlanta,United States,TRUE
2026-06-27,Panama,England,0,2,FIFA World Cup,East Rutherford,United States,TRUE
2026-06-27,Croatia,Ghana,2,1,FIFA World Cup,Philadelphia,United States,TRUE
2026-06-28,South Africa,Canada,0,1,FIFA World Cup,Los Angeles,United States,TRUE
2026-06-29,Germany,Paraguay,1,1,FIFA World Cup,Boston,United States,TRUE
2026-06-29,Netherlands,Morocco,1,1,FIFA World Cup,Monterrey,Mexico,TRUE
2026-06-29,Brazil,Japan,2,1,FIFA World Cup,Houston,United States,TRUE
2026-06-30,Ivory Coast,Norway,1,2,FIFA World Cup,Dallas,United States,TRUE
2026-06-30,France,Sweden,3,0,FIFA World Cup,East Rutherford,United States,TRUE
2026-06-30,Mexico,Ecuador,2,0,FIFA World Cup,Mexico City,Mexico,TRUE
2026-07-01,England,DR Congo,2,1,FIFA World Cup,Atlanta,United States,TRUE
2026-07-01,Belgium,Senegal,3,2,FIFA World Cup,Seattle,United States,TRUE
2026-07-01,USA,Bosnia and Herzegovina,2,0,FIFA World Cup,San Francisco,United States,TRUE
"""

# 队伍 → slug 映射
NAME_TO_SLUG = {
    'Mexico': 'mexico', 'South Africa': 'south-africa', 'South Korea': 'south-korea',
    'Czech Republic': 'czech-republic', 'Canada': 'canada', 'Bosnia and Herzegovina': 'bosnia-and-herzegovina',
    'United States': 'usa', 'USA': 'usa', 'Paraguay': 'paraguay', 'Qatar': 'qatar',
    'Switzerland': 'switzerland', 'Brazil': 'brazil', 'Morocco': 'morocco',
    'Haiti': 'haiti', 'Scotland': 'scotland', 'Australia': 'australia', 'Turkey': 'turkey',
    'Germany': 'germany', 'Curaçao': 'curacao', 'Ivory Coast': 'ivory-coast',
    'Ecuador': 'ecuador', 'Netherlands': 'netherlands', 'Japan': 'japan',
    'Sweden': 'sweden', 'Tunisia': 'tunisia', 'Belgium': 'belgium', 'Egypt': 'egypt',
    'Iran': 'iran', 'New Zealand': 'new-zealand', 'Spain': 'spain',
    'Cape Verde': 'cape-verde', 'Saudi Arabia': 'saudi-arabia', 'Uruguay': 'uruguay',
    'France': 'france', 'Senegal': 'senegal', 'Iraq': 'iraq', 'Norway': 'norway',
    'Argentina': 'argentina', 'Algeria': 'algeria', 'Austria': 'austria', 'Jordan': 'jordan',
    'Portugal': 'portugal', 'DR Congo': 'dr-congo', 'Uzbekistan': 'uzbekistan',
    'Colombia': 'colombia', 'England': 'england', 'Croatia': 'croatia',
    'Ghana': 'ghana', 'Panama': 'panama',
}

# 队伍 → 小组
TEAM_GROUP = {
    'mexico': 'A', 'south-africa': 'A', 'south-korea': 'A', 'czech-republic': 'A',
    'canada': 'B', 'bosnia-and-herzegovina': 'B', 'qatar': 'B', 'switzerland': 'B',
    'brazil': 'C', 'morocco': 'C', 'haiti': 'C', 'scotland': 'C',
    'usa': 'D', 'paraguay': 'D', 'australia': 'D', 'turkey': 'D',
    'germany': 'E', 'curacao': 'E', 'ivory-coast': 'E', 'ecuador': 'E',
    'netherlands': 'F', 'japan': 'F', 'sweden': 'F', 'tunisia': 'F',
    'belgium': 'G', 'egypt': 'G', 'iran': 'G', 'new-zealand': 'G',
    'spain': 'H', 'cape-verde': 'H', 'saudi-arabia': 'H', 'uruguay': 'H',
    'france': 'I', 'senegal': 'I', 'iraq': 'I', 'norway': 'I',
    'argentina': 'J', 'algeria': 'J', 'austria': 'J', 'jordan': 'J',
    'portugal': 'K', 'dr-congo': 'K', 'uzbekistan': 'K', 'colombia': 'K',
    'england': 'L', 'croatia': 'L', 'ghana': 'L', 'panama': 'L',
}

# 首字母大写显示名
DISPLAY_NAMES = {
    'mexico': 'Mexico', 'south-africa': 'South Africa', 'south-korea': 'South Korea',
    'czech-republic': 'Czech Republic', 'canada': 'Canada',
    'bosnia-and-herzegovina': 'Bosnia & Herzegovina', 'usa': 'USA',
    'paraguay': 'Paraguay', 'qatar': 'Qatar', 'switzerland': 'Switzerland',
    'brazil': 'Brazil', 'morocco': 'Morocco', 'haiti': 'Haiti', 'scotland': 'Scotland',
    'australia': 'Australia', 'turkey': 'Turkey', 'germany': 'Germany',
    'curacao': 'Curaçao', 'ivory-coast': 'Ivory Coast', 'ecuador': 'Ecuador',
    'netherlands': 'Netherlands', 'japan': 'Japan', 'sweden': 'Sweden',
    'tunisia': 'Tunisia', 'belgium': 'Belgium', 'egypt': 'Egypt', 'iran': 'Iran',
    'new-zealand': 'New Zealand', 'spain': 'Spain', 'cape-verde': 'Cape Verde',
    'saudi-arabia': 'Saudi Arabia', 'uruguay': 'Uruguay', 'france': 'France',
    'senegal': 'Senegal', 'iraq': 'Iraq', 'norway': 'Norway', 'argentina': 'Argentina',
    'algeria': 'Algeria', 'austria': 'Austria', 'jordan': 'Jordan', 'portugal': 'Portugal',
    'dr-congo': 'DR Congo', 'uzbekistan': 'Uzbekistan', 'colombia': 'Colombia',
    'england': 'England', 'croatia': 'Croatia', 'ghana': 'Ghana', 'panama': 'Panama',
}

# 按日期分配 round 标签（Matchday X）
DATE_ROUND = {}
all_dates = sorted(set(
    row['date'] for row in csv.DictReader(CSV_TEXT.strip().splitlines())
))
for i, d in enumerate(all_dates, 1):
    DATE_ROUND[d] = f'Matchday {i}'

# 解析 CSV
rows = list(csv.DictReader(CSV_TEXT.strip().splitlines()))
matches = []

for row in rows:
    home = row['home_team'].strip()
    away = row['away_team'].strip()
    hs = row['home_score'].strip()
    aws = row['away_score'].strip()

    t1 = NAME_TO_SLUG.get(home, home.lower().replace(' ', '-'))
    t2 = NAME_TO_SLUG.get(away, away.lower().replace(' ', '-'))

    if hs.upper() == 'NA' or aws.upper() == 'NA':
        g1, g2 = None, None
        status = 'TIMED'
    else:
        g1, g2 = int(hs), int(aws)
        status = 'FT'

    group = TEAM_GROUP.get(t1, None)
    if not group:
        group = TEAM_GROUP.get(t2, None)
    group_str = f'Group {group}' if group else None

    matches.append({
        'date': row['date'],
        'round': DATE_ROUND.get(row['date'], f'Matchday'),
        'group': group_str,
        'team1': DISPLAY_NAMES.get(t1, home),
        'team2': DISPLAY_NAMES.get(t2, away),
        't1': t1,
        't2': t2,
        'g1': g1,
        'g2': g2,
        'pens1': None,
        'pens2': None,
        'status': status,
        'winner': None,
    })

# 第一遍：统计各队已分配场次
team_count = Counter()
for m in matches:
    team_count[m['t1']] += 1
    team_count[m['t2']] += 1

# 第二遍：每队前3场为小组赛，第4场+为淘汰赛
knockout_dates = set()
for m in matches:
    # 如果两个队伍都已经有3场小组赛，且来自不同小组 → 淘汰赛
    t1 = m['t1']
    t2 = m['t2']
    g1 = TEAM_GROUP.get(t1)
    g2 = TEAM_GROUP.get(t2)
    if g1 and g2 and g1 != g2 and team_count[t1] >= 3 and team_count[t2] >= 3:
        m['group'] = None
        m['round'] = 'Round of 32'
        knockout_dates.add(m['date'])

# 排序：日期 + 小组
matches.sort(key=lambda m: (m['date'], m.get('group') or '', m['t1']))

output = {
    'updated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
    'matches': matches,
}

path = r'E:\codes_practice\world-cup-related\worldcup_new_2026\data\wc2026-results.json'
with open(path, 'w', encoding='utf-8') as f:
    json.dump(output, f, indent=1, ensure_ascii=False)

print(f'✅ 已更新 {len(matches)} 场比赛到 {path}')
print(f'   已完赛: {sum(1 for m in matches if m["status"]=="FT")}')
print(f'   未开赛: {sum(1 for m in matches if m["status"]!="FT")}')
print(f'   涉及小组: {sorted(set(m["group"] for m in matches if m["group"]))}')
