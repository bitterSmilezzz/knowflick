package com.knowflick.desktop

import java.io.File
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermissions

/**
 * 桌面端的凭据存储：数据目录下一个 **0600** 权限的文件。
 *
 * 这是明确的**平台边界**（Android 用 Keystore / EncryptedSharedPreferences），所以各端各写一份；
 * 但要如实告知强度差别——设置页据 `credentialsEncrypted = false` 显示「已降级为明文存储」，
 * 用户必须知情（与 Android 侧降级时的同一条纪律）。
 *
 * 有意**未接** OS 钥匙串（macOS Keychain / Windows DPAPI / libsecret）：先把能力对齐，
 * 钥匙串集成单列一项，见 [docs/adr/0001](../../../../../../docs/adr/0001-desktop-tri-platform-shared-kotlin.md)。
 */
class DesktopCredentialStore(private val dir: File) {

    private fun file(name: String): File = File(dir, "$name.credential")

    /** 读凭据；不存在或读不到一律返回空串（调用方按「未配置」处理，不抛异常） */
    fun load(name: String): String = runCatching { file(name).readText() }.getOrDefault("")

    /** 原子性不是这里的重点（单文件、无备份轮转），但**权限必须是 0600** */
    fun save(name: String, value: String): Boolean = runCatching {
        dir.mkdirs()
        val target = file(name)
        target.writeText(value)
        restrictToOwner(target)
        true
    }.getOrElse { false }

    fun delete(name: String): Boolean = runCatching { !file(name).exists() || file(name).delete() }.getOrDefault(false)

    private fun restrictToOwner(target: File) {
        // Windows 上 POSIX 视图不存在（UnsupportedOperationException），此时退回 File API；
        // 两者都做不到时也不静默——由设置页的「明文存储」提示兜住用户知情权。
        runCatching {
            Files.setPosixFilePermissions(target.toPath(), PosixFilePermissions.fromString("rw-------"))
        }.onFailure {
            target.setReadable(false, false)
            target.setReadable(true, true)
            target.setWritable(false, false)
            target.setWritable(true, true)
        }
    }
}
