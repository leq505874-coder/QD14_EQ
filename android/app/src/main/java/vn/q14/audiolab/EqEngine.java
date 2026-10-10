package vn.q14.audiolab;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioDeviceInfo;
import android.media.audiofx.AudioEffect;
import android.media.audiofx.BassBoost;
import android.media.audiofx.DynamicsProcessing;
import android.media.audiofx.Equalizer;
import android.media.audiofx.LoudnessEnhancer;
import android.media.audiofx.Virtualizer;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Quản lý các hiệu ứng âm thanh của Android (AudioEffect) và lưu trạng thái để dùng lại sau khi
 * khởi động máy.
 *
 * - Hiệu ứng "toàn cục" gắn vào audio session 0. Android đã đánh dấu cách này là deprecated; nhiều
 *   máy bỏ qua hoặc từ chối. Trạng thái thật được báo về giao diện, không giả định.
 * - Hiệu ứng "theo phiên" gắn vào session ID mà ứng dụng khác công bố qua broadcast
 *   ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION.
 * - Ngoài EQ còn có Bass Boost, Virtualizer, LoudnessEnhancer (cũng có thể bị máy từ chối).
 * - Auto EQ: tự áp dụng profile theo thiết bị phát (loa ngoài / có dây / Bluetooth).
 */
public final class EqEngine {
    private static final String TAG = "Q14Eq";
    public static final String PREFS = "eqo";

    /** Tần số tâm 10 băng (Hz), khớp website. */
    public static final int[] FREQS = {31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};
    /** Cạnh trên của từng băng cho DynamicsProcessing (Hz). */
    private static final float[] EDGES = {44f, 88f, 177f, 354f, 707f, 1414f, 2828f, 5657f, 11314f, 22050f};
    private static final String[] DEVICE_KEYS = {"speaker", "wired", "bluetooth"};

    public interface Listener {
        void onChanged();
    }

    private static final class Slot {
        int session;
        String pkg;
        String kind = "";
        AudioEffect effect;
        boolean ok;
        String message = "";
        int bands;
        String rangeDb = "";
        BassBoost bassFx;
        Virtualizer virtFx;
        LoudnessEnhancer loudFx;
        String bassMsg = "";
        String virtMsg = "";
        String loudMsg = "";
    }

    private final SharedPreferences prefs;
    private final Handler saver = new Handler(Looper.getMainLooper());
    private final Runnable saveTask = new Runnable() {
        @Override
        public void run() {
            saveNow();
        }
    };
    private Listener listener;

    private final Map<Integer, Slot> slots = new LinkedHashMap<>();
    private final Map<Integer, String> known = new LinkedHashMap<>();
    private Slot global;
    private String mode = "global";        // global | sessions | both
    private String enginePref = "auto";    // auto | equalizer | dynamics
    private boolean enabled = false;
    private final float[] gains = new float[10];
    private int bass = 0;                  // 0..100
    private int virt = 0;                  // 0..100
    private float loudDb = 0f;             // 0..12
    private boolean autostart = false;
    private boolean autoEnabled = false;
    private final Map<String, float[]> profiles = new HashMap<>();
    private String deviceKey = null;
    private String lastAutoKey = null;
    private String autoApplied = null;
    private long autoSeq = 0;
    private List<String> effectNames;

    public EqEngine(Context ctx) {
        prefs = ctx.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        load();
    }

    public synchronized void setListener(Listener l) {
        listener = l;
    }

    private void fireChanged() {
        Listener l = listener;
        if (l != null) l.onChanged();
    }

    /* ---------------- lưu / nạp ---------------- */

    private void load() {
        enabled = prefs.getBoolean("enabled", false);
        String g = prefs.getString("gains", "");
        if (g != null && !g.isEmpty()) {
            String[] p = g.split(",");
            if (p.length == 10) {
                try {
                    for (int i = 0; i < 10; i++) gains[i] = Float.parseFloat(p[i]);
                } catch (NumberFormatException e) {
                    Arrays.fill(gains, 0f);
                }
            }
        }
        String m = prefs.getString("mode", "global");
        if ("global".equals(m) || "sessions".equals(m) || "both".equals(m)) mode = m;
        String en = prefs.getString("engine", "auto");
        if ("auto".equals(en) || "equalizer".equals(en) || "dynamics".equals(en)) enginePref = en;
        bass = Math.max(0, Math.min(100, prefs.getInt("bass", 0)));
        virt = Math.max(0, Math.min(100, prefs.getInt("virt", 0)));
        loudDb = Math.max(0f, Math.min(12f, prefs.getFloat("loud", 0f)));
        autostart = prefs.getBoolean("autostart", false);
        autoEnabled = prefs.getBoolean("autoEnabled", false);
        String pj = prefs.getString("profiles", "");
        if (pj != null && !pj.isEmpty()) {
            try {
                putProfiles(new JSONObject(pj));
            } catch (JSONException e) {
                profiles.clear();
            }
        }
    }

    private void putProfiles(JSONObject o) {
        profiles.clear();
        if (o == null) return;
        for (String k : DEVICE_KEYS) {
            JSONArray a = o.optJSONArray(k);
            if (a != null && a.length() == 10) {
                float[] f = new float[10];
                for (int i = 0; i < 10; i++) f[i] = clamp((float) a.optDouble(i, 0.0));
                profiles.put(k, f);
            }
        }
    }

    private void scheduleSave() {
        saver.removeCallbacks(saveTask);
        saver.postDelayed(saveTask, 600);
    }

    private synchronized void saveNow() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 10; i++) {
            if (i > 0) sb.append(',');
            sb.append(gains[i]);
        }
        JSONObject po = new JSONObject();
        try {
            for (Map.Entry<String, float[]> e : profiles.entrySet()) {
                JSONArray a = new JSONArray();
                for (float f : e.getValue()) a.put((double) f);
                po.put(e.getKey(), a);
            }
        } catch (JSONException ignored) {
        }
        prefs.edit()
                .putBoolean("enabled", enabled)
                .putString("gains", sb.toString())
                .putString("mode", mode)
                .putString("engine", enginePref)
                .putInt("bass", bass)
                .putInt("virt", virt)
                .putFloat("loud", loudDb)
                .putBoolean("autostart", autostart)
                .putBoolean("autoEnabled", autoEnabled)
                .putString("profiles", po.toString())
                .apply();
    }

    private static float clamp(float v) {
        if (Float.isNaN(v)) return 0f;
        return Math.max(-24f, Math.min(24f, v));
    }

    /* ---------------- vòng đời ---------------- */

    public synchronized void start() {
        rebuild();
    }

    public synchronized void releaseAll() {
        saver.removeCallbacks(saveTask);
        saveNow();
        releaseSlots();
    }

    public synchronized void configure(String newMode, String newEngine, Boolean newAutostart) {
        boolean ch = false;
        if (newMode != null && (newMode.equals("global") || newMode.equals("sessions") || newMode.equals("both"))
                && !newMode.equals(mode)) {
            mode = newMode;
            ch = true;
        }
        if (newEngine != null && (newEngine.equals("auto") || newEngine.equals("equalizer") || newEngine.equals("dynamics"))
                && !newEngine.equals(enginePref)) {
            enginePref = newEngine;
            ch = true;
        }
        if (newAutostart != null && newAutostart.booleanValue() != autostart) {
            autostart = newAutostart.booleanValue();
            scheduleSave();
        }
        if (ch) {
            rebuild();
            scheduleSave();
        }
    }

    public synchronized void setEq(boolean on, float[] g) {
        enabled = on;
        for (int i = 0; i < 10 && i < g.length; i++) gains[i] = clamp(g[i]);
        reapplyAll();
        scheduleSave();
    }

    public synchronized void setFx(int bassPct, int virtPct, float loud) {
        bass = Math.max(0, Math.min(100, bassPct));
        virt = Math.max(0, Math.min(100, virtPct));
        loudDb = Math.max(0f, Math.min(12f, Float.isNaN(loud) ? 0f : loud));
        if (global != null) applyFx(global);
        for (Slot s : slots.values()) applyFx(s);
        scheduleSave();
    }

    public synchronized void setAuto(boolean en, JSONObject newProfiles) {
        if (en && !autoEnabled) lastAutoKey = null;
        autoEnabled = en;
        if (newProfiles != null) putProfiles(newProfiles);
        if (!en) autoApplied = null;
        evaluateAuto();
        scheduleSave();
    }

    /** Gọi khi thiết bị phát đổi (cắm/ngắt tai nghe, Bluetooth...). */
    public synchronized void updateDevice(String key) {
        if (key == null) return;
        deviceKey = key;
        evaluateAuto();
    }

    private void evaluateAuto() {
        if (!autoEnabled || deviceKey == null || deviceKey.equals(lastAutoKey)) return;
        lastAutoKey = deviceKey;
        float[] p = profiles.get(deviceKey);
        if (p == null) return;                       // "Giữ nguyên"
        System.arraycopy(p, 0, gains, 0, 10);
        autoApplied = deviceKey;
        autoSeq = System.currentTimeMillis();
        reapplyAll();
        scheduleSave();
        fireChanged();
    }

    public static String classify(AudioDeviceInfo[] devices) {
        boolean bt = false;
        boolean wired = false;
        if (devices != null) {
            for (AudioDeviceInfo d : devices) {
                int t = d.getType();
                if (t == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP || t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                        || t == 26 /* BLE_HEADSET */ || t == 27 /* BLE_SPEAKER */) {
                    bt = true;
                } else if (t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_WIRED_HEADSET
                        || t == AudioDeviceInfo.TYPE_USB_HEADSET || t == AudioDeviceInfo.TYPE_USB_DEVICE) {
                    wired = true;
                }
            }
        }
        return bt ? "bluetooth" : (wired ? "wired" : "speaker");
    }

    public synchronized void openSession(int id, String pkg) {
        if (id <= 0) return;
        known.put(id, pkg == null ? "?" : pkg);
        if (usesSessions()) {
            releaseSlot(slots.remove(id));
            slots.put(id, create(id, pkg == null ? "?" : pkg));
        }
    }

    public synchronized void closeSession(int id) {
        known.remove(id);
        releaseSlot(slots.remove(id));
    }

    /* ---------------- nội bộ ---------------- */

    private boolean usesGlobal() {
        return mode.equals("global") || mode.equals("both");
    }

    private boolean usesSessions() {
        return mode.equals("sessions") || mode.equals("both");
    }

    private void reapplyAll() {
        if (global != null && global.ok) reapply(global);
        for (Slot s : slots.values()) if (s.ok) reapply(s);
    }

    private void rebuild() {
        releaseSlots();
        global = null;
        if (usesGlobal()) global = create(0, "(toàn cục)");
        if (usesSessions()) {
            for (Map.Entry<Integer, String> e : known.entrySet()) {
                slots.put(e.getKey(), create(e.getKey(), e.getValue()));
            }
        }
    }

    private void releaseSlots() {
        releaseSlot(global);
        for (Slot s : slots.values()) releaseSlot(s);
        slots.clear();
        global = null;
    }

    private void rel(AudioEffect e) {
        if (e == null) return;
        try {
            e.release();
        } catch (Throwable t) {
            Log.w(TAG, "release lỗi", t);
        }
    }

    private void releaseSlot(Slot s) {
        if (s == null) return;
        rel(s.effect);
        rel(s.bassFx);
        rel(s.virtFx);
        rel(s.loudFx);
        s.effect = null;
        s.bassFx = null;
        s.virtFx = null;
        s.loudFx = null;
        s.ok = false;
    }

    private Slot create(int session, String pkg) {
        Slot s = new Slot();
        s.session = session;
        s.pkg = pkg;
        String[] order;
        if (enginePref.equals("equalizer")) order = new String[]{"equalizer"};
        else if (enginePref.equals("dynamics")) order = new String[]{"dynamics"};
        else order = session == 0 ? new String[]{"equalizer", "dynamics"} : new String[]{"dynamics", "equalizer"};

        StringBuilder err = new StringBuilder();
        for (String k : order) {
            if (s.ok) break;
            try {
                if (k.equals("equalizer")) createEqualizer(s);
                else createDynamics(s);
            } catch (Throwable t) {
                err.append(k).append(": ").append(brief(t)).append("; ");
                Log.w(TAG, "tạo " + k + " cho session " + session + " thất bại", t);
            }
        }
        if (!s.ok) s.message = err.length() > 0 ? err.toString() : "không có bộ xử lý nào khả dụng";
        createFx(s);
        return s;
    }

    private void createEqualizer(Slot s) {
        Equalizer eq = new Equalizer(0, s.session);
        try {
            if (!eq.hasControl()) {
                throw new IllegalStateException("không có quyền điều khiển hiệu ứng (đang bị ứng dụng khác giữ)");
            }
            short[] r = eq.getBandLevelRange();
            s.bands = eq.getNumberOfBands();
            s.rangeDb = (r[0] / 100) + " đến " + (r[1] / 100) + " dB";
            s.effect = eq;
            s.kind = "Equalizer";
            applyTo(s);
            s.ok = true;
        } catch (RuntimeException e) {
            s.effect = null;
            eq.release();
            throw e;
        }
    }

    private void createDynamics(Slot s) {
        DynamicsProcessing.Config cfg = new DynamicsProcessing.Config.Builder(
                DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
                2,          // kênh
                true, 10,   // PreEQ: 10 băng
                false, 0,   // MBC: không dùng
                false, 0,   // PostEQ: không dùng
                false)      // limiter: không dùng
                .build();
        DynamicsProcessing dp = new DynamicsProcessing(0, s.session, cfg);
        try {
            if (!dp.hasControl()) {
                throw new IllegalStateException("không có quyền điều khiển hiệu ứng (đang bị ứng dụng khác giữ)");
            }
            s.bands = 10;
            s.rangeDb = "10 băng";
            s.effect = dp;
            s.kind = "DynamicsProcessing";
            applyTo(s);
            s.ok = true;
        } catch (RuntimeException e) {
            s.effect = null;
            dp.release();
            throw e;
        }
    }

    private void createFx(Slot s) {
        try {
            s.bassFx = new BassBoost(0, s.session);
        } catch (Throwable t) {
            s.bassMsg = brief(t);
        }
        try {
            s.virtFx = new Virtualizer(0, s.session);
        } catch (Throwable t) {
            s.virtMsg = brief(t);
        }
        try {
            s.loudFx = new LoudnessEnhancer(s.session);
        } catch (Throwable t) {
            s.loudMsg = brief(t);
        }
        applyFx(s);
    }

    private void applyFx(Slot s) {
        if (s.bassFx != null) {
            try {
                if (bass > 0) {
                    if (s.bassFx.getStrengthSupported()) s.bassFx.setStrength((short) (bass * 10));
                    s.bassFx.setEnabled(true);
                } else {
                    s.bassFx.setEnabled(false);
                }
                s.bassMsg = "";
            } catch (Throwable t) {
                s.bassMsg = brief(t);
            }
        }
        if (s.virtFx != null) {
            try {
                if (virt > 0) {
                    if (s.virtFx.getStrengthSupported()) s.virtFx.setStrength((short) (virt * 10));
                    s.virtFx.setEnabled(true);
                } else {
                    s.virtFx.setEnabled(false);
                }
                s.virtMsg = "";
            } catch (Throwable t) {
                s.virtMsg = brief(t);
            }
        }
        if (s.loudFx != null) {
            try {
                s.loudFx.setTargetGain(Math.round(loudDb * 100f));
                s.loudFx.setEnabled(loudDb > 0f);
                s.loudMsg = "";
            } catch (Throwable t) {
                s.loudMsg = brief(t);
            }
        }
    }

    private void reapply(Slot s) {
        try {
            applyTo(s);
            s.message = "";
        } catch (Throwable t) {
            s.ok = false;
            s.message = brief(t);
            Log.w(TAG, "áp dụng EQ lỗi", t);
        }
    }

    /** Ném exception nếu thiết bị từ chối. */
    private void applyTo(Slot s) {
        if (s.effect instanceof Equalizer) {
            Equalizer eq = (Equalizer) s.effect;
            short[] r = eq.getBandLevelRange();
            short n = eq.getNumberOfBands();
            for (short b = 0; b < n; b++) {
                float hz = eq.getCenterFreq(b) / 1000f;   // mHz -> Hz
                float g = enabled ? interpolate(hz) : 0f;
                int mb = Math.round(g * 100f);
                mb = Math.max(r[0], Math.min(r[1], mb));
                eq.setBandLevel(b, (short) mb);
            }
            int res = eq.setEnabled(enabled);
            if (enabled && res != AudioEffect.SUCCESS) {
                throw new IllegalStateException("setEnabled trả về mã lỗi " + res);
            }
        } else if (s.effect instanceof DynamicsProcessing) {
            DynamicsProcessing dp = (DynamicsProcessing) s.effect;
            for (int i = 0; i < 10; i++) {
                dp.setPreEqBandAllChannelsTo(i,
                        new DynamicsProcessing.EqBand(true, EDGES[i], enabled ? gains[i] : 0f));
            }
            int res = dp.setEnabled(enabled);
            if (enabled && res != AudioEffect.SUCCESS) {
                throw new IllegalStateException("setEnabled trả về mã lỗi " + res);
            }
        }
    }

    /** Nội suy tuyến tính theo log(tần số) từ 10 băng của giao diện. */
    private float interpolate(float hz) {
        if (hz <= FREQS[0]) return gains[0];
        if (hz >= FREQS[9]) return gains[9];
        for (int i = 0; i < 9; i++) {
            if (hz <= FREQS[i + 1]) {
                double t = (Math.log(hz) - Math.log(FREQS[i])) / (Math.log(FREQS[i + 1]) - Math.log(FREQS[i]));
                return (float) (gains[i] + (gains[i + 1] - gains[i]) * t);
            }
        }
        return gains[9];
    }

    private static String brief(Throwable t) {
        String m = t.getMessage();
        return t.getClass().getSimpleName() + (m == null ? "" : " (" + m + ")");
    }

    /* ---------------- báo cáo trạng thái ---------------- */

    public synchronized String summary() {
        StringBuilder sb = new StringBuilder();
        sb.append("Chế độ: ").append(mode).append(" · bộ xử lý: ").append(enginePref).append('\n');
        if (global == null) {
            sb.append("Toàn cục: tắt");
        } else if (global.ok) {
            sb.append("Toàn cục: đã khởi tạo [").append(global.kind).append("], ").append(global.bands).append(" băng");
        } else {
            sb.append("Toàn cục: LỖI — ").append(global.message);
        }
        sb.append("\nPhiên ứng dụng thấy được: ").append(known.size());
        return sb.toString();
    }

    private List<String> effectNames() {
        if (effectNames == null) {
            effectNames = new ArrayList<>();
            try {
                AudioEffect.Descriptor[] ds = AudioEffect.queryEffects();
                if (ds != null) {
                    for (AudioEffect.Descriptor d : ds) {
                        effectNames.add(d.name + " / " + d.implementor);
                    }
                }
            } catch (Throwable t) {
                effectNames.add("không truy vấn được: " + brief(t));
            }
        }
        return effectNames;
    }

    private JSONObject fxJson(AudioEffect e, String msg, boolean haveSlot) throws JSONException {
        JSONObject j = new JSONObject();
        j.put("ok", haveSlot && e != null && msg.isEmpty());
        String text;
        if (!haveSlot) text = "chưa có hiệu ứng nào";
        else if (msg.isEmpty() && e == null) text = "không khả dụng";
        else text = msg;
        j.put("message", text);
        return j;
    }

    public synchronized JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            o.put("type", "status");
            o.put("protocol", 2);
            o.put("mode", mode);
            o.put("enginePref", enginePref);
            o.put("enabled", enabled);
            o.put("autostart", autostart);

            JSONArray ga = new JSONArray();
            for (float f : gains) ga.put((double) f);
            o.put("gains", ga);

            JSONObject g = new JSONObject();
            if (global == null) {
                g.put("state", "off");
            } else if (global.ok) {
                g.put("state", "ok");
                g.put("kind", global.kind);
                g.put("bands", global.bands);
                g.put("rangeDb", global.rangeDb);
            } else {
                g.put("state", "error");
                g.put("message", global.message);
            }
            o.put("global", g);

            JSONArray arr = new JSONArray();
            for (Map.Entry<Integer, String> e : known.entrySet()) {
                JSONObject j = new JSONObject();
                j.put("id", e.getKey());
                j.put("pkg", e.getValue());
                Slot s = slots.get(e.getKey());
                if (s == null) {
                    j.put("ok", false);
                    j.put("message", "chưa áp dụng (chế độ hiện tại không dùng phiên ứng dụng)");
                } else {
                    j.put("ok", s.ok);
                    j.put("kind", s.kind);
                    j.put("message", s.message);
                }
                arr.put(j);
            }
            o.put("sessions", arr);

            Slot fs = global;
            if (fs == null && !slots.isEmpty()) fs = slots.values().iterator().next();
            JSONObject fx = new JSONObject();
            fx.put("bass", fxJson(fs == null ? null : fs.bassFx, fs == null ? "" : fs.bassMsg, fs != null));
            fx.put("virt", fxJson(fs == null ? null : fs.virtFx, fs == null ? "" : fs.virtMsg, fs != null));
            fx.put("loud", fxJson(fs == null ? null : fs.loudFx, fs == null ? "" : fs.loudMsg, fs != null));
            o.put("fx", fx);

            JSONObject au = new JSONObject();
            au.put("enabled", autoEnabled);
            au.put("key", deviceKey == null ? "" : deviceKey);
            au.put("applied", autoApplied == null ? JSONObject.NULL : autoApplied);
            au.put("seq", autoSeq);
            o.put("auto", au);

            JSONObject d = new JSONObject();
            d.put("model", Build.MODEL);
            d.put("release", Build.VERSION.RELEASE);
            d.put("sdk", Build.VERSION.SDK_INT);
            d.put("effects", new JSONArray(effectNames()));
            o.put("device", d);
        } catch (JSONException e) {
            Log.w(TAG, "status JSON lỗi", e);
        }
        return o;
    }
}
