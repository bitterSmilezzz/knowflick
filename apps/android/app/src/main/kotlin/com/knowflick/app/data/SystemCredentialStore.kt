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

/**
 * 生产凭据存储：EncryptedSharedPreferences（Android Keystore 主密钥加密）。
 * 初始化失败（极少数设备 Keystore 异常）时回退普通 SharedPreferences 并标记降级，
 * 保证功能可用且不静默丢数据。
 *
 * 该降级标记（[isEncrypted]）由设置页消费，降级时显示橙色提示条——静默把 API Key
 * 写成明文是不可接受的。
 */
class SystemCredentialStore(context: Context) : CredentialStore {

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
     * 凭据写入必须**同步**落盘并把结果回传给设置页的成功/失败提示，因此保留 `commit()`：
     * - 返回值是 [CredentialStore.save] 的接口契约（`MainActivity` → `SettingsScreen`
     *   据此显示「已保存并生效 ✓」还是「写入设备失败，请重试」）；`apply()` 返回 void，
     *   改用它会让失败分支变成不可达的静默假成功；
     * - 凭据是「丢了就必须回服务商重新复制一次」的数据，不能容忍 `apply()` 的后台排队
     *   在进程被杀时丢写。
     *
     * 已知代价：`commit()` 在主线程执行（Compose 点击回调），含 Keystore 加解密 + fsync，
     * 可能带来数十毫秒卡顿。要同时保住「返回值可上报」与「不阻塞主线程」需要把
     * save/delete 改成 suspend（API 变更），已登记为独立技术债。
     *
     * TODO(技术债)：凭据存储迁移到 DataStore + Tink（或直接用 AndroidKeyStore + KeyGenerator）
     * 以摆脱已被 androidx 弃用的 `EncryptedSharedPreferences`/`MasterKey`，届时同步改 suspend。
     */
    @SuppressLint("ApplySharedPref")
    override fun save(value: String, account: String): Boolean = try {
        prefs.edit().putString(account, value).commit()
    } catch (_: Exception) {
        false
    }

    /** 同 [save]：返回值驱动设置页提示，故保留 `commit()`。 */
    @SuppressLint("ApplySharedPref")
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
            // Keystore 不可用：回退普通存储（数据不丢，安全等级降级，由设置页显式告知用户）
            context.getSharedPreferences("knowflick_credentials_plain", Context.MODE_PRIVATE) to false
        }
    }
}
