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
