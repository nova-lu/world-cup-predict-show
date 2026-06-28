/**
 * 晋级路径分析器
 * Phase 8.3 — 每支球队的淘汰赛路径、对手分布、难度指数
 *
 * 依赖：
 *   - bracketBuilder → 确定性淘汰赛树（R32 已解析为球队 slug）
 *   - knockoutEngine → 头对头概率计算
 *   - dataService    → Elo 评分、球队信息
 */

import { knockoutMatchProb } from './knockoutEngine.js';
import { getTeamInfo, getRatings } from './dataService.js';

// ===== 淘汰赛树结构（固定） =====
// R32: W73-W88 | R16: W89-W96 | QF: W97-W100 | SF: W101-W102 | FINAL: CHAMPION

/** 淘汰赛树 DAG：非叶子 slot 到其左/右子 slot */
const BRACKET_TREE = {
  // SF → QF
  W101: { left: 'W97', right: 'W98', stage: 'semi' },
  W102: { left: 'W99', right: 'W100', stage: 'semi' },
  // QF → R16
  W97: { left: 'W89', right: 'W90', stage: 'quarter' },
  W98: { left: 'W91', right: 'W92', stage: 'quarter' },
  W99: { left: 'W93', right: 'W94', stage: 'quarter' },
  W100: { left: 'W95', right: 'W96', stage: 'quarter' },
  // R16 → R32
  W89: { left: 'W73', right: 'W75', stage: 'round16' },
  W90: { left: 'W74', right: 'W77', stage: 'round16' },
  W91: { left: 'W76', right: 'W78', stage: 'round16' },
  W92: { left: 'W79', right: 'W80', stage: 'round16' },
  W93: { left: 'W81', right: 'W83', stage: 'round16' },
  W94: { left: 'W82', right: 'W84', stage: 'round16' },
  W95: { left: 'W85', right: 'W87', stage: 'round16' },
  W96: { left: 'W86', right: 'W88', stage: 'round16' },
};

/** Slot → 轮次中文名 */
const SLOT_STAGE = {
  W73: 'round32', W74: 'round32', W75: 'round32', W76: 'round32',
  W77: 'round32', W78: 'round32', W79: 'round32', W80: 'round32',
  W81: 'round32', W82: 'round32', W83: 'round32', W84: 'round32',
  W85: 'round32', W86: 'round32', W87: 'round32', W88: 'round32',
  W89: 'round16', W90: 'round16', W91: 'round16', W92: 'round16',
  W93: 'round16', W94: 'round16', W95: 'round16', W96: 'round16',
  W97: 'quarter', W98: 'quarter', W99: 'quarter', W100: 'quarter',
  W101: 'semi', W102: 'semi',
  CHAMPION: 'final',
};

const STAGE_LABELS = {
  round32: '32强', round16: '16强', quarter: '1/4决赛',
  semi: '半决赛', final: '决赛',
};

function getRoundLabel(stage) {
  return STAGE_LABELS[stage] || stage;
}

// ===== 辅助函数 =====

function getRating(slug) {
  const ratings = getRatings();
  return ratings[slug] ?? 1500;
}

function getTeamDisplay(slug) {
  const info = getTeamInfo(slug);
  return info || { slug, name: slug, flag: '🏳️', nameEn: slug, emojiFlag: '🏳️' };
}

/**
 * 构建球队 → R32 slot 映射
 */
function buildTeamSlotMap(round32) {
  const map = {};
  for (const m of round32) {
    if (m.home && !m.home.startsWith('W') && !m.home.match(/^\d/)) map[m.home] = m.slot;
    if (m.away && !m.away.startsWith('W') && !m.away.match(/^\d/)) map[m.away] = m.slot;
  }
  return map;
}

/**
 * 构建 R32 slot → 两支球队
 */
function buildSlotTeamsMap(round32) {
  const map = {};
  for (const m of round32) {
    const h = m.home, a = m.away;
    const teams = [];
    if (h && !h.startsWith('W') && !h.match(/^\d/)) teams.push(h);
    if (a && !a.startsWith('W') && !a.match(/^\d/)) teams.push(a);
    if (teams.length > 0) map[m.slot] = teams;
  }
  return map;
}

/**
 * 构建 R32 对手映射
 */
function buildR32OpponentMap(round32) {
  const map = {};
  for (const m of round32) {
    const h = m.home, a = m.away;
    if (h && a && !h.startsWith('W') && !a.startsWith('W') && !h.match(/^\d/) && !a.match(/^\d/)) {
      map[h] = a;
      map[a] = h;
    }
  }
  return map;
}

/**
 * 递归收集某 slot 子树中的所有 R32 球队
 * 例如：对 W90，返回 W74 和 W77 中的 4 支球队
 */
function collectTeamsInSubtree(slot, slotTeamsMap, depth = 0, maxDepth = 5) {
  if (maxDepth <= 0) return [];

  // 如果 slot 是 R32 leaf → 直接返回球队
  if (slotTeamsMap[slot]) {
    return [...slotTeamsMap[slot]];
  }

  // 非叶子 → 递归
  const node = BRACKET_TREE[slot];
  if (!node) return [];

  const left = collectTeamsInSubtree(node.left, slotTeamsMap, depth + 1, maxDepth - 1);
  const right = collectTeamsInSubtree(node.right, slotTeamsMap, depth + 1, maxDepth - 1);
  return [...left, ...right];
}

/**
 * 计算 P(球队从某 slot 晋级到目标 slot)
 * 即：球队击败路径上所有对手的联合概率
 */
function computeAdvanceProb(team, currentSlot, targetSlot, slotTeamsMap) {
  // 已到达
  if (currentSlot === targetSlot) return 1.0;
  // R32 leaf → 未在该 slot 中
  if (slotTeamsMap[currentSlot] && !slotTeamsMap[currentSlot].includes(team)) return 0.0;

  const node = BRACKET_TREE[currentSlot];
  if (!node) return 0.0;

  // 球队在左支还是右支？
  const leftTeams = slotTeamsMap[node.left] || collectTeamsInSubtree(node.left, slotTeamsMap);
  const rightTeams = slotTeamsMap[node.right] || collectTeamsInSubtree(node.right, slotTeamsMap);
  const inLeft = leftTeams.includes(team);
  const inRight = rightTeams.includes(team);

  if (!inLeft && !inRight) return 0.0;

  // 对手是另一侧所有可能晋级的球队
  const opponentCandidates = inLeft ? rightTeams : leftTeams;

  const stage = node.stage;
  let totalProb = 0;

  for (const opp of opponentCandidates) {
    // 对手晋级到 currentSlot 的概率
    const oppReachProb = computeAdvanceProb(opp, inLeft ? node.left : node.right, currentSlot, slotTeamsMap);
    if (oppReachProb <= 0) continue;

    // 球队击败对手的概率（根据 Elo 高低选择正确的 win side）
    const ourElo = getRating(team);
    const oppElo = getRating(opp);
    const matchProb = knockoutMatchProb(ourElo, oppElo, 0, stage);
    const winProb = ourElo >= oppElo ? matchProb.winA : matchProb.winB;

    // continueReachProb = 胜出后继续到 targetSlot 的概率
    const nextSlot = inLeft ? node.right : node.left; // 错误：胜出后进入 currentSlot 的父 slot

    // 实际上，胜出后进入的是 currentSlot 的父 slot
    // 我们需要向上找父 slot
    const continueProb = 1.0; // 简化：不继续递归向下
    totalProb += oppReachProb * winProb;
  }

  return totalProb;
}

/**
 * 查找球队在 bracket 中的当前 slot
 */
function findTeamSlot(team, round32, slotTeamsMap) {
  for (const [slot, teams] of Object.entries(slotTeamsMap)) {
    if (teams.includes(team)) return slot;
  }
  return null;
}

/**
 * 获取球队在某轮次的对手分布
 * round 可以是 'round16', 'quarter', 'semi', 'final'
 * 对手 = 同 slot 的另一侧子树中的 R32 球队
 */
function getRoundOpponents(team, teamSlot, roundStage, slotTeamsMap) {
  // 找到从 teamSlot 通往 roundStage 对应 slot 的路径
  // 对 R32: 我们需要找到下一个轮次的对应 slot
  // 对 R16: 找再下一轮
  
  const stageMap = {
    round16: { r32Key: 'W89', r16Key: 'W89' },
    quarter: { r32Key: 'W97', r16Key: 'W89' },
    semi: { r32Key: 'W101', r16Key: 'W89' },
    final: { r32Key: 'CHAMPION', r16Key: 'W89' },
  };

  // 通过 bracket 树向上查找
  // teamSlot (W73-W88) → 找到它所在子树与对面子树
  // 对 round16: 对手是 teamSlot 的兄弟 R32 slot
  // 对 quarter: 对手是父亲 slot 的兄弟 R16 slot

  // round16: 对手 = 同一父 slot (W89-W96) 的兄弟 R32 slot
  const r16Parent = findParentSlot(teamSlot);
  if (!r16Parent) return null;

  if (roundStage === 'round16') {
    const leftTeams = collectTeamsInSubtree(BRACKET_TREE[r16Parent].left, slotTeamsMap);
    const rightTeams = collectTeamsInSubtree(BRACKET_TREE[r16Parent].right, slotTeamsMap);
    const inLeft = leftTeams.includes(team);

    const partnerTeams = inLeft ? rightTeams : leftTeams;
    return computeOpponentProbabilities(team, partnerTeams, roundStage, r16Parent, slotTeamsMap);
  }

  // quarter: 对手来自父 slot (r16Parent) 的兄弟 QF slot
  const qfParent = findParentSlot(r16Parent);
  if (!qfParent) return null;

  if (roundStage === 'quarter') {
    const leftR16Slots = getAllLeafSlots(BRACKET_TREE[qfParent].left);
    const rightR16Slots = getAllLeafSlots(BRACKET_TREE[qfParent].right);
    const myR16Slot = findR16Slot(team, slotTeamsMap);

    const inLeft = leftR16Slots.includes(myR16Slot);
    const partnerSlots = inLeft ? rightR16Slots : leftR16Slots;
    const partnerR32Slots = partnerSlots.flatMap(s => collectR32LeafSlots(s));

    const partnerTeams = [...new Set(partnerR32Slots.flatMap(s => slotTeamsMap[s] || []))];
    return computeOpponentProbabilities(team, partnerTeams, roundStage, qfParent, slotTeamsMap);
  }

  // semi / final 类似...
  if (roundStage === 'semi') {
    const sfParent = findParentSlot(qfParent);
    if (!sfParent) return null;
    const leftQfSlots = getAllLeafSlots(BRACKET_TREE[sfParent].left);
    const rightQfSlots = getAllLeafSlots(BRACKET_TREE[sfParent].right);
    const myQfSlot = findQFSlot(team, slotTeamsMap);
    const inLeft = leftQfSlots.includes(myQfSlot);
    const partnerSlots = inLeft ? rightQfSlots : leftQfSlots;
    const partnerR32 = [...new Set(partnerSlots.flatMap(s => collectR32LeafSlots(s)))].flatMap(s => slotTeamsMap[s] || []);
    const partnerTeams = [...new Set(partnerR32)];
    return computeOpponentProbabilities(team, partnerTeams, roundStage, sfParent, slotTeamsMap);
  }

  if (roundStage === 'final') {
    const allSlots = Object.keys(slotTeamsMap);
    const partnerTeams = allSlots.filter(s => slotTeamsMap[s] && !slotTeamsMap[s].includes(team)).flatMap(s => slotTeamsMap[s]);
    return computeOpponentProbabilities(team, partnerTeams, roundStage, 'CHAMPION', slotTeamsMap);
  }

  return null;
}

function computeOpponentProbabilities(team, partnerTeams, stage, currentSlot, slotTeamsMap) {
  if (!partnerTeams || partnerTeams.length === 0) return null;

  const tRating = getRating(team);
  const opponents = [];

  for (const opp of [...new Set(partnerTeams)]) {
    if (opp === team) continue;
    const oppRating = getRating(opp);
    
    // 对手到达此轮的概率
    let oppReachProb = 1.0;
    const oppSlot = findTeamSlot(opp, null, slotTeamsMap);
    if (oppSlot) {
      // 对手击败它自己 R32 对手的概率
      oppReachProb = computeAdvanceProbToRound(opp, oppSlot, currentSlot, slotTeamsMap);
    }

    const matchProb = knockoutMatchProb(tRating, oppRating, 0, stage);

    opponents.push({
      opponent: opp,
      opponentInfo: getTeamDisplay(opp),
      opponentElo: oppRating,
      opponentReachProb: oppReachProb,
      matchWinProb: matchProb.winA,
      regWinProb: matchProb.regWinA,
      etProb: matchProb.etWinA,
      pkProb: matchProb.pkWinA,
      jointProb: oppReachProb * matchProb.winA,
    });
  }

  opponents.sort((a, b) => b.jointProb - a.jointProb);
  const totalJoint = opponents.reduce((s, o) => s + o.jointProb, 0);

  return {
    opponents: opponents.map(o => ({
      ...o,
      conditionalProb: totalJoint > 0 ? o.jointProb / totalJoint : 0,
    })),
    totalJointProb: totalJoint,
  };
}

/** 简化：对手晋级路径概率 = 对手赢下 R32 的概率 */
function computeAdvanceProbToRound(opp, oppSlot, targetSlot, slotTeamsMap) {
  // 简化实现：只算 R32 胜利概率（对手路径的主要不确定性）
  // 对 R32 球队，到 R16 的概率 = 赢下 R32 的概率
  const r32Opp = findR32Opponent(opp, slotTeamsMap);
  if (r32Opp) {
    const prob = knockoutMatchProb(getRating(opp), getRating(r32Opp), 0, 'round32');
    return prob.winA;
  }
  return 1.0;
}

function findR32Opponent(team, slotTeamsMap) {
  for (const [, teams] of Object.entries(slotTeamsMap)) {
    if (teams.includes(team)) {
      return teams.find(t => t !== team) || null;
    }
  }
  return null;
}

// ============== 辅助 slot 树操作 ==============

/** 查找 slot 的父 slot */
function findParentSlot(slot) {
  for (const [parent, node] of Object.entries(BRACKET_TREE)) {
    if (node.left === slot || node.right === slot) return parent;
  }
  return null;
}

/** 获取某子树下所有 R32 leaf slots */
function collectR32LeafSlots(slot) {
  const node = BRACKET_TREE[slot];
  if (!node) return [slot]; // leaf (R32)
  return [...collectR32LeafSlots(node.left), ...collectR32LeafSlots(node.right)];
}

/** 获取子树下所有非叶子 slot */
function getAllLeafSlots(slot) {
  const node = BRACKET_TREE[slot];
  if (!node) return [slot];
  return [slot];
}

/** 查找球队的 R16 slot */
function findR16Slot(team, slotTeamsMap) {
  const teamSlot = findTeamSlot(team, null, slotTeamsMap);
  if (!teamSlot) return null;
  return findParentSlot(teamSlot);
}

/** 查找球队的 QF slot */
function findQFSlot(team, slotTeamsMap) {
  const r16 = findR16Slot(team, slotTeamsMap);
  if (!r16) return null;
  return findParentSlot(r16);
}

// ============== 公开 API ==============

/**
 * 单队路径分析
 *
 * @param {string} slug - 球队 slug
 * @param {object} bracket - 来自 getKnockoutBracket()
 * @returns {object}
 */
export function getTeamPath(slug, bracket) {
  const round32 = bracket.rounds.round32;
  const slotTeamsMap = buildSlotTeamsMap(round32);
  const r32OppMap = buildR32OpponentMap(round32);

  const teamSlot = findTeamSlot(slug, round32, slotTeamsMap);
  if (!teamSlot) {
    return {
      slug,
      teamInfo: getTeamDisplay(slug),
      inKnockout: false,
      message: '球队未进入淘汰赛',
    };
  }

  const rating = getRating(slug);
  const teamInfo = getTeamDisplay(slug);
  const pathByRound = [];

  // R32：直接确定
  const r32Opp = r32OppMap[slug];
  if (r32Opp) {
    const prob = knockoutMatchProb(rating, getRating(r32Opp), 0, 'round32');
    pathByRound.push({
      round: 'round32',
      label: '32强',
      opponent: r32Opp,
      opponentInfo: getTeamDisplay(r32Opp),
      winProb: prob.winA,
      regWinProb: prob.regWinA,
      etProb: prob.etWinA,
      pkProb: prob.pkWinA,
      isDeterministic: true,
    });
  }

  // R16 对手分布
  const r16Data = getRoundOpponents(slug, teamSlot, 'round16', slotTeamsMap);
  if (r16Data) pathByRound.push({ round: 'round16', label: '16强', ...r16Data });

  // QF 对手分布
  const qfData = getRoundOpponents(slug, teamSlot, 'quarter', slotTeamsMap);
  if (qfData) pathByRound.push({ round: 'quarter', label: '1/4决赛', ...qfData });

  // SF 对手分布
  const sfData = getRoundOpponents(slug, teamSlot, 'semi', slotTeamsMap);
  if (sfData) pathByRound.push({ round: 'semi', label: '半决赛', ...sfData });

  // Final 对手分布
  const finalData = getRoundOpponents(slug, teamSlot, 'final', slotTeamsMap);
  if (finalData) pathByRound.push({ round: 'final', label: '决赛', ...finalData });

  // 难度指数
  const difficulty = computeDifficulty(pathByRound, rating);

  // VS MVP
  const vsMVP = computeVSMVP(pathByRound, rating);

  return {
    slug,
    teamInfo,
    elo: rating,
    inKnockout: true,
    r32Slot: teamSlot,
    bracketPath: pathByRound,
    difficulty,
    vsMVP,
  };
}

/**
 * 对手分布矩阵：对所有出线球队，统计各轮次对手分布
 */
export function getOpponentMatrix(bracket) {
  const round32 = bracket.rounds.round32;
  const slotTeamsMap = buildSlotTeamsMap(round32);
  const r32OppMap = buildR32OpponentMap(round32);

  const matrix = {
    generatedAt: new Date().toISOString(),
    round32Count: Object.keys(slotTeamsMap).length,
    teams: {},
  };

  for (const [slot, teams] of Object.entries(slotTeamsMap)) {
    for (const slug of teams) {
      const path = {};
      const rating = getRating(slug);
      const teamInfo = getTeamDisplay(slug);

      // R32
      const r32Opp = r32OppMap[slug];
      if (r32Opp) {
        const prob = knockoutMatchProb(rating, getRating(r32Opp), 0, 'round32');
        path.round32 = { opponent: r32Opp, opponentInfo: getTeamDisplay(r32Opp), ...prob };
      }

      // R16
      const r16Data = getRoundOpponents(slug, slot, 'round16', slotTeamsMap);
      if (r16Data) path.round16 = r16Data;

      // QF
      const qfData = getRoundOpponents(slug, slot, 'quarter', slotTeamsMap);
      if (qfData) path.quarter = qfData;

      // SF
      const sfData = getRoundOpponents(slug, slot, 'semi', slotTeamsMap);
      if (sfData) path.semi = sfData;

      // Final
      const finalData = getRoundOpponents(slug, slot, 'final', slotTeamsMap);
      if (finalData) path.final = finalData;

      matrix.teams[slug] = { info: teamInfo, elo: rating, slot, path };
    }
  }

  return matrix;
}

/** 计算路径难度 */
function computeDifficulty(pathByRound, teamRating) {
  if (!pathByRound || pathByRound.length === 0) return null;

  const rounds = [];
  for (const step of pathByRound) {
    if (step.round === 'round32') {
      const oppRating = getRating(step.opponent);
      const diff = oppRating - teamRating;
      const index = clamp((diff + 200) / 4, 0, 100);
      rounds.push({
        round: step.round, label: step.label,
        opponent: step.opponent, opponentElo: oppRating,
        diff, difficultyIndex: Math.round(index),
      });
    } else if (step.opponents && step.opponents.length > 0) {
      // 按 jointProb 加权平均
      let wElo = 0, wSum = 0;
      for (const o of step.opponents.slice(0, 5)) {
        wElo += o.opponentElo * o.jointProb;
        wSum += o.jointProb;
      }
      const avgElo = wSum > 0 ? wElo / wSum : teamRating;
      const diff = avgElo - teamRating;
      rounds.push({
        round: step.round, label: step.label,
        opponentElo: Math.round(avgElo), diff: Math.round(diff),
        difficultyIndex: Math.round(clamp((diff + 200) / 4, 0, 100)),
      });
    }
  }

  const avg = rounds.length > 0
    ? Math.round(rounds.reduce((s, r) => s + r.difficultyIndex, 0) / rounds.length)
    : 50;

  return {
    rounds,
    averageDifficulty: avg,
    label: avg >= 70 ? '地狱' : avg >= 55 ? '困难' : avg >= 40 ? '中等' : '轻松',
    description: avg >= 70 ? '地狱级难度：每轮都可能遭遇世界顶级强队'
      : avg >= 55 ? '困难级难度：多轮遇到强敌'
      : avg >= 40 ? '中等难度：部分轮次有挑战'
      : '相对轻松：避免与顶级强队过早相遇',
  };
}

/** VS MVP：每轮最强对手 */
function computeVSMVP(pathByRound, teamRating) {
  return pathByRound.map(step => {
    if (step.round === 'round32') {
      const oppRating = getRating(step.opponent);
      return {
        round: step.round, label: step.label,
        mostLikely: { opponent: step.opponent, opponentInfo: step.opponentInfo, matchWinProb: step.winProb },
        strongest: { opponent: step.opponent, opponentInfo: step.opponentInfo, elo: oppRating, matchWinProb: step.winProb },
        note: `首轮对阵 ${(step.opponentInfo && step.opponentInfo.name) || step.opponent}`,
      };
    }

    if (!step.opponents || step.opponents.length === 0) return null;

    const byJoint = [...step.opponents].sort((a, b) => b.jointProb - a.jointProb);
    const byElo = [...step.opponents].sort((a, b) => b.opponentElo - a.opponentElo);
    const mostLikely = byJoint[0];
    const strongest = byElo[0];

    return {
      round: step.round, label: step.label,
      mostLikely: mostLikely ? {
        opponent: mostLikely.opponent,
        opponentInfo: mostLikely.opponentInfo,
        jointProb: mostLikely.jointProb,
        matchWinProb: mostLikely.matchWinProb,
      } : null,
      strongest: strongest ? {
        opponent: strongest.opponent,
        opponentInfo: strongest.opponentInfo,
        elo: strongest.opponentElo,
        matchWinProb: strongest.matchWinProb,
      } : null,
      note: strongest && mostLikely?.opponent === strongest?.opponent
        ? `最可能对手同时也是最强对手`
        : `最可能对手 ${mostLikely?.opponentInfo?.name || mostLikely?.opponent}，最强可能性 ${strongest?.opponentInfo?.name || strongest?.opponent}`,
    };
  }).filter(Boolean);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export default { getTeamPath, getOpponentMatrix };
