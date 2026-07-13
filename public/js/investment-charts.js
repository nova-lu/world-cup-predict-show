// ===== 投资决策图表模块 (ECharts) =====

// ===== 资金曲线图 =====
function renderCapitalCurve(containerId, curveData) {
  var dom = document.getElementById(containerId);
  if (!dom) return;
  var chart = echarts.init(dom);

  if (!curveData || curveData.length < 2) {
    // 使用模拟数据
    var initial = 10000;
    var mockData = [];
    for (var i = 0; i < 30; i++) {
      initial += (Math.random() - 0.45) * 200;
      mockData.push({ time: 'Day ' + (i + 1), value: Math.max(initial, 8000) });
    }
    curveData = mockData;
  }

  var times = curveData.map(function(d) { return d.time || ''; });
  var values = curveData.map(function(d) { return d.value; });
  var initialCapital = 10000;
  var ddLine = initialCapital * (1 - 0.15);

  // 标记点
  var markPoints = [];
  curveData.forEach(function(d, i) {
    if (i === 0 || i === curveData.length - 1) {
      var change = d.value - (i === 0 ? initialCapital : curveData[i - 1].value);
      markPoints.push({
        name: i === 0 ? '初始' : '当前',
        coord: [times[i], d.value],
        itemStyle: {
          color: change >= 0 ? '#3fb950' : '#da3633'
        },
        label: {
          formatter: '￥' + d.value.toFixed(0),
          position: i === 0 ? 'bottom' : 'top'
        }
      });
    }
  });

  var option = {
    tooltip: {
      trigger: 'axis',
      formatter: function(params) {
        var p = params[0];
        return p.axisValue + '<br/>资金: ￥' + p.value.toFixed(2);
      }
    },
    grid: { left: '3%', right: '4%', bottom: '3%', top: '8%', containLabel: true },
    xAxis: {
      type: 'category',
      data: times,
      axisLine: { lineStyle: { color: '#30363d' } },
      axisLabel: { color: '#8b949e', fontSize: 10 }
    },
    yAxis: {
      type: 'value',
      min: Math.min.apply(null, values) * 0.95,
      max: Math.max.apply(null, values) * 1.05,
      splitLine: { lineStyle: { color: 'rgba(48,54,61,0.4)' } },
      axisLabel: {
        color: '#8b949e',
        fontSize: 10,
        formatter: function(v) { return '￥' + v.toFixed(0); }
      }
    },
    series: [{
      type: 'line',
      data: values,
      smooth: true,
      symbol: 'circle',
      symbolSize: 4,
      lineStyle: { width: 2, color: '#58a6ff' },
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(88,166,255,0.25)' },
            { offset: 1, color: 'rgba(88,166,255,0.02)' }
          ]
        }
      },
      markLine: {
        silent: true,
        data: [
          {
            yAxis: initialCapital,
            label: { formatter: '初始 ￥{c}', color: '#8b949e', fontSize: 10 },
            lineStyle: { color: '#8b949e', type: 'dashed', width: 1 }
          },
          {
            yAxis: ddLine,
            label: { formatter: '-15% 回撤 ￥{c}', color: '#f0883e', fontSize: 10 },
            lineStyle: { color: '#f0883e', type: 'dashed', width: 1 }
          }
        ]
      },
      markPoint: {
        data: markPoints,
        symbol: 'pin',
        symbolSize: 35
      },
      itemStyle: {
        color: function(params) {
          if (params.dataIndex > 0) {
            var prev = values[params.dataIndex - 1];
            return params.value >= prev ? '#3fb950' : '#da3633';
          }
          return '#58a6ff';
        }
      }
    }]
  };

  chart.setOption(option);
  window.addEventListener('resize', function() { chart.resize(); });
  return chart;
}

// ===== 概率分布图（泊松矩阵气泡图） =====
function renderProbabilityDistribution(containerId, analysis) {
  var dom = document.getElementById(containerId);
  if (!dom) return;
  var chart = echarts.init(dom);

  if (!analysis || !analysis.options) {
    chart.setOption({
      title: { text: '暂无数据', textStyle: { color: '#8b949e', fontSize: 13 }, left: 'center', top: 'center' }
    });
    return;
  }

  var options = analysis.options || [];
  var data = options.map(function(opt, i) {
    return {
      name: opt.name || ('Option ' + (i + 1)),
      value: [
        opt.prob || 0,
        opt.edge || 0,
        (opt.kellyFractional || 0) * 100
      ]
    };
  });

  var option = {
    tooltip: {
      formatter: function(params) {
        var d = params.data;
        return d.name + '<br/>概率: ' + (d.value[0] * 100).toFixed(1) + '%<br/>Edge: ' + (d.value[1] * 100).toFixed(2) + '%<br/>Kelly: ' + d.value[2].toFixed(2) + '%';
      }
    },
    grid: { left: '10%', right: '8%', bottom: '12%', top: '6%' },
    xAxis: {
      type: 'value',
      name: '概率',
      nameTextStyle: { color: '#8b949e', fontSize: 10 },
      min: 0,
      max: 1,
      splitLine: { lineStyle: { color: 'rgba(48,54,61,0.4)' } },
      axisLabel: {
        color: '#8b949e',
        fontSize: 10,
        formatter: function(v) { return (v * 100).toFixed(0) + '%'; }
      }
    },
    yAxis: {
      type: 'value',
      name: 'Edge',
      nameTextStyle: { color: '#8b949e', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(48,54,61,0.4)' } },
      axisLabel: {
        color: '#8b949e',
        fontSize: 10,
        formatter: function(v) { return (v * 100).toFixed(1) + '%'; }
      }
    },
    series: [{
      type: 'scatter',
      data: data,
      symbolSize: function(val) {
        return Math.max(20, Math.min(80, val[2] * 3 + 20));
      },
      itemStyle: {
        color: function(params) {
          var colors = ['#3fb950', '#d29922', '#da3633'];
          return colors[params.dataIndex] || '#58a6ff';
        }
      },
      label: {
        show: true,
        formatter: function(params) { return params.data.name; },
        position: 'right',
        color: '#e6edf3',
        fontSize: 10
      }
    }]
  };

  chart.setOption(option);
  window.addEventListener('resize', function() { chart.resize(); });
  return chart;
}

// ===== 最优路径图（桑基图） =====
function renderOptimalPath(containerId, bracketData) {
  var dom = document.getElementById(containerId);
  if (!dom) return;
  var chart = echarts.init(dom);

  if (!bracketData || !bracketData.roundData) {
    chart.setOption({
      title: { text: '暂无数据', textStyle: { color: '#8b949e', fontSize: 13 }, left: 'center', top: 'center' }
    });
    return;
  }

  // 构建桑基图数据
  var stages = [
    { key: 'round32', label: '32强' },
    { key: 'round16', label: '16强' },
    { key: 'quarter', label: '8强' },
    { key: 'semi', label: '半决赛' },
    { key: 'final', label: '决赛' }
  ];

  var nodes = [];
  var links = [];
  var nodeMap = {};
  var nodeIdx = 0;

  // 冠军节点
  nodes.push({ name: '🏆 冠军', itemStyle: { color: '#facc15' } });
  var championIdx = nodeIdx++;

  stages.forEach(function(s, si) {
    var matches = bracketData.roundData[s.key] || [];
    matches.forEach(function(m) {
      if (m.home && !m.home.startsWith('W')) {
        var homeName = m.homeInfo ? m.homeInfo.name : m.home;
        if (!nodeMap[homeName]) {
          nodeMap[homeName] = nodeIdx++;
          nodes.push({ name: homeName });
        }
      }
      if (m.away && !m.away.startsWith('W')) {
        var awayName = m.awayInfo ? m.awayInfo.name : m.away;
        if (!nodeMap[awayName]) {
          nodeMap[awayName] = nodeIdx++;
          nodes.push({ name: awayName });
        }
      }
    });
  });

  // 创建连接：同一场比赛的两个队伍流向胜者
  var prevStageWinners = [];
  stages.forEach(function(s, si) {
    var matches = bracketData.roundData[s.key] || [];
    var stageWinners = [];
    matches.forEach(function(m) {
      if (m.home && m.away && !m.home.startsWith('W') && !m.away.startsWith('W')) {
        var homeName = m.homeInfo ? m.homeInfo.name : m.home;
        var awayName = m.awayInfo ? m.awayInfo.name : m.away;
        var winnerName = null;

        // 如果有赢家
        if (m.winner) {
          winnerName = m.winnerInfo ? m.winnerInfo.name : m.winner;
        }

        // 连接上一轮胜者到本场比赛
        if (si > 0) {
          prevStageWinners.forEach(function(w) {
            if (w === homeName || w === awayName) {
              links.push({
                source: w,
                target: homeName === w ? homeName + ' vs ' + awayName : homeName + ' vs ' + awayName,
                value: 1
              });
            }
          });
        }

        // 从比赛到胜者
        if (winnerName && nodeMap[winnerName] != null) {
          var matchLabel = homeName + ' vs ' + awayName;
          if (!nodeMap[matchLabel]) {
            nodeMap[matchLabel] = nodeIdx++;
            nodes.push({
              name: matchLabel,
              itemStyle: { color: '#30363d' },
              label: { show: false }
            });
          }
          links.push({ source: homeName, target: matchLabel, value: 1 });
          links.push({ source: awayName, target: matchLabel, value: 1 });
          links.push({ source: matchLabel, target: winnerName, value: 2 });
          stageWinners.push(winnerName);
        } else {
          // 无赢家，直接流向两个队伍
          stageWinners.push(homeName, awayName);
        }
      }
    });
    prevStageWinners = stageWinners;
  });

  // 连接决赛胜者到冠军
  var finalMatches = bracketData.roundData.final || [];
  finalMatches.forEach(function(m) {
    if (m.winner) {
      var winnerName = m.winnerInfo ? m.winnerInfo.name : m.winner;
      if (nodeMap[winnerName] != null) {
        links.push({ source: winnerName, target: '🏆 冠军', value: 3 });
      }
    }
  });

  if (links.length === 0) {
    chart.setOption({
      title: { text: '暂无路径数据', textStyle: { color: '#8b949e', fontSize: 13 }, left: 'center', top: 'center' }
    });
    return;
  }

  var option = {
    tooltip: { trigger: 'item', triggerOn: 'mousemove' },
    series: [{
      type: 'sankey',
      layout: 'none',
      layoutIterations: 0,
      emphasis: { focus: 'adjacency' },
      nodeAlign: 'left',
      nodeWidth: 12,
      nodeGap: 8,
      lineStyle: { color: 'gradient', curveness: 0.5 },
      data: nodes,
      links: links,
      label: {
        color: '#e6edf3',
        fontSize: 9
      }
    }]
  };

  chart.setOption(option);
  window.addEventListener('resize', function() { chart.resize(); });
  return chart;
}

// ===== 风险预算分配图 =====
function renderRiskBudget(containerId, allocations) {
  var dom = document.getElementById(containerId);
  if (!dom) return;
  var chart = echarts.init(dom);

  if (!allocations || allocations.length === 0) {
    chart.setOption({
      title: { text: '暂无数据', textStyle: { color: '#8b949e', fontSize: 13 }, left: 'center', top: 'center' }
    });
    return;
  }

  var names = allocations.map(function(a) {
    return a.matchId || 'Match ' + (allocations.indexOf(a) + 1);
  });
  var values = allocations.map(function(a) { return a.stake || 0; });

  var option = {
    tooltip: {
      trigger: 'item',
      formatter: function(params) {
        return params.name + '<br/>预算: ￥' + params.value.toFixed(2) + '<br/>占比: ' + params.percent.toFixed(1) + '%';
      }
    },
    series: [{
      type: 'pie',
      radius: ['30%', '70%'],
      center: ['50%', '50%'],
      data: allocations.map(function(a, i) {
        return {
          name: names[i],
          value: values[i]
        };
      }),
      itemStyle: {
        borderRadius: 4,
        borderColor: '#0d1117',
        borderWidth: 2
      },
      label: {
        color: '#e6edf3',
        fontSize: 10,
        formatter: function(params) {
          return params.name + '\n￥' + params.value.toFixed(0);
        }
      },
      labelLine: { lineStyle: { color: '#30363d' } },
      emphasis: {
        itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.5)' }
      }
    }]
  };

  chart.setOption(option);
  window.addEventListener('resize', function() { chart.resize(); });
  return chart;
}

// ===== 页面加载完成后初始化图表 =====
document.addEventListener('DOMContentLoaded', function() {
  // 监听数据加载完成事件
  var checkInterval = setInterval(function() {
    if (typeof state !== 'undefined' && state.capitalCurve) {
      clearInterval(checkInterval);

      // 资金曲线图（投资面板）
      renderCapitalCurve('chart-capital-echart', state.capitalCurve);

      // 等待比赛数据加载完成
      var matchCheck = setInterval(function() {
        var firstMatch = state.matches && state.matches[0];
        if (firstMatch) {
          clearInterval(matchCheck);
          // 概率分布图初始化为首场比赛
          var analysis = state.currentAnalysis || {
            homeName: firstMatch.homeName,
            awayName: firstMatch.awayName,
            options: [
              { name: '主胜', prob: 0.45, edge: 0.05, kellyFractional: 0.03 },
              { name: '平局', prob: 0.25, edge: -0.02, kellyFractional: 0 },
              { name: '客胜', prob: 0.30, edge: 0.01, kellyFractional: 0.01 }
            ]
          };
          renderProbabilityDistribution('chart-probability-echart', analysis);
        }
      }, 300);

      // 初始化最优路径（等待 bracket 数据）
      setTimeout(function() {
        fetch('/api/knockout/bracket')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            renderOptimalPath('chart-path-echart', data);
          })
          .catch(function() {
            // 静默失败
          });
      }, 500);
    }
  }, 200);
});
