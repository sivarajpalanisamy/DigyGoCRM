# Flutter / Dart embedding - keep the engine + plugin registrant
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-keep class io.flutter.embedding.** { *; }
-dontwarn io.flutter.**

# App native channel (default-dialer / battery)
-keep class co.digygo.digygo_dialer.** { *; }

# Plugins that use reflection / native bindings
-keep class com.it_nomads.fluttersecurestorage.** { *; }
-keep class com.tekartik.sqflite.** { *; }
-keep class com.baseflow.permissionhandler.** { *; }

# Keep annotations and native method names
-keepattributes *Annotation*
-keepclasseswithmembernames class * {
    native <methods>;
}
