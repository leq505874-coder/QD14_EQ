# EQo (Q14 Audio Lab)

Website EQ 10 băng (dark mode, tối ưu điện thoại) + app Android cầu nối để thử áp dụng EQ lên âm thanh hệ thống.

> **Trạng thái kiểm chứng:** website đã kiểm tra cú pháp JavaScript. App Android **chưa được build hay chạy trên OPPO A53** — mã được viết theo tài liệu Android API. Việc EQ có thật sự tác động lên TikTok/YouTube/Roblox hay không **phải do bạn nghe thử** (xem mục 6).

> **Từ v1.1:** mở app EQo là thấy ngay giao diện EQ (WebView tải bản web nhúng tại `127.0.0.1:8766`), dịch vụ tự bật và chạy nền khi thoát. Bản web trên GitHub Pages vẫn dùng được như phương án phụ.

> **Từ v1.2:** thêm 15 preset, trang **Cài đặt** (đổi màu giao diện, độ bo góc, Preamp, Bass Boost, Âm thanh vòm, Loudness, Auto EQ theo thiết bị, tự bật khi khởi động máy). App lưu trạng thái EQ nên vẫn áp dụng sau khi khởi động lại. Các hiệu ứng Bass Boost/Vòm/Loudness do Android xử lý và có thể bị máy từ chối; trang Cài đặt hiện trạng thái thật. Auto EQ chọn preset theo thiết bị phát (loa ngoài, tai nghe có dây, Bluetooth), chưa phân tích nội dung bài nhạc.

## 1. Kiến trúc

```
┌───────────────────────────┐   ws://127.0.0.1:8765    ┌────────────────────────────┐
│ Website (GitHub Pages)    │ ───────────────────────► │ App Android EQo (service)  │
│ HTML/CSS/JS, Web Audio    │  JSON: setEq / config    │ AudioEffect:               │
│ - 10 slider, đường cong   │ ◄─────────────────────── │  Equalizer / Dynamics-     │
│ - preset, lưu cấu hình    │  JSON: status            │  Processing                │
│ - nghe thử + spectrum     │                          │ + phục vụ bản web dự phòng │
└───────────────────────────┘                          │   http://127.0.0.1:8766    │
                                                       └────────────────────────────┘
```

| Việc | Website thuần | Cần app Android |
|---|---|---|
| Giao diện, preset, lưu cấu hình | ✅ | |
| EQ + spectrum cho file MP3/WAV phát **trong trang** | ✅ | |
| EQ cho âm thanh của TikTok/YouTube/Roblox/game | ❌ trình duyệt không truy cập được | ✅ (không chắc chắn, xem dưới) |

## 2. Giới hạn thực tế (Android 12 / ColorOS 12.1)

- **Không có API hợp lệ nào cho phép app bất kỳ chặn rồi sửa âm thanh của app khác** mà không root. Vì vậy app này dùng `AudioEffect`:
  1. **Toàn cục (audio session 0):** Android đã đánh dấu deprecated. Một số máy vẫn chấp nhận, nhiều máy từ chối hoặc bỏ qua. ColorOS còn có thể tự dùng hiệu ứng riêng (Dolby/âm thanh OPPO) chèn trước hoặc sau.
  2. **Theo phiên ứng dụng:** chỉ hoạt động với ứng dụng tự công bố session ID qua broadcast `OPEN_AUDIO_EFFECT_CONTROL_SESSION` (nhiều trình phát nhạc làm vậy; TikTok, Roblox, game thường **không**).
- Phương án `MediaProjection` (thu âm thanh nội bộ) **không dùng**: nhiều app chặn thu, âm gốc vẫn phát song song (bị vang/trễ), và độ trễ cao.
- **Root** (hoặc Shizuku + hiệu ứng hệ thống) sẽ đáng tin cậy hơn, nhưng bạn yêu cầu ưu tiên không root nên chưa triển khai.
- Máy có thể chỉ có Equalizer 5 băng. App nội suy 10 băng web xuống số băng phần cứng, nên đường cong thật sẽ thô hơn đường cong hiển thị.
- ColorOS rất hay đóng service nền: phải cấu hình pin/tự khởi chạy (mục 5).
- Chrome mới có thể hiện hộp thoại quyền "thiết bị trong mạng cục bộ" khi trang HTTPS kết nối `127.0.0.1`: chọn **Cho phép**. Nếu trình duyệt vẫn chặn, dùng bản nhúng `http://127.0.0.1:8766/`.

## 3. Cấu trúc thư mục

```
q14-audio-lab/
├─ web/                      # Website (deploy lên GitHub Pages)
│  ├─ index.html  style.css  app.js
├─ android/                  # App cầu nối (Java, Gradle)
│  ├─ settings.gradle  build.gradle  gradle.properties
│  └─ app/ build.gradle, AndroidManifest.xml
│     └─ java/vn/q14/audiolab/ EqEngine, WsServer, StaticServer, EqService, MainActivity
└─ .github/workflows/        # pages.yml (deploy web), android.yml (build APK)
```

## 4. Đưa lên GitHub & GitHub Pages

1. Tạo repo mới trên github.com (ví dụ `q14-audio-lab`, public).
2. Trong thư mục dự án:
   ```bash
   git init -b main
   git add .
   git commit -m "Q14 Audio Lab"
   git remote add origin https://github.com/<tên-bạn>/q14-audio-lab.git
   git push -u origin main
   ```
3. Repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Tab **Actions** → chạy "Deploy website to GitHub Pages" (tự chạy khi push). Xong sẽ có địa chỉ `https://<tên-bạn>.github.io/q14-audio-lab/`.

## 5. Build & cài app Android (không cần Android Studio)

1. Tab **Actions → Build Android APK → Run workflow** (hoặc push thay đổi trong `android/`/`web/`).
2. Khi xong, mở lần chạy đó → **Artifacts → q14-audio-lab-apk** → tải về, giải nén lấy `app-debug.apk`.
3. Chép vào OPPO A53, mở file, cho phép **cài đặt từ nguồn không rõ** nếu được hỏi.
4. Mở **EQo** → **Bật dịch vụ EQ**.
5. Cấu hình ColorOS để không bị tắt nền:
   - Cài đặt → Pin → Tối ưu hoá pin → EQo → **Không hạn chế**.
   - Cài đặt → Quản lý ứng dụng → EQo → Sử dụng pin → bật **Cho phép hoạt động nền** và **Tự khởi chạy**.
   - Trong màn hình đa nhiệm, kéo thẻ app xuống để **khoá** (biểu tượng khoá).
6. Mở website (GitHub Pages) bằng Chrome. Thanh trạng thái trên cùng phải chuyển sang "Đã gửi tới app". Nếu không, mở `http://127.0.0.1:8766/` (bản nhúng trong app).

## 6. Kiểm chứng trên máy thật (bắt buộc)

1. Phát video YouTube trong khi mở website ở tab/app khác.
2. Chọn preset **Bass Moderate**, rồi bật/tắt công tắc EQ vài lần. Nếu bass thay đổi rõ → hiệu ứng toàn cục hoạt động.
3. Nếu không nghe khác biệt: mở **Nâng cao** trên website, thử lần lượt *Bộ xử lý* = Equalizer / DynamicsProcessing và *Phạm vi* = Toàn cục / Theo phiên / Cả hai (tránh "Cả hai" nếu đã nghe thấy tác dụng, vì EQ có thể cộng dồn).
4. Mục Nâng cao hiển thị lý do lỗi của Android, danh sách phiên ứng dụng thấy được và các hiệu ứng có trên máy. Gửi nội dung này nếu cần tôi giúp phân tích tiếp.
5. Thử lần lượt TikTok, Roblox. Kết quả có thể khác nhau giữa các ứng dụng.

## 7. Giao thức (JSON qua WebSocket, phiên bản 1)

Web → app:
```json
{"type":"hello","client":"q14-web","protocol":1}
{"type":"config","mode":"global|sessions|both","engine":"auto|equalizer|dynamics","autostart":false}
{"type":"fx","bass":0,"virt":0,"loud":0}                          // bass/virt 0-100 %, loud 0-12 dB
{"type":"auto","enabled":true,"profiles":{"speaker":null,"wired":[10 số],"bluetooth":null}}
{"type":"setEq","enabled":true,"gains":[0,0,0,0,0,0,0,0,0,0]}   // 10 số dB, đã trừ headroom
{"type":"getStatus"}
```
App → web (trả lời mọi tin nhắn):
```json
{"type":"status","protocol":1,"mode":"global","enginePref":"auto","enabled":true,
 "global":{"state":"ok|error|off","kind":"Equalizer","bands":5,"rangeDb":"-15 đến 15 dB","message":""},
 "sessions":[{"id":123,"pkg":"com.example","ok":true,"kind":"DynamicsProcessing","message":""}],
 "device":{"model":"CPH2127","release":"12","sdk":31,"effects":["..."]}}
```
Bảo mật: server chỉ nghe trên `127.0.0.1` và chỉ nhận Origin `https://*.github.io` hoặc `http://127.0.0.1:8766`. Dùng domain riêng thì thêm vào `EXTRA_ORIGINS` trong `WsServer.java`.

## 8. Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| Web báo "Chưa kết nối app" | Bật dịch vụ trong app; cho phép quyền mạng cục bộ của Chrome; thử bản nhúng `http://127.0.0.1:8766/`; kiểm tra ColorOS không đóng app |
| Báo "Chưa áp dụng" + lý do lỗi | Máy từ chối hiệu ứng toàn cục: thử đổi bộ xử lý/phạm vi; nếu vẫn lỗi thì cần root hoặc cơ chế khác |
| Báo "đã khởi tạo" nhưng không nghe thay đổi | Android chấp nhận hiệu ứng nhưng bộ trộn âm bỏ qua nó — hạn chế của session 0 trên máy này |
| Action build lỗi | Mở log bước "Build debug APK" và gửi cho tôi |
