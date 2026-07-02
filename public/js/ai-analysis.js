// ===== AI 分析页面交互 =====
// 负责: 初始加载 → 调用 API → 渲染6屏内容 → 刷新 / 折叠

(function() {
  'use strict';

  // ===== 状态 =====
  let analysis = null;
  let dataSources = null;

  // ===== DOM 缓存 =====
  const $ = id => document.getElementById(id);

  // ===== 页面初始化 =====
  if (phase14Data.initialAnalysis) {
    // 缓存命中：直接渲染（含数据源状态）
    renderAll(phase14Data.initialAnalysis, phase14Data.initialDataSources, phase14Data.initialSourceProbabilities, phase14Data.initialRecentForm);
    $('ai-cache-badge').style.display = 'inline-block';
    // DOM 就绪后重新确认数据源状态
    setTimeout(() => {
      if (phase14Data.initialDataSources) renderSources(phase14Data.initialDataSources);
    }, 200);
  } else {
    // 无缓存：调用 API
    fetchAnalysis();
  }

  // ===== 核心函数 =====

  async function fetchAnalysis(force) {
    showLoading(true);
    try {
      const res = await fetch(`/api/ai/analyze/${phase14Data.team1Slug}/${phase14Data.team2Slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: !!force }),
      });
      const data = await res.json();

      if (!data.success) {
        // LLM 失败但有数据源信息 — 显示部分结果
        if (data.dataSources) {
          // 渲染可用的数据源
          if (typeof renderSources === 'function') renderSources(data.dataSources);
          // 渲染近期表现（如有）
          if (data.recentForm) renderRecentForm(data.recentForm);
          // 渲染赛程信息（如有）
          if (data.matchInfo) renderSchedule(data.matchInfo);
          // 渲染信源对比表（如有）
          if (data.sourceProbabilities && Object.keys(data.sourceProbabilities).length > 0) {
            renderComparison(data.sourceProbabilities);
          }
          // 显示错误信息在 Hero 区
          showLLMFailed(data.error || 'AI 分析生成失败');
        } else {
          showError(data.error || 'AI 分析失败');
        }
        return;
      }

      analysis = data.analysis;
      dataSources = data.dataSources;
      renderAll(analysis, dataSources, data.sourceProbabilities, data.recentForm);
      if (data.matchInfo) renderSchedule(data.matchInfo);

      if (data.cached) {
        $('ai-cache-badge').style.display = 'inline-block';
      }
    } catch (e) {
      showError('网络错误: ' + e.message);
    } finally {
      showLoading(false);
    }
  }

  function renderAll(an, ds, sp, rf) {
    // 步骤指示器完成
    ['step-aggregate', 'step-llm', 'step-parse'].forEach(id => $(id).classList.add('complete'));

    try {
      renderHero(an);
      renderReasoning(an);
      if (phase14Data.initialMatchInfo) renderSchedule(phase14Data.initialMatchInfo);
      renderComparison(an, ds, sp);
      if (rf) renderRecentForm(rf);
      if (ds) renderSources(ds);
    } catch(e) {
      console.error('[ai] renderAll ERR:', e.message, e.stack);
    }
  }

  // ===== 第1屏: Hero =====
  function renderHero(an) {
    const p = an.probabilities;
    $('ai-home-prob').textContent = fmtPctShort(p.homeWin);
    $('ai-draw-prob').textContent = fmtPctShort(p.draw);
    $('ai-away-prob').textContent = fmtPctShort(p.awayWin);

    const pickMap = { home: '主胜', draw: '平局', away: '客胜' };
    $('ai-pick').textContent = pickMap[an.recommendedPick] || an.recommendedPick;
    $('ai-confidence').textContent = fmtPct(an.confidence);
    $('ai-score').textContent = `${an.scorePrediction.home} - ${an.scorePrediction.away}`;

    if (an.overUnder) {
      const rec = an.overUnder.recommendation === 'over' ? '大' : '小';
      $('ai-ou').textContent = `${rec}2.5 (${fmtPct(an.overUnder.over2_5)}/${fmtPct(an.overUnder.under2_5)})`;
    }
    if (an.expectedGoals) {
      $('ai-xg-total').textContent = an.expectedGoals.total?.toFixed(2) || '--';
    }
    if (an.extraTime) {
      $('ai-et').textContent = fmtPct(an.extraTime.probability);
    }
    if (an.penaltyShootout) {
      $('ai-pk').textContent = fmtPct(an.penaltyShootout.probability);
    }
    $('ai-best-odds').textContent = an.bestOddsSource || '--';

    // 队伍名
    $('ai-home-name').textContent = phase14Data.team1Name || phase14Data.team1Slug;
    $('ai-away-name').textContent = phase14Data.team2Name || phase14Data.team2Slug;

    $('ai-generated-at').textContent = `⏱ 更新于 ${new Date().toLocaleString('zh-CN')}`;
  }

  // ===== 第2屏: 推理 =====
  function renderReasoning(an) {
    if (an.reasoning) {
      $('ai-reasoning').innerHTML = an.reasoning.split('\n').filter(l => l.trim()).map(p => `<p>${p}</p>`).join('');
    }
    if (Array.isArray(an.keyFactors)) {
      $('ai-key-factors').innerHTML = an.keyFactors.map(f => `<li>✅ ${f}</li>`).join('');
    }
    if (Array.isArray(an.riskFactors)) {
      $('ai-risk-factors').innerHTML = an.riskFactors.map(f => `<li>⚠️ ${f}</li>`).join('');
    }
  }

  // ===== 第3屏: 赛程与实时数据 =====
  function renderSchedule(mi) {
    const stageLabels = {
      round32: '32强晋级赛', round16: '16强晋级赛', quarter: '1/4决赛',
      semi: '半决赛', final: '决赛', knockout: '淘汰赛',
      LAST_32: '32强晋级赛', LAST_16: '16强晋级赛',
      QUARTER_FINAL: '1/4决赛', SEMI_FINAL: '半决赛', FINAL: '决赛',
    };
    $('ai-stage-detail').textContent = stageLabels[mi.stage] || mi.stage || '--';
    $('ai-match-date').textContent = mi.date || '--';
    const statusMap = { scheduled: '📅 未开赛', TIMED: '📅 待发生', ongoing: '🔄 进行中', completed: '✅ 已结束', postponed: '⏳ 延期', cancelled: '❌ 取消' };
    $('ai-match-status').textContent = statusMap[mi.status] || mi.status || '--';
  }

  // ===== 第6屏: 信源对比 =====
  function renderComparison(an, ds, sp) {
    const tbody = $('comparison-body');
    const p = an.probabilities;
    let rows = '';

    rows += `<tr><td>🤖 AI 分析</td><td class="num">${fmtPct(p.homeWin)}</td><td class="num">${fmtPct(p.draw)}</td><td class="num">${fmtPct(p.awayWin)}</td></tr>`;
    rows += `<tr class="sep-row"><td colspan="4"></td></tr>`;

    // 各信源概率信息
    if (sp) {
      const labels = {
        elo: '📈 Elo 模型',
        ml: '🤖 ML 模型 v1',
        ensemble: '🧠 集成学习',
        odds: '🏦 市场赔率共识',
        polymarket: '📉 Polymarket',
      };
      for (const [key, probs] of Object.entries(sp)) {
        const label = labels[key] || key;
        const hw = probs.homeWin != null ? probs.homeWin : (probs.home || 0);
        const dr = probs.draw != null ? probs.draw : 0;
        const aw = probs.awayWin != null ? probs.awayWin : (probs.away || 0);
        rows += `<tr><td>${label}</td><td class="num">${fmtPctShort(hw)}%</td><td class="num">${fmtPctShort(dr)}%</td><td class="num">${fmtPctShort(aw)}%</td></tr>`;
      }
    }

    tbody.innerHTML = rows || '<tr><td colspan="4">暂无对比数据</td></tr>';
  }

  function buildComparisonTable(raw) {
    let r = '';
    for (const [source, probs] of Object.entries(raw)) {
      const label = { elo: '📈 Elo 模型', ml: '🤖 ML 模型 v1', ensemble: '🧠 集成学习', odds: '🏦 市场赔率', polymarket: '📉 Polymarket' }[source] || source;
      r += `<tr><td>${label}</td><td class="num">${fmtPct(probs.homeWin)}</td><td class="num">${fmtPct(probs.draw)}</td><td class="num">${fmtPct(probs.awayWin)}</td></tr>`;
    }
    if (r) r += '<tr class="sep-row"><td colspan="4"></td></tr>';
    return r;
  }

  // ===== 近期表现（核心历史与表现数据） =====
  function renderRecentForm(rf) {
    if (rf.home) {
      $('ai-h-gf').textContent = rf.home.gf || 0;
      $('ai-h-ga').textContent = rf.home.ga || 0;
      if (rf.home.formStr) $('ai-h-form').textContent = translateForm(rf.home.formStr);
      // 更新"近N场"标签
      const hc = parseInt(rf.home.count) || 0;
      if (hc > 0 && hc < 5) {
        const labels = document.querySelectorAll('#ai-h-gf-label');
        labels.forEach(l => l.textContent = `(共${hc}场)`);
        const ps = document.querySelectorAll('.history-card:first-child p');
        ps.forEach(p => {
          if (p.textContent.includes('近5场进球')) p.innerHTML = p.innerHTML.replace('近5场', '近' + hc + '场');
          if (p.textContent.includes('近5场失球')) p.innerHTML = p.innerHTML.replace('近5场', '近' + hc + '场');
        });
      }
    }
    if (rf.away) {
      $('ai-a-gf').textContent = rf.away.gf || 0;
      $('ai-a-ga').textContent = rf.away.ga || 0;
      if (rf.away.formStr) $('ai-a-form').textContent = translateForm(rf.away.formStr);
      const ac = parseInt(rf.away.count) || 0;
      if (ac > 0 && ac < 5) {
        const ps = document.querySelectorAll('.history-card:last-child p');
        ps.forEach(p => {
          if (p.textContent.includes('近5场进球')) p.innerHTML = p.innerHTML.replace('近5场', '近' + ac + '场');
          if (p.textContent.includes('近5场失球')) p.innerHTML = p.innerHTML.replace('近5场', '近' + ac + '场');
        });
      }
    }
  }

  // ===== 数据源展开折叠 =====
  function renderSources(ds) {
    const labels = {
      elo: 'Elo 模型',
      ml: 'ML 模型 v1',
      ensemble: '集成学习',
      odds: '市场赔率共识',
      polymarket: 'Polymarket',
      lottery: '竞彩网',
      form: '近期状态',
      knockout: '淘汰赛加时/点球',
    };
    // 后端 key → 前端 key 映射
    const keyMap = {
      oddsApi: 'odds',
      chinaLottery: 'lottery',
      elo: 'elo',
      ml: 'ml',
      ensemble: 'ensemble',
      polymarket: 'polymarket',
      form: 'form',
      knockout: 'knockout',
    };
    for (const [key, available] of Object.entries(ds)) {
      const mappedKey = keyMap[key] || key;
      const statusEl = document.getElementById(`src-${mappedKey}-status`);
      if (statusEl) {
        statusEl.textContent = available ? '✅ 可用' : '❌ 不可用';
        statusEl.className = available ? 'source-status available' : 'source-status unavailable';
      }
    }
  }

  function toggleSource(header) {
    const item = header.closest('.source-item');
    const body = item.querySelector('.source-body');
    const arrow = header.querySelector('.toggle-arrow');
    if (body) {
      const isOpen = body.style.display === 'block';
      body.style.display = isOpen ? 'none' : 'block';
      arrow.textContent = isOpen ? '▶' : '▼';
    }
  }

  // ===== 刷新 =====
  window.refreshAnalysis = function() {
    fetchAnalysis(true);
  };

  // ===== 工具函数 =====

  function fmtPct(v) {
    if (v == null || isNaN(v)) return '--';
    return (v * 100).toFixed(1) + '%';
  }

  function fmtPctShort(v) {
    if (v == null || isNaN(v)) return '--';
    return (v * 100).toFixed(1);
  }

  // W/D/L → 胜/平/负
  function translateForm(str) {
    if (!str) return '';
    const map = { W: '胜', D: '平', L: '负' };
    return str.split('').map(c => map[c] || c).join('');
  }

  function showLoading(show) {
    $('ai-analysis-loading').style.display = show ? 'flex' : 'none';
    $('ai-analysis-content').style.display = show ? 'none' : 'block';
  }

  function showError(msg) {
    const el = document.querySelector('.ai-loading-state') || document.createElement('div');
    el.innerHTML = `<div class="ai-error"><h3>❌ AI 分析失败</h3><p>${msg}</p></div>`;
    el.style.display = 'flex';
  }

  function showLLMFailed(msg) {
    // LLM 失败但数据源已就绪：显示 Hero 区提示 + 数据源
    const content = $('ai-analysis-content');
    content.style.display = 'block';

    // 在 Hero 区显示 LLM 不可用提示
    const hero = $('ai-hero');
    const notice = document.createElement('div');
    notice.className = 'ai-llm-notice';
    notice.innerHTML = `<p>⚠️ ${msg}</p>
      <p>数据源聚合已完成，可查看下方数据源详情。</p>
      <button class="btn btn-sm btn-ai" onclick="retryLLM()">🔄 重试 AI 分析</button>`;
    hero.parentNode.insertBefore(notice, hero.nextSibling);

    // 隐藏 loading
    $('ai-analysis-loading').style.display = 'none';
  }

  window.retryLLM = function() {
    const notice = document.querySelector('.ai-llm-notice');
    if (notice) notice.remove();
    fetchAnalysis(true);
  };
})();
