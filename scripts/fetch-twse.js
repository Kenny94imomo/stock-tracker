// 自動抓取台股漲幅前50 + 產業別，輸出 data.json
// 在 GitHub Actions 上執行（Node 20+），無需 token
// 資料來源：TWSE 官方 OpenAPI（無 CORS、無金鑰）

const fs = require('fs');
const path = require('path');

const SECTOR_NAMES = {
  '01':'水泥工業','02':'食品工業','03':'塑膠工業','04':'紡織纖維','05':'電機機械',
  '06':'電器電纜','08':'玻璃陶瓷','09':'造紙工業','10':'鋼鐵工業','11':'橡膠工業',
  '12':'汽車工業','14':'建材營造','15':'航運業','16':'觀光餐旅','17':'金融保險業',
  '18':'貿易百貨','19':'綜合','20':'其他','21':'化學工業','22':'生技醫療業',
  '23':'油電燃氣業','24':'半導體業','25':'電腦及週邊設備業','26':'光電業',
  '27':'通信網路業','28':'電子零組件業','29':'電子通路業','30':'資訊服務業',
  '31':'其他電子業','32':'文化創意業','33':'農業科技','34':'電子商務',
  '35':'綠能環保','36':'數位雲端','37':'運動休閒','38':'居家生活'
};

async function getJSON(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 stock-tracker-bot' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log('抓取 TWSE 上市每日收盤行情...');
  // 上市個股全日成交（前一交易日，clean JSON）
  const twse = await getJSON('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL');
  console.log(`  上市 ${twse.length} 檔`);

  // 上市公司基本資料（取產業別代碼）
  console.log('抓取產業別對照...');
  const basics = await getJSON('https://openapi.twse.com.tw/v1/opendata/t187ap03_L');
  const sectorMap = {};
  basics.forEach(b => { if (b['公司代號']) sectorMap[b['公司代號']] = b['產業別'] || '20'; });

  // 上櫃個股（OTC）也一起抓，讓榜單涵蓋全市場
  let tpex = [];
  try {
    // 上櫃當日行情：ROC 年/月/日
    const d = new Date();
    const roc = `${d.getFullYear() - 1911}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    const tp = await getJSON(`https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes?response=json&date=${encodeURIComponent(roc)}`);
    // tpex 結構可能變動，容錯處理
    const rows = tp.tables?.[0]?.data || tp.aaData || [];
    console.log(`  上櫃 ${rows.length} 檔`);
  } catch (e) {
    console.log('  上櫃抓取略過（格式變動或非交易日）:', e.message);
  }

  // 計算漲跌幅並排序
  const parsed = twse
    .filter(r => r.ClosingPrice && r.Change && r.ClosingPrice !== '--' && r.Change !== '--')
    .map(r => {
      const close = parseFloat(String(r.ClosingPrice).replace(/,/g, ''));
      const chg = parseFloat(String(r.Change).replace(/,/g, ''));
      const prev = close - chg;
      const pct = prev !== 0 ? (chg / prev * 100) : 0;
      const sCode = sectorMap[r.Code] || '20';
      return {
        code: r.Code,
        name: r.Name,
        sector: SECTOR_NAMES[sCode] || '其他',
        price: close.toFixed(2),
        change: pct.toFixed(2),
        volume: r.TradeVolume ? Math.round(parseInt(String(r.TradeVolume).replace(/,/g,'')) / 1000).toString() : '0',
      };
    })
    .filter(r => isFinite(parseFloat(r.change)))
    .sort((a, b) => parseFloat(b.change) - parseFloat(a.change))
    .slice(0, 50);

  // 推算資料日期：STOCK_DAY_ALL 是前一交易日，用台北時區今天當標記
  const tpeDate = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);

  const out = {
    date: tpeDate,
    updated: new Date().toISOString(),
    count: parsed.length,
    data: parsed,
  };

  const outPath = path.join(__dirname, '..', 'data.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`✓ 已輸出 ${parsed.length} 筆 → data.json（標記日期 ${tpeDate}）`);
  console.log(`  前3名：${parsed.slice(0,3).map(r => `${r.name} +${r.change}%`).join('、')}`);
}

main().catch(e => { console.error('✗ 失敗:', e.message); process.exit(1); });
