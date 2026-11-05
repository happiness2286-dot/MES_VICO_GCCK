import { getVietnamDateString } from './payrollEngine';

/**
 * Trả về Ngày Sản Xuất (Production Work Date) theo logic ca làm việc công nghiệp:
 * - Ca 1 (Sáng 06h - 14h): ngày hiện tại
 * - Ca 2 (Chiều 14h - 22h): ngày hiện tại
 * - Ca 3 (Đêm 22h - 06h sáng hôm sau):
 *   + Nếu làm việc / ghi nhận lúc rạng sáng (00h00 - trước 07h00 sáng):
 *     Toàn bộ sản lượng quy về NGÀY HÔM TRƯỚC (ngày bắt đầu của Ca 3)!
 *     Ví dụ: Ca 3 đêm 04/11 làm sang sáng 05/11 (06h08 - 06h24) -> Ngày sản xuất = 04/11/2026.
 */
export function getShiftProductionWorkDate(
  now: Date = new Date(),
  shiftType?: string
): string {
  const vnHourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: 'numeric',
    hour12: false,
  }).format(now);
  const hour = Number(vnHourStr);

  const s = (shiftType || '').toLowerCase();
  const isCa3 =
    s.includes('ca 3') ||
    s.includes('ca3') ||
    s.includes('đêm') ||
    s.includes('dem') ||
    s.includes('22h-06h') ||
    s.includes('lights-out');

  // Nếu rạng sáng 00h00 đến trước 07h00:
  // - Nếu là Ca 3 HOẶC không truyền shiftType (mặc định giờ 00h-06h là Ca 3 của đêm hôm trước)
  if ((isCa3 || (!shiftType && hour < 7)) && hour < 7) {
    const prev = new Date(now);
    prev.setDate(prev.getDate() - 1);
    return getVietnamDateString(prev);
  }

  return getVietnamDateString(now);
}

/**
 * Chuẩn hóa Ngày Sản Xuất cho một bản ghi nhật ký (Production Log):
 * - Nếu bản ghi ghi nhận trong Ca 3 vào rạng sáng hôm sau (00h-07h sáng),
 *   ngày sản xuất thực tế luôn quy về NGÀY HÔM TRƯỚC.
 */
export function getLogEffectiveWorkDate(log: {
  workDate?: string;
  shift?: string;
  shiftType?: string;
  createdAt?: string;
  timeStr?: string;
}): string {
  const rawDate = (log.workDate || '').slice(0, 10);
  if (!rawDate) return '';

  const shiftStr = `${log.shift || ''} ${log.shiftType || ''}`.toLowerCase();
  const isCa3 =
    shiftStr.includes('ca 3') ||
    shiftStr.includes('ca3') ||
    shiftStr.includes('đêm') ||
    shiftStr.includes('dem') ||
    shiftStr.includes('22h-06h') ||
    shiftStr.includes('lights-out');

  let hour = -1;
  if (log.timeStr) {
    const m = /(\d{1,2})[:h](\d{2})/.exec(log.timeStr);
    if (m) hour = Number(m[1]);
  }
  if (hour < 0 && log.createdAt) {
    try {
      const dt = new Date(log.createdAt);
      if (!Number.isNaN(dt.getTime())) {
        const vnHourStr = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Ho_Chi_Minh',
          hour: 'numeric',
          hour12: false,
        }).format(dt);
        hour = Number(vnHourStr);
      }
    } catch {}
  }

  // Nếu thuộc Ca 3 và thời điểm phát sinh rơi vào rạng sáng trước 07h00:
  // Kiểm tra xem rawDate có đang bị lấy là ngày hôm sau hay không
  if (isCa3 && hour >= 0 && hour < 7) {
    // Nếu có createdAt mà ngày createdAt trùng với rawDate -> lùi về 1 ngày
    if (log.createdAt) {
      try {
        const dt = new Date(log.createdAt);
        const createdDate = dt.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
        if (createdDate === rawDate) {
          const prev = new Date(rawDate);
          prev.setDate(prev.getDate() - 1);
          return prev.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
        }
      } catch {}
    }
  }

  return rawDate;
}
