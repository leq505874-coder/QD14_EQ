package vn.q14.audiolab;

import android.util.Log;

import org.java_websocket.WebSocket;
import org.java_websocket.handshake.ClientHandshake;
import org.java_websocket.server.WebSocketServer;
import org.json.JSONArray;
import org.json.JSONObject;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.UnknownHostException;
import java.util.Locale;

/**
 * WebSocket chỉ lắng nghe trên 127.0.0.1:8765. Chỉ chấp nhận Origin của GitHub Pages (*.github.io)
 * và bản nhúng http://127.0.0.1:8766. Có domain riêng thì thêm vào EXTRA_ORIGINS.
 */
public final class WsServer extends WebSocketServer {
    private static final String TAG = "Q14Ws";
    public static final int PORT = 8765;
    private static final String[] EXTRA_ORIGINS = {
            // "https://audio.example.com",
    };

    private final EqEngine engine;
    private volatile NowPlayingMonitor nowPlaying;

    private static InetSocketAddress loopback() {
        try {
            return new InetSocketAddress(InetAddress.getByAddress(new byte[]{127, 0, 0, 1}), PORT);
        } catch (UnknownHostException e) {
            return new InetSocketAddress("127.0.0.1", PORT);
        }
    }

    public WsServer(EqEngine engine) {
        super(loopback());
        this.engine = engine;
        setReuseAddr(true);
        setConnectionLostTimeout(30);
    }

    public void setNowPlaying(NowPlayingMonitor m) {
        nowPlaying = m;
    }

    /** Trạng thái EQ kèm bài đang phát (khoá "now") trong cùng một tin nhắn. */
    public String statusJson() {
        try {
            JSONObject st = engine.status();
            NowPlayingMonitor np = nowPlaying;
            if (np != null) st.put("now", np.toJson());
            return st.toString();
        } catch (Exception e) {
            return engine.status().toString();
        }
    }

    static boolean originAllowed(String origin) {
        if (origin == null) return false;
        String o = origin.trim().toLowerCase(Locale.ROOT);
        if (o.equals("http://127.0.0.1:8766") || o.equals("http://localhost:8766")) return true;
        for (String x : EXTRA_ORIGINS) if (o.equals(x.toLowerCase(Locale.ROOT))) return true;
        if (o.startsWith("https://")) {
            String host = o.substring(8);
            int colon = host.indexOf(':');
            if (colon >= 0) host = host.substring(0, colon);
            return host.endsWith(".github.io");
        }
        return false;
    }

    @Override
    public void onOpen(WebSocket conn, ClientHandshake hs) {
        String origin = hs.getFieldValue("Origin");
        if (!originAllowed(origin)) {
            Log.w(TAG, "Từ chối Origin: " + origin);
            conn.close(1008, "origin not allowed");
        }
    }

    @Override
    public void onClose(WebSocket conn, int code, String reason, boolean remote) { }

    @Override
    public void onMessage(WebSocket conn, String message) {
        try {
            JSONObject m = new JSONObject(message);
            String type = m.optString("type", "");
            if (type.equals("config")) {
                Boolean autostart = null;
                if (m.has("autostart")) autostart = Boolean.valueOf(m.optBoolean("autostart"));
                engine.configure(m.optString("mode", null), m.optString("engine", null), autostart);
            } else if (type.equals("setEq")) {
                JSONArray a = m.optJSONArray("gains");
                if (a != null && a.length() == 10) {
                    float[] g = new float[10];
                    for (int i = 0; i < 10; i++) g[i] = (float) a.optDouble(i, 0.0);
                    engine.setEq(m.optBoolean("enabled", false), g);
                }
            } else if (type.equals("fx")) {
                engine.setFx(m.optInt("bass", 0), m.optInt("virt", 0), (float) m.optDouble("loud", 0.0));
            } else if (type.equals("auto")) {
                engine.setAuto(m.optBoolean("enabled", false), m.optJSONObject("profiles"));
            } else if (type.equals("media")) {
                NowPlayingMonitor np = nowPlaying;
                if (np != null) np.control(m.optString("cmd", ""));
            }
            // hello / getStatus: chỉ cần trả trạng thái (kèm bài đang phát nếu có)
            conn.send(statusJson());
        } catch (Exception e) {
            Log.w(TAG, "Tin nhắn lỗi", e);
        }
    }

    @Override
    public void onError(WebSocket conn, Exception ex) {
        Log.e(TAG, "WebSocket lỗi", ex);
        if (conn == null) EqService.lastError = "WebSocket không khởi động được: " + ex.getMessage();
    }

    @Override
    public void onStart() {
        Log.i(TAG, "WebSocket đang chạy trên 127.0.0.1:" + PORT);
    }
}
