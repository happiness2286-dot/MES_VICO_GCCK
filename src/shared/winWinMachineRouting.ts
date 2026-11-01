/**
 * Win-Win Product -> Preferred Machine(s) Mapping Table
 * Theo quy định phân xưởng cơ khí chính xác VICO Thắng Lợi
 */

export interface WinWinRoutingRule {
  names: string[];
  machines: string[];
}

export const WIN_WIN_ROUTING_RULES: WinWinRoutingRule[] = [
  // Nhóm 1: ALKTOP cỡ nhỏ/vừa -> Máy tiện OKUMA, Máy tiện T630
  {
    names: [
      'ALKTOP 1130H',
      'ALKTOP 1130 H',
      'ALKTOP 1135M',
      'ALKTOP 1135 M',
      'ALKTOP 1335M',
      'ALKTOP 1335 M',
      'ALKTOP 1342M',
      'ALKTOP 1342 M',
      'ALKTOP 1342H',
      'ALKTOP 1342 H',
      'ALKTOP 1031M',
      'ALKTOP 1031 M',
      'ALKTOP 1640M',
      'ALKTOP 1640 M',
      'ALKTOP 1645H',
      'ALKTOP 1645 H',
      'ALKTOP 1950H',
      'ALKTOP 1950 H',
    ],
    machines: ['Máy tiện OKUMA', 'Máy tiện T630'],
  },

  // Nhóm 2: ALKTOP 2155H -> Máy tiện T630
  {
    names: ['ALKTOP 2155H', 'ALKTOP 2155 H'],
    machines: ['Máy tiện T630'],
  },

  // Nhóm 3: ALKTOP cỡ lớn -> Máy tiện FUJI
  {
    names: [
      'ALKTOP 2165H',
      'ALKTOP 2165 H',
      'ALKTOP 2660H',
      'ALKTOP 2660 H',
      'ALKTOP 2665H',
      'ALKTOP 2665 H',
      'ALKTOP 2670H',
      'ALKTOP 2670 H',
      'ALKTOP 2681H',
      'ALKTOP 2681 H',
      'ALKTOP 3585H',
      'ALKTOP 3585 H',
      'ALKTOP 3595H',
      'ALKTOP 3595 H',
      'ALKTOP 35107H',
      'ALKTOP 35107 H',
    ],
    machines: ['Máy tiện FUJI'],
  },

  // Nhóm 4: ISHIZUE cỡ nhỏ -> Máy tiện OKUMA, Máy tiện T630
  {
    names: [
      'ISHIZUE 101Dw250',
      'ISHIZUE 101 DW 250',
      'ISHIZUE 114Dw300',
      'ISHIZUE 114 DW 300',
      'ISHIZUE 139Dw350',
      'ISHIZUE 139 DW 350',
      'ISHIZUE 165Dw500',
      'ISHIZUE 165 DW 500',
      'ISHIZUE 190Dw550',
      'ISHIZUE 190 DW 550',
    ],
    machines: ['Máy tiện OKUMA', 'Máy tiện T630'],
  },

  // Nhóm 5: ISHIZUE 216Dw650 -> Máy tiện FUJI
  {
    names: ['ISHIZUE 216Dw650', 'ISHIZUE 216 DW 650', 'ISHIZUE 216Dw 650'],
    machines: ['Máy tiện FUJI'],
  },

  // Nhóm 6: ISHIZUE 216Dw550 -> Máy tiện T630
  {
    names: ['ISHIZUE 216Dw550', 'ISHIZUE 216 DW 550', 'ISHIZUE 216Dw 550'],
    machines: ['Máy tiện T630'],
  },

  // Nhóm 7: ISHIZUE cỡ trung -> Máy tiện FUJI
  {
    names: [
      'ISHIZUE 267Dw700',
      'ISHIZUE 267 DW 700',
      'ISHIZUE 267Dw800',
      'ISHIZUE 267 DW 800',
      'ISHIZUE 318Dw800',
      'ISHIZUE 318 DW 800',
      'ISHIZUE 318Dw650',
      'ISHIZUE 318 DW 650',
      'ISHIZUE 355Dw750',
      'ISHIZUE 355 DW 750',
      'ISHIZUE 355Dw900',
      'ISHIZUE 355 DW 900',
      'ISHIZUE 406Dw850',
      'ISHIZUE 406 DW 850',
      'ISHIZUE 406Dw1000',
      'ISHIZUE 406 DW 1000',
      'ISHIZUE 457Dw950',
      'ISHIZUE 457 DW 950',
    ],
    machines: ['Máy tiện FUJI'],
  },

  // Nhóm 8: ISHIZUE 457Dw1150 -> Máy tiện đứng T1516
  {
    names: ['ISHIZUE 457Dw1150', 'ISHIZUE 457 DW 1150', 'ISHIZUE 457Dw 1150'],
    machines: ['Máy tiện đứng T1516'],
  },

  // Nhóm 9: ISHIZUE OMEGA nhỏ -> Máy tiện OKUMA, Máy tiện T630
  {
    names: [
      'ISHIZUE OMEGA114.3-310',
      'ISHIZUE OMEGA 114.3-310',
      'ISHIZUE OMEGA 114.3 - 310',
      'ISHIZUE OMEGA139.8-450',
      'ISHIZUE OMEGA 139.8-450',
      'ISHIZUE OMEGA 139.8 - 450',
      'ISHIZUE OMEGA165.2-500',
      'ISHIZUE OMEGA 165.2-500',
      'ISHIZUE OMEGA 165.2 - 500',
    ],
    machines: ['Máy tiện OKUMA', 'Máy tiện T630'],
  },

  // Nhóm 10: ISHIZUE OMEGA 190.7 -> Máy tiện T630
  {
    names: [
      'ISHIZUE OMEGA190.7-550',
      'ISHIZUE OMEGA 190.7-550',
      'ISHIZUE OMEGA 190.7 - 550',
      'ISHIZUE OMEGA190.7-650',
      'ISHIZUE OMEGA 190.7-650',
      'ISHIZUE OMEGA 190.7 - 650',
    ],
    machines: ['Máy tiện T630'],
  },

  // Nhóm 11: ISHIZUE OMEGA trung -> Máy tiện FUJI
  {
    names: [
      'ISHIZUE OMEGA216.3-740',
      'ISHIZUE OMEGA 216.3-740',
      'ISHIZUE OMEGA 216.3 - 740',
      'ISHIZUE OMEGA267.4-700',
      'ISHIZUE OMEGA 267.4-700',
      'ISHIZUE OMEGA 267.4 - 700',
      'ISHIZUE OMEGA267.4-950',
      'ISHIZUE OMEGA 267.4-950',
      'ISHIZUE OMEGA 267.4 - 950',
      'ISHIZUE OMEGA318.5-1010',
      'ISHIZUE OMEGA 318.5-1010',
      'ISHIZUE OMEGA 318.5 - 1010',
      'ISHIZUE OMEGA355.6-1060',
      'ISHIZUE OMEGA 355.6-1060',
      'ISHIZUE OMEGA 355.6 - 1060',
      'ISHIZUE OMEGA406.4-1130',
      'ISHIZUE OMEGA 406.4-1130',
      'ISHIZUE OMEGA 406.4 - 1130',
    ],
    machines: ['Máy tiện FUJI'],
  },

  // Nhóm 12: ISHIZUE OMEGA457.2-1150 -> Máy tiện đứng T1516
  {
    names: [
      'ISHIZUE OMEGA457.2-1150',
      'ISHIZUE OMEGA 457.2-1150',
      'ISHIZUE OMEGA 457.2 - 1150',
    ],
    machines: ['Máy tiện đứng T1516'],
  },

  // Nhóm 13: ISHIZUE OMEGA miệng phẳng -> Máy tiện FUJI
  {
    names: [
      'ISHIZUE OMEGA267.4-950 miệng phẳng',
      'ISHIZUE OMEGA 267.4-950 miệng phẳng',
      'ISHIZUE OMEGA 267.4 - 950 miệng phẳng',
      'ISHIZUE OMEGA355.6-1060 miệng phẳng',
      'ISHIZUE OMEGA 355.6-1060 miệng phẳng',
      'ISHIZUE OMEGA 355.6 - 1060 miệng phẳng',
    ],
    machines: ['Máy tiện FUJI'],
  },
];

function compactText(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[._\-]/g, '');
}

/**
 * Tra cứu máy gia công ưu tiên cho sản phẩm Win-Win
 * Trả về mảng tên máy (ví dụ: ['Máy tiện OKUMA', 'Máy tiện T630'] hoặc ['Máy tiện FUJI'])
 * Trả về [] nếu không tìm thấy quy tắc ưu tiên
 */
export function getWinWinPreferredMachines(productName: string | undefined | null): string[] {
  if (!productName) return [];
  const clean = compactText(productName);
  if (!clean) return [];

  for (const rule of WIN_WIN_ROUTING_RULES) {
    for (const name of rule.names) {
      if (compactText(name) === clean) {
        return rule.machines;
      }
    }
  }

  // Fallback heuristic for partial match
  for (const rule of WIN_WIN_ROUTING_RULES) {
    for (const name of rule.names) {
      const cName = compactText(name);
      if (clean.includes(cName) || cName.includes(clean)) {
        return rule.machines;
      }
    }
  }

  return [];
}
