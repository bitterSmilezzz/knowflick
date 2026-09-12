package com.knowflick.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import com.knowflick.app.ui.KnowFlickTheme

/** 应用入口；M1 为占位骨架，M2 起接入刷卡主界面 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            KnowFlickTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    Text(text = "KnowFlick")
                }
            }
        }
    }
}
