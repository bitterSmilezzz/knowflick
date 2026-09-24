package com.knowflick.app.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNotSame
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.coroutines.CoroutineContext

@Config(sdk = [35])
@RunWith(RobolectricTestRunner::class)
class SystemCredentialStoreTest {

    @Test
    fun saveAndDeleteRunOnTheConfiguredIoDispatcher() = runBlocking {
        val callerThread = Thread.currentThread()
        val executorDispatcher = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "credential-store-test-io")
        }.asCoroutineDispatcher()
        val recordingDispatcher = RecordingDispatcher(executorDispatcher)
        val store = SystemCredentialStore(
            ApplicationProvider.getApplicationContext<Context>(),
            recordingDispatcher,
        )
        val account = "credential-store-test"

        try {
            assertTrue(store.save("test-value", account))
            val saveThread = assertNotNull(recordingDispatcher.lastDispatchedThread.get())
            assertNotSame(callerThread, saveThread)
            assertEquals("credential-store-test-io", saveThread.name)
            assertEquals("test-value", store.read(account))

            recordingDispatcher.lastDispatchedThread.set(null)
            assertTrue(store.delete(account))
            val deleteThread = assertNotNull(recordingDispatcher.lastDispatchedThread.get())
            assertNotSame(callerThread, deleteThread)
            assertEquals("credential-store-test-io", deleteThread.name)
            assertNull(store.read(account))
        } finally {
            try {
                store.delete(account)
            } finally {
                executorDispatcher.close()
            }
        }
    }

    private class RecordingDispatcher(
        private val delegate: CoroutineDispatcher,
    ) : CoroutineDispatcher() {
        val lastDispatchedThread = AtomicReference<Thread?>()

        override fun dispatch(context: CoroutineContext, block: Runnable) {
            delegate.dispatch(context, Runnable {
                lastDispatchedThread.set(Thread.currentThread())
                block.run()
            })
        }
    }
}
