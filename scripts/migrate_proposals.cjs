const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const dbPath = path.resolve(__dirname, '..', 'data', 'gcck_mes.sqlite');
const db = new DatabaseSync(dbPath);

console.log('[Migration] Creating weekly_proposals table...');

db.exec(`
CREATE TABLE IF NOT EXISTS weekly_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Vật tư / Dụng cụ',
  proposer TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Bình thường',
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weekly_proposals_week ON weekly_proposals(week_start);
`);

// Insert initial seed proposals if empty
const count = db.prepare('SELECT COUNT(*) as c FROM weekly_proposals').get().c;
if (count === 0) {
  const ins = db.prepare(`
    INSERT INTO weekly_proposals (week_start, category, proposer, content, priority, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  ins.run(
    '2026-10-15',
    'Vật tư & Dụng cụ cắt',
    'Quản đốc Hoàng Ngọc Hà',
    'Đề xuất cấp bổ sung 05 dao phay mặt hợp kim phi 63 và mảnh chíp Sandvik phục vụ phay chi tiết Sealing Strip của Thysen.',
    'Cao',
    'PENDING'
  );
  ins.run(
    '2026-10-15',
    'Bảo dưỡng thiết bị',
    'Trưởng ca Trần Văn Dũng',
    'Kiểm tra định kỳ và thay dầu làm mát cho máy tiện OKUMA T630 vào ca ngày Chủ nhật 18/10.',
    'Bình thường',
    'APPROVED'
  );
  ins.run(
    '2026-10-15',
    'Nhân sự & Bố trí ca',
    'Tổ trưởng Trần Văn Quỳnh',
    'Bố trí thợ Đặng Ngọc Long và Phùng Gia Phúc tăng ca 2h các ngày 19 và 20/10 để kịp bàn giao lô đập đá vôi cho Xi Măng Hạ Long.',
    'Bình thường',
    'APPROVED'
  );
  console.log('[Migration] Seeded 3 proposals for 2026-10-15.');
}

console.log('[Migration] Done.');

