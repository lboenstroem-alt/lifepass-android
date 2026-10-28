package lifepass.mealimage

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.util.Base64
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.sharedobjects.SharedRef
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt

/**
 * The two things the meal photo needs that no installed library does without
 * writing a file (MEAL-3, plan acceptance "No photo is ever written to disk";
 * iOS `MealImageEncoder`: "Nothing here writes a file").
 *
 * - `encodeJpegAsync(image, quality)`: a decoded bitmap (expo-image-manipulator's
 *   rendered image, or expo-camera's picture ref) as JPEG bytes, in base64,
 *   compressed into memory. expo-image-manipulator's own `saveAsync` always
 *   writes the JPEG into the cache folder first.
 * - `pickImageAsync()`: the system Photo Picker (the same androidx contract
 *   expo-image-picker launches, with its Google Play services backport on
 *   older phones), answering with the picked photo's `content://` URI. The
 *   photo is then decoded straight from the provider, in memory.
 *   expo-image-picker always copies the original, metadata and all, into the
 *   cache folder before it answers.
 *
 * Neither keeps anything: the bitmap stays the caller's, and a pick that
 * returns after the activity was recreated is handed to the call still
 * waiting (or dropped, when the process died: nothing was copied).
 */
class MealImageModule : Module() {
  private lateinit var pickerLauncher: AppContextActivityResultLauncher<String, PickResult>

  /** The pick in flight; one at a time. */
  private var pendingPick: CompletableDeferred<PickResult>? = null

  override fun definition() = ModuleDefinition {
    Name("LifePassMealImage")

    AsyncFunction("encodeJpegAsync") Coroutine { image: SharedRef<Bitmap>, quality: Double ->
      val bitmap = image.ref
      val percent = (quality * 100).roundToInt().coerceIn(0, 100)
      withContext(Dispatchers.Default) {
        val bytes = ByteArrayOutputStream().use { out ->
          if (!bitmap.compress(Bitmap.CompressFormat.JPEG, percent, out)) throw MealImageEncodeException()
          out.toByteArray()
        }
        Base64.encodeToString(bytes, Base64.NO_WRAP)
      }
    }

    /** The picked photo's content URI; null when the member backed out (or a pick is already open). */
    AsyncFunction("pickImageAsync") Coroutine { ->
      if (pendingPick?.isActive == true) return@Coroutine null
      val pick = CompletableDeferred<PickResult>()
      pendingPick = pick
      try {
        withContext(Dispatchers.Main) {
          pickerLauncher.launch(PICK_INPUT) { result -> pick.complete(result) }
        }
        when (val result = pick.await()) {
          is PickResult.Picked -> result.uri.toString()
          PickResult.Cancelled -> null
          PickResult.Failed -> throw MealImagePickException()
        }
      } finally {
        if (pendingPick === pick) pendingPick = null
      }
    }

    RegisterActivityContracts {
      pickerLauncher = registerForActivityResult(PhotoPickerContract()) { _, result ->
        // The activity was recreated while the picker was open: the call
        // that opened it is still waiting in this process (or, if the
        // process died, nothing is: nothing was copied, the member picks again).
        pendingPick?.complete(result)
      }
    }
  }

  private companion object {
    /** The contract's input has to be Serializable; there is nothing to say but "a photo". */
    const val PICK_INPUT = "image"
  }
}

internal sealed class PickResult {
  data class Picked(val uri: Uri) : PickResult()
  object Cancelled : PickResult()
  object Failed : PickResult()
}

/** androidx `PickVisualMedia`, images only, in Expo's activity-result shape. */
internal class PhotoPickerContract : AppContextActivityResultContract<String, PickResult> {
  private val picker = PickVisualMedia()

  override fun createIntent(context: Context, input: String): Intent =
    picker.createIntent(
      context,
      PickVisualMediaRequest.Builder().setMediaType(PickVisualMedia.ImageOnly).build()
    )

  override fun parseResult(input: String, resultCode: Int, intent: Intent?): PickResult {
    if (resultCode == Activity.RESULT_CANCELED) return PickResult.Cancelled
    val uri = picker.parseResult(resultCode, intent) ?: return PickResult.Failed
    return PickResult.Picked(uri)
  }
}

internal class MealImageEncodeException :
  CodedException("ERR_MEAL_IMAGE_ENCODE", "The photo could not be encoded as a JPEG", null)

internal class MealImagePickException :
  CodedException("ERR_MEAL_IMAGE_PICK", "The Photo Picker answered without a photo", null)
