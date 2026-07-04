/**
 * 淘汰赛树 SVG 连线引擎
 * Phase 8.4 — 在淘汰赛树的前后轮次之间绘制晋级连线
 *
 * 连线颜色根据晋级概率变化：
 *   - 高概率(≥70%): 绿色 (#4ade80)
 *   - 中等(40-70%): 黄色 (#facc15)
 *   - 低概率(<40%): 红色 (#f87171)
 *
 * 布局：在 bracket-grid 上方叠加 SVG，匹配卡片位置
 */

;(function () {
  'use strict';

  // 退出标志：如果没有 bracket-tree，不运行
  if (!document.getElementById('bracket-tree')) return;

  // ===== 淘汰赛树 DAG 映射（R32 slot → 父 R16 slot） =====
  const R32_TO_R16 = {
    W78: 'W89', W85: 'W89',
    W77: 'W90', W84: 'W90',
    W75: 'W91', W76: 'W91',
    W73: 'W92', W82: 'W92',
    W79: 'W93', W80: 'W93',
    W83: 'W94', W86: 'W94',
    W74: 'W95', W87: 'W95',
    W81: 'W96', W88: 'W96',
  };

  const R16_TO_QF = {
    W89: 'W97', W90: 'W97',
    W93: 'W98', W94: 'W98',
    W91: 'W99', W92: 'W99',
    W95: 'W100', W96: 'W100',
  };

  const QF_TO_SF = {
    W97: 'W101', W98: 'W101',
    W99: 'W102', W100: 'W102',
  };

  const SF_TO_FINAL = {
    W101: 'CHAMPION', W102: 'CHAMPION',
  };

  // 所有连线链路：R32→R16, R16→QF, QF→SF, SF→FINAL
  const LINK_CHAINS = [
    { childStage: 'round32', parentStage: 'round16', map: R32_TO_R16 },
    { childStage: 'round16', parentStage: 'quarter', map: R16_TO_QF },
    { childStage: 'quarter', parentStage: 'semi', map: QF_TO_SF },
    { childStage: 'semi', parentStage: 'final', map: SF_TO_FINAL },
  ];

  // ===== 绘制函数 =====

  /**
   * 在主渲染完成后，绘制所有连线
   * @param {object} roundData - { round32: [...], round16: [...], ... } 每个轮次的对阵列表
   * @param {object} teamsProb - 球队概率 { slug: { champion, ... } }
   */
  function drawBracketLines(roundData, teamsProb) {
    const container = document.getElementById('bracket-tree');
    if (!container) return;

    // 移除旧 SVG
    const oldSvg = container.querySelector('.bracket-svg-overlay');
    if (oldSvg) oldSvg.remove();

    // 建索引：slot → match（含获胜者）
    const matchBySlot = {};
    for (const rk of ['round32', 'round16', 'quarter', 'semi', 'final']) {
      const matches = roundData[rk] || [];
      for (const m of matches) {
        matchBySlot[m.slot] = m;
      }
    }

    // 创建 SVG（全尺寸覆盖）
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'bracket-svg-overlay');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';  // 让点击穿透到卡片
    svg.style.overflow = 'visible';
    container.style.position = 'relative';
    container.appendChild(svg);

    // 等 next frame 确保布局完成
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const containerRect = container.getBoundingClientRect();

        for (const chain of LINK_CHAINS) {
          const { childStage, parentStage, map } = chain;
          const childMatches = roundData[childStage] || [];
          const parentMatches = roundData[parentStage] || [];

          for (const childMatch of childMatches) {
            const childSlot = childMatch.slot;
            const parentSlot = map[childSlot];
            if (!parentSlot) continue;

            const parentMatch = matchBySlot[parentSlot];
            if (!parentMatch) continue;

            // 找到 child 卡片的 DOM 元素和 parent 卡片的 DOM 元素
            const childEl = container.querySelector(`[data-slot="${childSlot}"]`);
            const parentEl = container.querySelector(`[data-slot="${parentSlot}"]`);
            if (!childEl || !parentEl) continue;

            const childRect = childEl.getBoundingClientRect();
            const parentRect = parentEl.getBoundingClientRect();

            // 计算连线端点（相对 container）
            const cRight = childRect.right - containerRect.left;
            const cCenterY = (childRect.top + childRect.bottom) / 2 - containerRect.top;
            const pLeft = parentRect.left - containerRect.left;
            const pCenterY = (parentRect.top + parentRect.bottom) / 2 - containerRect.top;

            // 获取概率定颜色
            const prob = getMatchProb(childMatch, teamsProb);
            const color = getLineColor(prob);

            // 贝塞尔曲线：从 child 右边缘到 parent 左边缘
            const dx = (pLeft - cRight) * 0.4;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            const d = `M ${cRight} ${cCenterY} C ${cRight + dx} ${cCenterY}, ${pLeft - dx} ${pCenterY}, ${pLeft} ${pCenterY}`;
            path.setAttribute('d', d);
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', '2');
            path.setAttribute('fill', 'none');
            path.setAttribute('opacity', '0.5');
            path.setAttribute('stroke-linecap', 'round');
            svg.appendChild(path);

            // 如果 match 已完赛，加粗连线
            if (childMatch.finished) {
              path.setAttribute('stroke-width', '3');
              path.setAttribute('opacity', '0.8');
            }
          }
        }
      });
    });
  }

  /**
   * 获取某场比赛的晋级概率（用于连线颜色）
   */
  function getMatchProb(match, teamsProb) {
    if (!match || match.finished) return 1.0;  // 已完赛 = 高概率
    if (match.winner && teamsProb) {
      // 如果已知胜利者，用其晋级概率
      const wt = teamsProb[match.winner];
      if (wt) {
        const stageKey = match.stage || 'round32';
        const stageMap = { round32: 'round32', round16: 'round16', quarter: 'quarter', semi: 'semi', final: 'champion' };
        const key = stageMap[stageKey] || 'round32';
        return (wt[key] || 50) / 100;
      }
    }
    // 失败者或未知：用 match 的平均概率
    return 0.5;
  }

  /**
   * 根据概率返回颜色
   */
  function getLineColor(prob) {
    if (prob >= 0.7) return '#4ade80';   // green
    if (prob >= 0.4) return '#facc15';   // yellow
    return '#f87171';                     // red
  }

  // ===== 导出到全局 =====
  window.drawBracketLines = drawBracketLines;

})();
