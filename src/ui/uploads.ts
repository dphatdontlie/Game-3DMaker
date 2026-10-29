import type { Asset } from '../shared/schema';
export function uploadRequest<T>(
  file: Blob,
  url: string,
  progress: (percent: number) => void,
  onRequest: (xhr: XMLHttpRequest) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    onRequest(xhr);
    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) progress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error('Không tải được file. Kiểm tra máy chủ local và dung lượng đĩa.'));
    xhr.onabort = () => reject(new Error('Đã hủy tải file.'));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error ?? 'Tải file thất bại.'));
      } catch {
        reject(new Error('Máy chủ trả về dữ liệu không hợp lệ.'));
      }
    };
    xhr.send(file);
  });
}
export function uploadFile(
  file: Blob,
  name: string,
  type: 'glb' | 'texture',
  progress: (percent: number) => void,
  onRequest: (xhr: XMLHttpRequest) => void,
) {
  return uploadRequest<Asset>(
    file,
    `/api/assets?type=${type}&name=${encodeURIComponent(name)}`,
    progress,
    onRequest,
  );
}
