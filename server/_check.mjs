import { getMatches } from './services/dataService.js';
const matches = getMatches();
if (!matches) { console.log('no matches - null/undefined'); process.exit(0); }
console.log('matches type:', typeof matches, 'isArray:', Array.isArray(matches));
if (Array.isArray(matches)) {
  console.log('total matches:', matches.length);
  if (matches.length > 0) {
    const m = matches[0];
    console.log('first match keys:', Object.keys(m).join(','));
    console.log('home:', JSON.stringify(m.home || m.homeTeam));
    console.log('away:', JSON.stringify(m.away || m.awayTeam));
    console.log('stage:', typeof m.stage, JSON.stringify(m.stage));
    console.log('date:', typeof m.date, JSON.stringify(m.date));
    console.log('date is Date:', m.date instanceof Date);
  }
} else {
  console.log('matches entries:', Object.entries(matches).slice(0,2).map(([k,v])=>`${k}:${typeof v}`).join(', '));
}
console.log('done');
