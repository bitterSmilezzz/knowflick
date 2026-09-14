package com.knowflick.app.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * 生产凭据存储：EncryptedSharedPreferences（Android Keystore 主密钥加密）。
 * 初始化失败（极少数设备 Keystore 异常）时回退普通 SharedPreferences 并标记降级，
 * 保证功能可用且不静默丢数据。
 */
class SystemCredentialStore(context: Context) : CredentialStore {

    private val prefs: SharedPreferences
    private val encrypted: Boolean

    init {
        val (store, isEncrypted) = createStore(context.applicationContext)
        prefs = store
        encrypted = isEncrypted
    }

    /** 是否运行在加密存储上（设置页可提示降级） */
    val isEncrypted: Boolean get() = encrypted

    override fun read(account: String): String? = prefs.getString(account, null)

    override fun save(value: String, account: String): Boolean = try {
        prefs.edit().putString(account, value).commit()
    } catch (_: Exception) {
        false
    }

    override fun delete(account: String): Boolean = try {
        prefs.edit().remove(account).commit()
    } catch (_: Exception) {
        false
    }

    private fun createStore(context: Context): Pair<SharedPreferences, Boolean> {
        return try {
            val masterKey = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            val encryptedPrefs = EncryptedSharedPreferences.create(
                context,
                "knowflick_credentials",
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
            encryptedPrefs to true
        } catch (_: Exception) {
            // Keystore 不可用：回退普通存储（数据不丢，安全等级降级）
            context.getSharedPreferences("knowflick_credentials_plain", Context.MODE_PRIVATE) to false
        }
    }
}
