package vn.q14.audiolab;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Đọc thông tin "đang phát" (tên bài, nghệ sĩ, app, trạng thái) từ các phiên media của app khác và cho
 * phép điều khiển phát/tạm dừng/chuyển bài. Đây là đọc dữ liệu do app phát tự công bố, KHÔNG phải nghe
 * âm thanh để dò bài. App nào không công bố MediaSession (một số game, video ngắn) sẽ không hiện.
 * Cần người dùng cấp "Quyền truy cập thông báo" cho EQo.
 */
public final class NowPlayingMonitor {
    private static final String TAG = "Q14Now";

    public interface Listener {
        void onNowPlaying();
    }

    private final Context ctx;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ComponentName listenerCn;
    private MediaSessionManager msm;
    private boolean registered = false;
    private final List<MediaController> watching = new ArrayList<>();
    private volatile MediaController current;
    private volatile Listener listener;
    private String lastJson = "";

    private final MediaSessionManager.OnActiveSessionsChangedListener sessionsListener =
            new MediaSessionManager.OnActiveSessionsChangedListener() {
                @Override
                public void onActiveSessionsChanged(List<MediaController> controllers) {
                    attach(controllers);
                }
            };

    private final MediaController.Callback callback = new MediaController.Callback() {
        @Override
        public void onMetadataChanged(MediaMetadata metadata) {
            schedulePublish();
        }

        @Override
        public void onPlaybackStateChanged(PlaybackState state) {
            choose();
            schedulePublish();
        }
    };

    private final Runnable publishTask = new Runnable() {
        @Override
        public void run() {
            publishIfChanged();
        }
    };

    private final Runnable pollTask = new Runnable() {
        @Override
        public void run() {
            tick();
            main.postDelayed(this, 4000);
        }
    };

    public NowPlayingMonitor(Context context) {
        ctx = context.getApplicationContext();
        listenerCn = new ComponentName(ctx, NowPlayingService.class);
    }

    public void setListener(Listener l) {
        listener = l;
    }

    public void start() {
        main.post(pollTask);
    }

    public void stop() {
        main.removeCallbacks(pollTask);
        main.removeCallbacks(publishTask);
        main.post(new Runnable() {
            @Override
            public void run() {
                unregisterAll();
            }
        });
    }

    /* ---------------- quyền & đăng ký ---------------- */

    public boolean isGranted() {
        String flat = Settings.Secure.getString(ctx.getContentResolver(), "enabled_notification_listeners");
        return flat != null && flat.contains(ctx.getPackageName());
    }

    private void tick() {
        boolean granted = isGranted();
        if (granted && !registered) {
            tryRegister();
        } else if (!granted && registered) {
            unregisterAll();
        }
        publishIfChanged();
    }

    private void tryRegister() {
        try {
            msm = (MediaSessionManager) ctx.getSystemService(Context.MEDIA_SESSION_SERVICE);
            msm.addOnActiveSessionsChangedListener(sessionsListener, listenerCn, main);
            registered = true;
            attach(msm.getActiveSessions(listenerCn));
        } catch (SecurityException e) {
            registered = false;
            Log.w(TAG, "Chưa có quyền đọc phiên media", e);
        } catch (Exception e) {
            registered = false;
            Log.w(TAG, "Không đăng ký được MediaSessionManager", e);
        }
    }

    private void unregisterAll() {
        try {
            if (msm != null) msm.removeOnActiveSessionsChangedListener(sessionsListener);
        } catch (Exception ignored) {
        }
        for (MediaController c : watching) {
            try {
                c.unregisterCallback(callback);
            } catch (Exception ignored) {
            }
        }
        watching.clear();
        current = null;
        registered = false;
    }

    private void attach(List<MediaController> controllers) {
        for (MediaController c : watching) {
            try {
                c.unregisterCallback(callback);
            } catch (Exception ignored) {
            }
        }
        watching.clear();
        if (controllers != null) {
            for (MediaController c : controllers) {
                try {
                    c.registerCallback(callback, main);
                    watching.add(c);
                } catch (Exception e) {
                    Log.w(TAG, "registerCallback lỗi", e);
                }
            }
        }
        choose();
        schedulePublish();
    }

    /** Ưu tiên phiên đang phát; không có thì giữ bài gần nhất (đang tạm dừng). */
    private void choose() {
        MediaController pick = null;
        for (MediaController c : watching) {
            PlaybackState ps = c.getPlaybackState();
            if (ps != null && ps.getState() == PlaybackState.STATE_PLAYING) {
                pick = c;
                break;
            }
        }
        if (pick == null) {
            MediaController prev = current;
            if (prev != null) {
                for (MediaController c : watching) {
                    if (c.getSessionToken().equals(prev.getSessionToken())) {
                        pick = c;
                        break;
                    }
                }
            }
        }
        if (pick == null) {
            for (MediaController c : watching) {
                if (c.getMetadata() != null) {
                    pick = c;
                    break;
                }
            }
        }
        current = pick;
    }

    /* ---------------- xuất dữ liệu ---------------- */

    private void schedulePublish() {
        main.removeCallbacks(publishTask);
        main.postDelayed(publishTask, 150);
    }

    private void publishIfChanged() {
        String j = toJson().toString();
        if (!j.equals(lastJson)) {
            lastJson = j;
            Listener l = listener;
            if (l != null) l.onNowPlaying();
        }
    }

    private String appLabel(String pkg) {
        try {
            PackageManager pm = ctx.getPackageManager();
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (Exception e) {
            return pkg;
        }
    }

    public JSONObject toJson() {
        JSONObject o = new JSONObject();
        try {
            o.put("access", isGranted());
            MediaController c = current;
            if (c == null) {
                o.put("active", false);
                o.put("playing", false);
                return o;
            }
            MediaMetadata md = c.getMetadata();
            PlaybackState ps = c.getPlaybackState();
            String title = md == null ? null : md.getString(MediaMetadata.METADATA_KEY_TITLE);
            String artist = md == null ? null : md.getString(MediaMetadata.METADATA_KEY_ARTIST);
            if (artist == null && md != null) artist = md.getString(MediaMetadata.METADATA_KEY_ALBUM_ARTIST);
            String pkg = c.getPackageName();
            o.put("active", title != null || artist != null);
            o.put("playing", ps != null && ps.getState() == PlaybackState.STATE_PLAYING);
            o.put("title", title == null ? "" : title);
            o.put("artist", artist == null ? "" : artist);
            o.put("pkg", pkg);
            o.put("app", appLabel(pkg));
        } catch (JSONException e) {
            Log.w(TAG, "now JSON lỗi", e);
        }
        return o;
    }

    /** cmd: toggle | play | pause | next | prev */
    public void control(String cmd) {
        MediaController c = current;
        if (c == null || cmd == null) return;
        try {
            MediaController.TransportControls t = c.getTransportControls();
            PlaybackState ps = c.getPlaybackState();
            boolean playing = ps != null && ps.getState() == PlaybackState.STATE_PLAYING;
            if (cmd.equals("toggle")) {
                if (playing) t.pause();
                else t.play();
            } else if (cmd.equals("play")) {
                t.play();
            } else if (cmd.equals("pause")) {
                t.pause();
            } else if (cmd.equals("next")) {
                t.skipToNext();
            } else if (cmd.equals("prev")) {
                t.skipToPrevious();
            }
        } catch (Exception e) {
            Log.w(TAG, "Điều khiển media lỗi", e);
        }
    }
}
