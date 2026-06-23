import urllib.request, json
import ssl

API_KEY = 'fdfd7ff7dada4b07bf0a42e20bdbe27f'
BASE = 'https://api.football-data.org/v4'
ctx = ssl._create_unverified_context()

def api(path):
    req = urllib.request.Request(f'{BASE}{path}')
    req.add_header('X-Auth-Token', API_KEY)
    return json.loads(urllib.request.urlopen(req, timeout=10, context=ctx).read().decode())

# 1. 获取所有球队和比赛
data = api('/competitions/2000/matches')
matches = data['matches']

print('=== API Team Names vs Model Slugs ===')
api_teams = set()
for m in matches:
    if m.get('homeTeam',{}).get('name'): api_teams.add(m['homeTeam']['name'])
    if m.get('awayTeam',{}).get('name'): api_teams.add(m['awayTeam']['name'])
for t in sorted([x for x in api_teams if x]):
    print(f'  {t}')

print()
print('=== Knockout Stage info ===')
for m in matches:
    if m['stage'] and 'GROUP' not in m['stage'] and m['stage'] != 'PRELIMINARY_ROUND':
        print(f'  {m["utcDate"][:10]} Stage:{m["stage"]} Group:{m.get("group")} {m["homeTeam"]["name"]} vs {m["awayTeam"]["name"]} Score:{m["score"]["fullTime"].get("home")}-{m["score"]["fullTime"].get("away")}')
        if 'GROUP' not in m['stage']:
            # check all unique stages beyond group
            pass

stages = set()
for m in matches:
    stages.add(m['stage'])
print(f'\nUnique stages: {sorted(stages)}')

# Stage distribution
from collections import Counter
stage_counts = Counter(m['stage'] for m in matches)
print(f'\nStage distribution:')
for s, c in sorted(stage_counts.items()):
    fin = sum(1 for m in matches if m['stage'] == s and m['status'] == 'FINISHED')
    print(f'  {s}: {c} matches ({fin} finished)')

# 2. 查看一场详细比赛格式
print('\n=== Sample match detail ===')
for m in matches:
    if m['status'] == 'TIMED':
        import pprint
        pprint.pprint({k: v for k, v in m.items() if k not in ['odds','referees']})
        break

# 3. 查看一场已完赛比赛
print('\n=== Sample FINISHED match ===')
for m in matches:
    if m['status'] == 'FINISHED':
        print(f'  {m["homeTeam"]["name"]} {m["score"]["fullTime"]["home"]}:{m["score"]["fullTime"]["away"]} {m["awayTeam"]["name"]}')
        print(f'  Stage: {m["stage"]}, Group: {m.get("group")}')
        print(f'  Winner: {m.get("score","").get("winner")}')
        break
