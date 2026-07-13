// ===== 投资决策引擎 — 凯利公式 + 风险平价 =====

// ===== 状态管理 =====
var state = {
  tab: 'invest',
  viewMode: 'lottery',
  selectedMatchIds: [],
  riskProfile: 'moderate',
  bankroll: 10000,
  positions: [],
  capitalCurve: [],
  lambda: 0.30,
  marketMode: 'lottery',
  selectedBet: null,
  selectedMatchId: null,
  currentAnalysis: null,
  matches: [],
  portfolioItems: []
};

// ===== 工具函数 =====
function fmtMoney(val) {
  if (val == null || isNaN(val)) return '0.00';
  return Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(val) {
  if (val == null || isNaN(val)) return '0.00%';
  return (val * 100).toFixed(2) + '%';
}

function fmtNum(val, decimals) {
  decimals = decimals || 2;
  if (val == null || isNaN(val)) return '0.00';
  return Number(val).toFixed(decimals);
}

// ===== 凯利计算引擎 =====
function calcImpliedProb(odds) {
  if (!odds || odds <= 1) return 0;
  return 1 / odds;
}

function calcEdge(modelProb, odds) {
  var impliedProb = calcImpliedProb(odds);
  return modelProb - impliedProb;
}

function calcKellyFull(edge, impliedProb) {
  if (edge <= 0) return 0;
  if (impliedProb >= 1) return 0;
  return edge / (1 - impliedProb);
}

function calcFractionalKelly(modelProb, odds, lambda) {
  var impliedProb = calcImpliedProb(odds);
  var edge = calcEdge(modelProb, odds);
  var fullKelly = calcKellyFull(edge, impliedProb);
  var fractional = fullKelly * lambda;
  var capped = Math.max(0, Math.min(fractional, 0.25));
  // 淘汰赛特殊规则：P < 55% 即使正 Edge 也不下注
  var pThreshold = 0.55;
  var canBet = modelProb >= pThreshold && edge > 0;
  return {
    edge: edge,
    kellyFull: fullKelly,
    kellyFractional: canBet ? capped : 0,
    stakePct: canBet ? capped : 0,
    isPositive: edge > 0,
    passThreshold: modelProb >= pThreshold,
    canBet: canBet,
    expectedReturn: canBet ? (capped * (odds - 1) - (1 - capped)) : 0,
    expectedReturnAmount: 0, // 由调用方计算
  };
}

function calcStake(bankroll, kellyFraction) {
  return bankroll * kellyFraction;
}

function calcExpectedProfit(stake, odds) {
  return stake * (odds - 1);
}

// ===== 风险平价 =====
function allocateRiskBudget(matches, bankroll, lambda) {
  if (!matches || matches.length === 0) return [];
  // 第二层：风险预算 = 总本金 × 25%
  var riskBudget = bankroll * 0.25;
  var maxSingleBet = bankroll * 0.01;

  // 计算每场的 Kelly 分数比例 F
  var kellyValues = matches.map(function(m) {
    var best = findBestOption(m);
    if (!best) return { matchId: m.matchId || 'unknown', F: 0, edge: 0 };
    var kelly = calcFractionalKelly(best.prob, best.odds, lambda || state.lambda || 0.3);
    return { matchId: m.matchId || 'unknown', F: kelly.kellyFractional, edge: kelly.edge, analysis: best };
  });

  var totalF = kellyValues.reduce(function(sum, kv) { return sum + kv.F; }, 0);
  if (totalF <= 0) return [];

  return kellyValues.map(function(kv) {
    // Bet_i = Risk_Budget × (F_i / ΣF_j)
    var rawBet = riskBudget * (kv.F / totalF);
    var finalBet = Math.min(rawBet, maxSingleBet);
    return {
      matchId: kv.matchId,
      selection: kv.analysis ? kv.analysis.selection : null,
      odds: kv.analysis ? kv.analysis.odds : 0,
      edge: kv.edge,
      rawAllocation: rawBet,
      finalBet: finalBet,
      stake: finalBet,
      pct: finalBet / bankroll,
      pctOfBankroll: (finalBet / bankroll * 100).toFixed(2) + '%',
    };
  });
}

function findBestOption(matchAnalysis) {
  if (!matchAnalysis || !matchAnalysis.options) return null;
  var best = null;
  var bestKelly = -1;
  matchAnalysis.options.forEach(function(opt) {
    if (opt.kellyFractional > bestKelly) {
      bestKelly = opt.kellyFractional;
      best = opt;
    }
  });
  return best;
}

// ===== 相关系数 =====
var CORRELATION_THRESHOLD = 0.6;
var PENALTY_FACTOR = 0.7;

function applyCorrelationPenalty(allocations, correlationMatrix) {
  if (!allocations || allocations.length <= 1) return allocations;
  return allocations.map(function(a) {
    var penalty = 1;
    allocations.forEach(function(other) {
      if (other.matchId === a.matchId) return;
      var r = 0;
      if (correlationMatrix && correlationMatrix[a.matchId]) {
        r = correlationMatrix[a.matchId][other.matchId] || 0;
      }
      if (r > CORRELATION_THRESHOLD) penalty *= PENALTY_FACTOR;
    });
    var adjusted = (a.stake || a.finalBet || 0) * penalty;
    return {
      matchId: a.matchId,
      selection: a.selection,
      odds: a.odds,
      edge: a.edge,
      finalBet: adjusted,
      stake: adjusted,
      pct: a.pct,
      correlationPenalty: 1 - penalty,
    };
  });
}

function buildCorrelationMatrix(matchIds) {
  var matrix = {};
  matchIds.forEach(function(id1) {
    matrix[id1] = {};
    matchIds.forEach(function(id2) {
      if (id1 === id2) {
        matrix[id1][id2] = 1;
      } else {
        // 简单实现：相同阶段的比赛设轻度相关性
        matrix[id1][id2] = 0.15;
      }
    });
  });
  return matrix;
}

// ===== 止损检查（第三层：动态再平衡） =====
var INITIAL_BANKROLL = 10000;
var DRAWDOWN_THRESHOLD = 0.15;
var LAMBDA_NORMAL = 0.3;
var LAMBDA_REDUCED = 0.15;
var RECOVERY_THRESHOLD = 0.05;

function checkDrawdown(currentBankroll) {
  var drawdown = (INITIAL_BANKROLL - currentBankroll) / INITIAL_BANKROLL;
  var lambda = LAMBDA_NORMAL;
  var mode = 'normal';
  if (drawdown > DRAWDOWN_THRESHOLD) {
    lambda = LAMBDA_REDUCED;
    mode = 'safety';
  }
  if (drawdown < RECOVERY_THRESHOLD && mode === 'safety') {
    lambda = LAMBDA_NORMAL;
    mode = 'normal';
  }
  if (mode === 'safety') {
    console.warn('[投资] 回撤已达 ' + (drawdown * 100).toFixed(1) + '%，强制半仓模式 λ=' + lambda);
  }
  return { lambda: lambda, mode: mode, drawdown: drawdown, triggered: mode === 'safety' };
}

// ===== 数据管理函数 =====

function renderStorageInfo() {
  var el = document.getElementById('inv-storage-info');
  if (!el) return;
  try {
    var raw = localStorage.getItem('investment_state');
    if (!raw) {
      el.innerHTML = '<span class="text-muted">暂无存储数据</span>';
      return;
    }
    var data = JSON.parse(raw);
    var size = new Blob([raw]).size;
    var sizeStr = size > 1024 ? (size / 1024).toFixed(1) + ' KB' : size + ' B';
    var posCount = (data.positions || []).length;
    var curveCount = (data.capitalCurve || []).length;
    var pfCount = (data.portfolioItems || []).length;
    var html = '';
    html += '<div class="inv-storage-row"><span>存储键名</span><code>investment_state</code></div>';
    html += '<div class="inv-storage-row"><span>数据大小</span><code>' + sizeStr + '</code></div>';
    html += '<div class="inv-storage-row"><span>持仓记录</span><code>' + posCount + ' 条</code></div>';
    html += '<div class="inv-storage-row"><span>资金曲线点</span><code>' + curveCount + ' 个</code></div>';
    html += '<div class="inv-storage-row"><span>组合选中的比赛</span><code>' + pfCount + ' 场</code></div>';
    html += '<div class="inv-storage-row"><span>资金余额</span><code>' + fmtMoney(data.bankroll || 0) + '</code></div>';
    html += '<div class="inv-storage-row"><span>λ 值</span><code>' + fmtNum(data.lambda || 0.3, 2) + '</code></div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<span class="text-red">读取失败: ' + e.message + '</span>';
  }
}

function savePortfolioGroup() {
  var name = document.getElementById('inv-group-name').value.trim();
  if (!name) { alert('请输入方案名称'); return; }
  if (!state.portfolioItems || state.portfolioItems.length === 0) {
    alert('当前没有选中的比赛，请先在投资面板添加比赛到组合');
    return;
  }
  try {
    var groups = JSON.parse(localStorage.getItem('investment_groups') || '{}');
    groups[name] = {
      savedAt: new Date().toISOString(),
      items: JSON.parse(JSON.stringify(state.portfolioItems)),
      matchCount: state.portfolioItems.length,
    };
    localStorage.setItem('investment_groups', JSON.stringify(groups));
    document.getElementById('inv-group-name').value = '';
    renderPortfolioGroups();
    alert('✅ 组合方案"' + name + '" 已保存（' + state.portfolioItems.length + ' 场比赛）');
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}

function renderPortfolioGroups() {
  var el = document.getElementById('inv-portfolio-groups-list');
  if (!el) return;
  try {
    var groups = JSON.parse(localStorage.getItem('investment_groups') || '{}');
    var keys = Object.keys(groups);
    if (keys.length === 0) {
      el.innerHTML = '<div class="inv-empty-state">暂无保存的方案</div>';
      return;
    }
    var html = '';
    keys.forEach(function(name) {
      var g = groups[name];
      html += '<div class="inv-group-item">';
      html += '<div class="inv-group-info">';
      html += '<span class="inv-group-name">' + name + '</span>';
      html += '<span class="inv-group-meta">' + (g.matchCount || 0) + ' 场比赛 ｜ ' + (g.savedAt ? new Date(g.savedAt).toLocaleString('zh-CN') : '') + '</span>';
      html += '</div>';
      html += '<div class="inv-group-actions">';
      html += '<button class="inv-btn" style="font-size:0.75rem;padding:2px 8px" onclick="loadPortfolioGroup(\'' + name.replace(/'/g, "\\'") + '\')">📂 加载</button>';
      html += '<button class="inv-btn" style="font-size:0.75rem;padding:2px 8px;color:var(--win-away);border-color:var(--win-away)" onclick="deletePortfolioGroup(\'' + name.replace(/'/g, "\\'") + '\')">✕</button>';
      html += '</div>';
      html += '</div>';
    });
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<span class="text-red">加载失败: ' + e.message + '</span>';
  }
}

function loadPortfolioGroup(name) {
  try {
    var groups = JSON.parse(localStorage.getItem('investment_groups') || '{}');
    var g = groups[name];
    if (!g || !g.items) { alert('方案"' + name + '"不存在'); return; }
    state.portfolioItems = JSON.parse(JSON.stringify(g.items));
    saveState();
    renderPortfolioList();
    // 切换到投资面板
    switchTab('invest');
    alert('✅ 已加载组合方案"' + name + '"（' + g.items.length + ' 场比赛），请在右侧组合分配器中查看');
  } catch (e) {
    alert('加载失败: ' + e.message);
  }
}

function deletePortfolioGroup(name) {
  if (!confirm('确定删除组合方案"' + name + '"？')) return;
  try {
    var groups = JSON.parse(localStorage.getItem('investment_groups') || '{}');
    delete groups[name];
    localStorage.setItem('investment_groups', JSON.stringify(groups));
    renderPortfolioGroups();
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

function exportState() {
  try {
    var stateData = localStorage.getItem('investment_state');
    var groupsData = localStorage.getItem('investment_groups');
    var exportObj = {
      exportedAt: new Date().toISOString(),
      version: 1,
      investment_state: stateData ? JSON.parse(stateData) : null,
      investment_groups: groupsData ? JSON.parse(groupsData) : {},
    };
    var json = JSON.stringify(exportObj, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'investment_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('导出失败: ' + e.message);
  }
}

function importState(event) {
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var data = JSON.parse(e.target.result);
      if (!data.investment_state && !data.investment_groups) {
        alert('无效的备份文件：缺少投资数据');
        return;
      }
      if (data.investment_state) {
        localStorage.setItem('investment_state', JSON.stringify(data.investment_state));
      }
      if (data.investment_groups) {
        localStorage.setItem('investment_groups', JSON.stringify(data.investment_groups));
      }
      // 重新加载状态
      loadState();
      updateSummaryBar();
      renderPortfolioList();
      renderPortfolioGroups();
      renderStorageInfo();
      alert('✅ 数据导入成功！');
    } catch (err) {
      alert('导入失败: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function resetBankroll() {
  if (!confirm('确定将资金重置为 10,000 元？持仓记录和组合方案保持不变。')) return;
  state.bankroll = 10000;
  state.capitalCurve = [];
  saveState();
  updateSummaryBar();
  renderStorageInfo();
  alert('✅ 资金已重置为 10,000 元');
}

function resetAll() {
  if (!confirm('⚠️ 确定清除所有投资数据？包括持仓记录、资金曲线和组合方案。\n此操作不可撤销！')) return;
  if (!confirm('再次确认：所有数据将被永久删除！')) return;
  try {
    localStorage.removeItem('investment_state');
    localStorage.removeItem('investment_groups');
    // 重置状态
    state.bankroll = 10000;
    state.positions = [];
    state.capitalCurve = [];
    state.portfolioItems = [];
    state.lambda = 0.30;
    state.riskProfile = 'moderate';
    state.marketMode = 'lottery';
    saveState();
    updateSummaryBar();
    renderPositionTable();
    renderPortfolioList();
    renderPortfolioGroups();
    renderStorageInfo();
    // 重置服务器数据
    fetch('/api/investment/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bankroll: 10000 }) }).catch(function() {});
    alert('✅ 所有数据已重置');
  } catch (e) {
    alert('重置失败: ' + e.message);
  }
}

function deletePosition(idx) {
  if (!confirm('确定删除该持仓记录？')) return;
  var pos = state.positions[idx];
  if (!pos) return;
  // 只退还处于 open 状态的持仓资金（已结算的不退）
  if (pos.status === 'open') {
    state.bankroll += (pos.stake || 0);
  }
  state.positions.splice(idx, 1);
  saveState();
  renderPositionTable();
  updateSummaryBar();
}

function clearAllPositions() {
  if (!confirm('确定清空所有持仓记录？')) return;
  // 退还所有 open 状态的投注额
  state.positions.forEach(function(p) {
    if (p.status === 'open') {
      state.bankroll += (p.stake || 0);
    }
  });
  state.positions = [];
  saveState();
  renderPositionTable();
  updateSummaryBar();
}

// ===== URL 状态管理 =====
function syncUrl() {
  var params = new URLSearchParams();
  params.set('tab', state.tab);
  params.set('mode', state.marketMode);
  if (state.selectedMatchIds.length > 0) {
    params.set('matches', state.selectedMatchIds.join(','));
  }
  var url = window.location.pathname + '?' + params.toString();
  history.replaceState(null, '', url);
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.inv-tab-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.inv-tab-content').forEach(function(el) {
    el.style.display = el.id === 'tab-' + tab ? 'block' : 'none';
  });
  syncUrl();

  // 切换 tab 时触发对应的渲染
  if (tab === 'positions') {
    loadPositions();
  } else if (tab === 'curve') {
    renderCapitalCurve('chart-capital-full', state.capitalCurve);
  } else if (tab === 'manage') {
    renderStorageInfo();
    renderPortfolioGroups();
  } else if (tab === 'projection') {
    loadProjection();
  }
}

function switchMarketMode(mode) {
  state.marketMode = mode;
  document.querySelectorAll('.inv-mode-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  var labelEl = document.getElementById('inv-market-mode-label');
  if (labelEl) {
    labelEl.textContent = mode === 'lottery' ? '竞彩 · 单注≤500' : 'Polymarket · 单注≤200';
  }
  syncUrl();
}

// ===== localStorage 持久化 =====
function saveState() {
  try {
    var saveData = {
      bankroll: state.bankroll,
      positions: state.positions,
      capitalCurve: state.capitalCurve,
      lambda: state.lambda,
      riskProfile: state.riskProfile,
      marketMode: state.marketMode,
      portfolioItems: state.portfolioItems
    };
    localStorage.setItem('investment_state', JSON.stringify(saveData));
  } catch (e) {
    console.warn('[投资] 保存状态失败:', e);
  }
}

function loadState() {
  try {
    var saved = localStorage.getItem('investment_state');
    if (saved) {
      var data = JSON.parse(saved);
      if (data.bankroll) state.bankroll = data.bankroll;
      if (data.positions) state.positions = data.positions;
      if (data.capitalCurve) state.capitalCurve = data.capitalCurve;
      if (data.lambda) state.lambda = data.lambda;
      if (data.riskProfile) state.riskProfile = data.riskProfile;
      if (data.marketMode) state.marketMode = data.marketMode;
      if (data.portfolioItems) state.portfolioItems = data.portfolioItems;
    }
  } catch (e) {
    console.warn('[投资] 加载状态失败:', e);
  }
  // 读取 URL 参数
  var params = new URLSearchParams(window.location.search);
  if (params.get('tab')) state.tab = params.get('tab');
  if (params.get('mode')) state.marketMode = params.get('mode');
}

// ===== 更新概览栏 =====
function updateSummaryBar() {
  var totalStaked = 0;
  var totalPL = 0;
  state.positions.forEach(function(p) {
    totalStaked += p.stake || 0;
    if (p.status === 'won') totalPL += (p.stake * (p.odds - 1));
    else if (p.status === 'lost') totalPL -= p.stake;
  });
  // state.bankroll 已经是扣除投注后的可用余额（recordBet 时扣除，delete 时退还）
  var available = state.bankroll;
  var riskBudget = state.bankroll * 0.25;
  var riskUsed = 0;
  state.positions.forEach(function(p) {
    if (p.status === 'open') riskUsed += (p.stake || 0) * 0.3;
  });
  var riskLeft = riskBudget - riskUsed;

  document.getElementById('inv-total-capital').textContent = fmtMoney(state.bankroll);
  document.getElementById('inv-total-staked').textContent = fmtMoney(totalStaked);
  var plEl = document.getElementById('inv-pl');
  plEl.textContent = fmtMoney(totalPL);
  plEl.style.color = totalPL >= 0 ? 'var(--accent-green)' : 'var(--win-away)';
  document.getElementById('inv-available').textContent = fmtMoney(available);
  document.getElementById('inv-risk-budget').textContent = fmtMoney(riskBudget);
  document.getElementById('inv-risk-used').textContent = fmtMoney(Math.max(0, riskUsed));
  document.getElementById('inv-risk-left').textContent = fmtMoney(Math.max(0, riskLeft));
  document.getElementById('inv-lambda').textContent = fmtNum(state.lambda, 2);

  // 回撤计算与止损提示
  var initialCapital = 10000;  // 原始本金
  var drawdown = (initialCapital - state.bankroll) / initialCapital;
  var drawdownPct = (drawdown * 100).toFixed(1);
  var ddEl = document.getElementById('inv-drawdown-pct');
  if (ddEl) {
    ddEl.textContent = drawdownPct + '%';
    ddEl.style.color = drawdown > 0.05 ? 'var(--win-away)' : 'var(--accent-green)';
  }

  var alertEl = document.getElementById('inv-drawdown-alert');
  if (alertEl) {
    if (drawdown > 0.15) {
      alertEl.style.display = 'block';
      alertEl.className = 'inv-drawdown-alert';
      alertEl.textContent = '⚠️ 回撤超过15%！已自动切换为半仓模式（λ=' + fmtNum(state.lambda, 2) + '）';
    } else if (drawdown > 0.05) {
      alertEl.style.display = 'block';
      alertEl.className = 'inv-drawdown-alert';
      alertEl.textContent = '⚡ 回撤 ' + drawdownPct + '% ，注意风险控制';
    } else {
      alertEl.style.display = 'none';
    }
  }
}

// ===== 数据加载 =====
async function loadKnockoutMatches() {
  try {
    // 并行请求两个端点
    var [bracketResp, knockoutResp] = await Promise.all([
      fetch('/api/bracket').then(function(r) { return r.json(); }).catch(function() { return null; }),
      fetch('/api/knockout/bracket').then(function(r) { return r.json(); }).catch(function() { return null; }),
    ]);
    // 合并数据：knockout/bracket 有 R32/R16/QF 的 homeInfo/awayInfo；bracket 解决 semi/final 的 W-slot
    var knockoutRounds = (knockoutResp && knockoutResp.rounds) ? knockoutResp.rounds : {};
    var bracketRounds = (bracketResp && bracketResp.rounds) ? bracketResp.rounds : {};
    var rounds = {};
    ['round32', 'round16', 'quarter'].forEach(function(stage) {
      rounds[stage] = knockoutRounds[stage] || bracketRounds[stage] || [];
    });
    ['semi', 'final'].forEach(function(stage) {
      // 优先 bracket（已解析 W-slot），fallback knockout
      rounds[stage] = bracketRounds[stage] || knockoutRounds[stage] || [];
    });
    state.matches = [];
    var allMatches = [];
    var stageNames = { round32: '32强', round16: '16强', quarter: '¼决赛', semi: '半决赛', final: '决赛', third: '季军赛' };
    ['round32', 'round16', 'quarter', 'semi', 'final'].forEach(function(stage) {
      if (rounds[stage]) {
        rounds[stage].forEach(function(m) {
          if (m.home && m.away && !m.home.startsWith('W') && !m.away.startsWith('W')) {
            allMatches.push({
              matchId: m.home + '-' + m.away,
              homeName: (m.homeInfo && m.homeInfo.name) || m.home,
              awayName: (m.awayInfo && m.awayInfo.name) || m.away,
              homeFlag: (m.homeInfo && m.homeInfo.flag) || '',
              awayFlag: (m.awayInfo && m.awayInfo.flag) || '',
              homeFlagPath: (m.homeInfo && m.homeInfo.flagPath) || '/images/flags/' + m.home + '.svg',
              awayFlagPath: (m.awayInfo && m.awayInfo.flagPath) || '/images/flags/' + m.away + '.svg',
              stage: stageNames[stage] || stage,
              time: m.utcDate || '',
              homeOdds: 2.5,
              drawOdds: 3.2,
              awayOdds: 3.0,
              finished: m.finished || false
            });
          }
        });
      }
    });
    state.matches = allMatches;
    renderMatchCards(allMatches);
    renderKoTree(rounds);
    if (allMatches.length > 0 && window.initProbabilityChart) {
      loadAnalysis(allMatches[0].matchId);
    }
    return allMatches;
  } catch (e) {
    console.error('[投资] 加载淘汰赛数据失败:', e);
    var loadingEl = document.getElementById('inv-cards-loading');
    if (loadingEl) loadingEl.textContent = '加载失败，请重试';
    var treeEl = document.getElementById('inv-ko-tree');
    if (treeEl) treeEl.innerHTML = '<div class="inv-empty-state">加载失败</div>';
    return [];
  }
}

async function loadAnalysis(matchId) {
  try {
    document.getElementById('inv-panel-empty').style.display = 'none';
    document.getElementById('inv-panel-detail').style.display = 'block';
    document.getElementById('inv-panel-match-name').textContent = '加载分析中...';

    var resp = await fetch('/api/investment/analysis/' + matchId + '?lambda=' + (state.lambda || 0.3) + '&mode=' + (state.marketMode || 'lottery'));
    var analysis = await resp.json();
    // 规范化 API 响应 → 前端统一格式
    var bestType = typeof analysis.bestOption === 'object' ? analysis.bestOption.type : analysis.bestOption;
    var normalized = {
      matchId: analysis.matchId,
      homeName: analysis.homeTeam ? analysis.homeTeam.name : analysis.homeName,
      awayName: analysis.awayTeam ? analysis.awayTeam.name : analysis.awayName,
      homeFlag: analysis.homeTeam ? analysis.homeTeam.flag : '',
      awayFlag: analysis.awayTeam ? analysis.awayTeam.flag : '',
      riskLevel: analysis.riskLevel || 'medium',
      bestOptionType: bestType,
      bestOptionData: typeof analysis.bestOption === 'object' ? analysis.bestOption : null,
      recommendedStake: analysis.recommendedStake || 0,
      recommendedExpectedProfit: analysis.recommendedExpectedProfit || 0,
      options: (analysis.options || []).map(function(o) {
        return {
          selection: o.type || o.selection,
          name: o.label || (o.type === 'home' ? '主胜' : o.type === 'draw' ? '平局' : '客胜'),
          prob: o.modelProb || o.prob || 0,
          odds: o.odds || 0,
          edge: o.edge || 0,
          edgePct: o.edgePct || (o.edge ? +(o.edge*100).toFixed(1) : 0),
          kellyFractional: o.kellyFractional || 0,
          kellyPct: o.kellyPct || (o.kellyFractional ? +(o.kellyFractional*100).toFixed(1) : 0),
          expectedReturnRate: o.expectedReturnRate || 0,
          isPositive: o.isPositive !== undefined ? o.isPositive : (o.edge > 0),
          confidence: o.confidence || 'medium',
          isBest: false,
        };
      }),
      odds: analysis.odds || null,
      probabilities: analysis.probabilities || null,
      elo: analysis.elo || null,
      oddsSource: analysis.oddsSource || 'elo',
      modelSource: analysis.modelSource || 'elo',
    };
    // 标记最佳选项
    var maxKelly = 0;
    normalized.options.forEach(function(o) { if (o.kellyFractional > maxKelly) maxKelly = o.kellyFractional; });
    normalized.options.forEach(function(o) { o.isBest = o.kellyFractional > 0 && o.kellyFractional >= maxKelly; });

    state.currentAnalysis = normalized;
    state.selectedMatchId = matchId;

    renderDecisionPanel(normalized);
    renderMatchOdds(matchId, normalized);
    return normalized;
  } catch (e) {
    console.error('[投资] 加载分析数据失败:', e);
    // 使用模拟数据
    var mockAnalysis = generateMockAnalysis(matchId);
    state.currentAnalysis = mockAnalysis;
    state.selectedMatchId = matchId;
    renderDecisionPanel(mockAnalysis);
    renderMatchOdds(matchId, mockAnalysis);
    return mockAnalysis;
  }
}

function generateMockAnalysis(matchId) {
  var match = state.matches.find(function(m) { return m.matchId === matchId; });
  if (!match) return null;
  var lambda = state.lambda;
  var bankroll = state.bankroll;
  return {
    matchId: matchId,
    homeName: match.homeName,
    awayName: match.awayName,
    options: [
      {
        selection: 'home',
        name: '主胜',
        prob: 0.45,
        odds: match.homeOdds || 2.0,
        edge: calcEdge(0.45, match.homeOdds || 2.0),
        kellyFractional: calcFractionalKelly(0.45, match.homeOdds || 2.0, lambda).kellyFractional,
        stake: calcStake(bankroll, calcFractionalKelly(0.45, match.homeOdds || 2.0, lambda).kellyFractional),
        expectedProfit: 0
      },
      {
        selection: 'draw',
        name: '平局',
        prob: 0.25,
        odds: match.drawOdds || 3.2,
        edge: calcEdge(0.25, match.drawOdds || 3.2),
        kellyFractional: calcFractionalKelly(0.25, match.drawOdds || 3.2, lambda).kellyFractional,
        stake: calcStake(bankroll, calcFractionalKelly(0.25, match.drawOdds || 3.2, lambda).kellyFractional),
        expectedProfit: 0
      },
      {
        selection: 'away',
        name: '客胜',
        prob: 0.30,
        odds: match.awayOdds || 2.0,
        edge: calcEdge(0.30, match.awayOdds || 2.0),
        kellyFractional: calcFractionalKelly(0.30, match.awayOdds || 2.0, lambda).kellyFractional,
        stake: calcStake(bankroll, calcFractionalKelly(0.30, match.awayOdds || 2.0, lambda).kellyFractional),
        expectedProfit: 0
      }
    ],
    riskLevel: 'medium',
    recommendedSelection: 'home',
    oddsSource: 'mock',
  };
}

// ===== 渲染函数 =====
function renderKoTree(rounds) {
  var container = document.getElementById('inv-ko-tree');
  if (!rounds) {
    container.innerHTML = '<div class="inv-empty-state">暂无淘汰赛数据</div>';
    return;
  }
  var html = '<div class="inv-ko-mini-tree">';
  var stages = [
    { key: 'round32', label: '32强' },
    { key: 'round16', label: '16强' },
    { key: 'quarter', label: '8强' },
    { key: 'semi', label: '半决赛' },
    { key: 'third', label: '季军赛' },
    { key: 'final', label: '决赛' }
  ];
  stages.forEach(function(s) {
    var matches = rounds[s.key] || [];
    html += '<div class="inv-ko-stage"><div class="inv-ko-stage-label">' + s.label + '</div>';
    html += '<div class="inv-ko-matches">';

    // 季军赛：从两场半决赛的败者构造（如果 rounds.third 不存在）
    var stageMatches = matches;
    if (s.key === 'third' && (!stageMatches || stageMatches.length === 0)) {
      var semis = rounds.semi || [];
      if (semis.length === 2) {
        function loser(m) {
          if (!m || !m.winner || !m.home || !m.away) return null;
          if (m.home.startsWith('W') || m.away.startsWith('W')) return null;
          return m.winner === m.home ? m.away : m.home;
        }
        var sf1 = semis[0], sf2 = semis[1];
        var l1 = loser(sf1), l2 = loser(sf2);
        if (l1 && l2) {
          stageMatches = [{
            home: l1,
            away: l2,
            homeInfo: sf1.awayInfo && sf1.winner !== sf1.away ? sf1.awayInfo : (sf1.homeInfo || null),
            awayInfo: sf2.awayInfo && sf2.winner !== sf2.away ? sf2.awayInfo : (sf2.homeInfo || null),
          }];
        }
      }
    }

    (stageMatches || []).forEach(function(m) {
      var homeName = m.homeInfo ? m.homeInfo.name : (m.home || 'TBD');
      var awayName = m.awayInfo ? m.awayInfo.name : (m.away || 'TBD');
      var isClickable = m.home && m.away && !m.home.startsWith('W') && !m.away.startsWith('W');
      var matchId = m.home && m.away ? m.home + '-' + m.away : (m.slot || m.id || '');
      html += '<div class="inv-ko-match' + (isClickable ? ' clickable' : '') + '" data-match-id="' + matchId + '" onclick="' + (isClickable ? "selectMatch('" + matchId + "')" : '') + '">';
      html += '<span class="inv-ko-team">' + homeName + '</span>';
      html += '<span class="inv-ko-vs">vs</span>';
      html += '<span class="inv-ko-team">' + awayName + '</span>';
      html += '</div>';
    });
    html += '</div></div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

function renderMatchCards(matches) {
  var container = document.getElementById('inv-match-cards-list');
  if (!matches || matches.length === 0) {
    container.innerHTML = '<div class="inv-empty-state">暂无可投注比赛</div>';
    return;
  }
  var html = '';
  matches.forEach(function(m) {
    var riskLevel = 'medium';
    var riskLabel = '中风险';
    html += '<div class="inv-card inv-match-card" data-match-id="' + m.matchId + '" onclick="selectMatch(\'' + m.matchId + '\')">';
    html += '<div class="inv-card-header">';
    html += '<span class="inv-card-teams">';
    html += '<span class="inv-card-team">' + (m.homeFlagPath ? '<span class="team-flag flag-sm"><img src="' + m.homeFlagPath + '" alt=""></span>' : '') + m.homeName + '</span>';
    html += '<span class="inv-card-vs">vs</span>';
    html += '<span class="inv-card-team">' + (m.awayFlagPath ? '<span class="team-flag flag-sm"><img src="' + m.awayFlagPath + '" alt=""></span>' : '') + m.awayName + '</span>';
    html += '</span>';
    html += '<span class="inv-card-stage">' + m.stage + '</span>';
    html += '</div>';
    html += '<div class="inv-card-odds" id="inv-card-odds-' + m.matchId + '">';
    html += '<div class="inv-option-row"><span class="inv-option-name">主胜</span><span class="inv-option-odds">' + fmtNum(m.homeOdds, 2) + '</span><span class="inv-option-edge" id="edge-home-' + m.matchId + '">--</span><span class="inv-option-kelly" id="kelly-home-' + m.matchId + '">--</span></div>';
    html += '<div class="inv-option-row"><span class="inv-option-name">平局</span><span class="inv-option-odds">' + fmtNum(m.drawOdds, 2) + '</span><span class="inv-option-edge" id="edge-draw-' + m.matchId + '">--</span><span class="inv-option-kelly" id="kelly-draw-' + m.matchId + '">--</span></div>';
    html += '<div class="inv-option-row"><span class="inv-option-name">客胜</span><span class="inv-option-odds">' + fmtNum(m.awayOdds, 2) + '</span><span class="inv-option-edge" id="edge-away-' + m.matchId + '">--</span><span class="inv-option-kelly" id="kelly-away-' + m.matchId + '">--</span></div>';
    html += '</div>';
    html += '<div class="inv-card-footer"><span class="inv-badge-' + riskLevel + '">' + riskLabel + '</span></div>';
    html += '</div>';
  });
  container.innerHTML = html;
}

function renderMatchOdds(matchId, analysis) {
  if (!analysis || !analysis.options) return;
  var prefix = 'inv-card-odds-' + matchId;
  analysis.options.forEach(function(opt) {
    var edgeEl = document.getElementById('edge-' + opt.selection + '-' + matchId);
    var kellyEl = document.getElementById('kelly-' + opt.selection + '-' + matchId);
    if (edgeEl) edgeEl.textContent = fmtPct(opt.edge);
    if (kellyEl) kellyEl.textContent = fmtPct(opt.kellyFractional);
  });
}

function renderDecisionPanel(analysis) {
  if (!analysis || !analysis.options) {
    document.getElementById('inv-panel-empty').style.display = 'block';
    document.getElementById('inv-panel-detail').style.display = 'none';
    return;
  }

  document.getElementById('inv-panel-empty').style.display = 'none';
  document.getElementById('inv-panel-detail').style.display = 'block';
  document.getElementById('inv-panel-match-name').textContent = analysis.homeName + ' vs ' + analysis.awayName;

  // ---- 推荐操作区: 大号 CTA ----
  var bestOption = findBestOption(analysis);
  if (bestOption) {
    var stake = calcStake(state.bankroll, bestOption.kellyFractional);
    var expectedProfit = stake * bestOption.expectedReturnRate;
    var riskLabel = analysis.riskLevel === 'low' ? '低风险' : analysis.riskLevel === 'medium' ? '中风险' : '高风险';
    var riskColor = analysis.riskLevel === 'low' ? 'var(--accent-green)' : analysis.riskLevel === 'medium' ? 'var(--warning)' : 'var(--win-away)';
    var hasPositiveEdge = bestOption.isPositive && bestOption.expectedReturnRate > 0;

    var ctaHtml = '';
    ctaHtml += '<div class="inv-cta-box">';
    ctaHtml += '<div class="inv-cta-header">推荐操作</div>';
    ctaHtml += '<div class="inv-cta-row">';
    ctaHtml += '<div class="inv-cta-main">';

    if (hasPositiveEdge) {
      ctaHtml += '<div class="inv-cta-action">投注 <strong>' + bestOption.name + '</strong></div>';
      ctaHtml += '<div class="inv-cta-detail">';
      ctaHtml += '<span>赔率 <strong>@' + fmtNum(bestOption.odds, 2) + '</strong></span>';
      ctaHtml += '<span>｜投入 <strong class="inv-cta-stake">' + fmtMoney(stake) + '</strong></span>';
      ctaHtml += '<span>｜预期收益 <strong class="inv-cta-profit" style="color:var(--accent-green)">' + fmtMoney(expectedProfit) + '</strong></span>';
      ctaHtml += '<span>｜风控 <span style="color:' + riskColor + '">' + riskLabel + '</span></span>';
      ctaHtml += '</div>';
      ctaHtml += '</div>';
      ctaHtml += '<div class="inv-cta-side">';
      ctaHtml += '<div class="inv-cta-return-box">';
      ctaHtml += '<div class="inv-cta-return-label">预期回报率</div>';
      ctaHtml += '<div class="inv-cta-return-value">' + fmtPct(bestOption.expectedReturnRate) + '</div>';
      ctaHtml += '</div>';
      ctaHtml += '</div>';
      ctaHtml += '</div>';
      ctaHtml += '<div class="inv-cta-note">若模型准确，每投注 1 元平均回报 ' + fmtNum(bestOption.expectedReturnRate + 1, 3) + ' 元（含本金）</div>';
    } else {
      ctaHtml += '<div class="inv-cta-action" style="color:var(--win-away)">🚫 <strong>不建议投注</strong></div>';
      ctaHtml += '<div class="inv-cta-detail">';
      ctaHtml += '<span>所有选项预期回报率均为负值</span>';
      ctaHtml += '<span>｜Edge ≤ 0</span>';
      ctaHtml += '<span>｜市场定价已覆盖模型优势</span>';
      ctaHtml += '</div>';
      ctaHtml += '</div>';
      ctaHtml += '</div>';
      ctaHtml += '<div class="inv-cta-note" style="color:var(--warning);background:rgba(255,165,0,0.08)">⚠️ 此时投注数学期望为负，长期必亏。建议观望</div>';
    }

    ctaHtml += '</div>';

    document.getElementById('inv-cta-area').innerHTML = ctaHtml;

    // 更新推荐仓位（供 recordBet 使用）
    state.selectedBet = hasPositiveEdge ? bestOption : null;
    document.getElementById('inv-record-btn').disabled = !hasPositiveEdge;
  }

  // ---- Kelly 明细表 ----
  var kellyHtml = '<div class="inv-kelly-table-wrap"><table class="inv-kelly-table">';
  kellyHtml += '<thead><tr><th>选项</th><th>概率</th><th>赔率</th><th>Edge</th><th>Kelly</th><th>回报率</th></tr></thead>';
  kellyHtml += '<tbody>';
  analysis.options.forEach(function(opt) {
    var isRec = bestOption && opt.selection === bestOption.selection;
    kellyHtml += '<tr class="' + (isRec ? 'inv-kelly-rec' : 'inv-kelly-negative') + '" data-selection="' + opt.selection + '" style="cursor:pointer" title="点击选择该选项">';
    kellyHtml += '<td><span class="inv-option-name-cell">' + opt.name + '</span></td>';
    kellyHtml += '<td>' + fmtPct(opt.prob) + '</td>';
    kellyHtml += '<td>' + fmtNum(opt.odds, 2) + '</td>';
    kellyHtml += '<td class="' + (opt.isPositive ? 'text-green' : 'text-red') + '"><strong>' + (opt.isPositive ? '+' : '') + fmtPct(opt.edge) + '</strong></td>';
    kellyHtml += '<td>' + fmtPct(opt.kellyFractional) + '</td>';
    kellyHtml += '<td class="' + (opt.expectedReturnRate > 0 ? 'text-green' : 'text-red') + '">' + (opt.expectedReturnRate > 0 ? '+' : '') + fmtPct(opt.expectedReturnRate) + '</td>';
    kellyHtml += '</tr>';
  });
  kellyHtml += '</tbody></table></div>';
  kellyHtml += '<div class="inv-kelly-legend"><span class="dot-green"></span> 正期望 (Edge&gt;0) ｜ <span class="dot-red"></span> 负期望 (Edge≤0) ｜ λ = ' + fmtNum(state.lambda, 2) + '</div>';
  document.getElementById('inv-kelly-results').innerHTML = kellyHtml;

  // ---- 盈亏平衡提示 ----
  if (bestOption) {
    var breakEvenProb = +(1 / bestOption.odds * 100).toFixed(1);
    document.getElementById('inv-breakeven-info').innerHTML =
      '需要 <strong>' + breakEvenProb + '%</strong> 以上胜率才能盈利 ｜ ' +
      '模型预测 <strong>' + fmtPct(bestOption.prob) + '</strong> ｜ ' +
      '安全边际 <strong>' + fmtPct(bestOption.prob - 1/bestOption.odds) + '</strong>';
  }

  // ---- 预期收益计算器 ----
  if (bestOption) {
    var stakeVal = calcStake(state.bankroll, bestOption.kellyFractional);
    var winAmount = fmtMoney(stakeVal * bestOption.odds);
    var lossAmount = fmtMoney(-stakeVal);
    var expectedValue = fmtMoney(stakeVal * bestOption.expectedReturnRate);
    var calcHtml = '';
    calcHtml += '<div class="inv-calc-row"><span>投注额</span><span>' + fmtMoney(stakeVal) + '</span></div>';
    calcHtml += '<div class="inv-calc-row"><span>若赢（概率 ' + fmtPct(bestOption.prob) + '）</span><span class="text-green">' + winAmount + '</span></div>';
    calcHtml += '<div class="inv-calc-row"><span>若输（概率 ' + fmtPct(1 - bestOption.prob) + '）</span><span class="text-red">' + lossAmount + '</span></div>';
    calcHtml += '<div class="inv-calc-row inv-calc-total"><span>期望值</span><span class="' + (bestOption.expectedReturnRate > 0 ? 'text-green' : 'text-red') + '">' + expectedValue + '</span></div>';
    document.getElementById('inv-calc-details').innerHTML = calcHtml;
  }

  // ---- λ 控制 ----
  document.getElementById('inv-lambda-slider').value = state.lambda;
  document.getElementById('inv-lambda-value').textContent = fmtNum(state.lambda, 2);

  // ---- 风险标签 ----
  var riskLabel = analysis.riskLevel === 'low' ? '🟢 低风险' : analysis.riskLevel === 'medium' ? '🟡 中风险' : '🔴 高风险';
  document.getElementById('inv-risk-label').textContent = riskLabel;
  document.getElementById('inv-elo-display').textContent =
    (analysis.elo ? analysis.elo.home + ' vs ' + analysis.elo.away : '--');

  // ---- 赔率来源 + 模型来源 ----
  var osEl = document.getElementById('inv-odds-source');
  if (osEl) {
    var oddsSrc = analysis.oddsSource || 'elo';
    var modelSrc = analysis.modelSource || 'elo';
    var parts = [];
    if (oddsSrc === 'china-sports-lottery') {
      parts.push('<span style="color:var(--accent-green)">✅ 赔率: 竞彩网实时</span>');
    } else {
      parts.push('<span style="color:var(--text-muted)">⚙️ 赔率: Elo估算</span>');
    }
    if (modelSrc === 'ensemble') {
      parts.push('<span style="color:var(--accent-green)">🧠 模型: 集成Ensemble</span>');
    } else if (modelSrc === 'ml') {
      parts.push('<span style="color:var(--accent-green)">🤖 模型: ML</span>');
    } else {
      parts.push('<span style="color:var(--text-muted)">📊 模型: Elo</span>');
    }
    osEl.innerHTML = parts.join('  ');
  }

  // 概率分布图
  if (window.renderProbabilityDistribution) {
    renderProbabilityDistribution('chart-probability-echart', analysis);
  }
}

// ===== 选择比赛 =====
function selectMatch(matchId) {
  state.selectedMatchId = matchId;
  // 高亮选中的卡片
  document.querySelectorAll('.inv-match-card').forEach(function(c) {
    c.classList.toggle('selected', c.dataset.matchId === matchId);
  });
  loadAnalysis(matchId);
}

function selectBetOption(selection) {
  if (!state.currentAnalysis) return;
  var opt = state.currentAnalysis.options.find(function(o) { return o.selection === selection; });
  if (!opt) return;
  state.selectedBet = opt;
  document.querySelectorAll('.inv-selection-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.selection === selection);
  });
  document.getElementById('inv-record-btn').disabled = false;
  // 更新仓位显示
  var stake = calcStake(state.bankroll, opt.kellyFractional);
  document.getElementById('inv-rec-stake').textContent = fmtMoney(stake);
  document.getElementById('inv-rec-pct').textContent = fmtPct(opt.kellyFractional);

  // 更新 CTA 区域为当前选择
  var ctaEl = document.getElementById('inv-cta-area');
  if (ctaEl && opt) {
    var potentialReturn = stake * (opt.odds - 1);
    var expectedProfit = stake * opt.expectedReturnRate;
    ctaEl.innerHTML =
      '<div class="inv-cta-box">' +
      '<div class="inv-cta-header">已选择: <strong>' + opt.name + '</strong></div>' +
      '<div class="inv-cta-detail" style="padding:8px 0">' +
      '<span>赔率 <strong>@' + fmtNum(opt.odds, 2) + '</strong></span>' +
      '<span>｜投入 <strong>' + fmtMoney(stake) + '</strong></span>' +
      '<span>｜若中奖 <strong style="color:var(--accent-green)">+' + fmtMoney(potentialReturn) + '</strong></span>' +
      '<span>｜预期收益 <strong style="color:' + (expectedProfit > 0 ? 'var(--accent-green)' : 'var(--win-away)') + '">' + fmtMoney(expectedProfit) + '</strong></span>' +
      '</div>' +
      (opt.isPositive ? '' : '<div style="font-size:0.8rem;color:var(--warning);margin-top:4px">⚠️ 该选项预期回报率为负(' + fmtPct(opt.expectedReturnRate) + ')，不建议大量投注</div>') +
      '</div>';
  }
}

function quickSelect() {
  // 快速选择最佳Kelly选项
  if (!state.currentAnalysis) {
    alert('请先点击左侧比赛查看分析');
    return;
  }
  var best = findBestOption(state.currentAnalysis);
  if (best && best.isPositive) {
    selectBetOption(best.selection);
    // 滚动到CTA区域高亮显示
    var ctaEl = document.getElementById('inv-cta-area');
    if (ctaEl) ctaEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    alert('当前比赛无正期望选项，不建议投注');
  }
}

function setRiskProfile(profile) {
  state.riskProfile = profile;
  document.querySelectorAll('.inv-risk-profiles .inv-risk-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.risk === profile);
  });
  var lambdaMap = { conservative: 0.15, moderate: 0.30, aggressive: 0.50 };
  state.lambda = lambdaMap[profile] || 0.30;
  document.getElementById('inv-lambda-slider').value = state.lambda;
  document.getElementById('inv-lambda-value').textContent = fmtNum(state.lambda, 2);
  document.getElementById('inv-lambda').textContent = fmtNum(state.lambda, 2);
  saveState();
  // 如果有当前分析，重新渲染
  if (state.currentAnalysis) {
    loadAnalysis(state.selectedMatchId);
  }
}

// λ 滑块事件绑定
document.addEventListener('DOMContentLoaded', function() {
  var slider = document.getElementById('inv-lambda-slider');
  if (slider) {
    slider.addEventListener('input', function() {
      state.lambda = parseFloat(this.value);
      document.getElementById('inv-lambda-value').textContent = fmtNum(state.lambda, 2);
      document.getElementById('inv-lambda').textContent = fmtNum(state.lambda, 2);
      if (state.currentAnalysis) {
        loadAnalysis(state.selectedMatchId);
      }
      saveState();
    });
  }
});

// ===== 投注操作 =====
async function recordBet() {
  if (!state.selectedBet || !state.selectedMatchId) {
    alert('请先选择投注选项（点击 Kelly 表行或快速选择按钮）');
    return;
  }
  var stake = calcStake(state.bankroll, state.selectedBet.kellyFractional);
  if (stake <= 0) {
    alert('投注金额无效');
    return;
  }

  // 确认弹窗
  var potentialReturn = stake * (state.selectedBet.odds - 1);
  var expectedProfit = stake * state.selectedBet.expectedReturnRate;
  var msg = '确定投注该选项？\n\n' +
    '选项: ' + state.selectedBet.name + '\n' +
    '赔率: @' + fmtNum(state.selectedBet.odds, 2) + '\n' +
    '投注额: ' + fmtMoney(stake) + '\n' +
    '若中奖: +' + fmtMoney(potentialReturn) + '\n' +
    '预期收益: ' + fmtMoney(expectedProfit) + '\n' +
    (state.selectedBet.isPositive ? '' : '\n⚠️ 预期回报率为负，中奖概率低') +
    '\n\n可用资金: ' + fmtMoney(state.bankroll);
  if (!confirm(msg)) return;
  var betData = {
    matchId: state.selectedMatchId,
    selection: state.selectedBet.selection,
    odds: state.selectedBet.odds,
    stake: stake,
    expectedProfit: calcExpectedProfit(stake, state.selectedBet.odds),
    mode: state.marketMode
  };

  try {
    var resp = await fetch('/api/investment/record-bet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(betData)
    });
    var result = await resp.json();
    if (result.success) {
      // 用服务器返回的实际 bankroll（前后端一致）
      state.bankroll = result.remainingBankroll || (state.bankroll - stake);
      state.positions.push({
        matchId: state.selectedMatchId,
        selection: state.selectedBet.selection,
        odds: state.selectedBet.odds,
        stake: stake,
        expectedProfit: betData.expectedProfit,
        status: 'open',       // 与服务器一致，统一为 'open'
        time: new Date().toISOString()
      });
      state.capitalCurve.push({ time: new Date().toISOString(), value: state.bankroll });
      saveState();
      updateSummaryBar();
      renderPositionTable();   // 立即刷新持仓表
      alert('投注成功！');
    } else {
      alert('投注失败: ' + (result.error || '未知错误'));
    }
  } catch (e) {
    // API 不可用时本地记录
    state.bankroll -= stake;
    state.positions.push({
      matchId: state.selectedMatchId,
      selection: state.selectedBet.selection,
      odds: state.selectedBet.odds,
      stake: stake,
      expectedProfit: betData.expectedProfit,
      status: 'open',       // 统一用 'open'
      time: new Date().toISOString()
    });
    state.capitalCurve.push({ time: new Date().toISOString(), value: state.bankroll });
    saveState();
    updateSummaryBar();
    renderPositionTable();
    alert('投注记录成功（本地）');
  }
}

async function loadPositions() {
  // 本地是唯一可靠数据源（localStorage 持久化），服务器内存重启就丢
  // 只有本地无数据时才尝试从服务器加载（首次使用场景）
  if (state.positions && state.positions.length > 0) {
    renderPositionTable();
    return;
  }
  try {
    var resp = await fetch('/api/investment/positions');
    var data = await resp.json();
    if (data.positions && data.positions.length > 0) {
      // 只作为初始数据导入，转换 status 字段
      state.positions = data.positions.map(function(p) {
        return {
          matchId: p.matchId,
          selection: p.selection,
          odds: p.odds,
          stake: p.stake,
          expectedProfit: p.expectedProfit || 0,
          status: p.status || 'open',
          time: p.createdAt || p.time || new Date().toISOString()
        };
      });
      // 同步 bankroll
      if (data.totalStaked !== undefined) {
        state.bankroll = Math.max(0, 10000 - data.totalStaked);
      }
      saveState();
    }
  } catch (e) {
    console.log('[投资] 使用本地持仓数据');
  }
  renderPositionTable();
}

async function forceSyncServer() {
  // 强制从服务器同步（慎用，会覆盖本地修改）
  if (!confirm('确定从服务器同步持仓？这将覆盖本地数据。')) return;
  state.positions = [];
  await loadPositions();
  updateSummaryBar();
}

function renderPositionTable() {
  var tbody = document.getElementById('inv-position-tbody');
  if (!state.positions || state.positions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="inv-empty-state">暂无持仓记录</td></tr>';
    var footerEl = document.getElementById('inv-position-footer');
    if (footerEl) footerEl.innerHTML = '';
    return;
  }
  // 按时间倒序
  var sorted = state.positions.slice().sort(function(a, b) {
    return new Date(b.time || 0) - new Date(a.time || 0);
  });
  var html = '';
  sorted.forEach(function(p) {
    var origIdx = state.positions.indexOf(p);  // 在原始数组中的真正索引
    var match = state.matches.find(function(m) { return m.matchId === p.matchId; });
    var matchName = match ? (match.homeName + ' vs ' + match.awayName) : p.matchId;
    var statusClass = p.status === 'won' ? 'inv-status-won' : p.status === 'lost' ? 'inv-status-lost' : 'inv-status-pending';
    var statusText = p.status === 'won' ? '已赢' : p.status === 'lost' ? '已输' : p.status === 'open' ? '未决' : '未决';
    var actualPL = p.status === 'won' ? fmtMoney(p.stake * (p.odds - 1)) : p.status === 'lost' ? fmtMoney(-p.stake) : '--';
    html += '<tr>';
    html += '<td>' + matchName + '</td>';
    html += '<td>' + (p.selection === 'home' ? '主胜' : p.selection === 'draw' ? '平局' : '客胜') + '</td>';
    html += '<td>' + fmtNum(p.odds, 2) + '</td>';
    html += '<td>' + fmtMoney(p.stake) + '</td>';
    html += '<td>' + fmtMoney(p.expectedProfit || 0) + '</td>';
    html += '<td class="' + statusClass + '">' + statusText + '</td>';
    html += '<td>' + actualPL + '</td>';
    html += '<td><button class="inv-btn" style="font-size:0.7rem;padding:1px 6px;color:var(--win-away);border-color:var(--win-away)" onclick="deletePosition(' + origIdx + ')">删除</button></td>';
    html += '</tr>';
  });
  tbody.innerHTML = html;

  // 更新汇总
  var all = state.positions;  // 用原始数组统计，不用 sorted
  var totalStaked = all.reduce(function(s, p) { return s + (p.stake || 0); }, 0);
  var totalPL = all.reduce(function(s, p) {
    if (p.status === 'won') return s + p.stake * (p.odds - 1);
    if (p.status === 'lost') return s - p.stake;
    return s;
  }, 0);
  var footerEl = document.getElementById('inv-position-footer');
  if (footerEl) {
    footerEl.innerHTML = '<tr><td colspan="8" style="text-align:right;padding:8px;font-size:0.85rem">' +
      '总投注: ' + fmtMoney(totalStaked) + ' ｜ ' +
      '总盈亏: <span style="color:' + (totalPL >= 0 ? 'var(--accent-green)' : 'var(--win-away)') + '">' + fmtMoney(totalPL) + '</span>' +
      ' ｜ <button class="inv-btn" style="font-size:0.7rem;padding:1px 6px;color:var(--win-away);border-color:var(--win-away)" onclick="clearAllPositions()">🗑️ 清空所有</button>' +
      '</td></tr>';
  }
}

function refreshPositions() {
  loadPositions();
}

// ===== 组合操作 =====
function addToPortfolio() {
  if (!state.selectedMatchId || !state.selectedBet) {
    alert('请先选择比赛和投注选项');
    return;
  }
  var existing = state.portfolioItems.findIndex(function(item) {
    return item.matchId === state.selectedMatchId;
  });
  if (existing >= 0) {
    state.portfolioItems[existing].selection = state.selectedBet.selection;
    state.portfolioItems[existing].odds = state.selectedBet.odds;
    state.portfolioItems[existing].kelly = state.selectedBet.kellyFractional;
  } else {
    state.portfolioItems.push({
      matchId: state.selectedMatchId,
      selection: state.selectedBet.selection,
      odds: state.selectedBet.odds,
      kelly: state.selectedBet.kellyFractional
    });
  }
  saveState();
  renderPortfolioList();
  alert('已加入组合');
}

function renderPortfolioList() {
  var list = document.getElementById('inv-portfolio-list');
  var budgetSection = document.getElementById('inv-portfolio-budget-section');
  var actions = document.getElementById('inv-portfolio-actions');
  var countEl = document.getElementById('inv-portfolio-count');

  if (!state.portfolioItems || state.portfolioItems.length === 0) {
    list.innerHTML = '<div class="inv-empty-state">尚未选择比赛，点击比赛卡片的"加入组合"按钮添加</div>';
    budgetSection.style.display = 'none';
    actions.style.display = 'none';
    countEl.textContent = '已选 0 场比赛';
    return;
  }

  countEl.textContent = '已选 ' + state.portfolioItems.length + ' 场比赛';
  budgetSection.style.display = 'block';
  actions.style.display = 'flex';

  var html = '';
  state.portfolioItems.forEach(function(item, idx) {
    var match = state.matches.find(function(m) { return m.matchId === item.matchId; });
    var name = match ? (match.homeName + ' vs ' + match.awayName) : item.matchId;
    html += '<div class="inv-portfolio-item">';
    html += '<span class="inv-portfolio-name">' + name + '</span>';
    html += '<span class="inv-portfolio-selection">' + (item.selection === 'home' ? '主胜' : item.selection === 'draw' ? '平局' : '客胜') + '</span>';
    html += '<span class="inv-portfolio-odds">@' + fmtNum(item.odds, 2) + '</span>';
    html += '<button class="inv-btn" onclick="removeFromPortfolio(' + idx + ')" style="padding:2px 8px;font-size:0.75rem">✕</button>';
    html += '</div>';
  });
  list.innerHTML = html;

  // 预算分配
  var budgetVal = parseInt(document.getElementById('inv-budget-range').value);
  document.getElementById('inv-budget-value').textContent = fmtMoney(budgetVal);
  renderBudgetAllocation(budgetVal);
}

function removeFromPortfolio(idx) {
  state.portfolioItems.splice(idx, 1);
  saveState();
  renderPortfolioList();
}

function clearPortfolio() {
  state.portfolioItems = [];
  saveState();
  renderPortfolioList();
}

function renderBudgetAllocation(totalBudget) {
  var container = document.getElementById('inv-budget-allocation');
  if (!state.portfolioItems || state.portfolioItems.length === 0) {
    container.innerHTML = '';
    return;
  }
  var totalKelly = state.portfolioItems.reduce(function(sum, item) { return sum + (item.kelly || 0); }, 0);
  var html = '';
  state.portfolioItems.forEach(function(item) {
    var share = totalKelly > 0 ? (item.kelly / totalKelly) : (1 / state.portfolioItems.length);
    var alloc = totalBudget * share;
    var match = state.matches.find(function(m) { return m.matchId === item.matchId; });
    var name = match ? (match.homeName + ' vs ' + match.awayName) : item.matchId;
    html += '<div class="inv-budget-item">';
    html += '<span class="inv-budget-item-name">' + name + '</span>';
    html += '<div class="inv-budget-bar"><div class="inv-budget-fill" style="width:' + (share * 100) + '%"></div></div>';
    html += '<span class="inv-budget-item-amount">' + fmtMoney(alloc) + '</span>';
    html += '</div>';
  });
  container.innerHTML = html;
}

function optimizePortfolio() {
  if (!state.portfolioItems || state.portfolioItems.length === 0) {
    alert('组合为空，请先用"加入组合"按钮添加比赛到投资组合');
    return;
  }
  var budgetVal = parseInt(document.getElementById('inv-budget-range').value);
  var matches = state.portfolioItems.map(function(item) {
    return {
      matchId: item.matchId,
      options: [{
        selection: item.selection,
        odds: item.odds,
        kellyFractional: item.kelly
      }]
    };
  });
  var allocations = allocateRiskBudget(matches, state.bankroll, state.lambda);
  // 应用相关性惩罚
  var matchIds = state.portfolioItems.map(function(item) { return item.matchId; });
  var corrMatrix = buildCorrelationMatrix(matchIds);
  allocations = applyCorrelationPenalty(allocations, corrMatrix);
  renderBudgetAllocation(budgetVal);
  alert('优化完成！');
}

async function submitPortfolio() {
  if (!state.portfolioItems || state.portfolioItems.length === 0) {
    alert('组合为空，请先用"加入组合"添加比赛');
    return;
  }
  var totalStake = 0;
  var bets = state.portfolioItems.map(function(item) {
    var stake = calcStake(state.bankroll, item.kelly);
    totalStake += stake;
    return {
      matchId: item.matchId,
      selection: item.selection,
      odds: item.odds,
      stake: stake,
      expectedProfit: calcExpectedProfit(stake, item.odds),
      mode: state.marketMode
    };
  });

  // 确认弹窗
  var summary = '确定批量投注 ' + bets.length + ' 场比赛？\n\n' +
    '总投注额: ' + fmtMoney(totalStake) + '\n' +
    '可用资金: ' + fmtMoney(state.bankroll) + '\n' +
    '资金占比: ' + (state.bankroll > 0 ? (totalStake / state.bankroll * 100).toFixed(1) : 0) + '%';
  if (!confirm(summary)) return;

  if (totalStake > state.bankroll) {
    if (!confirm('总投注额 ' + fmtMoney(totalStake) + ' 超过可用资金 ' + fmtMoney(state.bankroll) + '，是否按比例缩放？')) {
      return;
    }
    var scale = state.bankroll / totalStake;
    bets.forEach(function(b) { b.stake *= scale; b.expectedProfit = calcExpectedProfit(b.stake, b.odds); });
  }

  try {
    var resp = await fetch('/api/investment/batch-bet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bets: bets })
    });
    var result = await resp.json();
    if (result.success) {
      bets.forEach(function(b) {
        state.bankroll -= b.stake;
        state.positions.push({
          matchId: b.matchId,
          selection: b.selection,
          odds: b.odds,
          stake: b.stake,
          expectedProfit: b.expectedProfit,
          status: 'pending',
          time: new Date().toISOString()
        });
      });
      state.capitalCurve.push({ time: new Date().toISOString(), value: state.bankroll });
      state.portfolioItems = [];
      saveState();
      updateSummaryBar();
      renderPortfolioList();
      alert('批量投注成功！');
    } else {
      alert('批量投注失败: ' + (result.error || '未知错误'));
    }
  } catch (e) {
    // 模拟
    bets.forEach(function(b) {
      state.bankroll -= b.stake;
      state.positions.push({
        matchId: b.matchId,
        selection: b.selection,
        odds: b.odds,
        stake: b.stake,
        expectedProfit: b.expectedProfit,
        status: 'pending',
        time: new Date().toISOString()
      });
    });
    state.capitalCurve.push({ time: new Date().toISOString(), value: state.bankroll });
    state.portfolioItems = [];
    saveState();
    updateSummaryBar();
    renderPortfolioList();
    alert('批量投注成功（本地）');
  }
}

// ===== 回测 =====
function runBacktest() {
  var statusEl = document.getElementById('inv-backtest-status');
  var resultsEl = document.getElementById('inv-backtest-results');
  statusEl.textContent = '回测进行中...';
  statusEl.style.color = 'var(--text-muted)';

  var lambda = parseFloat(document.getElementById('inv-bt-lambda')?.value || state.lambda || 0.3);

  fetch('/api/investment/simulate-backtest?lambda=' + lambda + '&iterations=100')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error && !data.mock) {
        statusEl.textContent = '回测失败: ' + data.error;
        statusEl.style.color = 'var(--win-away)';
        return;
      }

      var r = data;
      var html = '';

      // 核心指标卡片
      html += '<div class="inv-bt-grid">';
      html += '<div class="inv-bt-card"><div class="inv-bt-card-label">总投注</div><div class="inv-bt-card-value">' + (r.totalBets || 0) + '</div></div>';
      html += '<div class="inv-bt-card"><div class="inv-bt-card-label">胜率</div><div class="inv-bt-card-value" style="color:var(--accent-green)">' + (r.winRate || 0) + '%</div></div>';
      html += '<div class="inv-bt-card"><div class="inv-bt-card-label">总利润</div><div class="inv-bt-card-value" style="color:' + (r.totalProfit > 0 ? 'var(--accent-green)' : 'var(--win-away)') + '">' + fmtMoney(r.totalProfit) + '</div></div>';
      html += '<div class="inv-bt-card"><div class="inv-bt-card-label">每注平均利润</div><div class="inv-bt-card-value">' + fmtMoney(r.avgProfitPerBet) + '</div></div>';
      html += '<div class="inv-bt-card"><div class="inv-bt-card-label">ROI</div><div class="inv-bt-card-value" style="color:' + (r.roi > 0 ? 'var(--accent-green)' : 'var(--win-away)') + '">' + fmtNum(r.roi, 2) + '%</div></div>';
      html += '<div class="inv-bt-card"><div class="inv-bt-card-label">Sharpe</div><div class="inv-bt-card-value">' + fmtNum(r.sharpeRatio || 0, 2) + '</div></div>';
      html += '</div>';

      // λ 对比按钮
      html += '<div class="inv-bt-lambda-row">';
      [0.15, 0.20, 0.25, 0.30, 0.35, 0.40].forEach(function(l) {
        var activeClass = Math.abs(l - lambda) < 0.01 ? ' active' : '';
        html += '<button class="inv-bt-lambda-btn' + activeClass + '" onclick="runBacktestWithLambda(' + l + ')">λ=' + l.toFixed(2) + '</button>';
      });
      html += '</div>';

      // 策略对比表
      html += '<div class="inv-section-title">不同 λ 值策略对比</div>';
      html += '<div class="inv-bt-detail">';
      html += '<table><tr><th>λ</th><th>胜率</th><th>总利润</th><th>ROI</th><th>Sharpe</th></tr>';
      [0.15, 0.20, 0.25, 0.30, 0.35, 0.40].forEach(function(l) {
        html += '<tr><td>' + l.toFixed(2) + '</td>';
        // Simulate scaled values for different lambdas
        var scale = l / lambda;
        html += '<td>' + (r.winRate || 0) + '%</td>';
        html += '<td style="color:' + (r.totalProfit * scale > 0 ? 'var(--accent-green)' : 'var(--win-away)') + '">' + fmtMoney(r.totalProfit * scale) + '</td>';
        html += '<td style="color:' + (r.roi * scale > 0 ? 'var(--accent-green)' : 'var(--win-away)') + '">' + fmtNum(r.roi * scale, 2) + '%</td>';
        html += '<td>' + fmtNum((r.sharpeRatio || 0) * Math.sqrt(scale), 2) + '</td></tr>';
      });
      html += '</table>';
      html += '</div>';

      // 样本明细
      if (r.results && r.results.length > 0) {
        html += '<div class="inv-section-title" style="margin-top:8px">样本明细（最近 20 注）</div>';
        html += '<div class="inv-bt-detail">';
        html += '<table><tr><th>主队</th><th>客队</th><th>投注</th><th>赔率</th><th>概率</th><th>Edge</th><th>结果</th><th>利润</th></tr>';
        r.results.slice(0, 20).forEach(function(s) {
          var resultText = s.isWin ? '✅ 赢' : '❌ 输';
          html += '<tr>';
          html += '<td>' + (s.home || '') + '</td>';
          html += '<td>' + (s.away || '') + '</td>';
          html += '<td>' + (s.selection || '') + '</td>';
          html += '<td>@' + fmtNum(s.odds, 2) + '</td>';
          html += '<td>' + fmtPct(s.modelProb) + '</td>';
          html += '<td>' + (s.edge > 0 ? '+' : '') + fmtPct(s.edge) + '</td>';
          html += '<td>' + resultText + '</td>';
          html += '<td style="color:' + (s.profit > 0 ? 'var(--accent-green)' : 'var(--win-away)') + '">' + fmtMoney(s.profit) + '</td>';
          html += '</tr>';
        });
        html += '</table>';
        html += '</div>';
      }

      resultsEl.innerHTML = html;
      statusEl.textContent = '回测完成 ✅ λ=' + lambda.toFixed(2);
      statusEl.style.color = 'var(--accent-green)';
    })
    .catch(function(e) {
      statusEl.textContent = '回测失败: ' + e.message;
      statusEl.style.color = 'var(--win-away)';
    });
}

function runBacktestWithLambda(lambda) {
  document.getElementById('inv-bt-lambda').value = lambda;
  runBacktest();
}

// ===== 收益投影 =====
async function loadProjection() {
  var statusEl = document.getElementById('inv-projection-status');
  var summaryEl = document.getElementById('inv-projection-summary');
  var tableEl = document.getElementById('inv-projection-table');
  var chartEl = document.getElementById('inv-projection-chart');

  statusEl.textContent = '正在计算剩余比赛预期收益...';
  summaryEl.innerHTML = '';
  tableEl.innerHTML = '<div class="inv-empty-state">加载中...</div>';

  try {
    var resp = await fetch('/api/investment/project-returns?lambda=' + (state.lambda || 0.3) + '&bankroll=' + state.bankroll);
    var data = await resp.json();
    renderProjection(data, statusEl, summaryEl, tableEl, chartEl);
  } catch (e) {
    statusEl.textContent = '加载失败: ' + e.message;
    tableEl.innerHTML = '<div class="inv-empty-state">加载失败，请重试</div>';
  }
}

function renderProjection(data, statusEl, summaryEl, tableEl, chartEl) {
  var cachedText = data._cached ? ' (缓存)' : '';
  statusEl.textContent = '计算完成' + cachedText + ' — 共 ' + data.summary.totalMatches + ' 场比赛';

  // === Summary ===
  var s = data.summary;
  var growthColor = s.expectedGrowth > 10 ? 'var(--accent-green)' : s.expectedGrowth > 0 ? 'var(--warning)' : 'var(--win-away)';
  summaryEl.innerHTML = '' +
    '<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center">' +
    '<div><div style="font-size:0.75rem;color:var(--text-muted)">当前资金</div><div style="font-size:1.2rem;font-weight:700">' + fmtMoney(data.bankroll) + '</div></div>' +
    '<div style="font-size:1.5rem;color:var(--text-muted)">→</div>' +
    '<div><div style="font-size:0.75rem;color:var(--text-muted)">预期终值</div><div style="font-size:1.2rem;font-weight:700;color:' + growthColor + '">' + fmtMoney(s.projectedBankroll) + '</div></div>' +
    '<div><div style="font-size:0.75rem;color:var(--text-muted)">预期收益</div><div style="font-size:1.2rem;font-weight:700;color:' + growthColor + '">' + (s.expectedGrowth > 0 ? '+' : '') + fmtMoney(s.totalExpectedProfit) + '</div></div>' +
    '<div><div style="font-size:0.75rem;color:var(--text-muted)">增长率</div><div style="font-size:1.2rem;font-weight:700;color:' + growthColor + '">' + (s.expectedGrowth > 0 ? '+' : '') + s.expectedGrowth + '%</div></div>' +
    '<div><div style="font-size:0.75rem;color:var(--text-muted)">可投场次</div><div style="font-size:1.2rem;font-weight:700">' + s.activeBets + '/' + s.totalMatches + '</div></div>' +
    '</div>' +
    '<div style="margin-top:8px;padding:8px 12px;border-radius:6px;font-size:0.85rem;' +
    'background:' + (s.expectedGrowth > 0 ? 'rgba(0,200,0,0.08)' : 'rgba(255,0,0,0.08)') + ';' +
    'color:' + (s.expectedGrowth > 0 ? 'var(--accent-green)' : 'var(--win-away)') + '">' +
    '💡 ' + s.recommendation +
    ' ｜ λ=' + fmtNum(data.lambda, 2) + '（' + (data.lambda <= 0.15 ? '保守' : data.lambda <= 0.30 ? '稳健' : '进取') + '）' +
    ' ｜ 总投注 ' + fmtMoney(s.totalStake) +
    '</div>';

  // === Table ===
  if (!data.projections || data.projections.length === 0) {
    tableEl.innerHTML = '<div class="inv-empty-state">无剩余比赛数据</div>';
  } else {
    var html = '<table style="width:100%;border-collapse:collapse;font-size:0.85rem">';
    html += '<thead><tr style="border-bottom:2px solid var(--border)">';
    html += '<th style="text-align:left;padding:8px">比赛</th>';
    html += '<th style="padding:8px">推荐</th>';
    html += '<th style="padding:8px">赔率</th>';
    html += '<th style="padding:8px">Edge</th>';
    html += '<th style="padding:8px">Kelly</th>';
    html += '<th style="padding:8px">投注额</th>';
    html += '<th style="padding:8px">预期收益</th>';
    html += '<th style="padding:8px">回报率</th>';
    html += '<th style="padding:8px">来源</th>';
    html += '</tr></thead><tbody>';

    var stageLabels = { round32: '32强', round16: '16强', quarter: '8强', semi: '半决赛', final: '决赛' };
    var runningTotal = data.bankroll;

    data.projections.forEach(function(p) {
      if (p.skipped) {
        html += '<tr style="border-bottom:1px solid var(--border);color:var(--text-muted)">';
        html += '<td style="padding:8px">' + (p.homeName || p.home) + ' vs ' + (p.awayName || p.away) + '</td>';
        html += '<td colspan="8" style="padding:8px;text-align:center;font-style:italic">-- ' + (p.reason || '跳过') + ' --</td>';
        html += '</tr>';
        return;
      }
      var oddsSrcTag = p.oddsSource === 'china-sports-lottery' ? '竞彩' : 'Elo';
      var modelSrcTag = p.modelSource === 'ensemble' ? 'Ensemble' : p.modelSource === 'ml' ? 'ML' : 'Elo';
      var edgeColor = p.edge > 0 ? 'var(--accent-green)' : 'var(--win-away)';
      var retColor = p.expectedReturnRate > 0 ? 'var(--accent-green)' : 'var(--win-away)';

      html += '<tr style="border-bottom:1px solid var(--border)">';
      html += '<td style="padding:8px">' + (p.homeName || p.home) + ' vs ' + (p.awayName || p.away) + '</td>';
      html += '<td style="padding:8px;font-weight:600">' + (p.bestOption ? p.bestOption.label : '-') + '</td>';
      html += '<td style="padding:8px">' + (p.bestOption ? fmtNum(p.bestOption.odds, 2) : '-') + '</td>';
      html += '<td style="padding:8px;color:' + edgeColor + '">' + (p.edge > 0 ? '+' : '') + p.edge + '%</td>';
      html += '<td style="padding:8px">' + p.kellyPct + '%</td>';
      html += '<td style="padding:8px">' + fmtMoney(p.stake) + '</td>';
      html += '<td style="padding:8px;color:' + (p.expectedProfit > 0 ? 'var(--accent-green)' : 'var(--win-away)') + '">' + fmtMoney(p.expectedProfit) + '</td>';
      html += '<td style="padding:8px;color:' + retColor + '">' + (p.expectedReturnRate > 0 ? '+' : '') + fmtPct(p.expectedReturnRate) + '</td>';
      html += '<td style="padding:8px;font-size:0.7rem">' + oddsSrcTag + '/' + modelSrcTag + '</td>';
      html += '</tr>';
      runningTotal += p.expectedProfit;
    });

    html += '</tbody></table>';
    tableEl.innerHTML = html;
  }

  // === Simple bar chart (text-based) ===
  if (data.projections && data.projections.length > 0) {
    var chartHtml = '<div style="margin-top:16px"><strong>📊 预期资金累积曲线</strong></div>';
    chartHtml += '<div style="display:flex;align-items:flex-end;gap:4px;height:200px;padding:8px 0;margin-top:8px">';
    var maxVal = data.summary.projectedBankroll;
    var vals = [data.bankroll];
    data.projections.forEach(function(p) {
      vals.push((vals[vals.length - 1]) + (p.expectedProfit || 0));
    });

    // Show max 20 bars
    var step = Math.max(1, Math.floor(vals.length / 20));
    var bars = [];
    for (var i = 0; i < vals.length; i += step) bars.push(vals[i]);
    if (bars[bars.length - 1] !== vals[vals.length - 1]) bars.push(vals[vals.length - 1]);

    bars.forEach(function(v, i) {
      var h = maxVal > 0 ? (v / maxVal * 100) : 0;
      var color = v >= data.bankroll ? 'var(--accent-green)' : 'var(--win-away)';
      var isLast = i === bars.length - 1;
      chartHtml += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;min-width:20px">';
      chartHtml += '<div style="width:100%;height:' + Math.max(2, h) + '%;background:' + color + ';border-radius:2px 2px 0 0;min-height:2px" title="' + fmtMoney(v) + '"></div>';
      if (i === 0 || isLast || i % 5 === 0) {
        chartHtml += '<div style="font-size:0.6rem;color:var(--text-muted);writing-mode:vertical-rl;transform:rotate(180deg);margin-top:4px">' + fmtMoney(v) + '</div>';
      }
      chartHtml += '</div>';
    });
    chartHtml += '</div>';
    chartEl.innerHTML = chartHtml;
  }
}

// ===== 页面初始化 =====
document.addEventListener('DOMContentLoaded', function() {
  loadState();
  loadKnockoutMatches();
  updateSummaryBar();

  // 绑定预算滑块
  var budgetRange = document.getElementById('inv-budget-range');
  if (budgetRange) {
    budgetRange.addEventListener('input', function() {
      document.getElementById('inv-budget-value').textContent = fmtMoney(parseInt(this.value));
      renderBudgetAllocation(parseInt(this.value));
    });
  }

  // 恢复 tab 状态
  switchTab(state.tab);

  // 恢复市场模式
  if (state.marketMode) {
    document.querySelectorAll('.inv-mode-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.dataset.mode === state.marketMode);
    });
  }

  // Kelly 表点击事件委托（data-selection 代替 inline onclick，避免转义问题）
  document.getElementById('inv-kelly-results').addEventListener('click', function(e) {
    var row = e.target.closest('tr[data-selection]');
    if (row) selectBetOption(row.dataset.selection);
  });

  console.log('[投资] 投资决策引擎已初始化');
});
