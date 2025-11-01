package com.anonymous.stepple

import android.app.Activity
import android.content.Intent
import android.util.Log
import androidx.core.app.ActivityCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.contracts.HealthPermissionsRequestContract
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.facebook.react.bridge.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.Instant

class HealthConnectModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val requiredPermissions = setOf(
    HealthPermission.getReadPermission(StepsRecord::class)
  )
  private var permissionPromise: Promise? = null
  private val permissionRequestCode: Int = 10001

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "HealthConnectModule"

  @ReactMethod
  fun getSdkStatus(promise: Promise) {
    val status = HealthConnectClient.getSdkStatus(reactApplicationContext)
    Log.d(TAG, "getSdkStatus -> $status")
    promise.resolve(status)
  }

  @ReactMethod
  fun hasPermissions(promise: Promise) {
    scope.launch {
      try {
        val client = getClientOrNull()
        if (client == null) {
          promise.resolve(false)
          return@launch
        }
        val granted = client.permissionController.getGrantedPermissions()
        promise.resolve(granted.containsAll(requiredPermissions))
      } catch (e: Exception) {
        promise.reject("HC_PERMISSIONS", e)
      }
    }
  }

  @ReactMethod
  fun requestPermissions(promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("HC_NO_ACTIVITY", "Unable to request permissions without an active activity.")
      return
    }

    scope.launch {
      val status = HealthConnectClient.getSdkStatus(reactApplicationContext)
      Log.d(TAG, "requestPermissions status -> $status")
      if (status != HealthConnectClient.SDK_AVAILABLE) {
        promise.reject("HC_UNAVAILABLE", "Health Connect SDK unavailable: $status")
        return@launch
      }

      val client = getClientOrNull()
      if (client == null) {
        promise.reject("HC_UNAVAILABLE", "Unable to initialize Health Connect client.")
        return@launch
      }

      val alreadyGranted =
        client.permissionController.getGrantedPermissions().containsAll(requiredPermissions)
      if (alreadyGranted) {
        promise.resolve(true)
        return@launch
      }

      permissionPromise = promise
      try {
        val intent = HealthPermissionsRequestContract().createIntent(activity, requiredPermissions)
        launchIntent(activity, intent)
      } catch (e: Exception) {
        permissionPromise = null
        promise.reject("HC_PERMISSION_INTENT", e)
      }
    }
  }

  @ReactMethod
  fun readSteps(startMillis: Double, endMillis: Double, promise: Promise) {
    scope.launch {
      try {
        val client = getClientOrNull()
        if (client == null) {
          promise.reject("HC_UNAVAILABLE", "Health Connect client unavailable.")
          return@launch
        }
        Log.d(TAG, "readSteps range: $startMillis -> $endMillis")
        val request = ReadRecordsRequest(
          recordType = StepsRecord::class,
          timeRangeFilter = TimeRangeFilter.between(
            Instant.ofEpochMilli(startMillis.toLong()),
            Instant.ofEpochMilli(endMillis.toLong())
          )
        )
        val response = client.readRecords(request)
        val total = response.records.sumOf { it.count }
        Log.d(TAG, "readSteps total -> $total")
        promise.resolve(total)
      } catch (e: Exception) {
        promise.reject("HC_READ", e)
      }
    }
  }

  override fun onActivityResult(activity: Activity?, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode == permissionRequestCode) {
      val promise = permissionPromise
      permissionPromise = null
      if (promise == null) {
        return
      }
      scope.launch {
        try {
          val client = getClientOrNull()
          if (client == null) {
            promise.reject("HC_UNAVAILABLE", "Health Connect client unavailable.")
            return@launch
          }
          val granted = client.permissionController.getGrantedPermissions().containsAll(requiredPermissions)
          Log.d(TAG, "onActivityResult granted -> $granted")
          promise.resolve(granted)
        } catch (e: Exception) {
          promise.reject("HC_PERMISSIONS", e)
        }
      }
    }
  }

  override fun onNewIntent(intent: Intent?) {
    // no-op
  }

  @ReactMethod
  fun openSettings(promise: Promise) {
    val activity = currentActivity
    if (activity == null) {
      promise.reject("HC_NO_ACTIVITY", "Unable to open settings without an active activity.")
      return
    }

    try {
      val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
      activity.startActivity(intent)
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("HC_SETTINGS", e)
    }
  }

  private fun getClientOrNull(): HealthConnectClient? {
    return try {
      if (HealthConnectClient.getSdkStatus(reactApplicationContext) == HealthConnectClient.SDK_AVAILABLE) {
        HealthConnectClient.getOrCreate(reactApplicationContext)
      } else {
        null
      }
    } catch (e: Exception) {
      null
    }
  }

  private fun launchIntent(activity: Activity, intent: Intent) {
    reactApplicationContext.runOnUiQueueThread {
      try {
        ActivityCompat.startActivityForResult(activity, intent, permissionRequestCode, null)
      } catch (e: Exception) {
        Log.e(TAG, "launchIntent failed", e)
        val promise = permissionPromise
        permissionPromise = null
        promise?.reject("HC_PERMISSION_INTENT", e)
      }
    }
  }

  companion object {
    private const val TAG = "HealthConnectModule"
  }
}
