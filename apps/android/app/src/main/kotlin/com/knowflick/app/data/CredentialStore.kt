package com.knowflick.app.data

/**
 * 凭据持久化：与 JSON 设置分置，可注入替身（移植自 macOS CredentialStore 设计）。
 * 生产实现走 Android Keystore（EncryptedSharedPreferences）；测试用内存替身。
 * 写入与删除为 suspend 操作，生产实现会在 IO dispatcher 上同步落盘并返回结果。
 */
interface CredentialStore {
    fun read(account: String): String?
    suspend fun save(value: String, account: String): Boolean
    suspend fun delete(account: String): Boolean
}

/** 内存替身：无副作用，JVM/Robolectric 测试可用 */
class InMemoryCredentialStore : CredentialStore {
    val values: MutableMap<String, String> = HashMap()
    override fun read(account: String): String? = values[account]
    override suspend fun save(value: String, account: String): Boolean {
        values[account] = value
        return true
    }
    override suspend fun delete(account: String): Boolean {
        values.remove(account)
        return true
    }
}
