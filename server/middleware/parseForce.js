// 解析 force=1 参数中间件
export function parseForceParam(req, res, next) {
  req.forceRefresh = req.query.force === '1' || req.query.force === 'true';
  next();
}
