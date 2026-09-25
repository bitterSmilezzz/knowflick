package com.knowflick.app

import kotlinx.coroutines.runBlocking
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.knowflick.app.data.SystemCredentialStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * 凭据持久化设备级验证：Keystore 加密存储跨实例读写（此前是内存实现，重启即丢）。
 * 运行：./gradlew :app:connectedDebugAndroidTest
 */
@RunWith(AndroidJUnit4::class)
class CredentialPersistenceTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun credentialsSurviveNewStoreInstance() {
        val store = SystemCredentialStore(context)
        assertTrue("设备应支持 Keystore 加密存储", store.isEncrypted)

        assertTrue(runBlocking { store.save("sk-persist-test", "apiKey") })
        assertTrue(runBlocking { store.save("tts-secret", "tts.key") })

        // 新实例（模拟进程重启）应能读到
        val reopened = SystemCredentialStore(context)
        assertEquals("sk-persist-test", reopened.read("apiKey"))
        assertEquals("tts-secret", reopened.read("tts.key"))

        // 清理
        assertTrue(runBlocking { reopened.delete("apiKey") })
        assertTrue(runBlocking { reopened.delete("tts.key") })
        assertNull(SystemCredentialStore(context).read("apiKey"))
    }

    @Test
    fun settingsJsonNeverContainsCredentials() {
        // 回归护栏：密钥只进 Keystore，不进 settings.json / speech.json（通过 UiAutomator 层验证文件）
        val store = SystemCredentialStore(context)
        runBlocking { store.save("sk-should-not-leak", "apiKey") }
        val filesDir = context.filesDir
        val storeDir = java.io.File(filesDir, "store")
        listOf("settings.json", "speech.json").forEach { name ->
            val file = java.io.File(storeDir, name)
            if (file.exists()) {
                assertTrue("$name 不应包含密钥明文", !file.readText().contains("sk-should-not-leak"))
            }
        }
        runBlocking { store.delete("apiKey") }
    }
}
