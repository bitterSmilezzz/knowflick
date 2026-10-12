package com.knowflick.app.net

import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException

/** OkHttp 异步桥接：协程取消时立即取消 socket，响应体始终在 OkHttp 工作线程消费并关闭。 */
/**
 * **对外开放**：`:app` 的 WebClipFetcher / RemoteSpeechClient 与将来的桌面端都用它。
 * 本模块内部工具不该是 internal——Kotlin 的 internal 按**模块**算，跨模块调用直接编译不过。
 */
suspend fun <T> OkHttpClient.executeCancellable(
    request: Request,
    consume: (Response) -> T,
): T = suspendCancellableCoroutine { continuation ->
    val call = newCall(request)
    continuation.invokeOnCancellation { call.cancel() }
    call.enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isActive) continuation.resumeWith(Result.failure(e))
        }

        override fun onResponse(call: Call, response: Response) {
            val result = runCatching { response.use(consume) }
            if (continuation.isActive) continuation.resumeWith(result)
        }
    })
}
