# Kiểm tra bản bàn giao

Cập nhật texture và GLB lớn ngày 29/10/2026: xem [TEXTURE_UPLOAD_VERIFICATION.md](TEXTURE_UPLOAD_VERIFICATION.md). Các giới hạn trong báo cáo dưới đây là của bản đầu ngày 28/10.

Ngày kiểm tra: 28/10/2026, múi giờ Asia/Bangkok. Môi trường: Windows, Node.js 24.17.0, trình duyệt tích hợp của Codex, WebGL thực tế. App được chạy cả bằng lệnh phát triển và từ bản build với `npm start` tại http://localhost:4317.

## Tự động

- `npm test`: 12 bài kiểm tra qua.
- `npm run typecheck`: qua; build cũng bao gồm bước này.
- `npm run build`: qua.
- `npm audit --omit=dev --audit-level=high`: không phát hiện lỗ hổng ở các gói runtime tại thời điểm kiểm tra.
- Ghi/đọc nguyên tử, tranh chấp revision, giữ tối đa 5 bản dự phòng, chuyển vào thùng lưu và chặn nguồn truy cập ngoài localhost được kiểm tra bằng test.
- Có test riêng cho dữ liệu bộ phận GLB và bảng màu sau khi lưu/mở lại; bảo toàn hộp bao khi tách mô hình có cha xoay và tỷ lệ không đồng đều.
- Có test nội suy nét xây để không bỏ ô khi rê chuột nhanh.

## Đã thao tác trong trình duyệt

| Thao tác                                      | Kết quả quan sát                                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Tạo bản đồ trống, đặt tên, mở cảnh mẫu        | Tạo/mở được; cảnh mẫu có 24 vật thể và hiển thị thực tế                                                  |
| Tạo bản sao trong danh sách dự án             | Xuất hiện bản sao riêng, giữ đủ 24 vật thể                                                               |
| Cất bản sao kiểm thử vào thùng lưu            | Hộp xác nhận mở; xác nhận xong bản sao rời danh sách                                                     |
| Chọn khối, bấm đặt lên nền                    | Số vật thể tăng, xuất hiện khối và viền chọn                                                             |
| Nhập chiều rộng rồi nhân bản                  | Giá trị và hình học cập nhật; bản sao có vị trí mới                                                      |
| Kéo xây ở góc nhìn từ trên                    | Tạo hàng 16 khối liền nhau khi kéo nhanh                                                                 |
| Kéo xóa hàng vừa xây                          | Xóa đủ 16 khối; một lần undo phục hồi cả hàng                                                            |
| Undo thêm một lần                             | Bỏ nguyên nét xây, trở về số vật thể trước đó                                                            |
| Shift kéo chọn vùng                           | Chọn đúng 6 vật thể GLB trong vùng quan sát                                                              |
| Kéo tay nắm trục Y của một phần GLB           | Tọa độ Y thay từ 0 sang 1; chỉ phần đang chọn thay đổi                                                   |
| Đổi vật liệu sang Gỗ, lưu màu                 | Vật liệu đổi và bảng màu được thêm vào dự án                                                             |
| Khóa, mở khóa, ẩn, hiện qua danh sách         | Trạng thái nút và khả năng chọn thay đổi tương ứng                                                       |
| Bật hộp va chạm; đổi chất lượng Cao/Nhẹ máy   | Hộp va chạm hiện và tùy chọn chất lượng thay đổi                                                         |
| Nhập GLB hai phần qua file chooser            | Đọc được mô hình 24 tam giác; đặt vào cảnh và nhìn gần được                                              |
| Tách phần GLB                                 | Có hai vật thể độc lập, giữ vị trí tương đối                                                             |
| Lặp thành hàng, gom nhóm, lưu mẫu             | Tạo số bản sao đúng; mẫu xuất hiện trong thư viện và đặt lại được                                        |
| Xuất và nhập lại gói dự án                    | Giữ 6 vật thể, 1 tài nguyên, 1 mẫu; kiểm tra thêm API xác nhận đủ 6 đường dẫn bộ phận GLB sau khi mở lại |
| Nhập GLB lỗi                                  | Hiện thông báo file không hợp lệ, không thay cảnh                                                        |
| Nhập gói JSON lỗi                             | Từ chối dữ liệu; lỗi hiển thị ngay trong hộp thoại nhập                                                  |
| Lưu, tải lại trang và mở dự án                | Vật thể, tài nguyên và ảnh xem trước giữ lại trên máy                                                    |
| Đặt mẫu rồi lưu; mở bản dự phòng và khôi phục | Số vật thể trở về đúng bản trước; thông báo khôi phục thành công                                         |
| Đi thử bằng W                                 | Đi từ Z=10 qua cổng, tới gần tường tại Z≈-4,1                                                            |
| Giữ W thêm trước tường                        | Bị chặn, không xuyên tường                                                                               |
| Space khi đi thử                              | Tọa độ Y tăng khi nhảy                                                                                   |
| Về điểm bắt đầu                               | Trở lại X=0, Y=0, Z=10                                                                                   |
| Esc khi đi thử                                | Quay lại xưởng và camera chỉnh sửa                                                                       |
| Trình duyệt từ chối pointer lock              | Kéo để nhìn vẫn hoạt động, bàn phím vẫn di chuyển                                                        |
| Xuất GLB toàn cảnh                            | Tải được file GLB                                                                                        |
| Xuất GLB phần đang chọn có vật liệu Gạch      | Tải được GLB; đọc cấu trúc file xác nhận 1 mesh, 1 ảnh vật liệu nhúng trong buffer                       |
| Xuất PNG                                      | Tải được PNG thực tế, không có bảng công cụ/tay nắm; ảnh lưu trong screenshots/sample-map.png            |
| Bố cục rộng, 800 px và 390 px                 | Quan sát trực tiếp; 390 px có documentWidth=innerWidth=390, không tràn ngang                             |
| Mở bảng Thuộc tính ở 800 px                   | Bảng hiện và đóng lại bằng nút riêng                                                                     |

## Runtime và mạng

Ở phiên bản build cuối, console được kiểm tra sau khi mở cảnh và đi thử: không có lỗi hoặc cảnh báo được ghi nhận trong phiên đó. Một lần tải lại được theo dõi bằng công cụ mạng: 9 phản hồi, không có loadingFailed hoặc HTTP >= 400.

Trong quá trình phát triển đã sửa lỗi tải CSS, chỗ hở của nét xây nhanh, hành vi đi bộ khi không giữ được chuột, giữ dữ liệu phần GLB qua lưu trữ và tải ảnh PNG. Cảnh báo deprecated shadow map đã được xử lý bằng loại shadow map được hỗ trợ. Các cảnh báo annotation từ thư viện Zod trong log build không làm build thất bại.

## Phạm vi bằng chứng

Chưa đo hiệu năng ở 5.000 vật thể hoặc với mô hình 32 MB. Chưa kiểm chứng trên GPU/trình duyệt khác. Các giới hạn dữ liệu không phải chứng nhận tốc độ tối đa. Không kiểm thử toàn bộ tổ hợp thao tác, mô hình có bộ xương hay mọi phần mở rộng GLTF. Bản này dành cho desktop; chưa có điều khiển cảm ứng cho người đi bộ.

Các file bản đồ kiểm thử và dữ liệu cá nhân nằm trong `data/`, không đưa vào Git. Các file kiểm thử tạm và bản build cũng được bỏ qua. Ảnh trong tài liệu là cảnh mẫu tạo bởi app.
