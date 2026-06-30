const res = await fetch('https://webapi.sporttery.cn/gateway/uniform/football/getMatchCalculatorV1.qry?channel=c', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Referer': 'https://www.sporttery.cn/jc/jsq/zqspf/',
    'Accept': 'application/json',
  },
});
const raw = await res.json();
const keys = Object.keys(raw);
console.log('top keys:', keys.join(', '));
console.log('success type:', typeof raw.success, 'value:', raw.success);
console.log('Has errorCode?', 'errorCode' in raw, '->', raw.errorCode);
console.log('Has errorMessage?', 'errorMessage' in raw, '->', raw.errorMessage);
console.log('Has value?', 'value' in raw);
if (raw.value) {
  const vk = Object.keys(raw.value);
  console.log('value keys:', vk.join(', '));
  console.log('Has matchInfoList?', 'matchInfoList' in raw.value);
}
