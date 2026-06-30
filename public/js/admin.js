/**
 * Phase 11 — Admin Dashboard 交互逻辑
 */

(function () {
  'use strict';

  // ===== Tab 切换 =====
  document.querySelectorAll('.admin-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.admin-tab').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.admin-tab-content').forEach(function (c) { c.classList.remove('active'); });

      btn.classList.add('active');
      var tab = btn.getAttribute('data-tab');
      var content = document.getElementById('tab-' + tab);
      if (content) content.classList.add('active');

      // 懒加载 Tab 数据
      if (tab === 'elo-history' && !content.dataset.loaded) loadEloHistory();
      if (tab === 'data-freshness' && !content.dataset.loaded) { loadFreshness(); loadChinaLotteryStatus(); }
    });
  });

  // ===== 工具函数 =====
  function showStatus(el, msg, type) {
    if (!el) return;
    el.textContent = msg;
    el.style.color = type === 'error' ? '#ff4444' : type === 'success' ? '#44dd88' : '#888';
  }

  function apiPost(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); });
  }

  function apiGet(url) {
    return fetch(url).then(function (r) { return r.json(); });
  }

  function formatDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    var pad = function (n) { return n < 10 ? '0' + n : n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  // ===== Tab: ELO 更新历史 =====
  window.loadEloHistory = function () {
    var content = document.getElementById('tab-elo-history');
    var loading = document.getElementById('elo-history-loading');
    var errorEl = document.getElementById('elo-history-error');
    var body = document.getElementById('elo-history-body');
    var emptyEl = document.getElementById('elo-history-empty');
    var contentDiv = document.getElementById('elo-history-content');

    loading.style.display = 'block';
    errorEl.style.display = 'none';
    contentDiv.style.display = 'none';

    apiGet('/api/admin/elo/manifests').then(function (data) {
      loading.style.display = 'none';
      content.dataset.loaded = '1';

      if (!data.manifests || data.manifests.length === 0) {
        emptyEl.style.display = 'block';
        contentDiv.style.display = 'block';
        return;
      }

      emptyEl.style.display = 'none';
      contentDiv.style.display = 'block';
      body.innerHTML = '';

      data.manifests.forEach(function (m) {
        var dateRange = m.matchRange
          ? (m.matchRange.from || '') + ' ~ ' + (m.matchRange.to || '')
          : '-';
        var movers = (m.topMovers || []).map(function (mv) {
          return mv.team + ' (' + (mv.delta > 0 ? '+' : '') + mv.delta + ')';
        }).join(', ') || '-';

        var tr = document.createElement('tr');
        tr.innerHTML =
          '<td>' + formatDate(m.generatedAt) + '</td>' +
          '<td>' + (m.matchesApplied || 0) + '</td>' +
          '<td style="font-size:0.82rem">' + dateRange + '</td>' +
          '<td style="font-size:0.82rem">' + movers + '</td>' +
          '<td class="action-cell">' +
          '<button class="admin-btn-sm" onclick="viewManifest(\'' + m.manifestId + '\')">📄 详情</button> ' +
          '<button class="admin-btn-sm admin-btn-danger-sm" onclick="rollbackManifest(\'' + m.manifestId + '\')">⏪ 回滚</button>' +
          '</td>';
        body.appendChild(tr);
      });
    }).catch(function (err) {
      loading.style.display = 'none';
      errorEl.style.display = 'block';
      errorEl.textContent = '加载失败: ' + err.message;
    });
  };

  window.viewManifest = function (id) {
    apiGet('/api/admin/elo/manifests/' + id).then(function (data) {
      var html = '<div class="manifest-detail">';
      html += '<p><strong>Manifest ID:</strong> ' + (data.manifestId || id) + '</p>';
      html += '<p><strong>生成时间:</strong> ' + formatDate(data.generatedAt) + '</p>';
      html += '<p><strong>比赛场次:</strong> ' + (data.matchesApplied || 0) + '</p>';

      if (data.matchRange) {
        html += '<p><strong>日期范围:</strong> ' + (data.matchRange.from || '') + ' ~ ' + (data.matchRange.to || '') + '</p>';
      }

      if (data.topMovers && data.topMovers.length > 0) {
        html += '<h4>Top Movers</h4><table class="admin-table"><thead><tr><th>球队</th><th>变化</th></tr></thead><tbody>';
        data.topMovers.forEach(function (mv) {
          html += '<tr><td>' + mv.team + '</td><td style="color:' + (mv.delta >= 0 ? '#44dd88' : '#ff4444') + '">' + (mv.delta > 0 ? '+' : '') + mv.delta + '</td></tr>';
        });
        html += '</tbody></table>';
      }

      if (data.matchDetails && data.matchDetails.length > 0) {
        html += '<h4>比赛详情</h4><table class="admin-table"><thead><tr><th>日期</th><th>主队</th><th>客队</th><th>比分</th><th>K</th><th>ΔHome</th><th>ΔAway</th></tr></thead><tbody>';
        data.matchDetails.slice(0, 20).forEach(function (d) {
          html += '<tr>' +
            '<td>' + d.date + '</td>' +
            '<td>' + d.home + '</td>' +
            '<td>' + d.away + '</td>' +
            '<td>' + d.score + '</td>' +
            '<td>' + (d.kFactor || '-') + '</td>' +
            '<td>' + (d.deltaHome != null ? (d.deltaHome > 0 ? '+' : '') + d.deltaHome.toFixed(1) : '-') + '</td>' +
            '<td>' + (d.deltaAway != null ? (d.deltaAway > 0 ? '+' : '') + d.deltaAway.toFixed(1) : '-') + '</td>' +
            '</tr>';
        });
        html += '</tbody></table>';
      }
      html += '</div>';

      document.getElementById('manifest-detail-content').innerHTML = html;
      document.getElementById('manifest-modal').style.display = 'flex';
    }).catch(function (err) {
      alert('加载 manifest 详情失败: ' + err.message);
    });
  };

  window.rollbackManifest = function (id) {
    if (!confirm('确定要回滚到 ' + id + ' 吗？此操作不可撤销！')) return;
    var statusEl = document.getElementById('elo-update-status');
    showStatus(statusEl, '回滚中...', null);

    apiPost('/api/admin/elo/rollback', { manifestId: id }).then(function (data) {
      if (data.success) {
        showStatus(statusEl, '✅ ' + data.message, 'success');
        // 刷新列表和 ELO 排名
        loadEloHistory();
        refreshEloRanking();
      } else {
        showStatus(statusEl, '❌ 回滚失败: ' + (data.error || data.message), 'error');
      }
    }).catch(function (err) {
      showStatus(statusEl, '❌ 回滚请求失败: ' + err.message, 'error');
    });
  };

  window.triggerEloUpdate = function () {
    var btn = event.target;
    var statusEl = document.getElementById('elo-update-status');
    btn.disabled = true;
    btn.textContent = '⏳ 更新中...';
    showStatus(statusEl, '正在执行批量更新...', null);

    apiPost('/api/admin/elo/update', { fromDate: 'auto' }).then(function (data) {
      btn.disabled = false;
      btn.textContent = '🔄 执行批量更新';
      if (data.success) {
        showStatus(statusEl, '✅ ' + data.message, 'success');
        loadEloHistory();
        refreshEloRanking();
      } else {
        showStatus(statusEl, '❌ ' + (data.error || '更新失败'), 'error');
      }
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = '🔄 执行批量更新';
      showStatus(statusEl, '❌ 请求失败: ' + err.message, 'error');
    });
  };

  // ===== Modal: 回缩 =====
  window.showShrinkModal = function () {
    document.getElementById('shrink-modal').style.display = 'flex';
  };

  window.confirmShrink = function () {
    var rate = parseFloat(document.getElementById('shrink-rate').value) || 0.015;
    var statusEl = document.getElementById('elo-update-status');
    showStatus(statusEl, '回缩中...', null);
    closeModal();

    apiPost('/api/admin/elo/shrink', { rate: rate }).then(function (data) {
      if (data.success) {
        showStatus(statusEl, '✅ ' + data.message, 'success');
        refreshEloRanking();
      } else {
        showStatus(statusEl, '❌ 回缩失败: ' + (data.error || data.message), 'error');
      }
    }).catch(function (err) {
      showStatus(statusEl, '❌ 回缩请求失败: ' + err.message, 'error');
    });
  };

  // ===== Modal 通用 =====
  window.closeModal = function (e) {
    if (e && e.target !== e.currentTarget) return;
    document.querySelectorAll('.modal-overlay').forEach(function (m) { m.style.display = 'none'; });
  };

  // ===== ELO 排名刷新 =====
  function refreshEloRanking() {
    // 重新加载页面更简单可靠
    apiGet('/api/teams').then(function (data) {
      if (!data.teams) return;
      var sorted = data.teams.sort(function (a, b) { return (b.elo || 0) - (a.elo || 0); });
      var tbody = document.querySelector('#tab-elo-ranking tbody');
      if (!tbody) return;
      tbody.innerHTML = '';
      sorted.forEach(function (t, i) {
        var cls = t.elo >= 1950 ? 'elo-gold' : t.elo >= 1850 ? 'elo-green' : t.elo >= 1750 ? '' : 'elo-gray';
        var flagHtml = t.flag ? '<img src="' + t.flag + '" alt="" class="team-flag-sm">' : '';
        tbody.innerHTML += '<tr class="' + cls + '" onclick="location.href=\'/teams/' + t.slug + '\'">' +
          '<td>' + (i + 1) + '</td>' +
          '<td class="team-cell">' + flagHtml + ' ' + (t.nameCn || t.nameEn) + '</td>' +
          '<td class="elo-cell">' + (t.elo != null ? t.elo : '-') + '</td>' +
          '<td>' + (t.group ? t.group.replace('Group ', '') + '组' : '-') + '</td>' +
          '</tr>';
      });
    });
  }

  // ===== Tab: 数据新鲜度 =====
  window.loadFreshness = function () {
    var tab = document.getElementById('tab-data-freshness');
    var cards = document.getElementById('freshness-cards');
    var alertEl = document.getElementById('freshness-alert');

    apiGet('/api/ml/freshness').then(function (data) {
      tab.dataset.loaded = '1';

      if (data.error) {
        cards.innerHTML = '<div class="admin-error">加载失败: ' + data.error + '</div>';
        return;
      }

      var lagDays = data.lagDays != null ? data.lagDays : '-';
      var lagClass = lagDays === 0 ? 'badge-green' : lagDays <= 3 ? 'badge-yellow' : 'badge-red';
      var lagLabel = lagDays === 0 ? '✅ 最新' : lagDays <= 3 ? '⚠️ ' + lagDays + '天' : '🔴 ' + lagDays + '天';
      var newMatches = data.newMatchCount || 0;

      cards.innerHTML =
        '<div class="freshness-card"><div class="fc-label">源数据日期</div><div class="fc-value">' + (data.lastDataDate || '-') + '</div></div>' +
        '<div class="freshness-card"><div class="fc-label">特征数据日期</div><div class="fc-value">' + (data.lastFeatureDate || '-') + '</div></div>' +
        '<div class="freshness-card"><div class="fc-label">数据滞后</div><div class="fc-value"><span class="badge ' + lagClass + '">' + lagLabel + '</span></div></div>' +
        '<div class="freshness-card"><div class="fc-label">新增场次</div><div class="fc-value">' + (newMatches > 0 ? '<span class="badge badge-yellow">' + newMatches + ' 场</span>' : '<span class="badge badge-green">0 场</span>') + '</div></div>';

      // 训练建议
      if (data.shouldSuggestTrain) {
        alertEl.style.display = 'block';
        alertEl.className = 'admin-alert admin-alert-warning';
        alertEl.innerHTML = '⚠️ 数据滞后超过阈值，建议重新训练模型 <span style="font-size:0.78rem;color:var(--text-muted)">（训练需手动触发）</span>';
      } else {
        alertEl.style.display = 'none';
      }
    }).catch(function (err) {
      cards.innerHTML = '<div class="admin-error">加载失败: ' + err.message + '</div>';
    });
  };

  window.refreshFreshness = function () {
    delete document.getElementById('tab-data-freshness').dataset.loaded;
    document.getElementById('freshness-cards').innerHTML = '<div class="loading-card"><div class="admin-loading">加载数据新鲜度...</div></div>';
    loadFreshness();
  };

  window.exportFeatures = function () {
    var statusEl = document.getElementById('freshness-status');
    var btn = event && event.target;
    if (btn) btn.disabled = true;
    showStatus(statusEl, '正在导出特征...', null);

    apiPost('/api/admin/data/export-features').then(function (data) {
      if (btn) btn.disabled = false;
      if (data.success) {
        showStatus(statusEl, '✅ ' + data.message, 'success');
        refreshFreshness();
      } else {
        showStatus(statusEl, '❌ ' + (data.error || '导出失败'), 'error');
      }
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      showStatus(statusEl, '❌ ' + err.message, 'error');
    });
  };

  // ===== 清空缓存 =====
  window.flushCache = function () {
    if (!confirm('确定要清空所有缓存数据吗？')) return;
    var btn = event && event.target;
    if (btn) { btn.disabled = true; btn.textContent = '⏳...'; }

    apiGet('/api/cache/stats?force=1').then(function () {
      if (btn) { btn.disabled = false; btn.textContent = '🗑️ 清空缓存'; }
      alert('✅ 缓存已清空');
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = '🗑️ 清空缓存'; }
      alert('❌ 清空缓存失败: ' + err.message);
    });
  };

  // ===== 竞彩数据状态 =====
  window.loadChinaLotteryStatus = function () {
    var el = document.getElementById('china-lottery-status');
    el.innerHTML = '<div class="admin-loading">加载中...</div>';

    apiGet('/api/admin/odds/china-lottery/status').then(function (data) {
      if (data.error) {
        el.innerHTML = '<div class="admin-error">' + data.error + '</div>';
        return;
      }
      if (!data.available) {
        el.innerHTML = '<div class="admin-muted">❌ 竞彩数据不可用。' + (data.message || '') + '</div>';
        return;
      }
      el.innerHTML =
        '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
        '<div class="stat-card" style="padding:8px 14px"><span class="stat-value" style="font-size:1rem">' + data.matchCount + '</span><span class="stat-label">可用比赛</span></div>' +
        '<div class="stat-card" style="padding:8px 14px"><span class="stat-value" style="font-size:1rem">' + data.files + '</span><span class="stat-label">数据文件</span></div>' +
        '<div class="stat-card" style="padding:8px 14px"><span class="stat-value" style="font-size:1rem">' + (data.lastDate || '-') + '</span><span class="stat-label">最新日期</span></div>' +
        '</div>' +
        '<div style="font-size:0.74rem;color:var(--text-muted);margin-top:6px">最新文件: ' + (data.lastFile || '-') + ' | 更新于: ' + formatDate(data.lastModified) + '</div>';
    }).catch(function (err) {
      el.innerHTML = '<div class="admin-error">加载失败: ' + err.message + '</div>';
    });
  };

  // ===== 抓取竞彩数据 =====
  window.fetchChinaLottery = function () {
    var btn = event && event.target;
    var statusEl = document.getElementById('china-lottery-fetch-status');
    if (btn) btn.disabled = true;
    showStatus(statusEl, '正在从竞彩网抓取...', null);

    apiPost('/api/admin/odds/china-lottery/fetch').then(function (data) {
      if (btn) btn.disabled = false;
      if (data.success) {
        showStatus(statusEl, '✅ ' + data.message, 'success');
        loadChinaLotteryStatus(); // 刷新状态
      } else {
        showStatus(statusEl, '❌ 抓取失败: ' + (data.error || data.message), 'error');
      }
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      showStatus(statusEl, '❌ 请求失败: ' + err.message, 'error');
    });
  };

})();
