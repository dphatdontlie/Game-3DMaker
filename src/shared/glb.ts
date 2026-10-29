import { MAX_GLB_JSON_BYTES } from './limits';

export function checkGLBHeader(buffer: ArrayBuffer, totalBytes: number) {
  const v = new DataView(buffer);
  if (
    buffer.byteLength < 20 ||
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== totalBytes
  )
    throw new Error('File không phải GLB 2.0 hợp lệ.');
  const length = v.getUint32(12, true);
  if (v.getUint32(16, true) !== 0x4e4f534a || length > MAX_GLB_JSON_BYTES || length > buffer.byteLength - 20)
    throw new Error('GLB thiếu phần mô tả hoặc phần mô tả vượt 16 MB.');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  for (const item of [...(json.buffers ?? []), ...(json.images ?? [])])
    if (item.uri && !/^data:/.test(item.uri))
      throw new Error('GLB cần đóng gói ảnh và dữ liệu bên trong file, không dùng đường dẫn ngoài.');
  if (
    (json.extensionsRequired ?? []).some((s: string) =>
      ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'].includes(s),
    )
  )
    throw new Error('GLB này dùng nén chưa hỗ trợ. Hãy xuất GLB không nén Draco/Meshopt/KTX2.');
}
export function checkGLB(buffer: ArrayBuffer) {
  checkGLBHeader(buffer, buffer.byteLength);
}
export async function checkGLBFile(file: File) {
  const header = await file.slice(0, 20).arrayBuffer();
  if (header.byteLength < 20) throw new Error('File không phải GLB 2.0 hợp lệ.');
  const length = new DataView(header).getUint32(12, true);
  if (length > MAX_GLB_JSON_BYTES) throw new Error('Phần mô tả GLB vượt 16 MB.');
  checkGLBHeader(await file.slice(0, 20 + length).arrayBuffer(), file.size);
}
