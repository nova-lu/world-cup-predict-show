// 移动端菜单切换
function toggleMenu() {
  const links = document.querySelector('.nav-links');
  links.classList.toggle('open');
}

// 关闭菜单点击外部
document.addEventListener('click', function(e) {
  const links = document.querySelector('.nav-links');
  const btn = document.querySelector('.mobile-menu-btn');
  if (links && btn && !links.contains(e.target) && !btn.contains(e.target)) {
    links.classList.remove('open');
  }
});

// Phase 8.5: SVG 旗帜渲染 — 全局共享函数
window.flagHtml = function(info, size) {
  size = size || 'sm';
  if (!info) return '<span class="team-flag flag-' + size + '"><span class="flag-fallback">⚽</span></span>';
  var svgPath = info.flagPath || '';
  var emoji = info.flag || '⚽';
  if (svgPath) {
    return '<span class="team-flag flag-' + size + '"><img src="' + svgPath + '" alt="' + (info.name || '') + '" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\'"><span class="flag-fallback" style="display:none">' + emoji + '</span></span>';
  }
  return '<span class="team-flag flag-' + size + '"><span class="flag-fallback">' + emoji + '</span></span>';
};

// ===== 缓存感知的数据请求工具函数 =====

/**
 * 缓存感知的 fetch
 * @param {string} url - API URL
 * @param {object} options
 * @param {boolean} [options.force=false] - 是否强制刷新
 * @returns {Promise<object>} 解析后的 JSON 数据
 */
async function cachedFetch(url, options = {}) {
  const separator = url.includes('?') ? '&' : '?';
  const forceUrl = options.force ? url + separator + 'force=1' : url;
  const resp = await fetch(forceUrl);
  const data = await resp.json();
  if (window.cacheUI && data._cache) {
    window.cacheUI.setStatus(data._cache);
  } else if (window.cacheUI) {
    window.cacheUI.setStatus(null);
  }
  return data;
}
