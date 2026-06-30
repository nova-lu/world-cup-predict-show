// 移动端菜单切换
function toggleMenu() {
  const links = document.querySelector('.nav-links');
  links.classList.toggle('open');
}

// 移动端下拉菜单切换（点击展开）
document.addEventListener('click', function(e) {
  var toggle = e.target.closest('.nav-dropdown-toggle');
  if (toggle && window.innerWidth <= 768) {
    e.preventDefault();
    var dd = toggle.closest('.nav-dropdown');
    if (dd) dd.classList.toggle('open');
  }
});

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
async function cachedFetch(url, options) {
  if (!options) options = {};
  var sep = url.includes('?') ? '&' : '?';
  var fu = options.force ? url + sep + 'force=1' : url;
  var r = await fetch(fu);
  var d = await r.json();
  if (window.cacheUI && d._cache) window.cacheUI.setStatus(d._cache);
  else if (window.cacheUI) window.cacheUI.setStatus(null);
  return d;
}
