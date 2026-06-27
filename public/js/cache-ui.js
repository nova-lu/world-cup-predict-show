// ===== 缓存状态 UI 组件 =====
// 所有页面共享的缓存状态栏 + 更新按钮

class CacheUI {
  constructor() {
    this.bar = null;
    this._refreshCallbacks = {};
    this.init();
  }

  init() {
    // 创建缓存状态栏
    this.bar = document.createElement('div');
    this.bar.id = 'cache-status-bar';
    this.bar.innerHTML = [
      '<span class="cache-indicator" id="cache-indicator"></span>',
      '<span class="cache-text" id="cache-text"></span>',
      '<button class="cache-refresh-btn" id="cache-refresh-btn">🔄 Update Data</button>'
    ].join('');
    document.body.appendChild(this.bar);
    this.bindEvents();
  }

  bindEvents() {
    document.getElementById('cache-refresh-btn').addEventListener('click', () => {
      this.refresh();
    });
  }

  /**
   * 注册页面级刷新回调
   * @param {string} id - 唯一标识
   * @param {function} callback - 刷新函数（返回 Promise）
   */
  onRefresh(id, callback) {
    this._refreshCallbacks[id] = callback;
  }

  /**
   * 设置缓存状态
   * @param {object} meta - _cache 元信息
   */
  setStatus(meta) {
    const indicator = document.getElementById('cache-indicator');
    const text = document.getElementById('cache-text');
    if (!meta) {
      indicator.className = 'cache-indicator cache-unknown';
      text.textContent = 'Status unknown';
      return;
    }
    const age = meta.age || 0;
    const remaining = meta.remaining || 0;
    if (meta._degraded) {
      indicator.className = 'cache-indicator cache-degraded';
      text.textContent = 'Degraded mode (using stale data)';
    } else if (remaining <= 0) {
      indicator.className = 'cache-indicator cache-stale';
      text.textContent = 'Data expired, click to refresh';
    } else if (remaining < 300000) {
      indicator.className = 'cache-indicator cache-expiring';
      text.textContent = 'Expiring in ' + Math.round(remaining/60000) + 'min';
    } else {
      indicator.className = 'cache-indicator cache-fresh';
      text.textContent = 'Fresh / Updated ' + Math.round(age/60000) + 'min ago';
    }
  }

  startRefreshing() {
    const btn = document.getElementById('cache-refresh-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Refreshing...';
  }

  finishRefreshing() {
    const btn = document.getElementById('cache-refresh-btn');
    btn.disabled = false;
    btn.textContent = '🔄 Update Data';
  }

  async refresh() {
    this.startRefreshing();
    try {
      // 执行所有注册的刷新回调
      const promises = Object.values(this._refreshCallbacks).map(fn => fn());
      await Promise.all(promises);
    } catch (err) {
      console.error('[CacheUI] Refresh failed:', err);
    }
    this.finishRefreshing();
  }
}

// 全局单例
window.cacheUI = new CacheUI();
