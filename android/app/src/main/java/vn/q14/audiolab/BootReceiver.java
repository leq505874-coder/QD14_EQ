package vn.q14.audiolab;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

/** Tự bật dịch vụ EQ sau khi khởi động máy nếu người dùng đã bật "Tự bật khi khởi động". */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        SharedPreferences p = context.getSharedPreferences(EqEngine.PREFS, Context.MODE_PRIVATE);
        if (!p.getBoolean("autostart", false)) return;
        try {
            context.startForegroundService(new Intent(context, EqService.class));
        } catch (Exception e) {
            Log.w("Q14Boot", "Không tự bật được dịch vụ", e);
        }
    }
}
