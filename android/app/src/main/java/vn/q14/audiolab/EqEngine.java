package vn.q14.audiolab;

import android.media.audiofx.AudioEffect;
import android.media.audiofx.DynamicsProcessing;
import android.media.audiofx.Equalizer;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Quản lý các hiệu ứng EQ của Android (AudioEffect).
 *
 * - Hiệu ứng "toàn cục" gắn vào audio session 0 (mix đầu ra). Android đã đánh dấu cách này là
 *   deprecated; nhiều máy bỏ qua hoặc từ chối. Trạng thái thật được báo về website, không giả định.
 * - Hiệu ứng "theo phiên" gắn vào session ID mà ứng dụng khác tự công bố qua broadcast
 *   ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION (chỉ ứng dụng nào gửi broadcast này mới thấy được).
 */
public final class EqEngine {
    private static final String TAG = "Q14Eq";

    /** Tần số tâm 10 băng (Hz), khớp website. */
    public static final int[] FREQS = {31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000};
    /** Cạnh trên của từng băng cho DynamicsProcessing (Hz). */
    private static final float[] EDGES = {44f, 88f, 177f, 354f, 707f, 1414f, 2828f, 5657f, 11314f, 22050f};

    private static final class Slot {
        int session;
        String pkg;
        String kind = "";
        AudioEffect effect;
        boolean ok;
        String message = "";
        int bands;
        String rangeDb = "";
    }

    private final Map<Integer, Slot> slots = new LinkedHashMap<>();
    private final Map<Integer, String> known = new LinkedHashMap<>();
    private Slot global;
    private String mode = "global";        // global | sessions | both
    private String enginePref = "auto";    // auto | equalizer | dynamics
    private boolean enabled = false;
    private final float[] gains = new float[10];
    private List<String> effectNames;

    /* ---------------- vòng đời ---------------- */

    public synchronized void start() {
        rebuild();
    }

    public synchronized void releaseAll() {
        releaseSlots();
    }

    public synchronized void configure(String newMode, String newEngine) {
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
        if (ch) rebuild();
    }

    public synchronized void setEq(boolean on, float[] g) {
        enabled = on;
        for (int i = 0; i < 10 && i < g.length; i++) {
            gains[i] = Math.max(-24f, Math.min(24f, g[i]));
        }
        if (global != null && global.ok) reapply(global);
        for (Slot s : slots.values()) if (s.ok) reapply(s);
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

    private boolean usesGlobal() { return mode.equals("global") || mode.equals("both"); }
    private boolean usesSessions() { return mode.equals("sessions") || mode.equals("both"); }

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

    private void releaseSlot(Slot s) {
        if (s == null || s.effect == null) return;
        try {
            s.effect.release();
        } catch (Throwable t) {
            Log.w(TAG, "release lỗi", t);
        }
        s.effect = null;
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

    /** Nội suy tuyến tính theo log(tần số) từ 10 băng của website. */
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

    public synchronized JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            o.put("type", "status");
            o.put("protocol", 1);
            o.put("mode", mode);
            o.put("enginePref", enginePref);
            o.put("enabled", enabled);

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
