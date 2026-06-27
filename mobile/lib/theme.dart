import 'package:flutter/material.dart';

/// DigyGo brand palette - mirrors the CRM web app.
class Brand {
  static const primary = Color(0xFFC2410C);
  static const accent = Color(0xFFEA580C);
  static const accent2 = Color(0xFFF97316);
  static const ink = Color(0xFF1C1410);
  static const muted = Color(0xFF7A6B5C);
  static const bg = Color(0xFFFAF8F6);
}

ThemeData buildTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: Brand.accent,
    primary: Brand.primary,
    brightness: Brightness.light,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: Brand.bg,
    appBarTheme: const AppBarTheme(
      backgroundColor: Brand.bg,
      foregroundColor: Brand.ink,
      elevation: 0,
      centerTitle: false,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Brand.accent,
        foregroundColor: Colors.white,
        minimumSize: const Size.fromHeight(52),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0x14000000)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: const BorderSide(color: Color(0x14000000)),
      ),
    ),
  );
}
