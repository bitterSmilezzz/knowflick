// 本文件集中封装「已被 androidx 弃用但仍是当前凭据存储实现」的 API：
// EncryptedSharedPreferences / MasterKey 自 security-crypto 1.1.0 起被标记弃用
//（官方指引改用 AndroidKeyStore + KeyGenerator）。降级到文件级抑制是为了同时覆盖
// import 行；迁移完成后整个文件会被替换（TODO 见类内 KDoc）。
@file:Suppress("DEPRECATION")

package com.knowflick.app.data

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 生产凭据存储：EncryptedSharedPreferences（Android Keystore 主密钥加密）。写入与删除在 IO
 * dispatcher 上执行同步落盘，继续把结果交给设置页，同时避免 Keystore 加密和 fsync 卡住主线程。
 * 初始化失败（极少数设备 Keystore 异常）时回退普通 SharedPreferences 并标记降级，
 * 保证功能可用且不静默丢数据。
 *
 * 该降级标记（[isEncrypted]）由设置页消费，降级时显示橙色提示条——静默把 API Key
 * 写成明文是不可接受的。
 */
class SystemCredentialStore internal constructor(
    context: Context,
    private val ioDispatcher: CoroutineDispatcher = Dispatchers.IO,
) : CredentialStore {

    private val prefs: SharedPreferences
    private val encrypted: Boolean

    init {
        val (store, isEncrypted) = createStore(context.applicationContext)
        prefs = store
        encrypted = isEncrypted
    }

    /** 是否运行在加密存储上（设置页据此提示降级） */
    val isEncrypted: Boolean get() = encrypted

    override fun read(account: String): String? = prefs.getString(account, null)

    /**
     * 凭据写入必须落盘并把结果回传给设置页的成功/失败提示，因此保留 `commit()`：
     * - 返回值是 [CredentialStore.save] 的接口契约（`MainActivity` → `SettingsScreen`
     *   据此显示「已保存并生效 ✓」还是「写入设备失败，请重试」）；`apply()` 返回 void，
     *   改用它会让失败分支变成不可达的静默假成功；
     * - 凭据是「丢了就必须回服务商重新复制一次」的数据，不能容忍 `apply()` 的后台排队
     *   在进程被杀时丢写。
     *
     * `save` / `delete` 是 suspend API，`commit()` 在 IO dispatcher 执行，避免 Keystore 加解密
     * 与 fsync 阻塞主线程，同时保留可上报的落盘结果。
     *
     * TODO(技术债)：凭据存储迁移到 DataStore + Tink（或直接用 AndroidKeyStore + KeyGenerator）
     * 以摆脱已被 androidx 弃用的 `EncryptedSharedPreferences`/`MasterKey`。
     */
    @SuppressLint("ApplySharedPref")
    override suspend fun save(value: String, account: String): Boolean = withContext(ioDispatcher) {
        try {
            prefs.edit().putString(account, value).commit()
        } catch (_: Exception) {
            false
        }
    }

    /** 同 [save]：返回值驱动设置页提示，故保留 `commit()`，由 IO dispatcher 执行。 */
    @SuppressLint("ApplySharedPref")
    override suspend fun delete(account: String): Boolean = withContext(ioDispatcher) {
        try {
            prefs.edit().remove(account).commit()
        } catch (_: Exception) {
            false
        }
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
            // Keystore 不可用：回退普通存储（数据不丢，安全等级降级，由设置页显式告知用户）
            context.getSharedPreferences("knowflick_credentials_plain", Context.MODE_PRIVATE) to false
        }
    }
}
