# Tink's optional Error Prone analysis annotations are absent from its Android
# runtime dependency graph. Suppress only these four annotation references.
# https://github.com/tink-crypto/tink-java/issues/7
-dontwarn com.google.errorprone.annotations.CanIgnoreReturnValue
-dontwarn com.google.errorprone.annotations.CheckReturnValue
-dontwarn com.google.errorprone.annotations.Immutable
-dontwarn com.google.errorprone.annotations.RestrictedApi
