package vn.q14.audiolab;

import android.service.notification.NotificationListenerService;

/**
 * Dịch vụ rỗng. Android chỉ cho phép đọc phiên phát nhạc/video của app khác (MediaSession) khi app
 * có "Quyền truy cập thông báo" gắn với một NotificationListenerService. Lớp này chỉ để nhận quyền đó:
 * EQo KHÔNG đọc nội dung thông báo nào, chỉ dùng quyền để lấy tên bài, nghệ sĩ và trạng thái phát.
 */
public class NowPlayingService extends NotificationListenerService {
}
