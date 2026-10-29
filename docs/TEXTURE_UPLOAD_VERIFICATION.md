# Texture và file GLB lớn

Kiểm tra ngày 29/10/2026 trên Windows, Node.js 24, trình duyệt tích hợp của Codex. Dự án độc lập Game-3DMaker, không chỉnh mã HueViVu.

## Thay đổi

- Gán PNG/JPEG/WebP cho vật thể hoặc bộ phận GLB qua file chooser, nút dán clipboard và Ctrl+V. Có ảnh xem trước, dùng lại ảnh đã nhập, lặp ngang/dọc, xoay và gỡ ảnh.
- Texture lưu cùng dữ liệu vật thể nên nhân bản, lưu mẫu và undo/redo giữ ảnh.
- GLB nhỏ hơn 1.000.000.000 byte. Upload ghi theo luồng xuống đĩa, có tiến độ, hủy trong lúc truyền; không nhúng base64 file mới vào JSON bản đồ.
- Asset file lưu riêng trong data/assets, kiểm tra kích thước và header. GLB nhúng kiểu cũ vẫn mở được.
- Xuất/nhập ZIP có cả file GLB và ảnh, ghi/đọc theo luồng. JSON mô tả riêng phục vụ dự phòng trên cùng máy, không thay cho ZIP khi chuyển máy.
- Dọn bộ nhớ thuộc instance khi thay texture; cache mô hình không còn thuộc dự án được giải phóng. Có báo đang nạp mô hình khi mở file lớn.

## Đã thử trong trình duyệt

| Luồng                            | Kết quả                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| Chọn tường, chọn ảnh gạch từ máy | Ảnh hiện trên tường và trong phần xem trước                                |
| Nút dán clipboard                | Áp dụng được ảnh PNG từ clipboard                                          |
| Ctrl+V khi chọn vật thể          | Áp dụng được ảnh; không chặn nhập văn bản trong ô tên/số                   |
| Đổi lặp ngang/dọc và xoay ảnh    | Giá trị 2 × 2, 90 độ giữ sau khi lưu/mở lại                                |
| Gỡ texture rồi undo              | Ảnh được gỡ, sau undo trở lại đầy đủ                                       |
| Nhân bản và lưu/đặt lại mẫu      | Bộ phận mới giữ ảnh và thiết lập lặp/xoay                                  |
| Nhập GLB khoảng 40 MB            | Upload, parse và đặt vào cảnh thành công, vượt mức 32 MB cũ                |
| Dùng lại ảnh cho GLB thiếu UV    | Hiển thị ảnh bằng phép chiếu phẳng tự tạo                                  |
| Mở lại bản đồ                    | Tường, GLB và texture giữ nguyên                                           |
| Xuất ZIP rồi nhập lại            | Giữ đủ 2 vật thể và file tài nguyên; đọc API xác nhận cả 2 có texture      |
| Độ lớn file mô tả sau round-trip | Khoảng 85 KB, GLB riêng 41.944.412 byte                                    |
| Xuất phần chọn thành GLB         | File có 1 ảnh nhúng; KHR_texture_transform giữ scale [2,2] và rotation π/2 |
| Xuất PNG                         | Tải được ảnh thực tế tại screenshots/texture-wall.png                      |
| Runtime                          | Không ghi nhận lỗi console ở các luồng kiểm tra trên                       |

## Kiểm tra tự động

16 test qua, typecheck và build qua. Test mới gồm upload GLB trên 32 MB, chặn mức 1 GB, ảnh hợp lệ/lỗi, Range download, ZIP round-trip, dữ liệu bị thiếu, mục ZIP trùng tên, đường dẫn lạ và JSON hỏng. Kiểm tra gói runtime không phát hiện lỗ hổng tại thời điểm thực hiện.

File 36–40 MB dùng trong kiểm tra có hình học đơn giản và phần dữ liệu đệm để kiểm chứng đường truyền/lưu trữ. Đây không phải benchmark mô hình 40 MB nhiều tam giác. Chưa thử dựng mô hình gần 1 GB; giới hạn nhận file không đảm bảo đủ RAM/GPU cho mọi nội dung. GLB cần UV thích hợp để ảnh không méo trên các mặt phức tạp; phép chiếu tự tạo chỉ là dự phòng.

Thay đổi đang có của người dùng ở cảnh cũ đã được lưu trước khi tải lại giao diện. Các thao tác kiểm thử thực hiện trên dự án riêng; file dữ liệu và tài nguyên không được đưa lên GitHub.
