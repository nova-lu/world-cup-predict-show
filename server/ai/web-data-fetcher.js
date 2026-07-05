import aiConfig from './config.js';

// Wikipedia REST API
const WIKI_API = 'https://en.wikipedia.org/api/rest_v1/page/summary/';

const TEAM_WIKI_PAGES = {
  'france': 'France_national_football_team',
  'brazil': 'Brazil_national_football_team',
  'argentina': 'Argentina_national_football_team',
  'england': 'England_national_football_team',
  'spain': 'Spain_national_football_team',
  'germany': 'Germany_national_football_team',
  'netherlands': 'Netherlands_national_football_team',
  'portugal': 'Portugal_national_football_team',
  'belgium': 'Belgium_national_football_team',
  'croatia': 'Croatia_national_football_team',
  'switzerland': 'Switzerland_national_football_team',
  'uruguay': 'Uruguay_national_football_team',
  'mexico': 'Mexico_national_football_team',
  'usa': 'United_States_men%27s_national_soccer_team',
  'canada': 'Canada_men%27s_national_soccer_team',
  'morocco': 'Morocco_national_football_team',
  'senegal': 'Senegal_national_football_team',
  'japan': 'Japan_national_football_team',
  'korea-republic': 'South_Korea_national_football_team',
  'australia': 'Australia_men%27s_national_soccer_team',
  'egypt': 'Egypt_national_football_team',
  'ivory-coast': 'Ivory_Coast_national_football_team',
  'ghana': 'Ghana_national_football_team',
  'nigeria': 'Nigeria_national_football_team',
  'cameroon': 'Cameroon_national_football_team',
  'south-africa': 'South_Africa_national_football_team',
  'tunisia': 'Tunisia_national_football_team',
  'algeria': 'Algeria_national_football_team',
  'paraguay': 'Paraguay_national_football_team',
  'ecuador': 'Ecuador_national_football_team',
  'colombia': 'Colombia_national_football_team',
  'norway': 'Norway_national_football_team',
  'sweden': 'Sweden_men%27s_national_football_team',
  'austria': 'Austria_national_football_team',
  'czech-republic': 'Czech_Republic_national_football_team',
  'turkiye': 'Turkey_national_football_team',
  'poland': 'Poland_national_football_team',
  'denmark': 'Denmark_national_football_team',
  'hungary': 'Hungary_national_football_team',
  'serbia': 'Serbia_national_football_team',
  'romania': 'Romania_national_football_team',
  'ukraine': 'Ukraine_national_football_team',
  'slovakia': 'Slovakia_national_football_team',
  'slovenia': 'Slovenia_national_football_team',
  'greece': 'Greece_national_football_team',
  'ireland': 'Republic_of_Ireland_national_football_team',
  'scotland': 'Scotland_national_football_team',
  'wales': 'Wales_national_football_team',
  'dr-congo': 'DR_Congo_national_football_team',
  'cape-verde': 'Cape_Verde_national_football_team',
  'bosnia-and-herzegovina': 'Bosnia_and_Herzegovina_national_football_team',
};

/** 快速 Wikipedia 摘要获取 */
async function fetchWikiSummary(slug) {
  const page = TEAM_WIKI_PAGES[slug];
  if (!page) return null;
  const url = WIKI_API + page;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'WorldCup2026/1.0' } });
    clearTimeout(t);
    if (!r.ok) return null;
    const data = await r.json();
    return {
      extract: data.extract?.slice(0, 1500) || null,
      thumbnail: data.thumbnail?.source || null,
      description: data.description || null,
      source: 'wikipedia',
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** 获取球队实时信息 */
export async function fetchCurrentTeamData(t1, t2) {
  const [hData, aData] = await Promise.all([
    fetchWikiSummary(t1),
    fetchWikiSummary(t2),
  ]);
  return { home: hData, away: aData };
}

// Google News RSS（无需 API Key  → 爬取页面稍麻烦，改用 RSS 代理）
// 简单方案：用 gnews.io 免费 API（需注册）或自行搜索
// 这里提供一个朴素的 fallback：只用 Wikipedia
// 后续可扩展为 newsapi.org / gnews.io 等

const NEWS_API_KEY = process.env.NEWS_API_KEY || null;
const NEWS_API = 'https://newsapi.org/v2/everything';

/** 获取球队近期新闻（可选，需 NEWS_API_KEY） */
export async function fetchTeamNews(slug, name) {
  if (!NEWS_API_KEY) return [];
  const query = encodeURIComponent(`${name} World Cup 2026 team news squad`);
  try {
    const r = await fetch(`${NEWS_API}?q=${query}&sortBy=publishedAt&pageSize=3&language=en`, {
      headers: { 'X-Api-Key': NEWS_API_KEY },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.articles || []).slice(0, 3).map(a => ({
      title: a.title,
      description: a.description?.slice(0, 300) || null,
      publishedAt: a.publishedAt,
      url: a.url,
    }));
  } catch {
    return [];
  }
}
