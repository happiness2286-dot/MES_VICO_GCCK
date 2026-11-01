const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

// 1. Clean SQLite database
const dbPath = path.resolve(__dirname, '..', 'data', 'gcck_mes.sqlite');
if (fs.existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath);
  db.exec('DELETE FROM production_logs;');
  db.exec('DELETE FROM qc_inspections;');
  db.exec('DELETE FROM delivery_logs;');
  db.exec('DELETE FROM tool_swaps;');
  db.exec('DELETE FROM sync_outbox;');
  db.exec('DELETE FROM handover_slips;');
  db.exec("UPDATE purchase_orders SET finished_qty = 0, status = 'PENDING';");
  db.exec("UPDATE machines SET status = 'IDLE', current_worker_name = NULL, current_po_id = NULL, current_nc_id = NULL, stop_reason = NULL;");
  const count = db.prepare('SELECT COUNT(*) as c FROM production_logs').get().c;
  console.log('SQLite cleaned successfully! Current production_logs count:', count);
} else {
  console.log('SQLite db file does not exist at:', dbPath);
}

// 2. Clean data/seed_gcck_1233.json
const seedPath = path.resolve(__dirname, '..', 'data', 'seed_gcck_1233.json');
if (fs.existsSync(seedPath)) {
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  seed.recentLogs = [];
  seed.todayAccumulated = {};
  seed.opDoneMap = {};
  if (seed.kpiSummary) {
    seed.kpiSummary.totalOk = 0;
    seed.kpiSummary.totalRework = 0;
    seed.kpiSummary.totalScrap = 0;
    seed.kpiSummary.totalStopMinutes = 0;
    seed.kpiSummary.runningMachines = 0;
    seed.kpiSummary.bottleneckMachines = 0;
    seed.kpiSummary.overdueOrders = 0;
  }
  if (Array.isArray(seed.ordersList)) {
    for (const po of seed.ordersList) {
      po.finishedQty = 0;
      po.remainQty = po.qtyPo || 0;
      po.status = 'Đang gia công';
    }
  }
  fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2), 'utf8');
  console.log('seed_gcck_1233.json cleaned successfully! recentLogs count: 0');
}
