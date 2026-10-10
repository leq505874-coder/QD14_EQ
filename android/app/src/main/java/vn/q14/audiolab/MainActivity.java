package vn.q14.audiolab;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/** Màn hình điều khiển tối giản: bật/tắt dịch vụ cầu nối. Giao diện EQ chính nằm trên website. */
public class MainActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView status;
    private Button toggle;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            refresh();
            handler.postDelayed(this, 1000);
        }
    };

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private TextView text(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setPadding(0, dp(6), 0, dp(6));
        return t;
    }

    private Button button(String s, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setOnClickListener(l);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.topMargin = dp(8);
        b.setLayoutParams(p);
        return b;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(28), dp(20), dp(20));
        root.setBackgroundColor(Color.parseColor("#0b0e14"));
        root.setGravity(Gravity.TOP);

        root.addView(text("Q14 Audio Lab", 24, Color.parseColor("#37d6c4")));
        root.addView(text("Cầu nối Android. Giao diện EQ nằm trên website; app này chỉ nhận thông số và áp dụng hiệu ứng âm thanh.",
                14, Color.parseColor("#8b95ad")));

        status = text("", 14, Color.WHITE);
        root.addView(status);

        toggle = button("", v -> {
            Intent i = new Intent(this, EqService.class);
            if (EqService.running) stopService(i);
            else startForegroundService(i);
            handler.postDelayed(this::refresh, 400);
        });
        root.addView(toggle);

        root.addView(button("Mở giao diện EQ nhúng (dự phòng)", v -> {
            if (!EqService.running) {
                Toast.makeText(this, "Hãy bật dịch vụ EQ trước", Toast.LENGTH_SHORT).show();
                return;
            }
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("http://127.0.0.1:8766/")));
        }));

        root.addView(button("Cài đặt tối ưu pin (nên chọn Không hạn chế)", v ->
                startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))));

        ScrollView sv = new ScrollView(this);
        sv.addView(root);
        setContentView(sv);
    }

    private void refresh() {
        boolean run = EqService.running;
        toggle.setText(run ? "Tắt dịch vụ EQ" : "Bật dịch vụ EQ");
        StringBuilder sb = new StringBuilder();
        sb.append("Dịch vụ: ").append(run ? "ĐANG CHẠY" : "ĐÃ TẮT").append('\n');
        if (run) {
            sb.append("WebSocket: ws://127.0.0.1:").append(WsServer.PORT).append('\n');
            sb.append("Giao diện nhúng: http://127.0.0.1:").append(StaticServer.PORT).append("/\n\n");
            EqEngine e = EqService.engineRef;
            if (e != null) sb.append(e.summary());
        }
        if (EqService.lastError != null) sb.append("\n\n").append(EqService.lastError);
        sb.append("\n\nLưu ý: \"đã khởi tạo\" chỉ nghĩa là Android không từ chối hiệu ứng. Hãy nghe thử với YouTube để xác nhận.");
        status.setText(sb.toString());
    }

    @Override
    protected void onResume() {
        super.onResume();
        handler.post(tick);
    }

    @Override
    protected void onPause() {
        handler.removeCallbacks(tick);
        super.onPause();
    }
}
