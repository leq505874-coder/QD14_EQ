package vn.q14.audiolab;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;

/**
 * EQo: mở app là thấy ngay giao diện EQ (trang web nhúng trong assets, phục vụ bởi EqService
 * tại 127.0.0.1:8766). Dịch vụ tự bật khi mở app và vẫn chạy nền khi thoát.
 * Các chức năng (pin, thoát, màu thanh trạng thái) được trang web gọi qua cầu nối EQoNative.
 */
public class MainActivity extends Activity {
    private static final String URL = "http://127.0.0.1:8766/";
    private static final int REQ_FILE = 1;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private int retries = 0;

    /** Cầu nối cho trang web nhúng (chỉ tải nội dung từ 127.0.0.1). */
    public class Bridge {
        @JavascriptInterface
        public void batterySettings() {
            runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)));
        }

        @JavascriptInterface
        public void openNotificationAccess() {
            runOnUiThread(() -> startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        }

        @JavascriptInterface
        public void stopAndExit() {
            runOnUiThread(() -> {
                stopService(new Intent(MainActivity.this, EqService.class));
                finishAffinity();
            });
        }

        @JavascriptInterface
        public void setBarColor(final String hex) {
            runOnUiThread(() -> {
                try {
                    int c = Color.parseColor(hex);
                    getWindow().setStatusBarColor(c);
                    getWindow().setNavigationBarColor(c);
                    getWindow().setBackgroundDrawable(new ColorDrawable(c));
                    if (web != null) web.setBackgroundColor(c);
                } catch (Exception ignored) {
                }
            });
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!EqService.running) startForegroundService(new Intent(this, EqService.class));

        int bg = Color.parseColor("#0b0e14");
        getWindow().setBackgroundDrawable(new ColorDrawable(bg));
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);

        web = new WebView(this);
        web.setBackgroundColor(bg);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage: lưu preset và cài đặt
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        web.addJavascriptInterface(new Bridge(), "EQoNative");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                // Server nhúng có thể chưa kịp khởi động: thử lại vài lần
                if (r.isForMainFrame() && retries++ < 20) {
                    handler.postDelayed(() -> web.loadUrl(URL), 700);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("127.0.0.1".equals(u.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, u));
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView w, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("audio/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Chọn nhạc"), REQ_FILE);
                } catch (Exception e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onJsAlert(WebView v, String url, String msg, JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(msg)
                        .setPositiveButton("OK", (d, w) -> r.confirm())
                        .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView v, String url, String msg, JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(msg)
                        .setPositiveButton("OK", (d, w) -> r.confirm())
                        .setNegativeButton("Huỷ", (d, w) -> r.cancel())
                        .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }

            @Override
            public boolean onJsPrompt(WebView v, String url, String msg, String def, JsPromptResult r) {
                EditText input = new EditText(MainActivity.this);
                input.setText(def);
                new AlertDialog.Builder(MainActivity.this).setMessage(msg).setView(input)
                        .setPositiveButton("OK", (d, w) -> r.confirm(input.getText().toString()))
                        .setNegativeButton("Huỷ", (d, w) -> r.cancel())
                        .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }
        });

        setContentView(web);
        handler.postDelayed(() -> web.loadUrl(URL), 600);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE && fileCb != null) {
            Uri[] r = null;
            if (resultCode == RESULT_OK && data != null) {
                r = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            }
            fileCb.onReceiveValue(r);
            fileCb = null;
        } else {
            super.onActivityResult(requestCode, resultCode, data);
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else moveTaskToBack(true);   // thoát giao diện nhưng EQ vẫn chạy nền
    }

    @Override
    protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        web.destroy();
        super.onDestroy();
    }
}
