export const DEFAULT_DRIVE_FOLDER_URL =
  'https://drive.google.com/drive/folders/1JNC5odulouS-MMdHXkMoxyt2rLLXXiiS';

export interface DriveUrlParseResult {
  rawUrl: string;
  isDrive: boolean;
  isFolder: boolean;
  isFile: boolean;
  id: string | null;
  previewUrl: string;
  viewUrl: string;
}

/**
 * Parses any Google Drive URL (file, folder, view, preview, or raw link)
 * and formats it into an embeddable preview or direct view URL.
 */
export function parseGoogleDriveUrl(rawUrl?: string | null): DriveUrlParseResult {
  const url = (rawUrl || '').trim();
  if (!url) {
    return {
      rawUrl: DEFAULT_DRIVE_FOLDER_URL,
      isDrive: true,
      isFolder: true,
      isFile: false,
      id: '1JNC5odulouS-MMdHXkMoxyt2rLLXXiiS',
      previewUrl: DEFAULT_DRIVE_FOLDER_URL,
      viewUrl: DEFAULT_DRIVE_FOLDER_URL,
    };
  }

  // Check if it's a Google Drive link
  const isDrive = url.includes('drive.google.com') || url.includes('docs.google.com');

  if (!isDrive) {
    return {
      rawUrl: url,
      isDrive: false,
      isFolder: false,
      isFile: true,
      id: null,
      previewUrl: url,
      viewUrl: url,
    };
  }

  // Match folder URL: /folders/FOLDER_ID
  const folderMatch = /\/folders\/([a-zA-Z0-9_-]+)/.exec(url);
  if (folderMatch) {
    const id = folderMatch[1];
    return {
      rawUrl: url,
      isDrive: true,
      isFolder: true,
      isFile: false,
      id,
      previewUrl: `https://drive.google.com/drive/folders/${id}`,
      viewUrl: `https://drive.google.com/drive/folders/${id}`,
    };
  }

  // Match file URL: /file/d/FILE_ID or id=FILE_ID
  const fileMatch = /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(url) || /[?&]id=([a-zA-Z0-9_-]+)/.exec(url);
  if (fileMatch) {
    const id = fileMatch[1];
    return {
      rawUrl: url,
      isDrive: true,
      isFolder: false,
      isFile: true,
      id,
      // Google Drive file embed preview URL
      previewUrl: `https://drive.google.com/file/d/${id}/preview`,
      viewUrl: `https://drive.google.com/file/d/${id}/view?usp=sharing`,
    };
  }

  return {
    rawUrl: url,
    isDrive: true,
    isFolder: false,
    isFile: true,
    id: null,
    previewUrl: url,
    viewUrl: url,
  };
}

/**
 * Returns the effective drawing URL: if empty, defaults to the factory's shared Drive folder.
 */
export function getEffectiveDrawingUrl(specificUrl?: string | null): string {
  const clean = (specificUrl || '').trim();
  return clean || DEFAULT_DRIVE_FOLDER_URL;
}

/**
 * Converts a Google Drive file view URL (e.g. https://drive.google.com/file/d/<ID>/view?usp=drivesdk)
 * into a direct image stream URL that can be rendered directly inside an <img src="..." /> tag.
 */
export function toRenderableDriveImageUrl(rawUrl?: string | null): string {
  const clean = (rawUrl || '').trim();
  if (!clean) return '';
  if (clean.startsWith('data:image/')) return clean;
  const parsed = parseGoogleDriveUrl(clean);
  if (parsed.isDrive && parsed.isFile && parsed.id) {
    return `https://drive.google.com/thumbnail?id=${parsed.id}&sz=w1200`;
  }
  return clean;
}

/**
 * Returns the clickable Google Drive file view URL for opening in a new tab.
 */
export function toViewableDriveUrl(rawUrl?: string | null): string {
  const clean = (rawUrl || '').trim();
  if (!clean) return DEFAULT_DRIVE_FOLDER_URL;
  const parsed = parseGoogleDriveUrl(clean);
  if (parsed.isDrive && parsed.isFile && parsed.id) {
    return `https://drive.google.com/file/d/${parsed.id}/view?usp=sharing`;
  }
  return clean;
}
