package vn.q14.audiolab;

import android.content.Context;

import java.io.IOException;
import java.io.InputStream;

import fi.iki.elonen.NanoHTTPD;

/** Phục vụ bản website nhúng (assets = thư mục web/) tại http://127.0.0.1:8766/ làm phương án dự phòng. */
public final class StaticServer extends NanoHTTPD {
    public static final int PORT = 8766;
    private final Context ctx;

    public StaticServer(Context ctx) {
        super("127.0.0.1", PORT);
        this.ctx = ctx.getApplicationContext();
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        if (uri.equals("/") || uri.isEmpty()) uri = "/index.html";
        if (uri.contains("..")) return notFound();
        try {
            InputStream in = ctx.getAssets().open(uri.substring(1));
            Response r = newChunkedResponse(Response.Status.OK, getMimeTypeForFile(uri), in);
            r.addHeader("Cache-Control", "no-cache");
            return r;
        } catch (IOException e) {
            return notFound();
        }
    }

    private Response notFound() {
        return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "404");
    }
}
