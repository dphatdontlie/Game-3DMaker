# Kế hoạch và phạm vi Game-3DMaker

App localhost độc lập, lấy thao tác đặt khối của Minecraft và lắp ghép của LEGO làm quy trình sử dụng. Giao diện nền sáng do người dùng chọn, điều khiển bằng chuột/bàn phím, không cần Blender để bố trí bản đồ hoặc sửa các phần hình học đã tách sẵn.

## Các luồng phải dùng được

1. Tạo/mở bản đồ, xây trên lưới hoặc đặt tự do, sửa bằng tay nắm và nhập số, rồi lưu/mở lại.
2. Dựng công trình từ các bộ phận, chọn nhiều, nhân bản thành hàng, gom nhóm và lưu mẫu tái sử dụng.
3. Nhập GLB tự chứa tài nguyên, xem/đặt mô hình, tách phần hình học có sẵn, đổi màu/vị trí/kích thước từng phần.
4. Đặt điểm bắt đầu, đi bộ/chạy/nhảy trong cảnh, kiểm tra va chạm, trở về xưởng và sửa tiếp.
5. Xuất gói dự án, nhập lại đầy đủ tài nguyên; xuất GLB và PNG.
6. Tự lưu, ghi nguyên tử, giữ phiên bản trước, khôi phục bản dự phòng, xử lý file lỗi và xung đột nhiều cửa sổ.
7. Khởi chạy nhanh trên Windows, cập nhật mã an toàn, không đưa bản đồ cá nhân lên GitHub.

## Thứ tự thực hiện

Nền dự án và lưu trữ → vùng nhìn 3D/camera → xây và biến đổi → undo/redo → thư viện và vật liệu → lưu/mở/xung đột → nhập/tách GLB → đi thử và va chạm → xuất/khôi phục → kiểm tra thực tế và tài liệu.

## Các tiện ích ưu tiên

- Bản mờ vị trí đặt, xem trước cả nét xây khi kéo, một lần undo cho cả nét xây.
- Bám lưới, cố định độ cao, lấy mẫu vật thể, xoay trước khi đặt.
- Tìm trong thư viện/danh sách, khóa và ẩn, chọn vùng, nhìn gần hoặc toàn cảnh.
- Nhân bản theo khoảng cách, gom nhóm, mẫu gồm nhiều bộ phận và tài nguyên.
- Bảng màu cùng dự án, nhớ camera/lưới/chất lượng trong trình duyệt.
- Hiện hộp va chạm, trở về điểm bắt đầu, kéo để nhìn khi trình duyệt không giữ chuột.
- Thông báo lưu/lỗi rõ ràng, xuất khẩn cấp khi lưu thất bại, không ghi đè âm thầm bản mới hơn.

## Ngoài phạm vi

Không xây game sinh tồn, multiplayer, thế giới vô hạn, mô phỏng nước, AI sinh mô hình, tự phân chia mô hình liền khối hay công cụ điêu khắc/mesh chuyên sâu. Các khác biệt cụ thể so với kế hoạch ý tưởng và giới hạn kỹ thuật nằm trong README.

## Điều kiện bàn giao

Test và build qua; app khởi chạy; luồng đã thay đổi được bấm thử trong trình duyệt; giao diện được quan sát; lỗi runtime được xử lý; ghi bằng chứng kiểm tra trong VERIFICATION. Chỉ đánh dấu luồng đã kiểm chứng bằng test hoặc thao tác thực tế.
