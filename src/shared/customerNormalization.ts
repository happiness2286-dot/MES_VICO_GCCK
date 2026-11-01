import { removeVietnameseTones } from './vnSearch';

export function normalizeVn(str: string | null | undefined): string {
  return (str || '').normalize('NFC').trim();
}

export interface CanonicalCustomerResult {
  customer: string;
  contractRef: string;
}

/**
 * Normalizes any messy customer string (e.g. "UCC-US287291", "Win-Win - PO475", "Thyssen- HĐ số 33725805/456")
 * into the canonical factory customer name and extracted contract/PO reference.
 */
export function canonicalizeCustomerName(rawCust: string): CanonicalCustomerResult {
  const clean = normalizeVn(rawCust);
  if (!clean) return { customer: 'Vico - Nội bộ / Khách lẻ', contractRef: '' };

  const ascii = removeVietnameseTones(clean).toLowerCase();

  const extractSuffix = (prefixRegex: RegExp, canonical: string) => {
    const rest = clean.replace(prefixRegex, '').trim();
    return { customer: canonical, contractRef: rest };
  };

  if (ascii === 'win win' || ascii.startsWith('win-win') || ascii.startsWith('win win')) {
    return extractSuffix(/^win[-\s]*win\s*[-\s]*/i, 'Win-Win');
  }
  if (ascii.startsWith('ucc')) {
    return extractSuffix(/^ucc\s*[-\s]*/i, 'UCC');
  }
  if (ascii.startsWith('tfg')) {
    return extractSuffix(/^tfg\s*[-\s]*/i, 'TFG');
  }
  if (ascii.startsWith('taniguchi')) {
    return extractSuffix(/^taniguchi\s*[-\s]*/i, 'Taniguchi');
  }
  if (ascii.startsWith('molycop')) {
    return extractSuffix(/^molycop(?:\s*\/\s*bi\s*nghiền)?\s*[-\s]*/i, 'Molycop / Bi nghiền');
  }
  if (ascii.startsWith('vautid')) {
    return extractSuffix(/^vautid\s*[-\s]*/i, 'Vautid');
  }
  if (ascii.startsWith('thyssen')) {
    return extractSuffix(/^thyssen(?:krupp)?\s*[-\s]*/i, 'Thyssenkrupp');
  }
  if (ascii.startsWith('hung hd') || ascii.includes('hoang thach')) {
    return { customer: 'Hùng HD - XM Hoàng Thạch', contractRef: '' };
  }
  if (ascii.startsWith('hai-') || ascii.startsWith('hai -') || ascii.includes('vinh quang ninh')) {
    return { customer: 'Hải-Vinh Quảng Ninh', contractRef: '' };
  }
  if (ascii.startsWith('boz industrial') || ascii.startsWith('boz')) {
    return { customer: 'BOZ Industrial', contractRef: '' };
  }
  if (ascii.startsWith('ha song hai') || ascii.includes('hong ha')) {
    return { customer: 'Hà Song Hải / Hồng Hà', contractRef: clean !== 'Hà Song Hải / Hồng Hà' ? clean : '' };
  }
  if (ascii.includes('vicem hai phong')) {
    return { customer: 'XM Vicem Hải Phòng', contractRef: '' };
  }
  if (ascii.includes('dung quat') || ascii.includes('hoa phat dung quat')) {
    return { customer: 'Thép HP Dung Quất', contractRef: '' };
  }
  if (ascii.startsWith('dai phu')) {
    return { customer: 'Đại Phú', contractRef: '' };
  }
  if (ascii.startsWith('vico') || ascii.startsWith('noi bo') || ascii.includes('thu co tinh') || ascii.includes('qltb')) {
    return {
      customer: 'Vico - Nội bộ / Khách lẻ',
      contractRef: clean !== 'Vico - Nội bộ / Khách lẻ' ? clean : '',
    };
  }

  return { customer: clean, contractRef: '' };
}

