package vn.q14.audiolab;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.audiofx.AudioEffect;
import android.os.IBinder;
import android.util.Log;

public class EqService extends Service {
    private static final String TAG = "Q14Service";
    private static final String CHANNEL = "q14_eq";

    public static volatile boolean running = false;
    public static volatile EqEngine engineRef = null;
    public static volatile String lastError = null;

    private EqEngine engine;
    private WsServer ws;
    private StaticServer http;
    private BroadcastReceiver receiver;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (running) return START_STICKY;
        lastError = null;

        NotificationChannel ch = new NotificationChannel(CHANNEL, "Q14 EQ", NotificationManager.IMPORTANCE_LOW);
        getSystemService(NotificationManager.class).createNotificationChannel(ch);
        PendingIntent pi = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, CHANNEL)
                .setContentTitle("Q14 Audio Lab đang chạy")
                .setContentText("Nhận thông số EQ từ website qua 127.0.0.1")
                .setSmallIcon(android.R.drawable.stat_sys_headset)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
        startForeground(1, n);

        engine = new EqEngine();
        engine.start();
        engineRef = engine;

        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                String a = i.getAction();
                int sid = i.getIntExtra(AudioEffect.EXTRA_AUDIO_SESSION, -1);
                String pkg = i.getStringExtra(AudioEffect.EXTRA_PACKAGE_NAME);
                if (AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION.equals(a)) {
                    engine.openSession(sid, pkg);
                } else if (AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION.equals(a)) {
                    engine.closeSession(sid);
                }
            }
        };
        IntentFilter f = new IntentFilter();
        f.addAction(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION);
        f.addAction(AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION);
        registerReceiver(receiver, f);

        try {
            ws = new WsServer(engine);
            ws.start();
            http = new StaticServer(this);
            http.start();
        } catch (Exception e) {
            Log.e(TAG, "Không khởi động được server", e);
            lastError = "Không khởi động được server: " + e.getMessage();
        }
        running = true;
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        try { if (receiver != null) unregisterReceiver(receiver); } catch (Exception ignored) { }
        try { if (ws != null) ws.stop(300); } catch (Exception ignored) { }
        try { if (http != null) http.stop(); } catch (Exception ignored) { }
        if (engine != null) engine.releaseAll();
        engineRef = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
