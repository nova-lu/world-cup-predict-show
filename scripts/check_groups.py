import json, sys
d = json.load(sys.stdin)
groups = d.get('groups', {})
for g in sorted(groups.keys()):
    data = groups[g]
    if data.get('standings'):
        print(f"\n### {g}组")
        for t in data['standings']:
            info = t.get('info', {})
            print(f"  {t.get('rank',0)}. {info.get('name','?')} ({info.get('slug','?')}) 积分:{t.get('pts',0)} 净胜球:{t.get('gd',0)} 进球:{t.get('gf',0)}")
